import { describe, expect, it } from 'vitest';

import { calculateComparison, calculateSummary } from './summaryService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const periodStart = new Date('2024-06-01T00:00:00Z');
const periodEnd = new Date('2024-06-30T23:59:59Z');

// ---------------------------------------------------------------------------
// calculateSummary
// ---------------------------------------------------------------------------

describe('calculateSummary', () => {
  it('calculates totals from raw aggregation', () => {
    const result = calculateSummary(
      {
        totalInflowKobo: BigInt(500_000),
        totalOutflowKobo: BigInt(200_000),
        inflowCount: 10,
        outflowCount: 5,
      },
      periodStart,
      periodEnd,
    );

    expect(result.totalRevenueKobo).toBe(500_000);
    expect(result.totalExpensesKobo).toBe(200_000);
    expect(result.netCashflowKobo).toBe(300_000);
    expect(result.transactionCount).toBe(15);
    expect(result.averageTransactionKobo).toBe(Math.round(700_000 / 15));
    expect(result.periodStart).toBe(periodStart);
    expect(result.periodEnd).toBe(periodEnd);
  });

  it('handles zero transactions', () => {
    const result = calculateSummary(
      {
        totalInflowKobo: BigInt(0),
        totalOutflowKobo: BigInt(0),
        inflowCount: 0,
        outflowCount: 0,
      },
      periodStart,
      periodEnd,
    );

    expect(result.totalRevenueKobo).toBe(0);
    expect(result.totalExpensesKobo).toBe(0);
    expect(result.netCashflowKobo).toBe(0);
    expect(result.transactionCount).toBe(0);
    expect(result.averageTransactionKobo).toBe(0);
  });

  it('handles negative net cashflow (expenses > revenue)', () => {
    const result = calculateSummary(
      {
        totalInflowKobo: BigInt(100_000),
        totalOutflowKobo: BigInt(300_000),
        inflowCount: 2,
        outflowCount: 6,
      },
      periodStart,
      periodEnd,
    );

    expect(result.netCashflowKobo).toBe(-200_000);
    expect(result.transactionCount).toBe(8);
    expect(result.averageTransactionKobo).toBe(Math.round(400_000 / 8));
  });

  it('handles only inflows', () => {
    const result = calculateSummary(
      {
        totalInflowKobo: BigInt(1_000_000),
        totalOutflowKobo: BigInt(0),
        inflowCount: 5,
        outflowCount: 0,
      },
      periodStart,
      periodEnd,
    );

    expect(result.totalRevenueKobo).toBe(1_000_000);
    expect(result.totalExpensesKobo).toBe(0);
    expect(result.netCashflowKobo).toBe(1_000_000);
    expect(result.averageTransactionKobo).toBe(200_000);
  });
});

// ---------------------------------------------------------------------------
// calculateComparison
// ---------------------------------------------------------------------------

describe('calculateComparison', () => {
  const makeSummary = (
    revenue: number,
    expenses: number,
    count: number,
  ): {
    totalRevenueKobo: number;
    totalExpensesKobo: number;
    netCashflowKobo: number;
    transactionCount: number;
    averageTransactionKobo: number;
    periodStart: Date;
    periodEnd: Date;
  } => ({
    totalRevenueKobo: revenue,
    totalExpensesKobo: expenses,
    netCashflowKobo: revenue - expenses,
    transactionCount: count,
    averageTransactionKobo: count > 0 ? Math.round((revenue + expenses) / count) : 0,
    periodStart,
    periodEnd,
  });

  it('calculates percentage changes correctly', () => {
    const current = makeSummary(200_000, 100_000, 10);
    const previous = makeSummary(100_000, 80_000, 8);
    const result = calculateComparison(current, previous);

    expect(result.revenueChangePercent).toBe(100); // (200k - 100k) / 100k * 100
    expect(result.expensesChangePercent).toBe(25); // (100k - 80k) / 80k * 100
    expect(result.transactionCountChange).toBe(2);
  });

  it('handles zero previous values (Infinity)', () => {
    const current = makeSummary(100_000, 50_000, 5);
    const previous = makeSummary(0, 0, 0);
    const result = calculateComparison(current, previous);

    expect(result.revenueChangePercent).toBe(Infinity);
    expect(result.expensesChangePercent).toBe(Infinity);
    expect(result.netCashflowChangePercent).toBe(Infinity);
    expect(result.transactionCountChange).toBe(5);
  });

  it('handles both zero values (0% change)', () => {
    const current = makeSummary(0, 0, 0);
    const previous = makeSummary(0, 0, 0);
    const result = calculateComparison(current, previous);

    expect(result.revenueChangePercent).toBe(0);
    expect(result.expensesChangePercent).toBe(0);
    expect(result.netCashflowChangePercent).toBe(0);
    expect(result.transactionCountChange).toBe(0);
  });

  it('handles decrease (negative percentage)', () => {
    const current = makeSummary(50_000, 30_000, 3);
    const previous = makeSummary(100_000, 60_000, 6);
    const result = calculateComparison(current, previous);

    expect(result.revenueChangePercent).toBe(-50); // (50k - 100k) / 100k * 100
    expect(result.expensesChangePercent).toBe(-50);
    expect(result.transactionCountChange).toBe(-3);
  });

  it('handles zero current with non-zero previous (-Infinity for net)', () => {
    const current = makeSummary(0, 0, 0);
    const previous = makeSummary(100_000, 50_000, 5);
    const result = calculateComparison(current, previous);

    expect(result.revenueChangePercent).toBe(-100);
    expect(result.expensesChangePercent).toBe(-100);
    // net: previous = 50000, current = 0 → (0 - 50000) / 50000 * 100 = -100
    expect(result.netCashflowChangePercent).toBe(-100);
  });

  it('handles negative net cashflow comparison with absolute previous', () => {
    // previous net = -20000, current net = -10000
    // change = (-10000 - (-20000)) / |-20000| * 100 = 10000/20000 * 100 = 50%
    const current = makeSummary(40_000, 50_000, 5);
    const previous = makeSummary(30_000, 50_000, 5);
    const result = calculateComparison(current, previous);

    expect(result.netCashflowChangePercent).toBe(50);
  });
});
