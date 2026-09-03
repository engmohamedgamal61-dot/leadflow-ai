import type Anthropic from "@anthropic-ai/sdk";
import { CHAT_MODEL } from "@/lib/chat/anthropic";
import type { EffectiveConfig, LeadFieldDefinition } from "@/lib/config";
import { EMPTY_LEAD, type LeadData } from "@/types/chat";

const EXTRACTION_MAX_TOKENS = 512;

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
 * Build the structured-output JSON schema from the configured lead fields.
 *
 * Every field is nullable — extraction never invents a value. Anthropic
 * structured outputs rejects `enum` combined with a nullable union, so allowed
 * values live in the field description instead.
 */
export function buildLeadSchema(
  fields: LeadFieldDefinition[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const field of fields) {
    properties[field.key] = {
      type: [SCHEMA_TYPE_BY_FIELD[field.type], "null"],
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

function buildExtractionSystemPrompt(config: EffectiveConfig): string {
  return `You extract structured lead data from a lead-qualification conversation between a prospect and an assistant.

Rules:
- Output ONLY the JSON object matching the schema. No prose.
- Use information from the ENTIRE conversation, not just the last message.
- NEVER invent or guess. If a field was not clearly provided, it is null.
- If the prospect corrected an earlier answer, use the CORRECTED (latest) value.
- Understand ${config.aiBehavior.languages.join(", ")}.
- Normalize every field exactly as its description in the schema says.
- Do not ask questions. You only extract.`;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const digits = value.replace(/[^\d.]/g, "");
    if (!digits) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "نعم", "تمويل", "financing", "mortgage"].includes(v)) return true;
    if (["false", "no", "cash", "كاش", "لا"].includes(v)) return false;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Coerce a loosely-typed model result into a clean {@link LeadData}.
 *
 * This is the adapter between raw structured-output JSON and the real-estate
 * `LeadData` shape. A future non-real-estate lead shape would get its own
 * normalizer.
 */
export function normalizeLead(raw: unknown): LeadData {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const intentRaw = toText(source.intent)?.toLowerCase();
  const intent =
    intentRaw === "buy" || intentRaw === "purchase"
      ? "buy"
      : intentRaw === "rent" || intentRaw === "rental"
        ? "rent"
        : null;

  const budget = toNumber(source.budget);
  const bedrooms = toNumber(source.bedrooms);

  return {
    name: toText(source.name),
    intent,
    location: toText(source.location),
    budget: budget === null ? null : Math.round(budget),
    property_type: toText(source.property_type)?.toLowerCase() ?? null,
    bedrooms: bedrooms === null ? null : Math.round(bedrooms),
    financing: toBoolean(source.financing),
    timeline: toText(source.timeline),
  };
}

function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Extract the structured lead from the full conversation using Anthropic
 * structured outputs, driven by the effective configuration's lead fields.
 * Returns {@link EMPTY_LEAD} on failure so the chat flow is never blocked.
 */
export async function extractLead(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  config: EffectiveConfig,
): Promise<LeadData> {
  try {
    const schema = buildLeadSchema(
      config.leadFields.filter((field) => field.enabled),
    );

    const response = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: EXTRACTION_MAX_TOKENS,
      thinking: { type: "disabled" },
      system: buildExtractionSystemPrompt(config),
      output_config: { format: { type: "json_schema", schema } },
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Return the lead data as JSON, based on the entire conversation above.",
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const parsed = firstJsonObject(text);
    return parsed ? normalizeLead(parsed) : EMPTY_LEAD;
  } catch (error) {
    console.error("lead extraction failed", error);
    return EMPTY_LEAD;
  }
}
