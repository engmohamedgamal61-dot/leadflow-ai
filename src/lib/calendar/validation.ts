/**
 * Pure validation for appointment booking input (manual dashboard forms and
 * the AI action parser share these shapes). No imports, no I/O.
 */

const NOTE_MAX = 500;
const REASON_MAX = 200;

export function normalizeAppointmentNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > NOTE_MAX ? t.slice(0, NOTE_MAX) : t;
}

export function normalizeCancelReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > REASON_MAX ? t.slice(0, REASON_MAX) : t;
}

export interface SlotSelectionResult {
  ok: boolean;
  iso?: string;
  /** Dotted `calendar.validation.*` dictionary key. */
  errorCode?: string;
}

/**
 * A slot chosen from a server-generated list of real options: must be a
 * parseable, strictly-future ISO timestamp. (The caller — `service.ts` — is
 * what re-checks it's still actually free; this only rejects obvious junk.)
 */
export function validateSlotSelection(
  raw: unknown,
  now: Date = new Date(),
): SlotSelectionResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, errorCode: "calendar.validation.slotRequired" };
  }
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    return { ok: false, errorCode: "calendar.validation.slotInvalid" };
  }
  if (ts <= now.getTime()) {
    return { ok: false, errorCode: "calendar.validation.slotPast" };
  }
  return { ok: true, iso: new Date(ts).toISOString() };
}
