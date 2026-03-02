/**
 * Property-based tests for TrendService.
 *
 * Feature: analytics-dashboard
 *
 * Tests Properties 11 and 12 from the design document.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { RawTrendAggregation, TrendGranularity } from '../types/index.js';

import { determineGranularity, formatTrendDataPoints } from './trendService.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Shared arbitraries
// ---------------------------------------------------------------------------

/** A base date to anchor date ranges. */
const baseDateArb = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2030-06-30T00:00:00Z'),
});

/** Non-negative bigint amounts up to ₦100M in kobo. */
const amountBigIntArb = fc.integer({ min: 0, max: 100_000_000_00 }).map((n) => BigInt(n));

// ---------------------------------------------------------------------------
// Property 11: Trend Granularity Selection
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 11: Trend Granularity Selection', () => {
  /**
   * Validates: Requirements 6.2, 6.3, 6.4
   *
   * For any period:
   * - ≤ 7 days  → DAILY
   * - 8–90 days → WEEKLY
   * - > 90 days → MONTHLY
   */
  it('returns DAILY for periods of 1–7 days', () => {
    fc.assert(
      fc.property(baseDateArb, fc.integer({ min: 1, max: 7 }), (start, days) => {
        const end = new Date(start.getTime() + days * MS_PER_DAY);
        const result = determineGranularity(start, end);
        expect(result).toBe('DAILY');
      }),
      { numRuns: 200 },
    );
  });

  it('returns WEEKLY for periods of 8–90 days', () => {
    fc.assert(
      fc.property(baseDateArb, fc.integer({ min: 8, max: 90 }), (start, days) => {
        const end = new Date(start.getTime() + days * MS_PER_DAY);
        const result = determineGranularity(start, end);
        expect(result).toBe('WEEKLY');
      }),
      { numRuns: 200 },
    );
  });

  it('returns MONTHLY for periods greater than 90 days', () => {
    fc.assert(
      fc.property(baseDateArb, fc.integer({ min: 91, max: 730 }), (start, days) => {
        const end = new Date(start.getTime() + days * MS_PER_DAY);
        const result = determineGranularity(start, end);
        expect(result).toBe('MONTHLY');
      }),
      { numRuns: 200 },
    );
  });

  it('boundary: exactly 7 days is DAILY', () => {
    fc.assert(
      fc.property(baseDateArb, (start) => {
        const end = new Date(start.getTime() + 7 * MS_PER_DAY);
        expect(determineGranularity(start, end)).toBe('DAILY');
      }),
      { numRuns: 100 },
    );
  });

  it('boundary: exactly 8 days is WEEKLY', () => {
    fc.assert(
      fc.property(baseDateArb, (start) => {
        const end = new Date(start.getTime() + 8 * MS_PER_DAY);
        expect(determineGranularity(start, end)).toBe('WEEKLY');
      }),
      { numRuns: 100 },
    );
  });

  it('boundary: exactly 90 days is WEEKLY', () => {
    fc.assert(
      fc.property(baseDateArb, (start) => {
        const end = new Date(start.getTime() + 90 * MS_PER_DAY);
        expect(determineGranularity(start, end)).toBe('WEEKLY');
      }),
      { numRuns: 100 },
    );
  });

  it('boundary: exactly 91 days is MONTHLY', () => {
    fc.assert(
      fc.property(baseDateArb, (start) => {
        const end = new Date(start.getTime() + 91 * MS_PER_DAY);
        expect(determineGranularity(start, end)).toBe('MONTHLY');
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: Trend Data Chronological Order
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 12: Trend Data Chronological Order', () => {
  /**
   * Validates: Requirements 6.1, 6.6
   *
   * For any trend response, data points are ordered chronologically
   * by date in ascending order.
   */

  /** Generate a sorted array of unique time bucket dates. */
  const sortedTimeBucketsArb = (count: number): fc.Arbitrary<Date[]> =>
    fc
      .array(
        fc.date({
          min: new Date('2020-01-01T00:00:00Z'),
          max: new Date('2030-12-31T00:00:00Z'),
        }),
        { minLength: count, maxLength: count },
      )
      .map((dates) =>
        [...new Map(dates.map((d) => [d.getTime(), d])).values()].sort(
          (a, b) => a.getTime() - b.getTime(),
        ),
      )
      .filter((dates) => dates.length > 0);

  /** Build raw trend aggregation rows from sorted dates. */
  const rawTrendRowsArb: fc.Arbitrary<{
    rows: RawTrendAggregation[];
    granularity: TrendGranularity;
  }> = fc
    .tuple(
      fc.integer({ min: 2, max: 20 }),
      fc.constantFrom<TrendGranularity>('DAILY', 'WEEKLY', 'MONTHLY'),
    )
    .chain(([count, granularity]) =>
      fc
        .tuple(
          sortedTimeBucketsArb(count),
          fc.array(amountBigIntArb, { minLength: count, maxLength: count }),
          fc.array(amountBigIntArb, { minLength: count, maxLength: count }),
          fc.array(fc.integer({ min: 0, max: 500 }), { minLength: count, maxLength: count }),
        )
        .map(([dates, inflows, outflows, counts]) => ({
          rows: dates.map((d, i) => ({
            timeBucket: d,
            totalInflowKobo: inflows[i] ?? 0n,
            totalOutflowKobo: outflows[i] ?? 0n,
            transactionCount: counts[i] ?? 0,
          })),
          granularity,
        })),
    );

  it('formatted data points preserve chronological order from input rows', () => {
    fc.assert(
      fc.property(rawTrendRowsArb, ({ rows, granularity }) => {
        const dataPoints = formatTrendDataPoints(rows, granularity);

        // Verify chronological ordering
        for (let i = 1; i < dataPoints.length; i++) {
          const prev = dataPoints[i - 1];
          const curr = dataPoints[i];
          if (prev && curr) {
            expect(prev.date.getTime()).toBeLessThanOrEqual(curr.date.getTime());
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('each data point has a non-empty label', () => {
    fc.assert(
      fc.property(rawTrendRowsArb, ({ rows, granularity }) => {
        const dataPoints = formatTrendDataPoints(rows, granularity);

        for (const point of dataPoints) {
          expect(point.label).toBeTruthy();
          expect(point.label.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('net cashflow equals inflows minus outflows for every data point', () => {
    fc.assert(
      fc.property(rawTrendRowsArb, ({ rows, granularity }) => {
        const dataPoints = formatTrendDataPoints(rows, granularity);

        for (const point of dataPoints) {
          expect(point.netCashflowKobo).toBe(point.inflowsKobo - point.outflowsKobo);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('output length matches input length', () => {
    fc.assert(
      fc.property(rawTrendRowsArb, ({ rows, granularity }) => {
        const dataPoints = formatTrendDataPoints(rows, granularity);
        expect(dataPoints.length).toBe(rows.length);
      }),
      { numRuns: 200 },
    );
  });
});
