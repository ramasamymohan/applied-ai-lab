/**
 * Contract definition: one Zod schema is the single source of truth.
 *
 * A contract bundles the Zod schema (the application's validation boundary),
 * a name, an integer version, and the provider JSON Schema derived from the
 * Zod schema. The JSON Schema is derived once, at definition time, so a schema
 * that cannot run in provider strict mode fails at startup, not on a customer
 * request.
 *
 * Versioning convention
 *  - `version` is an integer owned by the application, bumped on any change to
 *    the shape or the meaning of a field.
 *  - The model is never asked to emit the version. It is applied by the
 *    application and persisted next to the stored result.
 *  - Readers of persisted data must handle every version that was ever stored.
 *
 * Strict-mode constraints (verify against current provider docs)
 *  - Every object lists all properties as required and forbids extras.
 *    Optional values are modeled as nullable.
 *  - Validation keywords such as minimum, maxLength, pattern, or format are
 *    not relied on in provider schemas. Express such rules with Zod `.refine()`
 *    instead: refinements run in the application and never reach the provider.
 *    That is a deliberate split: the provider constrains shape, the
 *    application enforces meaning.
 */

import { z } from "zod";

export type JsonSchemaObject = Record<string, unknown>;

export type StructuredContract<S extends z.ZodType = z.ZodType> = {
  readonly name: string;
  readonly version: number;
  readonly schema: S;
  readonly jsonSchema: JsonSchemaObject;
};

/** Keywords not relied on in strict provider schemas; express them with refine(). */
const DISALLOWED_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "default",
]);

const PROVIDER_SCHEMA_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Walk a generated JSON Schema, enforce strict-mode shape rules, and return a
 * normalized copy. Throws on violations: these are programmer errors.
 */
function normalizeStrictSchema(node: unknown, path: string): unknown {
  if (Array.isArray(node)) {
    return node.map((item, index) =>
      normalizeStrictSchema(item, `${path}[${index}]`),
    );
  }

  if (!isRecord(node)) {
    return node;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (DISALLOWED_KEYWORDS.has(key)) {
      throw new Error(
        `Contract schema uses "${key}" at ${path}. Express this rule with ` +
          `Zod .refine() so it is enforced by the application, not the provider.`,
      );
    }
    result[key] = normalizeStrictSchema(value, `${path}.${key}`);
  }

  if (result["type"] === "object" || isRecord(result["properties"])) {
    const properties = isRecord(result["properties"]) ? result["properties"] : {};
    const required = Array.isArray(result["required"])
      ? (result["required"] as string[])
      : [];
    const missing = Object.keys(properties).filter(
      (name) => !required.includes(name),
    );

    if (missing.length > 0) {
      throw new Error(
        `Contract schema at ${path} has optional properties (${missing.join(", ")}). ` +
          `Strict mode requires all properties; model optional values as nullable.`,
      );
    }

    result["additionalProperties"] = false;
  }

  return result;
}

export function defineContract<S extends z.ZodType>(definition: {
  name: string;
  version: number;
  schema: S;
}): StructuredContract<S> {
  if (!PROVIDER_SCHEMA_NAME.test(definition.name)) {
    throw new Error(
      `Invalid contract name "${definition.name}". Use 1-64 letters, digits, "_" or "-".`,
    );
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error("Contract version must be a positive integer.");
  }

  const generated = z.toJSONSchema(definition.schema) as Record<string, unknown>;

  // The dialect marker is not part of the schema the provider needs.
  const { $schema: _dialect, ...withoutDialect } = generated;

  const jsonSchema = normalizeStrictSchema(
    withoutDialect,
    definition.name,
  ) as JsonSchemaObject;

  if (jsonSchema["type"] !== "object") {
    throw new Error("Contract root schema must be an object.");
  }

  return {
    name: definition.name,
    version: definition.version,
    schema: definition.schema,
    jsonSchema,
  };
}
