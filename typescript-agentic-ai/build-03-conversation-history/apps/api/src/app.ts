
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { databasePlugin } from "./db/pool.js";
import { createConversationRepository } from "./repositories/conversation-repository.js";
import { createMessageRepository } from "./repositories/message-repository.js";
import { createConversationService } from "./services/conversation-service.js";
import { registerConversationRoutes } from "./routes/conversation-routes.js";
import type { ChatStreamingService } from "./streaming/chat-streaming-service.js";

type BuildAppOptions = {
  webOrigin: string;
  databaseUrl: string;
  maxContextTurns: number;
  chatStreamingService: ChatStreamingService;
};

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: true,
    bodyLimit: 16 * 1024,
  });

  await app.register(cors, {
    origin: options.webOrigin,
    methods: ["GET", "POST"],
  });

  await app.register(rateLimit, {
    max: 30,
    timeWindow: "1 minute",
  });

  await app.register(databasePlugin, {
    databaseUrl: options.databaseUrl,
  });

  app.get("/api/health", async () => ({
    status: "ok",
  }));

  // ── Wire up conversation service and routes ────────────────────────────

  const conversationRepository = createConversationRepository(app.pg);
  const messageRepository = createMessageRepository(app.pg);

  const conversationService = createConversationService({
    conversationRepository,
    messageRepository,
    chatStreamingService: options.chatStreamingService,
    maxContextTurns: options.maxContextTurns,
  });

  await registerConversationRoutes(app, {
    conversationService,
  });

  return app;
}
