/**
 * Property-based tests for SummaryService.
 *
 * Feature: analytics-dashboard
 *
 * Tests Properties 1, 2, 3, and 7 from the design document.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { RawSummaryAggregation, SummaryData } from '../types/index.js';

import { calculateComparison, calculateSummary } from './summaryService.js';

// ---------------------------------------------------------------------------
// Shared arbitraries
// ---------------------------------------------------------------------------

const periodStart = new Date('2024-01-01T00:00:00Z');
const periodEnd = new Date('2024-01-31T23:59:59Z');

/** Non-negative bigint amounts up to ₦100M in kobo. */
const amountBigIntArb = fc.integer({ min: 0, max: 100_000_000_00 }).map((n) => BigInt(n));

/** Non-negative integer counts. */
const countArb = fc.integer({ min: 0, max: 10_000 });

/** Raw summary aggregation arbitrary. */
const rawAggregationArb: fc.Arbitrary<RawSummaryAggregation> = fc.record({
  totalInflowKobo: amountBigIntArb,
  totalOutflowKobo: amountBigIntArb,
  inflowCount: countArb,
  outflowCount: countArb,
});

/** SummaryData arbitrary for comparison tests. */
const summaryDataArb: fc.Arbitrary<SummaryData> = fc
  .record({
    totalRevenueKobo: fc.integer({ min: 0, max: 100_000_000_00 }),
    totalExpensesKobo: fc.integer({ min: 0, max: 100_000_000_00 }),
    transactionCount: countArb,
  })
  .map((r) => ({
    totalRevenueKobo: r.totalRevenueKobo,
    totalExpensesKobo: r.totalExpensesKobo,
    netCashflowKobo: r.totalRevenueKobo - r.totalExpensesKobo,
    transactionCount: r.transactionCount,
    averageTransactionKobo:
      r.transactionCount > 0
        ? Math.round((r.totalRevenueKobo + r.totalExpensesKobo) / r.transactionCount)
        : 0,
    periodStart,
    periodEnd,
  }));

// ---------------------------------------------------------------------------
// Property 1: Aggregation Correctness
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 1: Aggregation Correctness', () => {
  /**
   * Validates: Requirements 1.1, 1.2, 1.4
   *
   * For any raw aggregation, calculateSummary returns:
   * - totalRevenueKobo equal to Number(totalInflowKobo)
   * - totalExpensesKobo equal to Number(totalOutflowKobo)
   * - transactionCount equal to inflowCount + outflowCount
   */
  it('total revenue equals sum of inflows, expenses equals sum of outflows, count equals total', () => {
    fc.assert(
      fc.property(rawAggregationArb, (agg) => {
        const result = calculateSummary(agg, periodStart, periodEnd);

        expect(result.totalRevenueKobo).toBe(Number(agg.totalInflowKobo));
        expect(result.totalExpensesKobo).toBe(Number(agg.totalOutflowKobo));
        expect(result.transactionCount).toBe(agg.inflowCount + agg.outflowCount);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Net Cashflow Invariant
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 2: Net Cashflow Invariant', () => {
  /**
   * Validates: Requirements 1.3
   *
   * For any summary, netCashflowKobo === totalRevenueKobo - totalExpensesKobo.
   */
  it('net cashflow always equals revenue minus expenses', () => {
    fc.assert(
      fc.property(rawAggregationArb, (agg) => {
        const result = calculateSummary(agg, periodStart, periodEnd);

        expect(result.netCashflowKobo).toBe(result.totalRevenueKobo - result.totalExpensesKobo);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Average Transaction Calculation
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 3: Average Transaction Calculation', () => {
  /**
   * Validates: Requirements 1.5
   *
   * For count > 0: average = round((revenue + expenses) / count).
   * For count = 0: average = 0.
   */
  it('average equals (revenue + expenses) / count when count > 0, else 0', () => {
    fc.assert(
      fc.property(rawAggregationArb, (agg) => {
        const result = calculateSummary(agg, periodStart, periodEnd);
        const count = agg.inflowCount + agg.outflowCount;

        if (count > 0) {
          const expected = Math.round(
            (Number(agg.totalInflowKobo) + Number(agg.totalOutflowKobo)) / count,
          );
          expect(result.averageTransactionKobo).toBe(expected);
        } else {
          expect(result.averageTransactionKobo).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Percentage Change Calculation
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 7: Percentage Change Calculation', () => {
  /**
   * Validates: Requirements 3.2
   *
   * For previous != 0: change = ((current - previous) / |previous|) * 100.
   * For previous = 0 and current != 0: change is Infinity or -Infinity.
   * For both = 0: change = 0.
   */
  it('percentage change follows the formula for non-zero previous', () => {
    const nonZeroSummaryArb = fc
      .record({
        totalRevenueKobo: fc.integer({ min: 1, max: 100_000_000_00 }),
        totalExpensesKobo: fc.integer({ min: 1, max: 100_000_000_00 }),
        transactionCount: fc.integer({ min: 1, max: 10_000 }),
      })
      .map((r) => ({
        ...r,
        netCashflowKobo: r.totalRevenueKobo - r.totalExpensesKobo,
        averageTransactionKobo: Math.round(
          (r.totalRevenueKobo + r.totalExpensesKobo) / r.transactionCount,
        ),
        periodStart,
        periodEnd,
      }));

    fc.assert(
      fc.property(summaryDataArb, nonZeroSummaryArb, (current, previous) => {
        const result = calculateComparison(current, previous);

        const expectedRevenue =
          ((current.totalRevenueKobo - previous.totalRevenueKobo) /
            Math.abs(previous.totalRevenueKobo)) *
          100;
        const expectedExpenses =
          ((current.totalExpensesKobo - previous.totalExpensesKobo) /
            Math.abs(previous.totalExpensesKobo)) *
          100;

        expect(result.revenueChangePercent).toBeCloseTo(expectedRevenue, 5);
        expect(result.expensesChangePercent).toBeCloseTo(expectedExpenses, 5);
        expect(result.transactionCountChange).toBe(
          current.transactionCount - previous.transactionCount,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('returns Infinity/-Infinity when previous is zero and current is non-zero', () => {
    const zeroSummary: SummaryData = {
      totalRevenueKobo: 0,
      totalExpensesKobo: 0,
      netCashflowKobo: 0,
      transactionCount: 0,
      averageTransactionKobo: 0,
      periodStart,
      periodEnd,
    };

    const positiveAmountArb = fc.integer({ min: 1, max: 100_000_000_00 });

    fc.assert(
      fc.property(positiveAmountArb, positiveAmountArb, (revenue, expenses) => {
        const current: SummaryData = {
          totalRevenueKobo: revenue,
          totalExpensesKobo: expenses,
          netCashflowKobo: revenue - expenses,
          transactionCount: 1,
          averageTransactionKobo: revenue + expenses,
          periodStart,
          periodEnd,
        };

        const result = calculateComparison(current, zeroSummary);

        expect(result.revenueChangePercent).toBe(Infinity);
        expect(result.expensesChangePercent).toBe(Infinity);
      }),
      { numRuns: 100 },
    );
  });

  it('returns 0% when both current and previous are zero', () => {
    const zeroSummary: SummaryData = {
      totalRevenueKobo: 0,
      totalExpensesKobo: 0,
      netCashflowKobo: 0,
      transactionCount: 0,
      averageTransactionKobo: 0,
      periodStart,
      periodEnd,
    };

    const result = calculateComparison(zeroSummary, zeroSummary);

    expect(result.revenueChangePercent).toBe(0);
    expect(result.expensesChangePercent).toBe(0);
    expect(result.netCashflowChangePercent).toBe(0);
    expect(result.transactionCountChange).toBe(0);
  });
});
