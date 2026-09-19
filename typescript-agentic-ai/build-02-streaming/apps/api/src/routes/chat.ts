
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ChatService } from "../services/chat-service.js";

const ChatRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message cannot be empty.")
    .max(4000, "Message must be 4000 characters or fewer."),
}).strict();

type ChatRouteOptions = {
  chatService: ChatService;
};

export async function registerChatRoutes(
  app: FastifyInstance,
  options: ChatRouteOptions,
): Promise<void> {
  app.post("/api/chat", async (request, reply) => {
    const parsedRequest = ChatRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Enter a message of up to 4000 characters.",
        },
      });
    }

    try {
      const response = await options.chatService.generateReply(
        parsedRequest.data.message,
      );

      return reply.code(200).send({
        reply: response,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        "Chat provider request failed",
      );

      return reply.code(502).send({
        error: {
          code: "MODEL_REQUEST_FAILED",
          message:
            "The assistant is temporarily unavailable. Please try again.",
        },
      });
    }
  });
}