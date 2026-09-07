/**
 * Pure parse + allowlist for the inbound action API. No I/O.
 *
 * The API is deliberately tiny: three explicit actions, each with a fixed
 * parameter shape. Anything else — an unknown action, a missing field, a bad
 * type — is rejected here before a single DB write. There is no path from an
 * external caller to an arbitrary internal command.
 *
 * Errors are dictionary codes (`integrationHub.inbound.*`).
 */

import { validateFutureTimestamp } from "../agent/actions.ts";
import { LEAD_STATUSES, type LeadStatusValue } from "../leads/list-params.ts";

export const INBOUND_ACTIONS = [
  "update_lead_status",
  "create_follow_up",
  "request_human_handoff",
] as const;
export type InboundActionType = (typeof INBOUND_ACTIONS)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedInbound =
  | {
      type: "update_lead_status";
      idempotencyKey: string;
      leadId: string;
      status: LeadStatusValue;
    }
  | {
      type: "create_follow_up";
      idempotencyKey: string;
      leadId: string;
      scheduledAt: string;
      note: string | null;
    }
  | {
      type: "request_human_handoff";
      idempotencyKey: string;
      leadId: string;
      reason: string | null;
    };

export type ParseInboundResult =
  | { ok: true; value: ParsedInbound }
  | { ok: false; code: string };

function trimCap(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

export function parseInboundRequest(
  raw: unknown,
  now: Date = new Date(),
): ParseInboundResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, code: "body_invalid" };
  }
  const body = raw as Record<string, unknown>;

  const idempotencyKey = trimCap(body.id ?? body.idempotency_key, 200);
  if (!idempotencyKey) {
    return { ok: false, code: "id_required" };
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!(INBOUND_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, code: "action_not_allowed" };
  }

  const leadId =
    typeof body.leadId === "string"
      ? body.leadId.trim()
      : typeof body.lead_id === "string"
        ? body.lead_id.trim()
        : "";
  if (!UUID_RE.test(leadId)) {
    return { ok: false, code: "lead_id_invalid" };
  }

  if (action === "update_lead_status") {
    const status =
      typeof body.status === "string" ? body.status.trim() : "";
    if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
      return { ok: false, code: "status_invalid" };
    }
    return {
      ok: true,
      value: {
        type: "update_lead_status",
        idempotencyKey,
        leadId,
        status: status as LeadStatusValue,
      },
    };
  }

  if (action === "create_follow_up") {
    const when = validateFutureTimestamp(
      body.scheduledAt ?? body.scheduled_at,
      now,
    );
    if (!when.ok) {
      return { ok: false, code: "scheduled_at_invalid" };
    }
    return {
      ok: true,
      value: {
        type: "create_follow_up",
        idempotencyKey,
        leadId,
        scheduledAt: when.iso as string,
        note: trimCap(body.note ?? body.reason, 500),
      },
    };
  }

  return {
    ok: true,
    value: {
      type: "request_human_handoff",
      idempotencyKey,
      leadId,
      reason: trimCap(body.reason, 200),
    },
  };
}
