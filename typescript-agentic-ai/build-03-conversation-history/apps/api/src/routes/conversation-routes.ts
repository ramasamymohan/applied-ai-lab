/**
 * Conversation routes for Build 03.
 *
 * POST   /api/conversations                    — Create a conversation
 * GET    /api/conversations                    — List conversations
 * GET    /api/conversations/:conversationId    — Get conversation with messages
 * POST   /api/conversations/:conversationId/messages — Send message (SSE stream)
 *
 * The streaming endpoint (POST .../messages) uses the same SSE wire format as
 * Build 02 but now includes conversationId and messageId in the done event.
 *
 * Pre-stream failures return JSON with an HTTP error code. Mid-stream failures
 * are forwarded as SSE error events because the response headers are already
 * committed.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { ConversationService } from "../services/conversation-service.js";
import {
  ConcurrentGenerationError,
  ConversationNotFoundError,
} from "../repositories/message-repository.js";
import { formatSseEvent, errorEvent } from "../streaming/sse.js";

// ── Request schemas ───────────────────────────────────────────────────────────

const CreateConversationSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, "Message cannot be empty.")
      .max(4000, "Message must be 4000 characters or fewer."),
  })
  .strict();

const SendMessageSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, "Message cannot be empty.")
      .max(4000, "Message must be 4000 characters or fewer."),
  })
  .strict();

const ConversationIdSchema = z.object({
  conversationId: z.string().uuid("Invalid conversation ID."),
});

// ── Route options ─────────────────────────────────────────────────────────────

type ConversationRouteOptions = {
  conversationService: ConversationService;
};

// ── Route registration ────────────────────────────────────────────────────────

export async function registerConversationRoutes(
  app: FastifyInstance,
  options: ConversationRouteOptions,
): Promise<void> {
  const { conversationService } = options;

  // ── POST /api/conversations — Create conversation and stream first reply ──

  app.post("/api/conversations", async (request, reply) => {
    const parsedBody = CreateConversationSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Enter a message of up to 4000 characters.",
        },
      });
    }

    // Create the conversation
    let conversation;
    try {
      conversation = await conversationService.createConversation(
        parsedBody.data.message,
      );
    } catch (err) {
      request.log.error({ err }, "Failed to create conversation");
      return reply.code(500).send({
        error: {
          code: "INTERNAL_ERROR",
          message: "Could not create conversation. Please try again.",
        },
      });
    }

    // Send the first message and stream the reply
    return streamMessageReply(
      request,
      reply,
      conversationService,
      conversation.id,
      parsedBody.data.message,
    );
  });

  // ── GET /api/conversations — List conversations ───────────────────────────

  app.get("/api/conversations", async (_request, reply) => {
    const conversations = await conversationService.listConversations();
    return reply.send({ conversations });
  });

  // ── GET /api/conversations/:conversationId — Get conversation ─────────────

  app.get(
    "/api/conversations/:conversationId",
    async (request, reply) => {
      const parsedParams = ConversationIdSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid conversation ID.",
          },
        });
      }

      const conversation = await conversationService.getConversation(
        parsedParams.data.conversationId,
      );

      if (!conversation) {
        return reply.code(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Conversation not found.",
          },
        });
      }

      return reply.send({ conversation });
    },
  );

  // ── POST /api/conversations/:conversationId/messages — Send message ───────

  app.post(
    "/api/conversations/:conversationId/messages",
    async (request, reply) => {
      const parsedParams = ConversationIdSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid conversation ID.",
          },
        });
      }

      const parsedBody = SendMessageSchema.safeParse(request.body);

      if (!parsedBody.success) {
        return reply.code(400).send({
          error: {
            code: "INVALID_REQUEST",
            message: "Enter a message of up to 4000 characters.",
          },
        });
      }

      return streamMessageReply(
        request,
        reply,
        conversationService,
        parsedParams.data.conversationId,
        parsedBody.data.message,
      );
    },
  );
}

// ── Shared streaming helper ───────────────────────────────────────────────────

/**
 * Creates a turn, sets up SSE headers, and streams the assistant reply.
 *
 * Used by both POST /api/conversations (first message) and
 * POST /api/conversations/:id/messages (subsequent messages).
 *
 * This function owns the SSE lifecycle:
 *   1. Creates the turn via the conversation service (can fail with HTTP error)
 *   2. Commits SSE headers (after this point, errors go through SSE events)
 *   3. Iterates the persistent stream, writing events to the response
 *   4. Ends the HTTP response
 */
async function streamMessageReply(
  request: FastifyRequest,
  reply: FastifyReply,
  conversationService: ConversationService,
  conversationId: string,
  message: string,
): Promise<FastifyReply> {
  // ── Create the turn (pre-stream — can return HTTP errors) ─────────────

  let sendResult;
  try {
    sendResult = await conversationService.sendMessage(
      conversationId,
      message,
    );
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Conversation not found.",
        },
      });
    }

    if (err instanceof ConcurrentGenerationError) {
      return reply.code(409).send({
        error: {
          code: "CONCURRENT_GENERATION",
          message:
            "A response is already being generated for this conversation.",
        },
      });
    }

    request.log.error({ err }, "Failed to create turn");
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Could not send message. Please try again.",
      },
    });
  }

  // ── SSE response setup ────────────────────────────────────────────────

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let clientClosed = false;
  reply.raw.on("close", () => {
    clientClosed = true;
  });

  // ── Timing for observability ──────────────────────────────────────────

  const startedAt = Date.now();
  let firstDeltaAt: number | null = null;
  let eventCount = 0;

  // ── Stream generation ─────────────────────────────────────────────────

  try {
    for await (const event of sendResult.stream) {
      if (clientClosed) {
        break;
      }

      if (event.event === "delta") {
        if (firstDeltaAt === null) {
          firstDeltaAt = Date.now();
        }
        eventCount++;
      }

      reply.raw.write(formatSseEvent(event));

      if (event.event === "done" || event.event === "error") {
        const outcome = event.event === "done" ? "completed" : "error";
        const durationMs = Date.now() - startedAt;

        request.log.info(
          {
            outcome,
            conversationId,
            durationMs,
            timeToFirstDeltaMs:
              firstDeltaAt !== null ? firstDeltaAt - startedAt : null,
            deltaCount: eventCount,
          },
          "Streaming generation finished",
        );

        break;
      }
    }
  } catch (err) {
    request.log.error({ err }, "Unexpected error during streaming");

    if (!clientClosed) {
      reply.raw.write(
        formatSseEvent(
          errorEvent(
            "The assistant is temporarily unavailable. Please try again.",
          ),
        ),
      );
    }
  }

  reply.raw.end();
  return reply;
}
