/**
 * Grounding summaries (Build 05).
 *
 * The API-facing view of a stored turn grounding: which products were
 * retrieved and which were verified and recommended. IDs only; no similarity
 * scores, filters, or failure reasons. Product details are not embedded here
 * because a stored ID can outlive a product's price or stock; clients hydrate
 * from the catalog.
 *
 * The stored `retrieved` JSONB is untrusted until re-validated. A malformed
 * entry is skipped rather than breaking the conversation load.
 */

import type { TurnGroundingRow, TurnGroundingStatus } from "../db/types.js";

export type GroundingSummary = {
  turn_id: string;
  status: TurnGroundingStatus;
  retrieved_product_ids: string[];
  recommended_product_ids: string[];
};

export function toGroundingSummary(row: TurnGroundingRow): GroundingSummary {
  const retrieved = Array.isArray(row.retrieved) ? row.retrieved : [];

  const retrievedIds = retrieved.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const productId = (entry as { productId?: unknown }).productId;
    return typeof productId === "string" ? [productId] : [];
  });

  return {
    turn_id: row.turn_id,
    status: row.status,
    retrieved_product_ids: retrievedIds,
    recommended_product_ids: row.recommended_product_ids,
  };
}
