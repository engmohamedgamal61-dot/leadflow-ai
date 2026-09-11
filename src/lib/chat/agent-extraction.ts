import type Anthropic from "@anthropic-ai/sdk";
// Relative value imports so this module (and its test) run under `node --test`.
import { CHAT_MODEL, requestCallOptions } from "./anthropic.ts";
import { reportError } from "../observability/report.ts";
import type { EffectiveConfig } from "@/lib/config";
import {
  buildAgentExtractionSchema,
  buildExtractionSystemPrompt,
} from "../lead-schema.ts";
import { assembleLead } from "../lead-normalization.ts";
import { parseProposedActions, type ProposedAction } from "../agent/actions.ts";
import { normalizeAnthropicUsage } from "../metering/types.ts";
import type { TokenUsage } from "@/lib/metering/pricing";
import { EMPTY_LEAD, type LeadData } from "../../types/chat.ts";

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
  /**
   * Token usage for this structured-output call, for cost metering. `null` when
   * the call failed or the SDK returned no usage (e.g. mock transport). Never an
   * extra request — this is the same call's own `response.usage`.
   */
  usage: TokenUsage | null;
  /** The model string this call used (for metering). */
  model: string;
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
export interface ExtractLeadAndActionsOptions {
  now?: Date;
  /** Best-effort cancellation — see `FinalizeTurnInput.signal` in conversation-service.ts. */
  signal?: AbortSignal | null;
}

export async function extractLeadAndActions(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  config: EffectiveConfig,
  options: ExtractLeadAndActionsOptions = {},
): Promise<AgentExtraction> {
  const now = options.now ?? new Date();
  try {
    const enabledFields = config.leadFields.filter((field) => field.enabled);
    const schema = buildAgentExtractionSchema(enabledFields);

    const response = await client.messages.create(
      {
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
      },
      requestCallOptions(options.signal),
    );

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const usage = normalizeAnthropicUsage(response.usage);

    const parsed = firstJsonObject(text) as {
      lead?: unknown;
      proposed_actions?: unknown;
    } | null;

    if (!parsed) {
      return { lead: EMPTY_LEAD, proposedActions: [], rejectedActions: [], usage, model: CHAT_MODEL };
    }

    const lead = parsed.lead
      ? assembleLead(parsed.lead, config)
      : EMPTY_LEAD;
    const { actions, rejected } = parseProposedActions(
      parsed.proposed_actions,
      now,
    );

    return { lead, proposedActions: actions, rejectedActions: rejected, usage, model: CHAT_MODEL };
  } catch (error) {
    void reportError(error, { scope: "chat.agent-extraction" });
    return { lead: EMPTY_LEAD, proposedActions: [], rejectedActions: [], usage: null, model: CHAT_MODEL };
  }
}
