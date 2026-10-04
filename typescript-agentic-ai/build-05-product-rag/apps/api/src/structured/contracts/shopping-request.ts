/**
 * ShoppingRequest contract, version 1 (Build 04).
 *
 * What a shopper's message means to the application: the intent, any
 * constraints, and whether the application should ask a clarifying question
 * before answering. The model proposes this; the application decides what to
 * do with it.
 *
 * Deviations from the draft in the build plan
 *  - `schema_version` is not part of the model's output schema. The version is
 *    applied by the application via the contract (ShoppingRequestContract.version)
 *    and persisted beside the payload. A model should not be trusted to carry
 *    versioning, and it keeps the provider schema smaller.
 *
 * Strict-mode notes
 *  - Optional values are nullable, never absent.
 *  - Range, length, and format rules are Zod refinements, which run in the
 *    application and are not sent to the provider (see contract.ts).
 *
 * Intent taxonomy: small and hand-written. It will be wrong sometimes, and
 * nothing measures how often until Build 12.
 */

import { z } from "zod";
import { defineContract } from "../contract.js";

export const SHOPPING_REQUEST_SCHEMA_VERSION = 1;

export const SHOPPING_INTENTS = [
  "product_search",
  "order_status",
  "returns",
  "policy_question",
  "small_talk",
  "other",
] as const;

export const SHOPPING_REQUEST_LIMITS = {
  categoryMaxChars: 80,
  attributesMaxCount: 10,
  attributeMaxChars: 50,
  clarificationQuestionMaxChars: 300,
} as const;

const ShoppingIntentSchema = z.enum(SHOPPING_INTENTS);

const BudgetSchema = z.object({
  max: z
    .number()
    .nullable()
    .refine((value) => value === null || (Number.isFinite(value) && value >= 0), {
      message: "budget.max must be a non-negative number or null",
    }),
  currency: z
    .string()
    .nullable()
    .refine((value) => value === null || /^[A-Z]{3}$/.test(value), {
      message: "budget.currency must be a 3-letter uppercase code or null",
    }),
});

export const ShoppingRequestSchema = z
  .object({
    intent: ShoppingIntentSchema,
    category: z
      .string()
      .nullable()
      .refine(
        (value) =>
          value === null ||
          (value.trim().length > 0 &&
            value.length <= SHOPPING_REQUEST_LIMITS.categoryMaxChars),
        { message: "category must be a short non-empty string or null" },
      ),
    budget: BudgetSchema,
    attributes: z.array(z.string()).refine(
      (values) =>
        values.length <= SHOPPING_REQUEST_LIMITS.attributesMaxCount &&
        values.every(
          (value) =>
            value.trim().length > 0 &&
            value.length <= SHOPPING_REQUEST_LIMITS.attributeMaxChars,
        ),
      {
        message: `attributes must have at most ${SHOPPING_REQUEST_LIMITS.attributesMaxCount} short non-empty entries`,
      },
    ),
    needs_clarification: z.boolean(),
    clarification_question: z.string().nullable(),
  })
  .refine(
    (value) =>
      !value.needs_clarification ||
      (value.clarification_question !== null &&
        value.clarification_question.trim().length > 0),
    {
      message: "clarification_question is required when needs_clarification is true",
      path: ["clarification_question"],
    },
  )
  .refine(
    (value) =>
      value.needs_clarification || value.clarification_question === null,
    {
      message: "clarification_question must be null when needs_clarification is false",
      path: ["clarification_question"],
    },
  )
  .refine(
    (value) =>
      value.clarification_question === null ||
      value.clarification_question.length <=
        SHOPPING_REQUEST_LIMITS.clarificationQuestionMaxChars,
    {
      message: "clarification_question is too long",
      path: ["clarification_question"],
    },
  );

export type ShoppingRequest = z.output<typeof ShoppingRequestSchema>;
export type ShoppingIntent = z.output<typeof ShoppingIntentSchema>;

export const ShoppingRequestContract = defineContract({
  name: "shopping_request",
  version: SHOPPING_REQUEST_SCHEMA_VERSION,
  schema: ShoppingRequestSchema,
});
