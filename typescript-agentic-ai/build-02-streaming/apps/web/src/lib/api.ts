
import { z } from "zod";

const ChatSuccessSchema = z.object({
  reply: z.string().min(1),
});

const ChatErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ChatRequest = {
  message: string;
};

export type ChatError = {
  code: string;
  message: string;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export async function sendChatMessage(
  message: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message } satisfies ChatRequest),
    signal,
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = ChatErrorSchema.safeParse(payload);

    if (parsedError.success) {
      throw new Error(parsedError.data.error.message);
    }

    throw new Error("The request failed. Please try again.");
  }

  const parsedSuccess = ChatSuccessSchema.safeParse(payload);

  if (!parsedSuccess.success) {
    throw new Error("The server returned an unexpected response.");
  }

  return parsedSuccess.data.reply;
}