
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { registerChatRoutes } from "./routes/chat.js";
import type { ChatService } from "./services/chat-service.js";

type BuildAppOptions = {
  webOrigin: string;
  chatService: ChatService;
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

  app.get("/api/health", async () => ({
    status: "ok",
  }));

  await registerChatRoutes(app, {
    chatService: options.chatService,
  });

  return app;
}