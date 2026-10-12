/**
 * POST /api/chat — streaming chat endpoint.
 *
 * Request:  { "message": string }   (Zod-validated)
 * Response: text/event-stream (SSE)
 *
 * Pre-stream failures (validation, missing body) return JSON with an HTTP
 * error code — headers have not been committed yet so a normal error response
 * is safe.
 *
 * Mid-stream failures are forwarded as an SSE `error` event because the HTTP
 * response headers (200 + SSE content-type) are already on the wire.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ChatStreamingService } from "../streaming/chat-streaming-service.js";
import { formatSseEvent } from "../streaming/sse.js";

const ChatRequestSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, "Message cannot be empty.")
      .max(4000, "Message must be 4000 characters or fewer."),
  })
  .strict();

type ChatRouteOptions = {
  chatStreamingService: ChatStreamingService;
};

export async function registerChatRoutes(
  app: FastifyInstance,
  options: ChatRouteOptions,
): Promise<void> {
  app.post("/api/chat", async (request, reply) => {
    // ── Validation ────────────────────────────────────────────────────────────

    const parsedRequest = ChatRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Enter a message of up to 4000 characters.",
        },
      });
    }

    // ── SSE response setup ────────────────────────────────────────────────────

    // Commit SSE headers before writing any body. After this point we cannot
    // send HTTP status codes — errors go through the SSE error event.
    // reply.raw.writeHead(200, {
    //   "Content-Type": "text/event-stream",
    //   "Cache-Control": "no-cache, no-transform",
    //   Connection: "keep-alive",
    //   // Prevents Nginx and other reverse proxies from buffering the stream
    //   "X-Accel-Buffering": "no",
    // });


    // Preserve headers registered by Fastify plugins, including CORS.
    const responseHeaders = {
      "Access-Control-Allow-Origin": reply.getHeader("Access-Control-Allow-Origin"),
      ...(reply.getHeader("Vary")
        ? { Vary: reply.getHeader("Vary") }
        : {}),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    };

    // Tell Fastify that we are managing the raw response ourselves.
    reply.hijack();

    // Commit the response headers.
    reply.raw.writeHead(200, responseHeaders);

    // Track whether the client closed the connection early
    let clientClosed = false;
    reply.raw.on("close", () => {
      clientClosed = true;
    });

    // AbortController lets us signal the streaming service when the client
    // disconnects or the request ends prematurely
    const abortController = new AbortController();
    reply.raw.on("close", () => {
      abortController.abort();
    });

    // ── Timing for observability ──────────────────────────────────────────────

    const startedAt = Date.now();
    let firstDeltaAt: number | null = null;
    let eventCount = 0;

    // ── Stream generation ─────────────────────────────────────────────────────

    try {
      for await (const event of options.chatStreamingService.streamReply(
        parsedRequest.data.message,
        abortController.signal,
      )) {
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

        // Stop after done or error — do not write further events
        if (event.event === "done" || event.event === "error") {
          const outcome = event.event === "done" ? "completed" : "error";
          const durationMs = Date.now() - startedAt;

          request.log.info(
            {
              outcome,
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
      // This catch block should not be reached because streamReply never
      // throws — all errors surface as error events. Log if it does.
      request.log.error({ err }, "Unexpected error during streaming");

      if (!clientClosed) {
        reply.raw.write(
          formatSseEvent({
            event: "error",
            data: {
              message:
                "The assistant is temporarily unavailable. Please try again.",
            },
          }),
        );
      }
    }

    // End the HTTP response cleanly
    reply.raw.end();

    // Tell Fastify not to manage the reply — we used reply.raw directly
    return reply;
  });
}
