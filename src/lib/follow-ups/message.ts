/**
 * Deterministic, template-based follow-up message. Pure — no Claude call.
 *
 * Phase G is about scheduler reliability, not copywriting. If a follow-up
 * carries a note (the AI's reason, or a manual note) it is used verbatim;
 * otherwise a plain check-in template. A future phase that genuinely needs
 * AI-generated copy would add a `FollowUpMessageGenerator` abstraction and
 * opt in per organization — it must not run by default here.
 */

const MAX_LENGTH = 600;

export function buildFollowUpMessage(input: {
  note?: string | null;
  leadName?: string | null;
}): string {
  const name =
    typeof input.leadName === "string" && input.leadName.trim()
      ? input.leadName.trim().split(/\s+/)[0]
      : "there";

  const note =
    typeof input.note === "string" && input.note.trim()
      ? input.note.trim()
      : null;

  const body = note
    ? `Following up as promised: ${note}`
    : "Just checking in to see whether you had any more questions or if now is a good time to move forward.";

  return `Hi ${name}, ${body}`.slice(0, MAX_LENGTH);
}
