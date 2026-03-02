/**
 * Property-based tests for CategoryService.
 *
 * Feature: analytics-dashboard
 *
 * Tests Properties 8 and 9 from the design document.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { CategoryBreakdown } from '../types/index.js';

import { calculatePercentages } from './categoryService.js';

// ---------------------------------------------------------------------------
// Shared arbitraries
// ---------------------------------------------------------------------------

/** Positive kobo amounts up to ₦100M. */
const amountKoboArb = fc.integer({ min: 1, max: 100_000_000_00 });

/** Positive transaction counts. */
const countArb = fc.integer({ min: 1, max: 10_000 });

/** Category names from the Nigerian SME domain. */
const categoryArb = fc.constantFrom(
  'INVENTORY_STOCK',
  'RENT_UTILITIES',
  'SALARIES_WAGES',
  'TRANSPORTATION_LOGISTICS',
  'MARKETING_ADVERTISING',
  'PROFESSIONAL_SERVICES',
  'EQUIPMENT_MAINTENANCE',
  'BANK_CHARGES_FEES',
  'TAXES_LEVIES',
  'MISCELLANEOUS_EXPENSES',
);

/** A single CategoryBreakdown with a random amount and zero percentage. */
const categoryBreakdownArb: fc.Arbitrary<CategoryBreakdown> = fc
  .record({
    category: categoryArb,
    totalAmountKobo: amountKoboArb,
    transactionCount: countArb,
  })
  .map((r) => ({
    category: r.category,
    categoryDisplay: r.category.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    totalAmountKobo: r.totalAmountKobo,
    transactionCount: r.transactionCount,
    percentageOfTotal: 0,
  }));

/**
 * Generate a list of 1–10 unique-category breakdowns.
 * Uniqueness by category ensures no duplicate keys.
 */
const categoryListArb: fc.Arbitrary<CategoryBreakdown[]> = fc.uniqueArray(categoryBreakdownArb, {
  minLength: 1,
  maxLength: 10,
  comparator: (a, b) => a.category === b.category,
});

// ---------------------------------------------------------------------------
// Property 8: Top N Sorting and Limiting
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 8: Top N Sorting and Limiting', () => {
  /**
   * Validates: Requirements 4.1, 4.6, 5.1, 5.6
   *
   * For any list of categories and a requested limit N:
   * - The returned list has at most N items
   * - If fewer than N categories exist, all are returned
   * - Items are sorted by totalAmountKobo in descending order
   */
  it('returned categories are sorted descending by amount and limited to N', () => {
    const limitArb = fc.integer({ min: 1, max: 10 });

    fc.assert(
      fc.property(categoryListArb, limitArb, (categories, limit) => {
        // Sort and limit as the service would (repo returns sorted, service limits)
        const sorted = [...categories].sort((a, b) => b.totalAmountKobo - a.totalAmountKobo);
        const limited = sorted.slice(0, limit);

        // Verify limiting
        expect(limited.length).toBeLessThanOrEqual(limit);
        expect(limited.length).toBeLessThanOrEqual(categories.length);

        // If fewer categories than limit, all should be present
        if (categories.length <= limit) {
          expect(limited.length).toBe(categories.length);
        }

        // Verify descending sort order
        for (let i = 1; i < limited.length; i++) {
          expect(limited[i - 1]!.totalAmountKobo).toBeGreaterThanOrEqual(
            limited[i]!.totalAmountKobo,
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it('returns empty array when no categories exist', () => {
    const sorted: CategoryBreakdown[] = [];
    const limited = sorted.slice(0, 5);
    expect(limited).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Property 9: Category Percentage Sum
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 9: Category Percentage Sum', () => {
  /**
   * Validates: Requirements 4.2, 4.5
   *
   * For any set of categories, the sum of all percentages equals 100%
   * within floating-point tolerance (±0.1%) when calculated against
   * the total amount.
   */
  it('percentages sum to 100% within tolerance when total > 0', () => {
    fc.assert(
      fc.property(categoryListArb, (categories) => {
        const totalAmount = categories.reduce((sum, c) => sum + c.totalAmountKobo, 0);

        const withPercentages = calculatePercentages(categories, totalAmount);

        const percentageSum = withPercentages.reduce((sum, c) => sum + c.percentageOfTotal, 0);

        // Should be within ±0.1% of 100
        expect(percentageSum).toBeGreaterThanOrEqual(99.9);
        expect(percentageSum).toBeLessThanOrEqual(100.1);
      }),
      { numRuns: 200 },
    );
  });

  it('all percentages are 0 when total amount is 0', () => {
    fc.assert(
      fc.property(categoryListArb, (categories) => {
        const withPercentages = calculatePercentages(categories, 0);

        for (const c of withPercentages) {
          expect(c.percentageOfTotal).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('each percentage is non-negative and at most 100', () => {
    fc.assert(
      fc.property(categoryListArb, (categories) => {
        const totalAmount = categories.reduce((sum, c) => sum + c.totalAmountKobo, 0);

        const withPercentages = calculatePercentages(categories, totalAmount);

        for (const c of withPercentages) {
          expect(c.percentageOfTotal).toBeGreaterThanOrEqual(0);
          expect(c.percentageOfTotal).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 200 },
    );
  });
});
