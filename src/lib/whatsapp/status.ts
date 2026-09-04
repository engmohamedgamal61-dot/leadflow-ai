/**
 * Apply a Meta delivery-status webhook to the outbound message it refers to.
 * Bound by `provider_message_id` (globally unique at Meta) and re-checked
 * against the resolved organization so a status event can never touch another
 * tenant's row. Stores only the minimal fields — never the full payload.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { NormalizedStatusUpdate } from "./payload.ts";

type Db = SupabaseClient<Database>;

const KNOWN = new Set(["sent", "delivered", "read", "failed"]);
/** Never downgrade a terminal-ish state on an out-of-order webhook. */
const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 3 };

export async function applyStatusUpdate(
  db: Db,
  organizationId: string,
  update: NormalizedStatusUpdate,
): Promise<"applied" | "skipped"> {
  if (!KNOWN.has(update.status)) return "skipped";

  const { data: msg } = await db
    .from("messages")
    .select("id, conversation_id, delivery_status")
    .eq("provider_message_id", update.providerMessageId)
    .maybeSingle();
  if (!msg) return "skipped";

  const { data: conv } = await db
    .from("conversations")
    .select("organization_id")
    .eq("id", msg.conversation_id)
    .maybeSingle();
  if (!conv || conv.organization_id !== organizationId) return "skipped";

  const current = msg.delivery_status ?? "";
  if ((RANK[update.status] ?? 0) < (RANK[current] ?? 0)) return "skipped";

  const patch: Database["public"]["Tables"]["messages"]["Update"] = {
    delivery_status: update.status,
  };
  if (update.status === "failed" && update.errorDetail) {
    patch.provider_metadata = { error: update.errorDetail.slice(0, 200) };
  }

  const { error } = await db.from("messages").update(patch).eq("id", msg.id);
  if (error) {
    console.error("[whatsapp] status update failed:", error.message);
    return "skipped";
  }
  return "applied";
}
