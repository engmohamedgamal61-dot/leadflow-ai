// Value imports use relative paths so this module (and its tests) run under
// `node --test`. Type-only imports are erased and may use the `@/` alias.
import { leadWriteToInsert } from "../supabase/mappers.ts";
import { computeLeadEvents, type LeadSnapshot } from "./events.ts";
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
  /** Conversation channel for a newly created conversation. */
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
 * Persist one completed chat turn: upsert the lead, reuse or create the
 * conversation, append the completed user + assistant messages, and record
 * lead events for any state changes.
 *
 * **Concurrency-safe.** Every write that could be duplicated by two
 * simultaneous identical requests is guarded by a database unique index keyed
 * on the turn's `requestId`:
 * - lead / conversation creation → `unique (organization_id, creation_request_id)`
 * - messages → `unique (conversation_id, role, request_id)`
 * - lead events → `unique (lead_id, request_id, event_type)`
 *
 * The loser of a race gets `ON CONFLICT DO NOTHING` and reads back the winner's
 * row, so the result is identical for both callers and nothing is duplicated.
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
  const leadCreated = leadId === null;

  if (leadId) {
    // Existing lead — update the mutable columns only.
    const leadUpdate: TablesUpdate<"leads"> = {
      name: mapped.name,
      phone: mapped.phone,
      email: mapped.email,
      intent: mapped.intent,
      custom_data: mapped.custom_data,
      score: mapped.score,
      temperature: mapped.temperature,
      updated_at: nowIso,
    };
    const { error } = await db.from("leads").update(leadUpdate).eq("id", leadId);
    if (error) throw new PersistenceError("update lead", error);
  } else {
    // New lead — race-safe on (organization_id, creation_request_id).
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
    } else {
      // No requestId → the insert cannot conflict, so an empty result is a bug.
      throw new PersistenceError("insert lead", "no row returned");
    }
  }

  // 4. Reuse or create the conversation.
  if (conversationId) {
    const { error } = await db
      .from("conversations")
      .update({ last_message_at: nowIso })
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
          creation_request_id: requestId,
        },
        { onConflict: "organization_id,creation_request_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new PersistenceError("insert conversation", error);
    if (data && data.length > 0) {
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

  const messageRows: TablesInsert<"messages">[] = [];
  if (!alreadyPersisted(recentMessages, "user", input.userMessage)) {
    messageRows.push({
      conversation_id: conversationId,
      role: "user",
      content: input.userMessage,
      request_id: requestId,
    });
  }
  if (!alreadyPersisted(recentMessages, "assistant", input.assistantMessage)) {
    messageRows.push({
      conversation_id: conversationId,
      role: "assistant",
      content: input.assistantMessage,
      request_id: requestId,
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
