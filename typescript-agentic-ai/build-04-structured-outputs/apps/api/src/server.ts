
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { createChatStreamingService } from "./streaming/chat-streaming-service.js";
import { createMessageRepository } from "./repositories/message-repository.js";
import { createOpenAIStructuredProvider } from "./structured/openai-structured-provider.js";
import { createStructuredGenerationService } from "./structured/structured-generation-service.js";
import { createRequestAnalysisService } from "./services/request-analysis-service.js";

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

  const app = await buildApp({
    webOrigin: config.WEB_ORIGIN,
    databaseUrl: config.DATABASE_URL,
    maxContextTurns: config.MAX_CONTEXT_TURNS,
    chatStreamingService,
    requestAnalysisService,
    analysisContextTurns: config.ANALYSIS_CONTEXT_TURNS,
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
