/**
 * Ask LeadFlow — serialise the recent Q&A transcript into planner history.
 *
 * Pure (runs under `node --test`). The result is passed to the planner and the
 * grounded-answer calls as CONTEXT for follow-up understanding only — never as a
 * factual source. A deterministic previous answer (`answerKey` + `answerParams`)
 * is rendered with its params so no `{count}`-style placeholder leaks into the
 * history the model sees.
 */

import type { AskResult, ConversationTurn } from "./orchestration.ts";

export interface AnsweredTurn {
  question: string;
  result: Pick<AskResult, "answer" | "answerKey" | "answerParams">;
}

export type HistoryTranslate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/** The default number of prior turns to carry (matches `actions.ts`). */
export const MAX_PLANNER_HISTORY_TURNS = 6;

export function toPlannerHistory(
  turns: readonly AnsweredTurn[],
  translate: HistoryTranslate,
  maxTurns: number = MAX_PLANNER_HISTORY_TURNS,
): ConversationTurn[] {
  const out: ConversationTurn[] = [];
  for (const turn of turns) {
    out.push({ role: "user", content: turn.question });
    const answer =
      turn.result.answer ??
      (turn.result.answerKey
        ? translate(turn.result.answerKey, turn.result.answerParams ?? undefined)
        : "");
    if (answer) out.push({ role: "assistant", content: answer });
  }
  return out.slice(-maxTurns);
}
