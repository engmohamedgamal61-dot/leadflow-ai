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
