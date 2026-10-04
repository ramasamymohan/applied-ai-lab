/**
 * Conversation service — orchestrates repositories and streaming.
 *
 * This service owns the business logic for conversations:
 *
 *   - Creating conversations with a title derived from the first message
 *   - Sending messages: creating a turn, building model context from
 *     completed turns, streaming the reply, and persisting the result
 *   - Listing and retrieving conversations with their messages
 *
 * Build 04 turn lifecycle (inside the stream, after the SSE headers are sent):
 *
 *   createTurn (transaction) → analyze request → persist analysis
 *     → decide (application code) → clarifying reply | streamed model reply
 *
 * Analysis never blocks a reply: any analysis failure is recorded as
 * `analysis_failed` and the turn continues as a normal conversation.
 *
 * Route handlers call this service rather than touching repositories or
 * the streaming layer directly. This keeps the route layer thin and the
 * orchestration testable.
 */

import type { ConversationRow, MessageRow } from "../db/types.js";
import type { ConversationRepository } from "../repositories/conversation-repository.js";
import type {
  MessageRepository,
  TurnInsertResult,
} from "../repositories/message-repository.js";
import type {
  ChatStreamingService,
  ContextMessage,
} from "../streaming/chat-streaming-service.js";
import {
  analysisEvent,
  deltaEvent,
  doneEvent,
  type StreamEvent,
} from "../streaming/sse.js";
import type { TurnAnalysisRepository } from "../repositories/turn-analysis-repository.js";
import { toAnalysisSummary, type AnalysisSummary } from "./analysis-summary.js";
import type {
  AnalysisOutcome,
  RequestAnalysisService,
} from "./request-analysis-service.js";
import { decideTurn } from "./turn-decision.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ConversationWithMessages = ConversationRow & {
  messages: MessageRow[];
  /** Build 04: per-turn analysis summaries, oldest first. Additive. */
  analyses: AnalysisSummary[];
};

export type SendMessageResult = {
  turn: TurnInsertResult;
  stream: AsyncIterable<StreamEvent>;
};

export type ConversationService = {
  /** Create a new conversation. Title is derived from the first user message. */
  createConversation(firstMessage: string): Promise<ConversationRow>;

  /** List conversations, most recently updated first. */
  listConversations(): Promise<ConversationRow[]>;

  /** Get a conversation with all its messages. Returns null if not found. */
  getConversation(id: string): Promise<ConversationWithMessages | null>;

  /**
   * Send a message in a conversation. Creates the turn (user message +
   * assistant placeholder), builds context from prior completed turns,
   * and returns the turn and an async iterable of streaming events.
   *
   * The caller is responsible for iterating the stream and writing SSE
   * events to the response. The assistant message is finalized in the
   * database automatically: before a terminal done/error event is yielded,
   * or as `cancelled` if the caller stops iterating early (for example,
   * because the client disconnected).
   *
   * The optional signal cancels the upstream provider request.
   */
  sendMessage(
    conversationId: string,
    message: string,
    signal?: AbortSignal,
  ): Promise<SendMessageResult>;
};

type CreateConversationServiceOptions = {
  conversationRepository: ConversationRepository;
  messageRepository: MessageRepository;
  chatStreamingService: ChatStreamingService;
  maxContextTurns: number;
  /**
   * Build 04. When both are provided, each turn is analyzed before the reply.
   * When omitted, turns behave exactly as in Build 03.
   */
  requestAnalysisService?: RequestAnalysisService | undefined;
  turnAnalysisRepository?: TurnAnalysisRepository | undefined;
  /** Number of recent completed turns given to the analyzer as context. */
  analysisContextTurns?: number | undefined;
  logger?: ServiceLogger | undefined;
};

/** Minimal logger shape; Fastify's logger satisfies it. */
export type ServiceLogger = {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
};

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Derive a short conversation title from the first user message.
 * Truncates to 80 characters with an ellipsis if needed.
 */
function deriveTitle(message: string): string {
  const maxLength = 80;
  const trimmed = message.trim().replace(/\n+/g, " ");
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return trimmed.slice(0, maxLength - 1) + "…";
}

export function createConversationService(
  options: CreateConversationServiceOptions,
): ConversationService {
  const {
    conversationRepository,
    messageRepository,
    chatStreamingService,
    maxContextTurns,
    requestAnalysisService,
    turnAnalysisRepository,
    analysisContextTurns = 2,
    logger,
  } = options;

  return {
    async createConversation(
      firstMessage: string,
    ): Promise<ConversationRow> {
      const title = deriveTitle(firstMessage);
      return conversationRepository.create(title);
    },

    async listConversations(): Promise<ConversationRow[]> {
      return conversationRepository.list();
    },

    async getConversation(
      id: string,
    ): Promise<ConversationWithMessages | null> {
      const conversation = await conversationRepository.findById(id);
      if (!conversation) {
        return null;
      }

      const messages = await messageRepository.findByConversationId(id);

      let analyses: AnalysisSummary[] = [];

      if (turnAnalysisRepository) {
        const rows = await turnAnalysisRepository.findByConversationId(id);
        analyses = rows.flatMap((row) => {
          const summary = toAnalysisSummary(row);
          return summary === null ? [] : [summary];
        });
      }

      return { ...conversation, messages, analyses };
    },

    async sendMessage(
      conversationId: string,
      message: string,
      signal?: AbortSignal,
    ): Promise<SendMessageResult> {
      // Generate a turn ID for this exchange
      const turnId = crypto.randomUUID();

      // Create the turn — inserts user message + assistant placeholder
      // in a single transaction. Throws ConcurrentGenerationError or
      // ConversationNotFoundError on constraint violations.
      const turn = await messageRepository.createTurn(
        conversationId,
        turnId,
        message,
      );

      // Build context from recent completed turns
      const contextRows = await messageRepository.findRecentCompletedTurns(
        conversationId,
        maxContextTurns,
        turnId,
      );

      const contextMessages: ContextMessage[] = contextRows.map((row) => ({
        role: row.role,
        content: row.content,
      }));

      // Create the persistent streaming wrapper. This wraps the turn's event
      // source and handles finalizing the assistant message in the database
      // when the stream completes, fails, or is cancelled.
      //
      // Analysis runs inside the stream (not here) so the SSE headers go out
      // immediately and the `analysis` event reaches the client as soon as
      // it is ready.
      const stream = persistentStream({
        messageRepository,
        assistantMessageId: turn.assistantMessage.id,
        signal,
        innerStream: turnEvents({
          turnId,
          conversationId,
          assistantMessageId: turn.assistantMessage.id,
          message,
          contextMessages,
          signal,
          chatStreamingService,
          requestAnalysisService,
          turnAnalysisRepository,
          analysisContextMessages: Math.max(0, analysisContextTurns) * 2,
          logger,
        }),
      });

      return { turn, stream };
    },
  };
}


// ── Turn events: analyze, decide, reply ───────────────────────────────────────

type TurnEventsOptions = {
  turnId: string;
  conversationId: string;
  assistantMessageId: string;
  message: string;
  contextMessages: ContextMessage[];
  signal: AbortSignal | undefined;
  chatStreamingService: ChatStreamingService;
  requestAnalysisService: RequestAnalysisService | undefined;
  turnAnalysisRepository: TurnAnalysisRepository | undefined;
  analysisContextMessages: number;
  logger: ServiceLogger | undefined;
};

/**
 * Analyze the request and persist the result. Never throws: a failure to
 * analyze or to persist is logged and the turn carries on.
 */
async function analyzeAndPersist(
  options: TurnEventsOptions,
  analysisService: RequestAnalysisService,
  repository: TurnAnalysisRepository | undefined,
): Promise<AnalysisOutcome | null> {
  const { turnId, conversationId, logger } = options;

  try {
    const recent =
      options.analysisContextMessages === 0
        ? []
        : options.contextMessages.slice(-options.analysisContextMessages);

    const outcome = await analysisService.analyze({
      message: options.message,
      contextMessages: recent,
      signal: options.signal,
    });

    // Log metadata only: never the shopper's text or the model's output.
    logger?.info(
      {
        conversationId,
        turnId,
        status: outcome.status,
        failureKind:
          outcome.status === "analysis_failed" ? outcome.failureKind : null,
        attempts: outcome.attempts,
        repaired: outcome.repaired,
        latencyMs: outcome.latencyMs,
        contract: outcome.contract,
      },
      "Request analysis finished",
    );

    // A cancelled turn has no meaningful analysis to keep.
    if (outcome.status === "analysis_failed" && outcome.aborted) {
      return outcome;
    }

    if (repository) {
      try {
        await repository.save({
          turnId,
          conversationId,
          status: outcome.status,
          failureKind:
            outcome.status === "analysis_failed" ? outcome.failureKind : null,
          contractName: outcome.contract.name,
          schemaVersion: outcome.contract.version,
          payload: outcome.status === "completed" ? outcome.request : null,
          attempts: outcome.attempts,
          repaired: outcome.repaired,
          latencyMs: outcome.latencyMs,
        });
      } catch (err) {
        logger?.warn(
          { err, conversationId, turnId },
          "Failed to persist request analysis",
        );
      }
    }

    return outcome;
  } catch (err) {
    logger?.warn({ err, conversationId, turnId }, "Request analysis crashed");
    return null;
  }
}

/**
 * The turn's event source, wrapped by persistentStream.
 *
 * Yields an optional `analysis` event, then either a clarifying reply
 * (delta + done, no chat-model call) or the streamed model reply. If the
 * caller cancels during analysis the generator ends with no terminal event,
 * which persistentStream finalizes as `cancelled`.
 */
async function* turnEvents(
  options: TurnEventsOptions,
): AsyncIterable<StreamEvent> {
  let outcome: AnalysisOutcome | null = null;

  if (options.requestAnalysisService) {
    outcome = await analyzeAndPersist(
      options,
      options.requestAnalysisService,
      options.turnAnalysisRepository,
    );

    if (options.signal?.aborted) {
      return;
    }
  }

  const decision = decideTurn(outcome);

  if (outcome !== null) {
    yield analysisEvent({
      turnId: options.turnId,
      status: outcome.status,
      intent: outcome.status === "completed" ? outcome.request.intent : null,
      needsClarification: decision.action === "clarify",
    });
  }

  if (decision.action === "clarify") {
    yield deltaEvent(decision.question);
    yield doneEvent(options.conversationId, options.assistantMessageId);
    return;
  }

  yield* options.chatStreamingService.streamReply({
    message: options.message,
    contextMessages: options.contextMessages,
    conversationId: options.conversationId,
    messageId: options.assistantMessageId,
    signal: options.signal,
    requestAnalysis: decision.analysis ?? undefined,
  });
}

// ── Persistent streaming wrapper ──────────────────────────────────────────────

type PersistentStreamOptions = {
  messageRepository: MessageRepository;
  assistantMessageId: string;
  innerStream: AsyncIterable<StreamEvent>;
  signal?: AbortSignal;
};

/**
 * Wraps a raw streaming iterable, accumulates the generated text, and
 * guarantees the assistant message leaves the `streaming` status.
 *
 * Finalization rules:
 *
 *   - `done`   → finalized as `completed` BEFORE the event is yielded, so a
 *                client that sees `done` knows the reply is already persisted.
 *   - `error`  → finalized as `failed` BEFORE the event is yielded.
 *   - consumer stops early (client disconnect, route `break`) → the
 *                `finally` block finalizes as `cancelled` with the partial text.
 *   - inner stream ends with no terminal event → `cancelled` if the signal was
 *                aborted, otherwise `failed`.
 *
 * Finalizing before yielding matters: a consumer that `break`s out of
 * `for await` calls `return()` on this generator, which resumes it at the
 * `yield` and skips any code placed after it.
 */
async function* persistentStream(
  options: PersistentStreamOptions,
): AsyncIterable<StreamEvent> {
  const { messageRepository, assistantMessageId, innerStream, signal } =
    options;

  let accumulatedText = "";
  let finalized = false;

  async function finalize(
    status: "completed" | "failed" | "cancelled",
  ): Promise<void> {
    if (finalized) {
      return;
    }
    await messageRepository.finalizeAssistantMessage(
      assistantMessageId,
      accumulatedText,
      status,
    );
    finalized = true;
  }

  async function finalizeBestEffort(
    status: "failed" | "cancelled",
  ): Promise<void> {
    try {
      await finalize(status);
    } catch {
      // Best-effort — startup recovery marks leftover `streaming` rows as
      // `interrupted` on the next restart.
    }
  }

  try {
    for await (const event of innerStream) {
      if (event.event === "delta") {
        accumulatedText += event.data.text;
        yield event;
        continue;
      }

      if (event.event === "analysis") {
        // Informational only; does not affect the persisted message.
        yield event;
        continue;
      }

      if (event.event === "done") {
        await finalize("completed");
        yield event;
        return;
      }

      // error event
      await finalize("failed");
      yield event;
      return;
    }

    // Inner stream ended without a terminal event.
    await finalize(signal?.aborted ? "cancelled" : "failed");
  } catch (err) {
    await finalizeBestEffort("failed");
    throw err;
  } finally {
    // Runs when the consumer stops early. No-op if already finalized.
    await finalizeBestEffort("cancelled");
  }
}
