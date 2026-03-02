/**
 * Property-based tests for PeriodService — Period Boundary WAT Calculation.
 *
 * Feature: analytics-dashboard, Property 5: Period Boundary WAT Calculation
 *
 * Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
 *
 * For any predefined period type, the calculated start date SHALL be at
 * 00:00:00 WAT (UTC+1) on the appropriate boundary day, and the end date
 * SHALL be the current time in WAT.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  toWAT,
  getStartOfDayWAT,
  getStartOfWeekWAT,
  getStartOfMonthWAT,
  getStartOfQuarterWAT,
  getStartOfYearWAT,
} from './periodService.js';

const dateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') });

describe('Feature: analytics-dashboard, Property 5: Period Boundary WAT Calculation', () => {
  /**
   * Validates: Requirements 2.3
   *
   * For any date, getStartOfDayWAT returns midnight WAT
   * (shifted to WAT, hours/minutes/seconds/ms are all 0).
   */
  it('getStartOfDayWAT returns midnight WAT for any date', () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const result = getStartOfDayWAT(date);
        const resultWAT = toWAT(result);

        expect(resultWAT.getUTCHours()).toBe(0);
        expect(resultWAT.getUTCMinutes()).toBe(0);
        expect(resultWAT.getUTCSeconds()).toBe(0);
        expect(resultWAT.getUTCMilliseconds()).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 2.4, 2.5
   *
   * For any date, getStartOfWeekWAT returns a Monday (day of week = 1 in WAT).
   */
  it('getStartOfWeekWAT returns a Monday for any date', () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const result = getStartOfWeekWAT(date);
        const resultWAT = toWAT(result);

        // getUTCDay(): 0=Sun, 1=Mon, ..., 6=Sat
        expect(resultWAT.getUTCDay()).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 2.6
   *
   * For any date, getStartOfMonthWAT returns the 1st of the month (day = 1 in WAT).
   */
  it('getStartOfMonthWAT returns the 1st of the month for any date', () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const result = getStartOfMonthWAT(date);
        const resultWAT = toWAT(result);

        expect(resultWAT.getUTCDate()).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 2.7
   *
   * For any date, getStartOfQuarterWAT returns the 1st of a quarter month
   * (month is 0, 3, 6, or 9 in WAT).
   */
  it('getStartOfQuarterWAT returns the 1st of a quarter-start month for any date', () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const result = getStartOfQuarterWAT(date);
        const resultWAT = toWAT(result);

        expect(resultWAT.getUTCDate()).toBe(1);
        expect([0, 3, 6, 9]).toContain(resultWAT.getUTCMonth());
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 2.8
   *
   * For any date, getStartOfYearWAT returns January 1st (month = 0, day = 1 in WAT).
   */
  it('getStartOfYearWAT returns January 1st for any date', () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const result = getStartOfYearWAT(date);
        const resultWAT = toWAT(result);

        expect(resultWAT.getUTCMonth()).toBe(0);
        expect(resultWAT.getUTCDate()).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
   *
   * All boundary functions return midnight WAT (00:00:00.000 in WAT).
   */
  it('all boundary functions return midnight WAT for any date', () => {
    const boundaryFns = [
      getStartOfDayWAT,
      getStartOfWeekWAT,
      getStartOfMonthWAT,
      getStartOfQuarterWAT,
      getStartOfYearWAT,
    ];

    fc.assert(
      fc.property(dateArb, (date) => {
        for (const fn of boundaryFns) {
          const result = fn(date);
          const resultWAT = toWAT(result);

          expect(resultWAT.getUTCHours()).toBe(0);
          expect(resultWAT.getUTCMinutes()).toBe(0);
          expect(resultWAT.getUTCSeconds()).toBe(0);
          expect(resultWAT.getUTCMilliseconds()).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property-based tests for PeriodService — Period Comparison Equal Length.
 *
 * Feature: analytics-dashboard, Property 6: Period Comparison Equal Length
 *
 * Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8
 *
 * For any period comparison, the previous period SHALL have the same number
 * of elapsed days as the current period. For a current period of N days,
 * the previous period SHALL also span N days and end exactly where the
 * current period starts.
 */
import { calculatePreviousPeriod } from './periodService.js';
import type { PeriodBounds } from '../types/index.js';

/**
 * Arbitrary that produces a valid PeriodBounds where endDate > startDate.
 * Uses two dates in a reasonable range and sorts them so start < end.
 */
const periodBoundsArb = fc
  .tuple(
    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-06-30') }),
    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-06-30') }),
  )
  .filter(([a, b]) => a.getTime() !== b.getTime())
  .map(([a, b]): PeriodBounds => {
    const [start, end] = a < b ? [a, b] : [b, a];
    const daysInPeriod = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)),
    );
    return {
      startDate: start,
      endDate: end,
      periodType: 'custom',
      daysInPeriod,
    };
  });

describe('Feature: analytics-dashboard, Property 6: Period Comparison Equal Length', () => {
  /**
   * Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8
   *
   * For any period bounds where end > start, the previous period has the
   * same duration (in milliseconds) as the current period.
   */
  it('previous period has the same duration (ms) as the current period', () => {
    fc.assert(
      fc.property(periodBoundsArb, (bounds) => {
        const previous = calculatePreviousPeriod(bounds);

        const currentDurationMs = bounds.endDate.getTime() - bounds.startDate.getTime();
        const previousDurationMs = previous.endDate.getTime() - previous.startDate.getTime();

        expect(previousDurationMs).toBe(currentDurationMs);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8
   *
   * For any period bounds, the previous period ends exactly at the current
   * period's start date.
   */
  it('previous period ends exactly at the current period start', () => {
    fc.assert(
      fc.property(periodBoundsArb, (bounds) => {
        const previous = calculatePreviousPeriod(bounds);

        expect(previous.endDate.getTime()).toBe(bounds.startDate.getTime());
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8
   *
   * For any period bounds, the previous period's daysInPeriod matches the
   * current period's daysInPeriod.
   */
  it('previous period daysInPeriod matches current period daysInPeriod', () => {
    fc.assert(
      fc.property(periodBoundsArb, (bounds) => {
        const previous = calculatePreviousPeriod(bounds);

        expect(previous.daysInPeriod).toBe(bounds.daysInPeriod);
      }),
      { numRuns: 100 },
    );
  });
});
