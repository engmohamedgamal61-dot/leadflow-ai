import type Anthropic from "@anthropic-ai/sdk";
import { CHAT_MODEL } from "@/lib/chat/anthropic";
import type { EffectiveConfig } from "@/lib/config";
import {
  buildAgentExtractionSchema,
  buildExtractionSystemPrompt,
} from "@/lib/lead-schema";
import { assembleLead } from "@/lib/lead-normalization";
import { parseProposedActions, type ProposedAction } from "@/lib/agent/actions";
import { EMPTY_LEAD, type LeadData } from "@/types/chat";

const EXTRACTION_MAX_TOKENS = 640;

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

export interface AgentExtraction {
  lead: LeadData;
  proposedActions: ProposedAction[];
  /** Proposed items the parser dropped — logged, never surfaced to the client. */
  rejectedActions: string[];
}

/**
 * ONE structured-output Anthropic call that both extracts the structured lead
 * AND lets the model propose business actions. This replaces the old
 * extraction call — it is not an additional request. The schema and prompt are
 * generated from `config`; the engine never knows the industry. Claude only
 * *proposes* — validation + execution happen server-side.
 *
 * Never throws: returns an empty lead and no actions on any failure.
 */
export async function extractLeadAndActions(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  config: EffectiveConfig,
  now: Date = new Date(),
): Promise<AgentExtraction> {
  try {
    const enabledFields = config.leadFields.filter((field) => field.enabled);
    const schema = buildAgentExtractionSchema(enabledFields);

    const response = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: EXTRACTION_MAX_TOKENS,
      thinking: { type: "disabled" },
      system: `${buildExtractionSystemPrompt(config)}

The current date and time is ${now.toISOString()} (UTC). Resolve any relative time the prospect gives ("tomorrow", "next week", "in 3 days") against it.
You may also propose business actions in "proposed_actions" ONLY when the prospect clearly asked for one. Do not propose actions speculatively; an empty array is the normal case.`,
      output_config: { format: { type: "json_schema", schema } },
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Return the JSON: the lead data, and proposed_actions (usually empty).",
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const parsed = firstJsonObject(text) as {
      lead?: unknown;
      proposed_actions?: unknown;
    } | null;

    if (!parsed) return { lead: EMPTY_LEAD, proposedActions: [], rejectedActions: [] };

    const lead = parsed.lead
      ? assembleLead(parsed.lead, config)
      : EMPTY_LEAD;
    const { actions, rejected } = parseProposedActions(
      parsed.proposed_actions,
      now,
    );

    return { lead, proposedActions: actions, rejectedActions: rejected };
  } catch (error) {
    console.error("agent extraction failed", error);
    return { lead: EMPTY_LEAD, proposedActions: [], rejectedActions: [] };
  }
}
