// Value imports use relative paths so this module (and its tests) run under
// `node --test`. Type-only imports are erased and may use the `@/` alias.
import { leadWriteToInsert } from "../supabase/mappers.ts";
import { computeLeadEvents, type LeadSnapshot } from "./events.ts";
import {
  escapeLike,
  normalizeEmail,
  phoneMatchKey,
  pickDedupMatch,
  type DedupMatch,
} from "./lead-dedup.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadData } from "@/types/chat";
import type { LeadTemperature } from "@/lib/lead-scoring";
import type {
  Database,
  TablesInsert,
  TablesUpdate,
} from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

export interface PersistChatTurnInput {
  organizationId: string;
  /** Conversation id from a previous turn, if any. */
  conversationId: string | null;
  /**
   * Per-turn idempotency key from the client. Two truly identical requests
   * carry the same value, and the unique indexes added in
   * `20260904130000_chat_idempotency.sql` collapse their writes into one.
   * Absent / `null` for a client that doesn't send it — persistence still
   * works, just without the concurrency guarantee.
   */
  requestId?: string | null;
  /** Conversation channel for a newly created conversation ("web" | "whatsapp" | …). */
  channel: string;
  /** Lead source for a newly created lead. */
  source: string | null;
  /** The user message that triggered this turn. */
  userMessage: string;
  /** The completed assistant reply for this turn. */
  assistantMessage: string;
  lead: LeadData;
  score: number;
  temperature: LeadTemperature;
  /**
   * External channel contact id (e.g. a WhatsApp `wa_id`). When set and no
   * `conversationId` is given, the conversation is resolved / created by
   * `(organization_id, channel, external_contact_id)` so repeat messages from
   * the same customer reuse one lead + one conversation.
   */
  externalContactId?: string | null;
  /** Provider message id of the inbound user message (e.g. a WhatsApp `wamid`). */
  userProviderMessageId?: string | null;
}

export interface PersistChatTurnResult {
  conversationId: string;
  leadId: string;
  leadCreated: boolean;
  messagesInserted: number;
  eventsInserted: number;
}

export class PersistenceError extends Error {
  readonly step: string;
  readonly cause?: unknown;
  constructor(step: string, cause?: unknown) {
    super(`persistence failed at "${step}"`);
    this.name = "PersistenceError";
    this.step = step;
    this.cause = cause;
  }
}

export type PersistenceFailureReason = "transient" | "permanent";

interface PostgrestLikeError {
  code?: string | null;
  message?: string;
}

function isPostgrestLikeError(value: unknown): value is PostgrestLikeError {
  return typeof value === "object" && value !== null && ("code" in value || "message" in value);
}

/**
 * Best-effort classification for alert triage — NOT what makes a retry safe.
 * Retrying is ALWAYS safe here regardless of this classification, via the
 * requestId/contact-key idempotency guarantees documented on
 * {@link persistChatTurn} — this only picks the "reason" tag a caller logs.
 *
 *  - "permanent": the database was reached and rejected the write for a
 *    structural reason — a real Postgres/PostgREST error code is present.
 *    Retrying the identical request will most likely fail the same way.
 *  - "transient": everything else. Most commonly the database/network was
 *    unreachable at all — a fetch-level failure carries no Postgres error
 *    code. Treated as the safer default: an unrecognized shape is assumed
 *    worth escalating/retrying rather than silently downgraded.
 */
export function classifyPersistenceFailure(error: unknown): PersistenceFailureReason {
  const cause = error instanceof PersistenceError ? error.cause : error;
  if (isPostgrestLikeError(cause) && typeof cause.code === "string" && cause.code.length > 0) {
    return "permanent";
  }
  return "transient";
}

interface RecentMessage {
  role: string;
  content: string;
}

/** A retried request re-sends the same message content for the same role. */
function alreadyPersisted(
  recent: RecentMessage[],
  role: "user" | "assistant",
  content: string,
): boolean {
  return recent.some((m) => m.role === role && m.content === content);
}

/**
 * Find an existing lead for this org by a contact key. Tenant-scoped
 * (`organization_id`) + bounded. Returns the id only on an UNAMBIGUOUS match
 * (exactly one row) — 0 or 2+ → create a fresh lead rather than merge wrongly.
 *
 * **Advisory only.** This is a plain SELECT, not a lock — two concurrent
 * callers can both see "no match" and both proceed to the insert step. It's
 * used purely to fetch a `previous` snapshot for lead-change events before a
 * likely match; the actual no-duplicate guarantee against a genuinely
 * concurrent identical-contact insert is the database unique index on the
 * match key itself (`20260912090000_lead_contact_dedup.sql`), enforced by
 * the `ON CONFLICT ... DO UPDATE` in the insert branch below.
 */
async function findLeadByContact(
  db: Db,
  organizationId: string,
  match: DedupMatch,
): Promise<string | null> {
  const base = db
    .from("leads")
    .select("id")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(2);

  const query =
    match.by === "email"
      ? base.ilike("email", escapeLike(match.value))
      : base.ilike("phone", `%${escapeLike(match.matchKey)}`);

  const { data, error } = await query;
  if (error) throw new PersistenceError("dedup lead lookup", error);
  return data && data.length === 1 ? data[0].id : null;
}

/**
 * Persist one completed chat turn: upsert the lead, reuse or create the
 * conversation, append the completed user + assistant messages, and record
 * lead events for any state changes.
 *
 * **Concurrency-safe.** Every write that could be duplicated by two
 * simultaneous requests is guarded by a database unique index:
 * - lead / conversation creation (exact retry, same `requestId`) →
 *   `unique (organization_id, creation_request_id)`
 * - a new lead WITH contact info, from two DIFFERENT sessions (no shared
 *   `requestId` — e.g. the same visitor opening two tabs, or a traffic spike
 *   of many people texting one shared/example number) →
 *   `unique (organization_id, email_match_key)` /
 *   `unique (organization_id, phone_match_key)`
 *   (`20260912090000_lead_contact_dedup.sql`)
 * - messages → `unique (conversation_id, role, request_id)`
 * - lead events → `unique (lead_id, request_id, event_type)`
 *
 * The loser of a race either gets `ON CONFLICT DO NOTHING` and reads back the
 * winner's row (exact-retry paths), or `ON CONFLICT DO UPDATE` and merges
 * into the winner's row directly (contact-match path) — either way the
 * result is identical for both callers and nothing is duplicated.
 *
 * Throws {@link PersistenceError} on any database error — the caller decides
 * whether that should affect the response.
 */
export async function persistChatTurn(
  db: Db,
  input: PersistChatTurnInput,
): Promise<PersistChatTurnResult> {
  const nowIso = new Date().toISOString();
  const requestId = input.requestId ?? null;

  // 1. Resolve the conversation: by the id the client already has, or — if a
  //    concurrent identical request created it first — by (org, request_id).
  let conversationId: string | null = null;
  let leadId: string | null = null;

  if (input.conversationId) {
    const { data, error } = await db
      .from("conversations")
      .select("id, lead_id, organization_id")
      .eq("id", input.conversationId)
      .maybeSingle();
    if (error) throw new PersistenceError("load conversation", error);
    if (data && data.organization_id === input.organizationId) {
      conversationId = data.id;
      leadId = data.lead_id;
    }
  }

  if (!conversationId && requestId) {
    const { data, error } = await db
      .from("conversations")
      .select("id, lead_id")
      .eq("organization_id", input.organizationId)
      .eq("creation_request_id", requestId)
      .maybeSingle();
    if (error) throw new PersistenceError("load conversation by request", error);
    if (data) {
      conversationId = data.id;
      leadId = data.lead_id;
    }
  }

  // External channel (WhatsApp): reuse the customer's existing conversation.
  if (!conversationId && input.externalContactId) {
    const { data, error } = await db
      .from("conversations")
      .select("id, lead_id")
      .eq("organization_id", input.organizationId)
      .eq("channel", input.channel)
      .eq("external_contact_id", input.externalContactId)
      .maybeSingle();
    if (error) {
      throw new PersistenceError("load conversation by contact", error);
    }
    if (data) {
      conversationId = data.id;
      leadId = data.lead_id;
    }
  }

  // No conversation matched → we would create a new lead. First try to attach
  // this conversation to an EXISTING lead for the same org, matched by contact
  // detail (a widget visitor often returns in a fresh browser session). Phone
  // matching is format-agnostic — see `lead-dedup.ts`.
  if (leadId === null) {
    const match = pickDedupMatch({
      email: input.lead.email,
      phone: input.lead.phone,
    });
    if (match) {
      const matched = await findLeadByContact(db, input.organizationId, match);
      if (matched) leadId = matched;
    }
  }

  const startedWithLead = leadId !== null;

  // 2. Snapshot the lead's current state (for change events).
  let previous: LeadSnapshot | null = null;
  if (leadId) {
    const { data, error } = await db
      .from("leads")
      .select("score, temperature, status")
      .eq("id", leadId)
      .maybeSingle();
    if (error) throw new PersistenceError("load lead", error);
    if (data) {
      previous = {
        score: data.score,
        temperature: data.temperature,
        status: data.status,
      };
    } else {
      leadId = null; // conversation pointed at a deleted lead — recreate
    }
  }

  // 3. Upsert the lead (mapper is the only camelCase ↔ snake_case boundary).
  const mapped = leadWriteToInsert({
    organizationId: input.organizationId,
    lead: input.lead,
    score: input.score,
    temperature: input.temperature,
    source: input.source ?? undefined,
  });
  // Raw (not `mapped`) — normalizeEmail/phoneMatchKey do their own parsing,
  // same inputs `pickDedupMatch` above already used.
  const emailMatchKey = normalizeEmail(input.lead.email);
  const phoneKey = phoneMatchKey(input.lead.phone);
  let leadCreated: boolean;

  if (leadId) {
    // Existing lead — update the mutable columns only. An UPDATE never
    // creates a row, so this branch is not part of the dedup race at all;
    // included here so a lead that gains contact info this turn becomes
    // matchable by it next time.
    const leadUpdate: TablesUpdate<"leads"> = {
      name: mapped.name,
      phone: mapped.phone,
      email: mapped.email,
      intent: mapped.intent,
      custom_data: mapped.custom_data,
      score: mapped.score,
      temperature: mapped.temperature,
      email_match_key: emailMatchKey,
      phone_match_key: phoneKey,
      updated_at: nowIso,
    };
    const { error } = await db.from("leads").update(leadUpdate).eq("id", leadId);
    if (error) throw new PersistenceError("update lead", error);
    leadCreated = false;
  } else if (emailMatchKey || phoneKey) {
    // New lead WITH a contact key — race-safe on the contact match key
    // itself, not just on creation_request_id: a concurrent identical-
    // contact request from a DIFFERENT anonymous session (different/absent
    // requestId — the advisory `findLeadByContact` lookup above can't close
    // that window, only a database constraint can) converges on ONE row via
    // `ON CONFLICT ... DO UPDATE`, instead of the pre-fix SELECT-then-INSERT
    // race that produced hundreds of duplicate leads under concurrent load
    // (see the migration for the load-test evidence).
    //
    // `id` is deliberately NOT in this payload: on a genuine conflict,
    // PostgREST's generated `DO UPDATE SET` covers every column present in
    // the payload, and setting `id` there would overwrite the EXISTING row's
    // primary key with this caller's row (which was never inserted) —
    // orphaning every conversation / appointment / event that already
    // references it, since `leads.id` has no `ON UPDATE CASCADE`. Leaving it
    // out means a genuine insert still gets the column default
    // (`gen_random_uuid()`), and a conflict simply never touches it.
    const onConflict = emailMatchKey
      ? "organization_id,email_match_key"
      : "organization_id,phone_match_key";
    const { data, error } = await db
      .from("leads")
      .upsert(
        {
          ...mapped,
          creation_request_id: requestId,
          email_match_key: emailMatchKey,
          phone_match_key: phoneKey,
        },
        { onConflict },
      )
      .select("id");
    if (error) throw new PersistenceError("insert lead", error);
    if (!data || data.length === 0) {
      throw new PersistenceError("insert lead", "no row returned");
    }
    leadId = data[0].id;
    // Best-effort, like the pre-fix code's own `leadId === null` check —
    // `leadCreated` has no consumer today that depends on it being exact
    // across the race window this branch closes; the guarantee that matters
    // (no duplicate row) is enforced by the database constraint above,
    // regardless of what this flag reports.
    leadCreated = !startedWithLead;
  } else {
    // New lead with NO contact info yet — unchanged: race-safe only on
    // (organization_id, creation_request_id), same as before this fix (a
    // contact-less anonymous lead has no key to dedup by regardless).
    const { data, error } = await db
      .from("leads")
      .upsert(
        { ...mapped, creation_request_id: requestId },
        { onConflict: "organization_id,creation_request_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new PersistenceError("insert lead", error);
    if (data && data.length > 0) {
      leadId = data[0].id;
      leadCreated = true;
    } else if (requestId) {
      // Lost the race — a concurrent identical request created it first.
      const existing = await db
        .from("leads")
        .select("id")
        .eq("organization_id", input.organizationId)
        .eq("creation_request_id", requestId)
        .maybeSingle();
      if (existing.error || !existing.data) {
        throw new PersistenceError("read back lead", existing.error);
      }
      leadId = existing.data.id;
      leadCreated = false;
    } else {
      // No requestId → the insert cannot conflict, so an empty result is a bug.
      throw new PersistenceError("insert lead", "no row returned");
    }
  }

  // 4. Reuse or create the conversation.
  //    `last_inbound_at` tracks the customer's last message — it drives the
  //    WhatsApp 24-hour session window (harmless for web).
  if (conversationId) {
    const { error } = await db
      .from("conversations")
      .update({ last_message_at: nowIso, last_inbound_at: nowIso })
      .eq("id", conversationId);
    if (error) throw new PersistenceError("update conversation", error);
  } else {
    const { data, error } = await db
      .from("conversations")
      .upsert(
        {
          organization_id: input.organizationId,
          lead_id: leadId,
          channel: input.channel,
          last_message_at: nowIso,
          last_inbound_at: nowIso,
          external_contact_id: input.externalContactId ?? null,
          creation_request_id: requestId,
        },
        { onConflict: "organization_id,creation_request_id", ignoreDuplicates: true },
      )
      .select("id");

    // A concurrent first message from the same WhatsApp contact created the
    // conversation first — its own unique index rejects this insert. Reuse it.
    if (
      (error || !data || data.length === 0) &&
      input.externalContactId
    ) {
      const byContact = await db
        .from("conversations")
        .select("id, lead_id")
        .eq("organization_id", input.organizationId)
        .eq("channel", input.channel)
        .eq("external_contact_id", input.externalContactId)
        .maybeSingle();
      if (byContact.data) {
        conversationId = byContact.data.id;
        leadId = byContact.data.lead_id;
      }
    }

    if (conversationId) {
      // resolved via the contact fallback above
    } else if (error) {
      throw new PersistenceError("insert conversation", error);
    } else if (data && data.length > 0) {
      conversationId = data[0].id;
    } else if (requestId) {
      const existing = await db
        .from("conversations")
        .select("id")
        .eq("organization_id", input.organizationId)
        .eq("creation_request_id", requestId)
        .maybeSingle();
      if (existing.error || !existing.data) {
        throw new PersistenceError("read back conversation", existing.error);
      }
      conversationId = existing.data.id;
    } else {
      throw new PersistenceError("insert conversation", "no row returned");
    }
  }

  // 5. Persist the completed user + assistant messages (not streaming chunks).
  //    The content check skips a re-typed turn; the unique index on
  //    (conversation_id, role, request_id) collapses concurrent identical ones.
  const { data: recent, error: recentError } = await db
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(6);
  if (recentError) throw new PersistenceError("load recent messages", recentError);
  const recentMessages: RecentMessage[] = recent ?? [];

  const isExternal = input.channel !== "web";
  const messageRows: TablesInsert<"messages">[] = [];
  if (!alreadyPersisted(recentMessages, "user", input.userMessage)) {
    messageRows.push({
      conversation_id: conversationId,
      role: "user",
      content: input.userMessage,
      request_id: requestId,
      channel: input.channel,
      ...(isExternal
        ? {
            provider: "meta_cloud",
            provider_message_id: input.userProviderMessageId ?? null,
          }
        : {}),
    });
  }
  if (!alreadyPersisted(recentMessages, "assistant", input.assistantMessage)) {
    messageRows.push({
      conversation_id: conversationId,
      role: "assistant",
      content: input.assistantMessage,
      request_id: requestId,
      channel: input.channel,
      ...(isExternal ? { provider: "meta_cloud" } : {}),
    });
  }
  let messagesInserted = 0;
  if (messageRows.length > 0) {
    const { data, error } = await db
      .from("messages")
      .upsert(messageRows, {
        onConflict: "conversation_id,role,request_id",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new PersistenceError("insert messages", error);
    messagesInserted = data?.length ?? 0;
  }

  // 6. Lead events for anything that actually changed this turn.
  const events = computeLeadEvents({
    isNewLead: !startedWithLead,
    previous,
    next: {
      score: input.score,
      temperature: mapped.temperature as string,
      status: previous?.status ?? "new",
    },
    userMessage: input.userMessage,
  });
  let eventsInserted = 0;
  if (events.length > 0) {
    const finalLeadId = leadId;
    const eventRows: TablesInsert<"lead_events">[] = events.map((event) => ({
      organization_id: input.organizationId,
      lead_id: finalLeadId,
      event_type: event.event_type,
      metadata: event.metadata as TablesInsert<"lead_events">["metadata"],
      request_id: requestId,
    }));
    const { data, error } = await db
      .from("lead_events")
      .upsert(eventRows, {
        onConflict: "lead_id,request_id,event_type",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new PersistenceError("insert events", error);
    eventsInserted = data?.length ?? 0;
  }

  return {
    conversationId,
    leadId,
    leadCreated,
    messagesInserted,
    eventsInserted,
  };
}
