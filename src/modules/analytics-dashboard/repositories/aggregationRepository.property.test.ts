/**
 * Property-based tests for transaction filtering exclusion logic.
 *
 * Feature: analytics-dashboard, Property 4: Transaction Filtering Exclusion
 *
 * Validates: Requirements 1.6, 1.7, 4.4, 5.4
 *
 * Verifies that the `shouldIncludeTransaction` predicate correctly excludes
 * personal transactions (isPersonal = true) and soft-deleted transactions
 * (deletedAt IS NOT NULL) from all aggregation calculations.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { shouldIncludeTransaction } from './aggregationRepository.js';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const transactionArb = fc.record({
  isPersonal: fc.boolean(),
  deletedAt: fc.option(fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }), {
    nil: null,
  }),
  amountKobo: fc.integer({ min: 1, max: 100_000_000_00 }),
  transactionType: fc.constantFrom('INFLOW' as const, 'OUTFLOW' as const),
  category: fc.constantFrom(
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
    'PRODUCT_SALES',
    'SERVICE_REVENUE',
    'OTHER_INCOME',
  ),
  counterparty: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
});

const transactionListArb = fc.array(transactionArb, { minLength: 0, maxLength: 200 });

// ---------------------------------------------------------------------------
// Property 4: Transaction Filtering Exclusion
// ---------------------------------------------------------------------------

describe('Property 4: Transaction Filtering Exclusion', () => {
  /**
   * **Validates: Requirements 1.6, 1.7**
   *
   * For any transaction, shouldIncludeTransaction returns true if and only if
   * isPersonal is false AND deletedAt is null.
   */
  it('includes a transaction iff it is non-personal and non-deleted', () => {
    fc.assert(
      fc.property(transactionArb, (tx) => {
        const included = shouldIncludeTransaction(tx);
        const expected = !tx.isPersonal && tx.deletedAt === null;
        expect(included).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.6, 4.4, 5.4**
   *
   * Personal transactions are always excluded regardless of deletedAt.
   */
  it('always excludes personal transactions', () => {
    fc.assert(
      fc.property(
        fc.option(fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }), {
          nil: null,
        }),
        (deletedAt) => {
          expect(shouldIncludeTransaction({ isPersonal: true, deletedAt })).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.7, 4.4, 5.4**
   *
   * Soft-deleted transactions are always excluded regardless of isPersonal.
   */
  it('always excludes soft-deleted transactions', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
        (isPersonal, deletedAt) => {
          expect(shouldIncludeTransaction({ isPersonal, deletedAt })).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.6, 1.7, 4.4, 5.4**
   *
   * For any list of transactions, manually filtering with the predicate
   * produces the same set as filtering out personal and deleted entries.
   */
  it('filtering a list with the predicate matches manual exclusion logic', () => {
    fc.assert(
      fc.property(transactionListArb, (transactions) => {
        const predicateFiltered = transactions.filter((tx) => shouldIncludeTransaction(tx));
        const manualFiltered = transactions.filter((tx) => !tx.isPersonal && tx.deletedAt === null);

        expect(predicateFiltered).toEqual(manualFiltered);
      }),
      { numRuns: 100 },
    );
  });
});
