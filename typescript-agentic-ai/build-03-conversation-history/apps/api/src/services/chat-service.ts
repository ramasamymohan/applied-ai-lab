
import OpenAI from "openai";

export type ChatService = {
  generateReply(message: string): Promise<string>;
};

type CreateChatServiceOptions = {
  apiKey: string;
  model: string;
};

const SYSTEM_INSTRUCTIONS = `
You are Storefront AI, a helpful shopping assistant for an online retailer.

Help customers understand product categories, compare general product
characteristics, and make informed shopping decisions.

Do not invent current prices, inventory, shipping estimates, or retailer
policies. If the user asks for specific store information that you do not
have, explain that you do not have access to live store data.

Be concise, friendly, and transparent about uncertainty.
`.trim();

export function createChatService(
  options: CreateChatServiceOptions,
): ChatService {
  const client = new OpenAI({
    apiKey: options.apiKey,
    timeout: 30_000,
    maxRetries: 1,
  });

  return {
    async generateReply(message: string): Promise<string> {
      const response = await client.responses.create({
        model: options.model,
        instructions: SYSTEM_INSTRUCTIONS,
        input: message,
      });

      const reply = response.output_text.trim();

      if (!reply) {
        throw new Error("The model returned no text output.");
      }

      return reply;
    },
  };
}