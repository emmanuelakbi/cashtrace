// ============================================================================
// Transaction Engine Module — Categorization Service
// ============================================================================

import type {
  CategorizationResult,
  CategoryInfo,
  CategorySuggestion,
  ExpenseCategory,
  NormalizedTransaction,
  RevenueCategory,
  TransactionCategory,
  TransactionType,
} from './types.js';

import { EXPENSE_CATEGORIES, REVENUE_CATEGORIES } from './types.js';

/** Confidence threshold below which we assign the default category. */
const LOW_CONFIDENCE_THRESHOLD = 30;

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Score a text against a list of keywords.
 *
 * For each keyword that appears in the text, a score contribution is
 * calculated based on the keyword's length (longer keywords are more
 * specific and therefore worth more). The raw score is then normalised
 * to a 0–100 range relative to the maximum possible score for the
 * keyword list.
 *
 * @param text     - The lowercased search text
 * @param keywords - The keywords to match against
 * @returns A score from 0 to 100
 */
export function scoreCategory(text: string, keywords: string[]): number {
  if (keywords.length === 0) {
    return 0;
  }

  const lowerText = text.toLowerCase();

  let matchedWeight = 0;
  let totalWeight = 0;

  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    // Longer keywords are more specific → higher weight
    const weight = lowerKeyword.length;
    totalWeight += weight;

    if (lowerText.includes(lowerKeyword)) {
      matchedWeight += weight;
    }
  }

  if (totalWeight === 0) {
    return 0;
  }

  return Math.round((matchedWeight / totalWeight) * 100);
}

/**
 * Return the appropriate category map for a given transaction type.
 *
 * @param transactionType - INFLOW or OUTFLOW
 * @returns The matching category record
 */
export function getCategoriesForTransactionType(
  transactionType: TransactionType,
): Record<string, CategoryInfo> {
  return transactionType === 'OUTFLOW'
    ? (EXPENSE_CATEGORIES as Record<string, CategoryInfo>)
    : (REVENUE_CATEGORIES as Record<string, CategoryInfo>);
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Match a transaction description (and optional counterparty) against
 * category keywords and return the best match with alternatives.
 *
 * @param description     - The transaction description
 * @param counterparty    - Optional counterparty name
 * @param transactionType - INFLOW or OUTFLOW
 * @returns The best matching category, its confidence, and up to 3 alternatives
 */
export function matchKeywords(
  description: string,
  counterparty: string | null,
  transactionType: TransactionType,
): {
  category: TransactionCategory;
  confidence: number;
  alternatives: CategorySuggestion[];
} {
  const searchText = [description, counterparty].filter(Boolean).join(' ');
  const categories = getCategoriesForTransactionType(transactionType);

  const scored: { category: TransactionCategory; score: number; name: string }[] = [];

  for (const [key, info] of Object.entries(categories)) {
    const score = scoreCategory(searchText, info.keywords);
    scored.push({ category: key as TransactionCategory, score, name: info.name });
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];

  // If no keywords matched at all, fall back to the default category
  if (!best || best.score === 0) {
    const defaultCategory: TransactionCategory =
      transactionType === 'OUTFLOW' ? 'MISCELLANEOUS_EXPENSES' : 'OTHER_INCOME';

    const alternatives = scored
      .filter((s) => s.category !== defaultCategory)
      .slice(0, 3)
      .map((s) => ({
        category: s.category,
        confidence: s.score,
        reason: `Matched keywords in ${s.name}`,
      }));

    return { category: defaultCategory, confidence: 0, alternatives };
  }

  // Build alternatives from the remaining scored categories (excluding the best)
  const alternatives = scored
    .filter((s) => s.category !== best.category && s.score > 0)
    .slice(0, 3)
    .map((s) => ({
      category: s.category,
      confidence: s.score,
      reason: `Matched keywords in ${s.name}`,
    }));

  return { category: best.category, confidence: best.score, alternatives };
}

// ---------------------------------------------------------------------------
// Higher-Level Categorization API
// ---------------------------------------------------------------------------

/**
 * Categorize a normalized transaction automatically.
 *
 * Uses keyword matching on the description and counterparty to determine the
 * best category. When confidence falls below {@link LOW_CONFIDENCE_THRESHOLD},
 * the default category for the transaction type is assigned instead
 * (MISCELLANEOUS_EXPENSES for OUTFLOW, OTHER_INCOME for INFLOW) with
 * confidence 0.
 *
 * @param transaction - A normalized transaction to categorize
 * @returns A full categorization result with source set to AUTO
 */
export function categorize(transaction: NormalizedTransaction): CategorizationResult {
  const { category, confidence, alternatives } = matchKeywords(
    transaction.description,
    transaction.counterparty,
    transaction.transactionType,
  );

  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    const defaultCategory: TransactionCategory =
      transaction.transactionType === 'OUTFLOW' ? 'MISCELLANEOUS_EXPENSES' : 'OTHER_INCOME';

    return {
      category: defaultCategory,
      confidence: 0,
      source: 'AUTO',
      alternativeCategories: alternatives,
    };
  }

  return {
    category,
    confidence,
    source: 'AUTO',
    alternativeCategories: alternatives,
  };
}

/**
 * Return category suggestions for a transaction, sorted by confidence
 * descending.
 *
 * The list includes the best match followed by all alternatives.
 *
 * @param transaction - A normalized transaction
 * @returns Sorted array of category suggestions
 */
export function getSuggestions(transaction: NormalizedTransaction): CategorySuggestion[] {
  const { category, confidence, alternatives } = matchKeywords(
    transaction.description,
    transaction.counterparty,
    transaction.transactionType,
  );

  const categories = getCategoriesForTransactionType(transaction.transactionType);
  const info = categories[category as string];
  const bestName = info?.name ?? category;

  const best: CategorySuggestion = {
    category,
    confidence,
    reason: `Matched keywords in ${bestName}`,
  };

  return [best, ...alternatives].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Validate that a category string is a valid {@link TransactionCategory} for
 * the given transaction type.
 *
 * OUTFLOW transactions accept only {@link ExpenseCategory} values, while
 * INFLOW transactions accept only {@link RevenueCategory} values.
 *
 * @param category        - The category string to validate
 * @param transactionType - INFLOW or OUTFLOW
 * @returns `true` when the category is valid for the type
 */
export function validateCategory(category: string, transactionType: TransactionType): boolean {
  const validCategories = getCategoriesForType(transactionType);
  return validCategories.includes(category as TransactionCategory);
}

/**
 * Return all valid category keys for a given transaction type.
 *
 * @param transactionType - INFLOW or OUTFLOW
 * @returns Array of valid {@link TransactionCategory} values
 */
export function getCategoriesForType(transactionType: TransactionType): TransactionCategory[] {
  if (transactionType === 'OUTFLOW') {
    return Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[];
  }
  return Object.keys(REVENUE_CATEGORIES) as RevenueCategory[];
}
