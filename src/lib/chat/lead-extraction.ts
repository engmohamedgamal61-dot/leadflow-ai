import type Anthropic from "@anthropic-ai/sdk";
import { CHAT_MODEL } from "@/lib/chat/anthropic";
import { EMPTY_LEAD, LEAD_FIELD_KEYS, type LeadData } from "@/types/chat";

const EXTRACTION_MAX_TOKENS = 512;

/**
 * JSON schema for the structured lead. Passed to Anthropic structured outputs
 * so the model is constrained to return exactly this shape.
 */
const LEAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...LEAD_FIELD_KEYS],
  properties: {
    name: {
      type: ["string", "null"],
      description: "The prospect's name, as they gave it. Keep the original script.",
    },
    intent: {
      type: ["string", "null"],
      description:
        "Exactly \"buy\" or \"rent\" (lowercase), or null. Infer from clear signals: financing/mortgage or a large purchase-sized budget imply \"buy\"; \"rent\"/\"إيجار\"/\"للإيجار\" imply \"rent\". null if genuinely unclear.",
    },
    location: {
      type: ["string", "null"],
      description:
        "City or district, normalized to English (e.g. \"Riyadh\", \"North Riyadh\", \"Jeddah\").",
    },
    budget: {
      type: ["number", "null"],
      description:
        "Numeric amount in SAR. \"مليون ريال\" -> 1000000, \"800 ألف\" -> 800000, \"1.2m\" -> 1200000.",
    },
    property_type: {
      type: ["string", "null"],
      description:
        "Lowercase English: \"apartment\", \"villa\", \"townhouse\", \"office\", \"land\", etc.",
    },
    bedrooms: {
      type: ["integer", "null"],
      description: "Integer number of bedrooms. Arabic-Indic digits count (٤ -> 4).",
    },
    financing: {
      type: ["boolean", "null"],
      description:
        "true if the prospect needs financing / a mortgage, false if paying cash. null if not mentioned.",
    },
    timeline: {
      type: ["string", "null"],
      description:
        "Short English phrase for when they want to move/buy: \"1 week\", \"3 months\", \"ASAP\", \"end of year\".",
    },
  },
} as const;

const EXTRACTION_SYSTEM = `You extract structured lead data from a real-estate qualification conversation between a prospect and an assistant.

Rules:
- Output ONLY the JSON object matching the schema. No prose.
- Use information from the ENTIRE conversation, not just the last message.
- NEVER invent or guess. If a field was not clearly provided, it is null.
- If the prospect corrected an earlier answer, use the CORRECTED (latest) value.
- Understand Arabic, English, and Arabizi (Arabic in Latin letters/numbers).
- Normalize values to the canonical shapes described in the schema (English location/property_type/timeline, numeric budget in SAR, integer bedrooms, boolean financing, "buy"/"rent" intent).
- Do not ask questions. You only extract.`;

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

/** Coerce a loosely-typed model result into a clean {@link LeadData}. */
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
 * structured outputs. Returns {@link EMPTY_LEAD} on failure so the chat flow
 * is never blocked by extraction problems.
 */
export async function extractLead(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
): Promise<LeadData> {
  try {
    const response = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: EXTRACTION_MAX_TOKENS,
      thinking: { type: "disabled" },
      system: EXTRACTION_SYSTEM,
      output_config: { format: { type: "json_schema", schema: LEAD_SCHEMA } },
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
