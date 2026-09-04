import type { EffectiveConfig, LeadFieldDefinition } from "@/lib/config";

/**
 * Build the assistant's system prompt from an {@link EffectiveConfig}.
 *
 * Nothing about the prompt is real-estate specific — the persona, goal, rules,
 * languages and the list of things to learn all come from the configuration's
 * `aiBehavior` and `qualificationFlow`. The assistant still writes its own
 * natural questions; the flow only tells it *what* to work towards.
 *
 * The conversation always opens client-side with a fixed greeting
 * ("Hi! 👋 How can I help you today?"), so the model picks up from the
 * prospect's first reply.
 */

function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/, "");
  const cased = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return `${cased}.`;
}

export interface AvailableSlot {
  startsAt: string;
  endsAt: string;
}

export interface SystemPromptOptions {
  /**
   * Real, provider-backed appointment slots (see `calendar/service.ts`).
   * `undefined` — no connected calendar: never mention booking an
   * appointment. `[]` — connected but nothing open: say so, don't invent a
   * time. Non-empty — the ONLY times that may ever be offered or confirmed.
   */
  availableSlots?: readonly AvailableSlot[];
}

const MAX_SLOTS_IN_PROMPT = 15;

function buildAvailabilitySection(slots: readonly AvailableSlot[] | undefined): string {
  if (slots === undefined) return "";
  if (slots.length === 0) {
    return `

## Appointment availability
No appointment slots are open right now. If the prospect wants to book an
appointment, say so plainly and let them know a team member will follow up to
find a time — do not invent or guess a time.`;
  }
  const list = slots
    .slice(0, MAX_SLOTS_IN_PROMPT)
    .map((s) => `- ${s.startsAt}`)
    .join("\n");
  return `

## Appointment availability
These are the ONLY real, currently-open appointment slots (ISO 8601, UTC).
Never offer, confirm, reschedule to, or invent a time outside this exact list.
Present them in the prospect's own words/timezone if you can infer one, but the
underlying time you propose must be one of these:
${list}`;
}

export function buildSystemPrompt(
  config: EffectiveConfig,
  options: SystemPromptOptions = {},
): string {
  const { aiBehavior, qualificationFlow, leadFields } = config;
  const fieldsByKey = new Map<string, LeadFieldDefinition>(
    leadFields.map((field) => [field.key, field]),
  );

  const learnList = qualificationFlow
    .map((step) => {
      const label = fieldsByKey.get(step.fieldKey)?.label ?? step.fieldKey;
      return step.questionHint
        ? `- ${label} — ${step.questionHint}`
        : `- ${label}`;
    })
    .join("\n");

  const behaviourRules = [sentence(aiBehavior.style), ...aiBehavior.rules]
    .map((rule) => `- ${rule}`)
    .join("\n");

  const languageLine = `Understand and reply in the prospect's own language. Supported: ${aiBehavior.languages.join("; ")}.`;
  const domainLine = aiBehavior.domainContext
    ? `\n${sentence(aiBehavior.domainContext)}`
    : "";

  return `You are LeadFlow AI, ${aiBehavior.persona}. Your job is to ${aiBehavior.goal}. The chat already opened with your greeting; continue from the prospect's first message.

## What to learn
Work towards learning the following about the prospect — one thing at a time, in whatever order feels natural:
${learnList}

## How to behave
${behaviourRules}

## Language
${languageLine}${domainLine}${buildAvailabilitySection(options.availableSlots)}

## Tone
${sentence(aiBehavior.tone)}`;
}
