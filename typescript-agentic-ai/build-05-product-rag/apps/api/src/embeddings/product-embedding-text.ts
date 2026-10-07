/**
 * Product embedding text and content hash (Build 05).
 *
 * What gets embedded is a deliberate choice:
 *
 *  - Included: name, brand, category, description, attributes. These describe
 *    what a product *is*, which is what similarity search should match on.
 *  - Excluded: price and stock status. They change independently of meaning
 *    and are always read from the database at answer time, so a price change
 *    must not trigger a re-embed (or leave a stale price inside a vector).
 *  - Excluded: SKU. It is an identifier, not meaning. If exact SKU lookup
 *    proves necessary it is a job for keyword search, not embeddings.
 *
 * The text is deterministic: attribute keys are sorted, so the same product
 * always yields the same text and the same hash. Bump
 * EMBEDDING_TEXT_VERSION when this format changes so every row re-embeds.
 */

import { createHash } from "node:crypto";

export const EMBEDDING_TEXT_VERSION = 1;

export type EmbeddableProduct = {
  name: string;
  brand: string;
  category: string;
  description: string;
  attributes: Record<string, unknown>;
};

function formatAttributeValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  return String(value);
}

export function composeProductEmbeddingText(
  product: EmbeddableProduct,
): string {
  const attributeLines = Object.keys(product.attributes)
    .sort()
    .map(
      (key) =>
        `${key.replace(/_/g, " ")}: ${formatAttributeValue(product.attributes[key])}`,
    );

  const lines = [
    `Name: ${product.name}`,
    `Brand: ${product.brand}`,
    `Category: ${product.category}`,
    `Description: ${product.description}`,
  ];
  if (attributeLines.length > 0) {
    lines.push(`Attributes: ${attributeLines.join("; ")}`);
  }

  return lines.join("\n");
}

/** SHA-256 of the text, prefixed by the text-format version. */
export function hashEmbeddingText(text: string): string {
  return createHash("sha256")
    .update(`v${EMBEDDING_TEXT_VERSION}\n${text}`)
    .digest("hex");
}
