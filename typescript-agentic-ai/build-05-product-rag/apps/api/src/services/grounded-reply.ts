/**
 * Grounded reply composition (Build 05).
 *
 * Plain TypeScript. The reply text is assembled by the application, not by the
 * model: product names, prices, currencies and stock labels come from database
 * rows. The model's contribution is limited to an intro sentence and a short
 * reason per product, both treated as untrusted prose.
 *
 * Not verified: the intro and reasons are model-written and could still make a
 * claim the catalog does not support (for example, "all waterproof"). Only
 * product identity, price and stock are verified.
 */

import type { ProductRow } from "../db/types.js";

export type VerifiedRecommendation = {
  product: ProductRow;
  reason: string;
};

export type AppliedConstraints = {
  category: string | null;
  maxPrice: number | null;
  currency: string | null;
};

export function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(price);
  } catch {
    return `${price.toFixed(2)} ${currency}`;
  }
}

function stockNote(product: ProductRow): string {
  return product.stock_status === "low_stock" ? " (low stock)" : "";
}

export function composeGroundedReply(options: {
  intro: string;
  recommendations: VerifiedRecommendation[];
}): string {
  const lines = options.recommendations.map(({ product, reason }, index) =>
    [
      `${index + 1}. ${product.name} (${product.brand}), ${formatPrice(product.price, product.currency)}${stockNote(product)}`,
      `   ${reason.trim()}`,
    ].join("\n"),
  );

  return `${options.intro.trim()}\n\n${lines.join("\n\n")}`;
}

export function composeNoMatchReply(constraints: AppliedConstraints): string {
  const applied: string[] = [];
  if (constraints.category) {
    applied.push(`in ${constraints.category}`);
  }
  if (constraints.maxPrice !== null) {
    applied.push(
      `up to ${formatPrice(constraints.maxPrice, constraints.currency ?? "USD")}`,
    );
  }

  const scope = applied.length > 0 ? ` ${applied.join(" ")}` : "";
  const hint =
    constraints.maxPrice !== null || constraints.category
      ? "Try loosening the budget or describing what you need differently."
      : "Try describing what you need differently, such as the type of product or what you will use it for.";

  return `I couldn't find anything in our catalog${scope} that matches that. ${hint}`;
}

export const SEARCH_UNAVAILABLE_REPLY =
  "I couldn't search the catalog just now. Please try again in a moment.";
