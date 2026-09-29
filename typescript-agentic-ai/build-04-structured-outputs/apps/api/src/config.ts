import "dotenv/config";
import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MAX_CONTEXT_TURNS: z.coerce.number().int().min(1).max(100).default(10),

  // ── Structured generation (Build 04) ──────────────────────────────────────
  // Model used for structured calls. Falls back to OPENAI_MODEL when unset.
  // It must support provider strict structured outputs.
  STRUCTURED_OUTPUT_MODEL: z.string().min(1).optional(),
  // Per-call timeout. A repair retry can double the worst-case wait.
  STRUCTURED_OUTPUT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(15_000),
  // Output token cap for structured calls. Truncated output is rejected.
  STRUCTURED_OUTPUT_MAX_TOKENS: z.coerce
    .number()
    .int()
    .min(64)
    .max(4_096)
    .default(512),
  // One repair retry after a parse or validation failure. "true" | "false".
  STRUCTURED_OUTPUT_REPAIR_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

const parsedEnvironment = EnvironmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  console.error(
    "Invalid environment configuration:",
    z.treeifyError(parsedEnvironment.error),
  );

  throw new Error("The API cannot start with invalid configuration.");
}

export const config = parsedEnvironment.data;
