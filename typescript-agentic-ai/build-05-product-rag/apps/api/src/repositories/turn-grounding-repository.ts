/**
 * Turn grounding repository — PostgreSQL access for `turn_groundings`.
 *
 * All SQL is parameterized. One row per turn; saving the same turn twice is a
 * no-op rather than an error, so a retried write cannot fail a reply.
 */

import type { Pool } from "pg";
import type { TurnGroundingRow, TurnGroundingStatus } from "../db/types.js";

export type SaveTurnGroundingInput = {
  turnId: string;
  conversationId: string;
  status: TurnGroundingStatus;
  reason: string | null;
  filters: Record<string, unknown>;
  retrievalParams: Record<string, unknown>;
  retrieved: Array<{ productId: string; similarity: number }>;
  recommendedProductIds: string[];
  rejectedRecommendationCount: number;
  latencyMs: number;
};

export type TurnGroundingRepository = {
  save(input: SaveTurnGroundingInput): Promise<void>;

  /** All groundings for a conversation, oldest first. */
  findByConversationId(conversationId: string): Promise<TurnGroundingRow[]>;
};

export function createTurnGroundingRepository(
  pool: Pool,
): TurnGroundingRepository {
  return {
    async save(input) {
      await pool.query(
        `INSERT INTO turn_groundings
           (turn_id, conversation_id, status, reason, filters, retrieval_params,
            retrieved, recommended_product_ids, rejected_recommendation_count,
            latency_ms)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::uuid[], $9, $10)
         ON CONFLICT (turn_id) DO NOTHING`,
        [
          input.turnId,
          input.conversationId,
          input.status,
          input.reason,
          JSON.stringify(input.filters),
          JSON.stringify(input.retrievalParams),
          JSON.stringify(input.retrieved),
          input.recommendedProductIds,
          input.rejectedRecommendationCount,
          input.latencyMs,
        ],
      );
    },

    async findByConversationId(conversationId) {
      const result = await pool.query<TurnGroundingRow>(
        `SELECT turn_id, conversation_id, status, reason, filters,
                retrieval_params, retrieved, recommended_product_ids,
                rejected_recommendation_count, latency_ms, created_at
           FROM turn_groundings
          WHERE conversation_id = $1
          ORDER BY created_at ASC`,
        [conversationId],
      );
      return result.rows;
    },
  };
}
