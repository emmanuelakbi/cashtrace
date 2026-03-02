/**
 * Period and timezone utilities for analytics date calculations.
 *
 * All date boundaries are computed in WAT (West Africa Time, UTC+1).
 * WAT has a fixed offset — no daylight saving transitions.
 *
 * @module modules/analytics-dashboard/utils/periodService
 */

import type { PeriodBounds, PeriodType } from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** WAT offset from UTC in milliseconds (+1 hour). */
export const WAT_OFFSET_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// WAT timezone utilities
// ---------------------------------------------------------------------------

/**
 * Return the current instant as a `Date`.
 *
 * `Date` objects are always UTC internally, so this is equivalent to
 * `new Date()`. It exists as a named function for testability — callers
 * can stub or wrap it when deterministic timestamps are needed.
 *
 * @returns The current date/time.
 *
 * Validates: Requirements 2.3
 */
export function getCurrentTimeWAT(): Date {
  return new Date();
}

/**
 * Shift a UTC date to its WAT wall-clock equivalent by adding the
 * fixed +1 hour offset.
 *
 * The returned `Date` is **not** a true UTC instant — its UTC accessors
 * (`getUTCHours`, etc.) will read as WAT wall-clock values. This is
 * intentional and used for calendar arithmetic (e.g. finding the WAT
 * date, month, or day-of-week).
 *
 * @param date - A date in UTC.
 * @returns A new `Date` whose UTC fields represent WAT wall-clock time.
 *
 * Validates: Requirements 2.3
 */
export function toWAT(date: Date): Date {
  return new Date(date.getTime() + WAT_OFFSET_MS);
}

/**
 * Return the UTC timestamp that corresponds to midnight (00:00:00.000)
 * WAT on the same WAT calendar day as the given date.
 *
 * Algorithm:
 * 1. Shift to WAT to determine the WAT calendar date.
 * 2. Construct midnight of that WAT date (using UTC accessors on the
 *    shifted value).
 * 3. Shift back to UTC by subtracting the WAT offset.
 *
 * Example: for any time on 2024-06-15 WAT the result is
 * `2024-06-14T23:00:00.000Z` (midnight WAT = 23:00 UTC the previous day).
 *
 * @param date - Any date (interpreted as UTC).
 * @returns A `Date` representing midnight WAT in UTC.
 *
 * Validates: Requirements 2.3
 */
export function getStartOfDayWAT(date: Date): Date {
  const watDate = toWAT(date);
  const midnightWAT = new Date(
    Date.UTC(watDate.getUTCFullYear(), watDate.getUTCMonth(), watDate.getUTCDate(), 0, 0, 0, 0),
  );
  return new Date(midnightWAT.getTime() - WAT_OFFSET_MS);
}

// ---------------------------------------------------------------------------
// Period boundary calculations
// ---------------------------------------------------------------------------

/**
 * Return the UTC timestamp that corresponds to Monday 00:00:00.000 WAT
 * of the week containing the given date.
 *
 * ISO weeks start on Monday. JavaScript's `getUTCDay()` returns 0 for
 * Sunday, so we map: Sun → 6 days back, Mon → 0, Tue → 1, … Sat → 5.
 *
 * @param date - Any date (interpreted as UTC).
 * @returns A `Date` representing Monday midnight WAT in UTC.
 *
 * Validates: Requirements 2.4, 2.5
 */
export function getStartOfWeekWAT(date: Date): Date {
  const watDate = toWAT(date);
  const dayOfWeek = watDate.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(
    Date.UTC(
      watDate.getUTCFullYear(),
      watDate.getUTCMonth(),
      watDate.getUTCDate() - daysFromMonday,
      0,
      0,
      0,
      0,
    ),
  );
  return new Date(monday.getTime() - WAT_OFFSET_MS);
}

/**
 * Return the UTC timestamp that corresponds to the 1st of the current
 * month at 00:00:00.000 WAT for the given date.
 *
 * @param date - Any date (interpreted as UTC).
 * @returns A `Date` representing the first of the month midnight WAT in UTC.
 *
 * Validates: Requirements 2.6
 */
export function getStartOfMonthWAT(date: Date): Date {
  const watDate = toWAT(date);
  const firstOfMonth = new Date(
    Date.UTC(watDate.getUTCFullYear(), watDate.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  return new Date(firstOfMonth.getTime() - WAT_OFFSET_MS);
}

/**
 * Return the UTC timestamp that corresponds to the first day of the
 * current quarter at 00:00:00.000 WAT for the given date.
 *
 * Quarters: Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec.
 *
 * @param date - Any date (interpreted as UTC).
 * @returns A `Date` representing the first of the quarter midnight WAT in UTC.
 *
 * Validates: Requirements 2.7
 */
export function getStartOfQuarterWAT(date: Date): Date {
  const watDate = toWAT(date);
  const quarterStartMonth = Math.floor(watDate.getUTCMonth() / 3) * 3;
  const firstOfQuarter = new Date(
    Date.UTC(watDate.getUTCFullYear(), quarterStartMonth, 1, 0, 0, 0, 0),
  );
  return new Date(firstOfQuarter.getTime() - WAT_OFFSET_MS);
}

/**
 * Return the UTC timestamp that corresponds to January 1st 00:00:00.000
 * WAT of the year containing the given date.
 *
 * @param date - Any date (interpreted as UTC).
 * @returns A `Date` representing January 1st midnight WAT in UTC.
 *
 * Validates: Requirements 2.8
 */
export function getStartOfYearWAT(date: Date): Date {
  const watDate = toWAT(date);
  const firstOfYear = new Date(Date.UTC(watDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
  return new Date(firstOfYear.getTime() - WAT_OFFSET_MS);
}
// ---------------------------------------------------------------------------
// Period bounds calculation
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Calculate the start and end date boundaries for a given period type.
 *
 * For predefined periods the start is the WAT boundary and the end is
 * the current time. For custom periods both dates must be supplied.
 * Defaults to `this_month` when no period is specified.
 *
 * @param period - The period type (defaults to `'this_month'`).
 * @param customStart - Required when period is `'custom'`.
 * @param customEnd - Required when period is `'custom'`.
 * @returns Resolved period boundaries.
 * @throws When custom period is missing dates or start > end.
 *
 * Validates: Requirements 2.1, 2.2, 2.9
 */
export function calculatePeriodBounds(
  period?: PeriodType,
  customStart?: Date,
  customEnd?: Date,
): PeriodBounds {
  const effectivePeriod: PeriodType = period ?? 'this_month';
  const now = getCurrentTimeWAT();

  let startDate: Date;
  let endDate: Date = now;

  switch (effectivePeriod) {
    case 'today':
      startDate = getStartOfDayWAT(now);
      break;
    case 'this_week':
      startDate = getStartOfWeekWAT(now);
      break;
    case 'this_month':
      startDate = getStartOfMonthWAT(now);
      break;
    case 'this_quarter':
      startDate = getStartOfQuarterWAT(now);
      break;
    case 'this_year':
      startDate = getStartOfYearWAT(now);
      break;
    case 'custom': {
      if (!customStart || !customEnd) {
        throw new Error('Custom period requires both startDate and endDate');
      }
      if (customStart > customEnd) {
        throw new Error('startDate must be before or equal to endDate');
      }
      startDate = customStart;
      endDate = customEnd;
      break;
    }
  }

  const daysInPeriod = Math.max(
    1,
    Math.ceil((endDate.getTime() - startDate.getTime()) / MS_PER_DAY),
  );

  return { startDate, endDate, periodType: effectivePeriod, daysInPeriod };
}

/**
 * Calculate the previous comparison period for a given set of bounds.
 *
 * The previous period has the **same duration** as the current period and
 * ends exactly where the current period starts. This ensures an
 * apples-to-apples comparison regardless of period type.
 *
 * Examples:
 * - "today" (start=midnight, end=now) → previous ends at midnight, same duration before that.
 * - "this_week" with 3 elapsed days → previous is the 3 days immediately before.
 * - custom 10-day range → previous is the 10 days immediately before.
 *
 * @param bounds - The current period boundaries.
 * @returns A new `PeriodBounds` for the previous comparison period.
 *
 * Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */
export function calculatePreviousPeriod(bounds: PeriodBounds): PeriodBounds {
  const durationMs = bounds.endDate.getTime() - bounds.startDate.getTime();
  const previousEnd = bounds.startDate;
  const previousStart = new Date(previousEnd.getTime() - durationMs);

  const daysInPeriod = Math.max(1, Math.ceil(durationMs / MS_PER_DAY));

  return {
    startDate: previousStart,
    endDate: previousEnd,
    periodType: bounds.periodType,
    daysInPeriod,
  };
}
