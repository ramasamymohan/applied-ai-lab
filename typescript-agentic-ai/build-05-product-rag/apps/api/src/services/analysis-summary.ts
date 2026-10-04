/**
 * Analysis summaries (Build 04).
 *
 * The API-facing view of a stored turn analysis. Deliberately smaller than the
 * stored row: no failure details, latency, attempt counts, or raw payload.
 *
 * Stored payloads are re-validated on read against the contract they were
 * written under. Rows from a contract version this code does not understand,
 * or whose payload no longer validates, are skipped, so an old or damaged row
 * can never break loading a conversation.
 */

import type { TurnAnalysisRow } from "../db/types.js";
import { clarificationQuestion } from "./turn-decision.js";
import {
  SHOPPING_REQUEST_SCHEMA_VERSION,
  ShoppingRequestContract,
  ShoppingRequestSchema,
  type ShoppingIntent,
} from "../structured/contracts/shopping-request.js";

export type AnalysisSummary =
  | {
      turn_id: string;
      status: "completed";
      schema_version: number;
      intent: ShoppingIntent;
      category: string | null;
      budget: { max: number | null; currency: string | null };
      attributes: string[];
      needs_clarification: boolean;
    }
  | { turn_id: string; status: "analysis_failed" };

export function toAnalysisSummary(row: TurnAnalysisRow): AnalysisSummary | null {
  if (row.status === "analysis_failed") {
    return { turn_id: row.turn_id, status: "analysis_failed" };
  }

  if (
    row.contract_name !== ShoppingRequestContract.name ||
    row.schema_version !== SHOPPING_REQUEST_SCHEMA_VERSION
  ) {
    return null;
  }

  const parsed = ShoppingRequestSchema.safeParse(row.payload);

  if (!parsed.success) {
    return null;
  }

  const request = parsed.data;

  return {
    turn_id: row.turn_id,
    status: "completed",
    schema_version: row.schema_version,
    intent: request.intent,
    category: request.category,
    budget: { max: request.budget.max, currency: request.budget.currency },
    attributes: request.attributes,
    // Whether the application asked a clarifying question, which can be
    // narrower than the model's raw flag (see clarificationQuestion).
    needs_clarification: clarificationQuestion(request) !== null,
  };
}
