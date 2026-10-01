/**
 * Turn decision (Build 04).
 *
 * Plain TypeScript, not model-driven. The model proposes an interpretation;
 * the application decides what happens next.
 *
 * Rules
 *  - Analysis failed or absent: answer normally with no analysis context.
 *  - needs_clarification with a usable question: reply with that question
 *    instead of calling the chat model. Small talk is never held up by a
 *    clarifying question.
 *  - Otherwise: answer normally, passing the analysis as a non-authoritative
 *    hint.
 */

import type { ShoppingRequest } from "../structured/contracts/shopping-request.js";
import type { AnalysisOutcome } from "./request-analysis-service.js";

export type TurnDecision =
  | { action: "clarify"; question: string }
  | { action: "answer"; analysis: ShoppingRequest | null };

/**
 * The clarifying question the application will actually ask, or null.
 * Shared by the turn decision and the API summary so both always agree on
 * whether a turn is a clarification, whatever the model's raw flag said.
 */
export function clarificationQuestion(request: ShoppingRequest): string | null {
  const question = request.clarification_question?.trim() ?? "";

  if (
    request.needs_clarification &&
    request.intent !== "small_talk" &&
    question.length > 0
  ) {
    return question;
  }

  return null;
}

export function decideTurn(outcome: AnalysisOutcome | null): TurnDecision {
  if (outcome === null || outcome.status !== "completed") {
    return { action: "answer", analysis: null };
  }

  const question = clarificationQuestion(outcome.request);

  if (question !== null) {
    return { action: "clarify", question };
  }

  return { action: "answer", analysis: outcome.request };
}
