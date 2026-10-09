
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { databasePlugin } from "./db/pool.js";
import { createConversationRepository } from "./repositories/conversation-repository.js";
import { createMessageRepository } from "./repositories/message-repository.js";
import { createTurnAnalysisRepository } from "./repositories/turn-analysis-repository.js";
import type { RequestAnalysisService } from "./services/request-analysis-service.js";
import { createConversationService } from "./services/conversation-service.js";
import { registerConversationRoutes } from "./routes/conversation-routes.js";
import type { ChatStreamingService } from "./streaming/chat-streaming-service.js";
import { createProductRepository } from "./repositories/product-repository.js";
import { createProductSearchRepository } from "./repositories/product-search-repository.js";
import { createTurnGroundingRepository } from "./repositories/turn-grounding-repository.js";
import { createProductRetrievalService } from "./retrieval/product-retrieval-service.js";
import { createGroundedAnswerService } from "./services/grounded-answer-service.js";
import type { EmbeddingService } from "./embeddings/types.js";
import type { StructuredGenerationService } from "./structured/structured-generation-service.js";

type BuildAppOptions = {
  webOrigin: string;
  databaseUrl: string;
  maxContextTurns: number;
  chatStreamingService: ChatStreamingService;
  /** Build 04. Omit to run turns without request analysis (Build 03 behavior). */
  requestAnalysisService?: RequestAnalysisService | undefined;
  analysisContextTurns?: number | undefined;
  /**
   * Build 05. Omit to answer product searches with the chat model as in
   * Build 04. When provided, product-search turns are grounded in the catalog.
   */
  grounding?:
    | {
        embeddings: EmbeddingService;
        /** Structured generation for the grounded-answer contract. */
        structuredGeneration: StructuredGenerationService;
        topK: number;
        minSimilarity: number;
      }
    | undefined;
};

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: true,
    bodyLimit: 16 * 1024,
  });

  await app.register(cors, {
    origin: options.webOrigin,
    methods: ["GET", "POST"],
    // Lets the browser read the conversation ID from streaming responses.
    exposedHeaders: ["X-Conversation-Id"],
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
  const turnAnalysisRepository = createTurnAnalysisRepository(app.pg);

  // Build 05: product grounding, only when its dependencies were provided.
  const groundedAnswerService = options.grounding
    ? createGroundedAnswerService({
        retrieval: createProductRetrievalService({
          embeddings: options.grounding.embeddings,
          searchRepository: createProductSearchRepository(app.pg),
          topK: options.grounding.topK,
          minSimilarity: options.grounding.minSimilarity,
          logger: app.log,
        }),
        structuredGeneration: options.grounding.structuredGeneration,
        productRepository: createProductRepository(app.pg),
        logger: app.log,
      })
    : undefined;

  const conversationService = createConversationService({
    conversationRepository,
    messageRepository,
    chatStreamingService: options.chatStreamingService,
    maxContextTurns: options.maxContextTurns,
    requestAnalysisService: options.requestAnalysisService,
    turnAnalysisRepository,
    analysisContextTurns: options.analysisContextTurns,
    groundedAnswerService,
    turnGroundingRepository: groundedAnswerService
      ? createTurnGroundingRepository(app.pg)
      : undefined,
    logger: app.log,
  });

  await registerConversationRoutes(app, {
    conversationService,
  });

  return app;
}
