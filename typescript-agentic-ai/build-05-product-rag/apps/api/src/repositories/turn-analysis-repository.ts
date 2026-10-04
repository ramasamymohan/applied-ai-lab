/**
 * Turn analysis repository — PostgreSQL access for the `turn_analyses` table.
 *
 * All SQL is parameterized. One row per turn; saving the same turn twice is a
 * no-op rather than an error, so a retried write cannot fail a reply.
 */

import type { Pool } from "pg";
import type { TurnAnalysisRow, TurnAnalysisStatus } from "../db/types.js";

export type SaveTurnAnalysisInput = {
  turnId: string;
  conversationId: string;
  status: TurnAnalysisStatus;
  failureKind: string | null;
  contractName: string;
  schemaVersion: number;
  /** Validated contract value for `completed`; null for `analysis_failed`. */
  payload: unknown | null;
  attempts: number;
  repaired: boolean;
  latencyMs: number;
};

export type TurnAnalysisRepository = {
  save(input: SaveTurnAnalysisInput): Promise<void>;

  /** All analyses for a conversation, oldest first. */
  findByConversationId(conversationId: string): Promise<TurnAnalysisRow[]>;
};

export function createTurnAnalysisRepository(
  pool: Pool,
): TurnAnalysisRepository {
  return {
    async save(input: SaveTurnAnalysisInput): Promise<void> {
      await pool.query(
        `INSERT INTO turn_analyses
           (turn_id, conversation_id, status, failure_kind, contract_name,
            schema_version, payload, attempts, repaired, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
         ON CONFLICT (turn_id) DO NOTHING`,
        [
          input.turnId,
          input.conversationId,
          input.status,
          input.failureKind,
          input.contractName,
          input.schemaVersion,
          input.payload === null ? null : JSON.stringify(input.payload),
          input.attempts,
          input.repaired,
          input.latencyMs,
        ],
      );
    },

    async findByConversationId(
      conversationId: string,
    ): Promise<TurnAnalysisRow[]> {
      const result = await pool.query<TurnAnalysisRow>(
        `SELECT turn_id, conversation_id, status, failure_kind, contract_name,
                schema_version, payload, attempts, repaired, latency_ms, created_at
         FROM turn_analyses
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conversationId],
      );
      return result.rows;
    },
  };
}
