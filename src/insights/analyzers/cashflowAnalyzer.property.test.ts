/**
 * Property-based tests for Cashflow Projection Accuracy.
 *
 * **Property 9: Cashflow Projection Accuracy**
 * For any cashflow risk insight, the projected shortfall date and amount
 * SHALL be based on actual transaction patterns and recurring expenses.
 *
 * **Validates: Requirements 3.4, 3.5**
 *
 * @module insights/analyzers/cashflowAnalyzer.property.test
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { NigerianSector, Transaction } from '../types/index.js';
import { makeTransaction } from '../test/fixtures.js';

import {
  detectRecurringPatterns,
  getSeasonalMultiplier,
  projectCashflow,
  SEASONAL_MULTIPLIERS,
} from './cashflowAnalyzer.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** All valid Nigerian sectors. */
const SECTORS: NigerianSector[] = [
  'retail',
  'services',
  'manufacturing',
  'agriculture',
  'technology',
  'healthcare',
  'education',
  'logistics',
  'hospitality',
];

/** Arbitrary Nigerian sector. */
const sectorArb = fc.constantFrom(...SECTORS);

/** Arbitrary valid month (1–12). */
const monthArb = fc.integer({ min: 1, max: 12 });

/** Arbitrary positive Kobo amount (1 Kobo to ₦10M). */
const amountKoboArb = fc.integer({ min: 1, max: 1_000_000_000 });

/** Arbitrary projection horizon in days (1–180). */
const horizonDaysArb = fc.integer({ min: 1, max: 180 });

/** Arbitrary period length in days (1–365). */
const periodDaysArb = fc.integer({ min: 1, max: 365 });

/** Arbitrary transaction type. */
const txTypeArb = fc.constantFrom('credit' as const, 'debit' as const);

/**
 * Generate a list of transactions spread across a date range.
 * Each transaction has a random type, amount, and counterparty.
 */
function transactionsArb(
  minCount: number,
  maxCount: number,
): fc.Arbitrary<{ transactions: Transaction[]; dateRange: { start: Date; end: Date } }> {
  return fc
    .record({
      count: fc.integer({ min: minCount, max: maxCount }),
      periodDays: periodDaysArb,
      seed: fc.integer({ min: 0, max: 1_000_000 }),
    })
    .chain(({ count, periodDays, seed }) => {
      const end = new Date('2024-06-30T23:59:59+01:00');
      const start = new Date(end.getTime() - periodDays * 24 * 60 * 60 * 1000);
      const rangeMs = end.getTime() - start.getTime();

      return fc
        .array(
          fc.record({
            type: txTypeArb,
            amountKobo: amountKoboArb,
            counterpartyIdx: fc.integer({ min: 0, max: 4 }),
            dateOffset: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: count, maxLength: count },
        )
        .map((items) => {
          const counterparties = ['Vendor A', 'Vendor B', 'Customer X', 'Customer Y', 'Supplier Z'];
          const transactions = items.map((item, i) =>
            makeTransaction({
              businessId: `prop-test-${seed}`,
              type: item.type,
              amountKobo: item.amountKobo,
              counterparty: counterparties[item.counterpartyIdx]!,
              date: new Date(start.getTime() + Math.floor(item.dateOffset * rangeMs)),
            }),
          );
          return { transactions, dateRange: { start, end } };
        });
    });
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Cashflow Projection Accuracy (Property 9)', () => {
  // ── Sub-property 1: All projected amounts are integers (Kobo precision) ──

  /**
   * **Validates: Requirements 3.4**
   * projectCashflow always returns integer amounts for income, expenses,
   * and net cashflow (Kobo precision).
   */
  it('projectCashflow always returns integer amounts (Kobo precision)', () => {
    fc.assert(
      fc.property(
        transactionsArb(1, 20),
        sectorArb,
        horizonDaysArb,
        ({ transactions, dateRange }, sector, horizon) => {
          if (transactions.length === 0) return;

          const projection = projectCashflow(transactions, dateRange, sector, horizon);

          expect(Number.isInteger(projection.projectedIncomeKobo)).toBe(true);
          expect(Number.isInteger(projection.projectedExpensesKobo)).toBe(true);
          expect(Number.isInteger(projection.netCashflowKobo)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── Sub-property 2: netCashflowKobo = income - expenses ──────────────────

  /**
   * **Validates: Requirements 3.4**
   * For any projection, netCashflowKobo SHALL equal
   * projectedIncomeKobo - projectedExpensesKobo.
   */
  it('netCashflowKobo equals projectedIncomeKobo minus projectedExpensesKobo', () => {
    fc.assert(
      fc.property(
        transactionsArb(1, 20),
        sectorArb,
        horizonDaysArb,
        ({ transactions, dateRange }, sector, horizon) => {
          if (transactions.length === 0) return;

          const projection = projectCashflow(transactions, dateRange, sector, horizon);

          expect(projection.netCashflowKobo).toBe(
            projection.projectedIncomeKobo - projection.projectedExpensesKobo,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── Sub-property 3: Longer horizons produce proportionally larger projections ─

  /**
   * **Validates: Requirements 3.5**
   * For the same transaction set and sector, a longer horizon SHALL produce
   * absolute projected expenses >= those of a shorter horizon (monotonic scaling).
   * Expenses are not seasonally adjusted, so they scale linearly with horizon.
   */
  it('longer horizons produce greater or equal absolute projected expenses', () => {
    fc.assert(
      fc.property(
        transactionsArb(1, 20),
        sectorArb,
        horizonDaysArb,
        horizonDaysArb,
        ({ transactions, dateRange }, sector, h1, h2) => {
          if (transactions.length === 0) return;

          const [shortHorizon, longHorizon] = h1 <= h2 ? [h1, h2] : [h2, h1];

          const shortProj = projectCashflow(transactions, dateRange, sector, shortHorizon);
          const longProj = projectCashflow(transactions, dateRange, sector, longHorizon);

          // Expenses scale linearly with horizon (no seasonal adjustment on expenses)
          expect(longProj.projectedExpensesKobo).toBeGreaterThanOrEqual(
            shortProj.projectedExpensesKobo,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  // ── Sub-property 4: Seasonal multiplier is always positive ────────────────

  /**
   * **Validates: Requirements 3.5**
   * getSeasonalMultiplier SHALL always return a positive number for any
   * valid sector and month combination.
   */
  it('getSeasonalMultiplier always returns a positive number', () => {
    fc.assert(
      fc.property(sectorArb, monthArb, (sector, month) => {
        const multiplier = getSeasonalMultiplier(sector, month);

        expect(multiplier).toBeGreaterThan(0);
        expect(typeof multiplier).toBe('number');
        expect(Number.isFinite(multiplier)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.5**
   * All seasonal multipliers defined in SEASONAL_MULTIPLIERS are positive.
   */
  it('all defined seasonal multipliers are positive', () => {
    for (const sector of SECTORS) {
      const sectorData = SEASONAL_MULTIPLIERS[sector];
      for (let month = 1; month <= 12; month++) {
        const multiplier = sectorData[month];
        expect(multiplier).toBeDefined();
        expect(multiplier).toBeGreaterThan(0);
      }
    }
  });

  // ── Sub-property 5: detectRecurringPatterns requires >= 2 occurrences ─────

  /**
   * **Validates: Requirements 3.5**
   * detectRecurringPatterns SHALL only return patterns for counterparties
   * with at least 2 occurrences of the same type.
   */
  it('detectRecurringPatterns returns patterns only for counterparties with >= 2 occurrences', () => {
    fc.assert(
      fc.property(transactionsArb(0, 30), ({ transactions }) => {
        const patterns = detectRecurringPatterns(transactions);

        for (const pattern of patterns) {
          expect(pattern.occurrences).toBeGreaterThanOrEqual(2);

          // Verify the pattern actually corresponds to transactions in the input
          const matchingTxs = transactions.filter(
            (tx) => tx.counterparty === pattern.identifier && tx.type === pattern.type,
          );
          expect(matchingTxs.length).toBeGreaterThanOrEqual(2);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.5**
   * When all transactions have unique counterparty+type combinations,
   * detectRecurringPatterns SHALL return an empty array.
   */
  it('detectRecurringPatterns returns empty for all-unique counterparties', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), amountKoboArb, (count, baseAmount) => {
        const transactions = Array.from({ length: count }, (_, i) =>
          makeTransaction({
            type: 'debit',
            amountKobo: baseAmount,
            counterparty: `UniqueVendor-${i}`,
            date: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
          }),
        );

        const patterns = detectRecurringPatterns(transactions);
        expect(patterns).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
