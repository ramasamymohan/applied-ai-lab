
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { createChatStreamingService } from "./streaming/chat-streaming-service.js";
import { createMessageRepository } from "./repositories/message-repository.js";
import { createOpenAIStructuredProvider } from "./structured/openai-structured-provider.js";
import { createStructuredGenerationService } from "./structured/structured-generation-service.js";
import { createRequestAnalysisService } from "./services/request-analysis-service.js";
import { createEmbeddingService } from "./embeddings/embedding-service.js";
import { createOpenAIEmbeddingProvider } from "./embeddings/openai-embedding-provider.js";

async function main(): Promise<void> {
  const chatStreamingService = createChatStreamingService({
    apiKey: config.OPENAI_API_KEY,
    model: config.OPENAI_MODEL,
  });

  // Structured generation (Build 04). Provider failures are not logged by the
  // adapter here; the turn lifecycle logs each analysis outcome instead.
  const structuredProvider = createOpenAIStructuredProvider({
    apiKey: config.OPENAI_API_KEY,
    model: config.STRUCTURED_OUTPUT_MODEL ?? config.OPENAI_MODEL,
    timeoutMs: config.STRUCTURED_OUTPUT_TIMEOUT_MS,
    maxOutputTokens: config.STRUCTURED_OUTPUT_MAX_TOKENS,
  });

  const requestAnalysisService = createRequestAnalysisService({
    structuredGeneration: createStructuredGenerationService({
      provider: structuredProvider,
      repairEnabled: config.STRUCTURED_OUTPUT_REPAIR_ENABLED,
    }),
  });

  // Product grounding (Build 05). The grounded-answer call returns up to five
  // recommendations, so it gets its own provider with a larger output cap.
  const grounding = config.PRODUCT_GROUNDING_ENABLED
    ? {
        embeddings: createEmbeddingService({
          provider: createOpenAIEmbeddingProvider({
            apiKey: config.OPENAI_API_KEY,
            model: config.EMBEDDING_MODEL,
            dimensions: config.EMBEDDING_DIMENSIONS,
            timeoutMs: config.EMBEDDING_TIMEOUT_MS,
          }),
          model: config.EMBEDDING_MODEL,
          dimensions: config.EMBEDDING_DIMENSIONS,
        }),
        structuredGeneration: createStructuredGenerationService({
          provider: createOpenAIStructuredProvider({
            apiKey: config.OPENAI_API_KEY,
            model: config.STRUCTURED_OUTPUT_MODEL ?? config.OPENAI_MODEL,
            timeoutMs: config.STRUCTURED_OUTPUT_TIMEOUT_MS,
            maxOutputTokens: config.GROUNDING_MAX_TOKENS,
          }),
          repairEnabled: config.STRUCTURED_OUTPUT_REPAIR_ENABLED,
        }),
        topK: config.RETRIEVAL_TOP_K,
        minSimilarity: config.RETRIEVAL_MIN_SIMILARITY,
      }
    : undefined;

  const app = await buildApp({
    webOrigin: config.WEB_ORIGIN,
    databaseUrl: config.DATABASE_URL,
    maxContextTurns: config.MAX_CONTEXT_TURNS,
    chatStreamingService,
    requestAnalysisService,
    analysisContextTurns: config.ANALYSIS_CONTEXT_TURNS,
    grounding,
  });

  // ── Startup recovery ─────────────────────────────────────────────────────
  // Mark any assistant messages left in 'streaming' status by a previous
  // process as 'interrupted'. This assumes a single application instance —
  // multi-instance coordination is not implemented in this build.
  try {
    const messageRepository = createMessageRepository(app.pg);
    const recoveredCount = await messageRepository.markAbandonedStreaming();
    if (recoveredCount > 0) {
      app.log.info(
        { recoveredCount },
        "Marked abandoned streaming messages as interrupted",
      );
    }
  } catch (err) {
    app.log.error({ err }, "Startup recovery failed");
    // Non-fatal — the server can still start
  }

  try {
    await app.listen({
      port: config.PORT,
      host: "0.0.0.0",
    });
  } catch (error) {
    app.log.error({ err: error }, "Failed to start API server");
    await app.close();
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("API startup failed:", error);
  process.exitCode = 1;
});
