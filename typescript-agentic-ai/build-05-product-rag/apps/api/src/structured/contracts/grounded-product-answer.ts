/**
 * GroundedProductAnswer contract, version 1 (Build 05).
 *
 * What the model returns after reading retrieved catalog candidates. It does
 * NOT contain prices, stock, or product facts to display: the application
 * fills those from the database. The model contributes a short introduction
 * and, per recommended product, a one-sentence reason.
 *
 * Product references are SKUs copied from the candidate list. A SKU is short
 * and human-meaningful, which makes copy errors rarer than with UUIDs. The
 * application maps verified SKUs to product IDs and rejects anything that was
 * not in the retrieved set, so a hallucinated or mistyped SKU is dropped, not
 * trusted.
 *
 * Strict-mode notes: no optional properties and no validation keywords in the
 * provider schema. Length and consistency rules are Zod refinements enforced
 * by the application (see contract.ts).
 */

import { z } from "zod";
import { defineContract } from "../contract.js";

export const GROUNDED_PRODUCT_ANSWER_SCHEMA_VERSION = 1;

export const GROUNDED_ANSWER_LIMITS = {
  maxRecommendations: 5,
  introMaxChars: 300,
  reasonMaxChars: 200,
} as const;

const RecommendationSchema = z.object({
  sku: z
    .string()
    .refine((value) => value.trim().length > 0 && value.length <= 64, {
      message: "sku must be a short non-empty string",
    }),
  reason: z
    .string()
    .refine(
      (value) =>
        value.trim().length > 0 &&
        value.length <= GROUNDED_ANSWER_LIMITS.reasonMaxChars,
      { message: "reason must be a short non-empty string" },
    ),
});

export const GroundedProductAnswerSchema = z
  .object({
    outcome: z.enum(["recommend", "no_match"]),
    intro: z.string(),
    recommendations: z.array(RecommendationSchema),
  })
  .refine(
    (value) =>
      value.recommendations.length <= GROUNDED_ANSWER_LIMITS.maxRecommendations,
    {
      message: `at most ${GROUNDED_ANSWER_LIMITS.maxRecommendations} recommendations`,
      path: ["recommendations"],
    },
  )
  .refine(
    (value) =>
      value.outcome === "recommend"
        ? value.recommendations.length > 0
        : value.recommendations.length === 0,
    {
      message: "recommend needs at least one recommendation; no_match needs none",
      path: ["recommendations"],
    },
  )
  .refine(
    (value) =>
      value.outcome === "no_match" ||
      (value.intro.trim().length > 0 &&
        value.intro.length <= GROUNDED_ANSWER_LIMITS.introMaxChars),
    {
      message: "intro must be a short non-empty string",
      path: ["intro"],
    },
  );

export type GroundedProductAnswer = z.output<typeof GroundedProductAnswerSchema>;

export const GroundedProductAnswerContract = defineContract({
  name: "grounded_product_answer",
  version: GROUNDED_PRODUCT_ANSWER_SCHEMA_VERSION,
  schema: GroundedProductAnswerSchema,
});
