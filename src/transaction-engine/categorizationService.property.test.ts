/**
 * Property-based tests for CategorizationService
 *
 * **Property 4: Categorization Completeness**
 * For any valid NormalizedTransaction, categorize() always returns a valid
 * CategorizationResult with a valid TransactionCategory, confidence 0-100,
 * source 'AUTO', and alternativeCategories as an array.
 *
 * **Property 5: Default Category Assignment**
 * For any NormalizedTransaction with gibberish description (no keywords),
 * OUTFLOW → MISCELLANEOUS_EXPENSES (confidence 0),
 * INFLOW → OTHER_INCOME (confidence 0).
 *
 * **Property 6: Category Validation**
 * validateCategory returns true for correct type, false for wrong type,
 * and false for random invalid strings.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  categorize,
  getCategoriesForType,
  getSuggestions,
  validateCategory,
} from './categorizationService.js';
import type { NormalizedTransaction, TransactionType } from './types.js';
import { EXPENSE_CATEGORIES, REVENUE_CATEGORIES } from './types.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** All category keywords across both expense and revenue categories. */
const allCategoryKeywords = [
  ...Object.values(EXPENSE_CATEGORIES).flatMap((c) => c.keywords),
  ...Object.values(REVENUE_CATEGORIES).flatMap((c) => c.keywords),
];

/** All valid expense category keys. */
const expenseCategoryKeys = Object.keys(EXPENSE_CATEGORIES) as string[];

/** All valid revenue category keys. */
const revenueCategoryKeys = Object.keys(REVENUE_CATEGORIES) as string[];

/** All valid category keys. */
const allCategoryKeys = [...expenseCategoryKeys, ...revenueCategoryKeys];

/** Arbitrary for TransactionType. */
const transactionTypeArb = fc.constantFrom<TransactionType>('INFLOW', 'OUTFLOW');
/**
 * Generate a gibberish string that does NOT contain any category keyword.
 * Uses hex-like characters to avoid accidental keyword matches.
 */
const gibberishArb = fc
  .stringOf(fc.constantFrom('x', 'z', 'q', 'j', 'k', '0', '1', '7', '9'), {
    minLength: 3,
    maxLength: 30,
  })
  .filter((s) => {
    const lower = s.toLowerCase();
    return !allCategoryKeywords.some((kw) => kw.length > 0 && lower.includes(kw.toLowerCase()));
  });

/** Generate a valid NormalizedTransaction with the given description and type. */
function makeTransaction(
  overrides: Partial<NormalizedTransaction> = {},
): fc.Arbitrary<NormalizedTransaction> {
  return fc
    .record({
      transactionDate: fc.date({
        min: new Date('2020-01-01'),
        max: new Date('2030-12-31'),
      }),
      description: fc.string({ minLength: 1, maxLength: 100 }),
      amountKobo: fc.integer({ min: 1, max: 100_000_000 }),
      transactionType: transactionTypeArb,
      counterparty: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      reference: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      rawMetadata: fc.constant({}),
    })
    .map((tx) => ({ ...tx, ...overrides }));
}

/** Generate a NormalizedTransaction with gibberish description and no counterparty. */
function makeGibberishTransaction(
  transactionType: TransactionType,
): fc.Arbitrary<NormalizedTransaction> {
  return fc
    .record({
      transactionDate: fc.date({
        min: new Date('2020-01-01'),
        max: new Date('2030-12-31'),
      }),
      description: gibberishArb,
      amountKobo: fc.integer({ min: 1, max: 100_000_000 }),
      transactionType: fc.constant(transactionType),
      counterparty: fc.constant(null),
      reference: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      rawMetadata: fc.constant({}),
    })
    .map((tx) => tx as NormalizedTransaction);
}

// ─── Property 4: Categorization Completeness ─────────────────────────────────

describe('Property 4: Categorization Completeness', () => {
  /**
   * **Validates: Requirements 2.1, 2.5, 2.6**
   *
   * For any valid NormalizedTransaction, categorize() always returns a valid
   * CategorizationResult with all required fields properly populated.
   */
  it('categorize() always returns a valid CategorizationResult', () => {
    fc.assert(
      fc.property(makeTransaction(), (tx) => {
        const result = categorize(tx);

        // Must return a valid TransactionCategory
        expect(allCategoryKeys).toContain(result.category);

        // Confidence must be in 0-100 range
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(100);

        // Source must always be AUTO
        expect(result.source).toBe('AUTO');

        // alternativeCategories must be an array
        expect(Array.isArray(result.alternativeCategories)).toBe(true);

        // Each alternative must also have valid fields
        for (const alt of result.alternativeCategories) {
          expect(allCategoryKeys).toContain(alt.category);
          expect(alt.confidence).toBeGreaterThanOrEqual(0);
          expect(alt.confidence).toBeLessThanOrEqual(100);
          expect(typeof alt.reason).toBe('string');
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.2, 2.3**
   *
   * The returned category must be valid for the transaction's type:
   * OUTFLOW → expense categories, INFLOW → revenue categories.
   */
  it('returned category is valid for the transaction type', () => {
    fc.assert(
      fc.property(makeTransaction(), (tx) => {
        const result = categorize(tx);
        const validCategories = getCategoriesForType(tx.transactionType);
        expect(validCategories).toContain(result.category);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.1**
   *
   * getSuggestions() always returns a non-empty array of valid suggestions.
   */
  it('getSuggestions() always returns valid suggestions', () => {
    fc.assert(
      fc.property(makeTransaction(), (tx) => {
        const suggestions = getSuggestions(tx);

        expect(suggestions.length).toBeGreaterThan(0);

        for (const suggestion of suggestions) {
          expect(allCategoryKeys).toContain(suggestion.category);
          expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
          expect(suggestion.confidence).toBeLessThanOrEqual(100);
          expect(typeof suggestion.reason).toBe('string');
        }
      }),
      { numRuns: 100 },
    );
  });
});
// ─── Property 5: Default Category Assignment ─────────────────────────────────

describe('Property 5: Default Category Assignment', () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * OUTFLOW transactions with gibberish descriptions (no keyword matches)
   * get MISCELLANEOUS_EXPENSES with confidence 0.
   */
  it('OUTFLOW with gibberish description gets MISCELLANEOUS_EXPENSES at confidence 0', () => {
    fc.assert(
      fc.property(makeGibberishTransaction('OUTFLOW'), (tx) => {
        const result = categorize(tx);

        expect(result.category).toBe('MISCELLANEOUS_EXPENSES');
        expect(result.confidence).toBe(0);
        expect(result.source).toBe('AUTO');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * INFLOW transactions with gibberish descriptions (no keyword matches)
   * get OTHER_INCOME with confidence 0.
   */
  it('INFLOW with gibberish description gets OTHER_INCOME at confidence 0', () => {
    fc.assert(
      fc.property(makeGibberishTransaction('INFLOW'), (tx) => {
        const result = categorize(tx);

        expect(result.category).toBe('OTHER_INCOME');
        expect(result.confidence).toBe(0);
        expect(result.source).toBe('AUTO');
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: Category Validation ─────────────────────────────────────────

describe('Property 6: Category Validation', () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * validateCategory returns true for every expense category with OUTFLOW.
   */
  it('returns true for valid expense categories with OUTFLOW', () => {
    fc.assert(
      fc.property(fc.constantFrom(...expenseCategoryKeys), (category) => {
        expect(validateCategory(category, 'OUTFLOW')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * validateCategory returns true for every revenue category with INFLOW.
   */
  it('returns true for valid revenue categories with INFLOW', () => {
    fc.assert(
      fc.property(fc.constantFrom(...revenueCategoryKeys), (category) => {
        expect(validateCategory(category, 'INFLOW')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * validateCategory returns false for expense categories used with INFLOW.
   */
  it('returns false for expense categories with INFLOW', () => {
    fc.assert(
      fc.property(fc.constantFrom(...expenseCategoryKeys), (category) => {
        expect(validateCategory(category, 'INFLOW')).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * validateCategory returns false for revenue categories used with OUTFLOW.
   */
  it('returns false for revenue categories with OUTFLOW', () => {
    fc.assert(
      fc.property(fc.constantFrom(...revenueCategoryKeys), (category) => {
        expect(validateCategory(category, 'OUTFLOW')).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * validateCategory returns false for random invalid strings regardless of type.
   */
  it('returns false for random invalid category strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !allCategoryKeys.includes(s)),
        transactionTypeArb,
        (invalidCategory, txType) => {
          expect(validateCategory(invalidCategory, txType)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.2, 2.3**
   *
   * getCategoriesForType returns the correct number of categories:
   * 10 expense categories for OUTFLOW, 3 revenue categories for INFLOW.
   */
  it('getCategoriesForType returns correct category counts', () => {
    const outflowCategories = getCategoriesForType('OUTFLOW');
    expect(outflowCategories).toHaveLength(10);
    for (const cat of outflowCategories) {
      expect(expenseCategoryKeys).toContain(cat);
    }

    const inflowCategories = getCategoriesForType('INFLOW');
    expect(inflowCategories).toHaveLength(3);
    for (const cat of inflowCategories) {
      expect(revenueCategoryKeys).toContain(cat);
    }
  });
});
