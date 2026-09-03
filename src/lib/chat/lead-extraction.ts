import type Anthropic from "@anthropic-ai/sdk";
import { CHAT_MODEL } from "@/lib/chat/anthropic";
import type { EffectiveConfig } from "@/lib/config";
import { buildExtractionSystemPrompt, buildLeadSchema } from "@/lib/lead-schema";
import { assembleLead } from "@/lib/lead-normalization";
import { EMPTY_LEAD, type LeadData } from "@/types/chat";

const EXTRACTION_MAX_TOKENS = 512;

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
 * structured outputs.
 *
 * The schema and extraction prompt are generated from `config.leadFields`, and
 * the raw result is normalized by {@link assembleLead} — this engine never
 * knows which industry it is processing. Returns {@link EMPTY_LEAD} on failure
 * so the chat flow is never blocked.
 */
export async function extractLead(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  config: EffectiveConfig,
): Promise<LeadData> {
  try {
    const enabledFields = config.leadFields.filter((field) => field.enabled);
    const schema = buildLeadSchema(enabledFields);

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
    return parsed ? assembleLead(parsed, config) : EMPTY_LEAD;
  } catch (error) {
    console.error("lead extraction failed", error);
    return EMPTY_LEAD;
  }
}
