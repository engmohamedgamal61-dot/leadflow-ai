/**
 * Executes an already-parsed, allowlisted inbound action from an external
 * automation system. The security boundary is upstream (the route verifies the
 * HMAC signature + timestamp and resolves the endpoint → organization); this
 * module enforces the rest:
 *
 *  - the action is one of exactly three (guaranteed by `parseInboundRequest`)
 *  - the target lead belongs to the endpoint's organization (re-checked here)
 *  - the call is idempotent on `(endpoint_id, idempotency_key)` — a retry
 *    returns the first outcome and never runs the action twice
 *  - every call is audited, with a redacted request summary (never a secret,
 *    never a signature)
 *
 * Reuses the existing agent executor for follow-up / handoff so there is one
 * code path, not a parallel one. `db` is the trusted service-role client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/lib/supabase/types";
import {
  createFollowUp,
  requestHumanHandoff,
  type AgentExecContext,
} from "../agent/executor.ts";
import type { ParsedInbound } from "./inbound-validation.ts";

type Db = SupabaseClient<Database>;
type Endpoint = Pick<Tables<"integration_endpoints">, "id" | "organization_id">;

export interface InboundResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

function summaryOf(parsed: ParsedInbound): Record<string, unknown> {
  switch (parsed.type) {
    case "update_lead_status":
      return { action: parsed.type, leadId: parsed.leadId, status: parsed.status };
    case "create_follow_up":
      return {
        action: parsed.type,
        leadId: parsed.leadId,
        scheduledAt: parsed.scheduledAt,
      };
    case "request_human_handoff":
      return { action: parsed.type, leadId: parsed.leadId };
  }
}

function ctxFor(
  db: Db,
  endpoint: Endpoint,
  parsed: ParsedInbound,
): AgentExecContext {
  return {
    db,
    organizationId: endpoint.organization_id,
    leadId: parsed.leadId,
    conversationId: null,
    requestId: parsed.idempotencyKey,
    source: "integration",
  };
}

export async function handleInboundAction(
  db: Db,
  input: { endpoint: Endpoint; parsed: ParsedInbound },
): Promise<InboundResult> {
  const { endpoint, parsed } = input;

  // ── 1. idempotency claim ──────────────────────────────────────────────
  const claim: TablesInsert<"integration_inbound_actions"> = {
    organization_id: endpoint.organization_id,
    endpoint_id: endpoint.id,
    idempotency_key: parsed.idempotencyKey,
    action: parsed.type,
    lead_id: parsed.leadId,
    request_summary: summaryOf(parsed) as TablesInsert<"integration_inbound_actions">["request_summary"],
    status: "accepted",
  };
  const { data: claimed, error: claimErr } = await db
    .from("integration_inbound_actions")
    .insert(claim)
    .select("id")
    .single();

  if (claimErr) {
    if ((claimErr as { code?: string }).code === "23505") {
      const { data: existing } = await db
        .from("integration_inbound_actions")
        .select("action, status, result_summary, error_code")
        .eq("endpoint_id", endpoint.id)
        .eq("idempotency_key", parsed.idempotencyKey)
        .maybeSingle();
      return {
        httpStatus: 200,
        body: {
          status: "duplicate",
          action: existing?.action ?? parsed.type,
          result: existing?.result_summary ?? null,
          error_code: existing?.error_code ?? null,
        },
      };
    }
    return {
      httpStatus: 500,
      body: { status: "failed", error: "could not record action" },
    };
  }

  const auditId = claimed.id;

  const finish = async (
    status: Tables<"integration_inbound_actions">["status"],
    patch: Partial<Tables<"integration_inbound_actions">>,
  ) => {
    await db
      .from("integration_inbound_actions")
      .update({ status, ...patch })
      .eq("id", auditId);
  };

  // ── 2. lead ownership ────────────────────────────────────────────────
  const { data: lead, error: leadErr } = await db
    .from("leads")
    .select("id, status")
    .eq("organization_id", endpoint.organization_id)
    .eq("id", parsed.leadId)
    .maybeSingle();
  if (leadErr) {
    await finish("failed", { error_code: "lead_read_failed" });
    return { httpStatus: 500, body: { status: "failed", error: "lead read failed" } };
  }
  if (!lead) {
    await finish("rejected", { error_code: "lead_not_found" });
    return {
      httpStatus: 404,
      body: { status: "rejected", error_code: "lead_not_found" },
    };
  }

  // ── 3. dispatch (allowlisted) ────────────────────────────────────────
  try {
    let result: Record<string, unknown>;

    if (parsed.type === "update_lead_status") {
      if (lead.status === parsed.status) {
        result = { changed: false, status: parsed.status };
      } else {
        const { data: updated, error } = await db
          .from("leads")
          .update({ status: parsed.status })
          .eq("organization_id", endpoint.organization_id)
          .eq("id", parsed.leadId)
          .select("id");
        if (error || !updated || updated.length === 0) {
          await finish("failed", { error_code: "status_update_failed" });
          return {
            httpStatus: 500,
            body: { status: "failed", error_code: "status_update_failed" },
          };
        }
        await db.from("lead_events").insert({
          organization_id: endpoint.organization_id,
          lead_id: parsed.leadId,
          event_type: "status_changed",
          metadata: { from: lead.status, to: parsed.status, source: "integration" },
        });
        result = { changed: true, from: lead.status, to: parsed.status };
      }
    } else if (parsed.type === "create_follow_up") {
      const outcome = await createFollowUp(ctxFor(db, endpoint, parsed), {
        scheduledAt: parsed.scheduledAt,
        note: parsed.note,
      });
      result = { outcome: outcome.status, followUpId: outcome.followUpId ?? null };
    } else {
      const outcome = await requestHumanHandoff(ctxFor(db, endpoint, parsed), {
        reason: parsed.reason,
      });
      result = { outcome: outcome.status };
    }

    await finish("accepted", {
      result_summary: result as Tables<"integration_inbound_actions">["result_summary"],
    });
    return {
      httpStatus: 200,
      body: { status: "accepted", action: parsed.type, result },
    };
  } catch {
    await finish("failed", { error_code: "action_error" });
    return {
      httpStatus: 500,
      body: { status: "failed", error_code: "action_error" },
    };
  }
}
