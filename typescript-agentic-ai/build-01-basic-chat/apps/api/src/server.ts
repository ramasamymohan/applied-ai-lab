
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { createChatService } from "./services/chat-service.js";

async function main(): Promise<void> {
  const chatService = createChatService({
    apiKey: config.OPENAI_API_KEY,
    model: config.OPENAI_MODEL,
  });

  const app = await buildApp({
    webOrigin: config.WEB_ORIGIN,
    chatService,
  });

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