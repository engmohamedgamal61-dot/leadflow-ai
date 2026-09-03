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
  metadata: unknown;
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
 * Idempotent where practical: an existing conversation's lead is updated in
 * place (no duplicate lead), and a message whose exact content already exists
 * for that role in the recent history is not re-inserted.
 *
 * Throws {@link PersistenceError} on any database error — the caller decides
 * whether that should affect the response.
 */
export async function persistChatTurn(
  db: Db,
  input: PersistChatTurnInput,
): Promise<PersistChatTurnResult> {
  const nowIso = new Date().toISOString();

  // 1. Reuse the conversation the client already has, if it is ours.
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
    // Update the mutable columns only — never re-write organization_id or the
    // original source.
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
    const { error } = await db
      .from("leads")
      .update(leadUpdate)
      .eq("id", leadId);
    if (error) throw new PersistenceError("update lead", error);
  } else {
    const { data, error } = await db
      .from("leads")
      .insert(mapped)
      .select("id")
      .single();
    if (error || !data) throw new PersistenceError("insert lead", error);
    leadId = data.id;
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
      .insert({
        organization_id: input.organizationId,
        lead_id: leadId,
        channel: input.channel,
        last_message_at: nowIso,
      })
      .select("id")
      .single();
    if (error || !data) throw new PersistenceError("insert conversation", error);
    conversationId = data.id;
  }

  // 5. Persist the completed user + assistant messages (not streaming chunks),
  //    skipping any whose content is already the latest for that role.
  const { data: recent, error: recentError } = await db
    .from("messages")
    .select("role, content, metadata")
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
    });
  }
  if (!alreadyPersisted(recentMessages, "assistant", input.assistantMessage)) {
    messageRows.push({
      conversation_id: conversationId,
      role: "assistant",
      content: input.assistantMessage,
    });
  }
  if (messageRows.length > 0) {
    const { error } = await db.from("messages").insert(messageRows);
    if (error) throw new PersistenceError("insert messages", error);
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
  if (events.length > 0) {
    const finalLeadId = leadId;
    const eventRows: TablesInsert<"lead_events">[] = events.map((event) => ({
      organization_id: input.organizationId,
      lead_id: finalLeadId,
      event_type: event.event_type,
      metadata: event.metadata as TablesInsert<"lead_events">["metadata"],
    }));
    const { error } = await db.from("lead_events").insert(eventRows);
    if (error) throw new PersistenceError("insert events", error);
  }

  return {
    conversationId,
    leadId,
    leadCreated,
    messagesInserted: messageRows.length,
    eventsInserted: events.length,
  };
}
