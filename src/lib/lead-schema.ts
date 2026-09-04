import type { EffectiveConfig, LeadFieldDefinition } from "@/lib/config";

/**
 * Build the extraction request from the effective configuration's lead fields.
 * Pure and industry-agnostic — the extraction engine never knows which
 * industry it is processing.
 */

const SCHEMA_TYPE_BY_FIELD: Record<
  LeadFieldDefinition["type"],
  "string" | "number" | "boolean"
> = {
  text: "string",
  select: "string",
  date: "string",
  number: "number",
  boolean: "boolean",
};

/**
 * JSON schema for Anthropic structured outputs, generated from the configured
 * fields. Every field is nullable — extraction never invents a value.
 * Anthropic structured outputs rejects `enum` combined with a nullable union,
 * so allowed values live in the field description instead.
 */
export function buildLeadSchema(
  fields: LeadFieldDefinition[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const field of fields) {
    properties[field.key] = {
      type: [SCHEMA_TYPE_BY_FIELD[field.type] ?? "string", "null"],
      description: field.extractionHint ?? field.description ?? field.label,
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    required: fields.map((field) => field.key),
    properties,
  };
}

/**
 * Structured-output schema for the combined extraction + action-decision call.
 * Wraps {@link buildLeadSchema} with a `proposed_actions` array so the agent
 * can suggest business actions in the SAME request — no extra Anthropic call.
 * Generic: the action vocabulary is industry-agnostic.
 */
export function buildAgentExtractionSchema(
  fields: LeadFieldDefinition[],
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["lead", "proposed_actions"],
    properties: {
      lead: buildLeadSchema(fields),
      proposed_actions: {
        type: "array",
        description:
          "Zero or more business actions to propose from the conversation. Leave EMPTY unless the prospect clearly asked for one of these.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: {
            type: {
              type: "string",
              description:
                'Exactly one of: "create_follow_up" (the prospect explicitly asked to be contacted at a specific later time, e.g. "call me tomorrow at 3", "reach out next week"); "request_human_handoff" (the prospect asks to speak to a person, is frustrated, or has a request the assistant cannot handle).',
            },
            scheduled_at: {
              type: ["string", "null"],
              description:
                'For "create_follow_up" only: the requested time as an ISO 8601 timestamp in the FUTURE, resolved against the current date given in the system prompt. null for any other action.',
            },
            reason: {
              type: ["string", "null"],
              description:
                "One short sentence (max 200 chars), in English, explaining why this action was proposed.",
            },
          },
        },
      },
    },
  };
}

export function buildExtractionSystemPrompt(config: EffectiveConfig): string {
  const languages =
    config.aiBehavior?.languages?.join(", ") || "the prospect's language";
  return `You extract structured lead data from a lead-qualification conversation between a prospect and an assistant.

Rules:
- Output ONLY the JSON object matching the schema. No prose.
- Use information from the ENTIRE conversation, not just the last message.
- NEVER invent or guess. If a field was not clearly provided, it is null.
- If the prospect corrected an earlier answer, use the CORRECTED (latest) value.
- Understand ${languages}.
- Normalize every field exactly as its description in the schema says.
- Do not ask questions. You only extract.`;
}
