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

export function buildSystemPrompt(config: EffectiveConfig): string {
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
${languageLine}${domainLine}

## Tone
${sentence(aiBehavior.tone)}`;
}
