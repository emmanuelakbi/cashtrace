/**
 * Property-based tests for CacheService — Cache Invalidation on Transaction Changes.
 *
 * Feature: analytics-dashboard, Property 14: Cache Invalidation on Transaction Changes
 *
 * Validates: Requirements 8.3, 8.4, 9.1, 9.2, 9.3
 *
 * For any transaction create, update, or delete operation, the cache service
 * SHALL invalidate all cached aggregations for the affected business that
 * include the transaction's date in their period range.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  getStartOfDayWAT,
  getStartOfMonthWAT,
  getStartOfQuarterWAT,
  getStartOfWeekWAT,
  getStartOfYearWAT,
  toWAT,
} from '../utils/periodService.js';

import { getAffectedPeriodKeys } from './cacheService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** WAT offset in ms (+1 hour). */
const WAT_OFFSET_MS = 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Independently check whether a date falls within a given standard period
 * relative to "now". This is the oracle implementation used to verify
 * `getAffectedPeriodKeys`.
 */
function isDateInPeriod(transactionDate: Date, period: string, now: Date): boolean {
  const watNow = toWAT(now);

  switch (period) {
    case 'today': {
      const start = getStartOfDayWAT(now);
      const end = new Date(start.getTime() + MS_PER_DAY);
      return transactionDate >= start && transactionDate < end;
    }
    case 'this_week': {
      const start = getStartOfWeekWAT(now);
      const end = new Date(start.getTime() + 7 * MS_PER_DAY);
      return transactionDate >= start && transactionDate < end;
    }
    case 'this_month': {
      const start = getStartOfMonthWAT(now);
      const nextMonth = new Date(
        Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth() + 1, 1, 0, 0, 0, 0),
      );
      const end = new Date(nextMonth.getTime() - WAT_OFFSET_MS);
      return transactionDate >= start && transactionDate < end;
    }
    case 'this_quarter': {
      const start = getStartOfQuarterWAT(now);
      const qMonth = Math.floor(watNow.getUTCMonth() / 3) * 3;
      const nextQuarter = new Date(Date.UTC(watNow.getUTCFullYear(), qMonth + 3, 1, 0, 0, 0, 0));
      const end = new Date(nextQuarter.getTime() - WAT_OFFSET_MS);
      return transactionDate >= start && transactionDate < end;
    }
    case 'this_year': {
      const start = getStartOfYearWAT(now);
      const nextYear = new Date(Date.UTC(watNow.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0));
      const end = new Date(nextYear.getTime() - WAT_OFFSET_MS);
      return transactionDate >= start && transactionDate < end;
    }
    default:
      return false;
  }
}

const ALL_PERIODS = ['today', 'this_week', 'this_month', 'this_quarter', 'this_year'] as const;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generate transaction dates within the current year so they have a
 * reasonable chance of falling within current standard periods.
 */
const currentYear = new Date().getUTCFullYear();
const transactionDateArb = fc.date({
  min: new Date(`${currentYear}-01-01T00:00:00Z`),
  max: new Date(`${currentYear}-12-31T23:59:59Z`),
});

// ---------------------------------------------------------------------------
// Property 14: Cache Invalidation on Transaction Changes
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 14: Cache Invalidation on Transaction Changes', () => {
  /**
   * Validates: Requirements 8.3, 8.4, 9.1, 9.2, 9.3
   *
   * For any transaction date that falls within a standard period,
   * getAffectedPeriodKeys MUST include that period in its result.
   *
   * We use an independent oracle (isDateInPeriod) to verify the
   * implementation agrees on which periods contain the date.
   */
  it('affected periods include every standard period that contains the transaction date', () => {
    fc.assert(
      fc.property(transactionDateArb, (txDate) => {
        const now = new Date();
        const affected = getAffectedPeriodKeys(txDate);

        for (const period of ALL_PERIODS) {
          const shouldBeAffected = isDateInPeriod(txDate, period, now);
          if (shouldBeAffected) {
            expect(affected).toContain(period);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Validates: Requirements 9.1, 9.2, 9.3
   *
   * For any transaction date, getAffectedPeriodKeys MUST NOT include
   * periods that do not contain the transaction date.
   * (No false positives — only truly affected periods are invalidated.)
   */
  it('affected periods exclude every standard period that does not contain the transaction date', () => {
    fc.assert(
      fc.property(transactionDateArb, (txDate) => {
        const now = new Date();
        const affected = getAffectedPeriodKeys(txDate);

        for (const period of ALL_PERIODS) {
          const shouldBeAffected = isDateInPeriod(txDate, period, now);
          if (!shouldBeAffected) {
            expect(affected).not.toContain(period);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Validates: Requirements 8.3, 8.4
   *
   * Period containment is hierarchical where nesting is guaranteed:
   * - today ⊂ this_week (a day is always within its week)
   * - this_month ⊂ this_quarter ⊂ this_year
   *
   * Note: this_week is NOT necessarily ⊂ this_month because a week can
   * span two calendar months (e.g. Mon Feb 23 – Sun Mar 1). A date in
   * the next-month portion of the week would be in this_week but not
   * this_month.
   */
  it('period containment is hierarchical (today ⊂ this_week, this_month ⊂ this_quarter ⊂ this_year)', () => {
    fc.assert(
      fc.property(transactionDateArb, (txDate) => {
        const affected = new Set(getAffectedPeriodKeys(txDate));

        // today is always within this_week
        if (affected.has('today')) {
          expect(affected.has('this_week')).toBe(true);
          expect(affected.has('this_year')).toBe(true);
        }
        // this_month ⊂ this_quarter ⊂ this_year
        if (affected.has('this_month')) {
          expect(affected.has('this_quarter')).toBe(true);
          expect(affected.has('this_year')).toBe(true);
        }
        if (affected.has('this_quarter')) {
          expect(affected.has('this_year')).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Validates: Requirements 9.1, 9.2, 9.3
   *
   * The current instant always falls within all five standard periods.
   * This is a sanity check that "now" is always fully covered.
   */
  it('the current instant is always in all five standard periods', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const now = new Date();
        const affected = getAffectedPeriodKeys(now);

        expect(affected).toContain('today');
        expect(affected).toContain('this_week');
        expect(affected).toContain('this_month');
        expect(affected).toContain('this_quarter');
        expect(affected).toContain('this_year');
      }),
      { numRuns: 100 },
    );
  });
});
