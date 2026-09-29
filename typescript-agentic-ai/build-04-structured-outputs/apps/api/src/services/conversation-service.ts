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
import type { StreamEvent } from "../streaming/sse.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ConversationWithMessages = ConversationRow & {
  messages: MessageRow[];
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

      return { ...conversation, messages };
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

      // Create the persistent streaming wrapper. This wraps the raw streaming
      // service and handles finalizing the assistant message in the database
      // when the stream completes, fails, or is cancelled.
      const stream = persistentStream({
        messageRepository,
        assistantMessageId: turn.assistantMessage.id,
        signal,
        innerStream: chatStreamingService.streamReply({
          message,
          contextMessages,
          conversationId,
          messageId: turn.assistantMessage.id,
          signal,
        }),
      });

      return { turn, stream };
    },
  };
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
