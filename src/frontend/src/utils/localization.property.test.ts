/**
 * Property-based tests for WAT (West Africa Time) timezone formatting.
 *
 * **Property 8: WAT Timezone Display**
 * _For any_ date/time displayed in the UI, it SHALL be formatted in WAT (UTC+1) timezone.
 *
 * **Validates: Requirements 15.1**
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatWATDate, formatWATDateTime, formatWATTime } from './localization';

/**
 * Generates arbitrary valid Date objects within a reasonable range.
 * Range: 2000-01-01 to 2099-12-31 to avoid edge cases with very old/future dates.
 */
const arbDate = fc
  .integer({
    min: new Date('2000-01-01T00:00:00Z').getTime(),
    max: new Date('2099-12-31T23:59:59Z').getTime(),
  })
  .map((ms) => new Date(ms));

describe('Property 8: WAT Timezone Display', () => {
  describe('formatWATDate produces DD/MM/YYYY format', () => {
    it('always matches DD/MM/YYYY pattern for any valid Date', () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const result = formatWATDate(date);
          expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        }),
        { numRuns: 200 },
      );
    });

    it('day is always 2-digit (01-31)', () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const result = formatWATDate(date);
          const day = parseInt(result.split('/')[0]!, 10);
          expect(day).toBeGreaterThanOrEqual(1);
          expect(day).toBeLessThanOrEqual(31);
          expect(result.split('/')[0]).toHaveLength(2);
        }),
        { numRuns: 200 },
      );
    });

    it('month is always 2-digit (01-12)', () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const result = formatWATDate(date);
          const month = parseInt(result.split('/')[1]!, 10);
          expect(month).toBeGreaterThanOrEqual(1);
          expect(month).toBeLessThanOrEqual(12);
          expect(result.split('/')[1]).toHaveLength(2);
        }),
        { numRuns: 200 },
      );
    });

    it('year is always 4-digit', () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const result = formatWATDate(date);
          const year = result.split('/')[2]!;
          expect(year).toHaveLength(4);
          const yearNum = parseInt(year, 10);
          expect(yearNum).toBeGreaterThanOrEqual(2000);
          expect(yearNum).toBeLessThanOrEqual(2100);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('formatWATTime produces HH:MM format with WAT offset', () => {
    it('always matches HH:MM pattern for any valid Date', () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const result = formatWATTime(date);
          expect(result).toMatch(/^\d{2}:\d{2}$/);
        }),
        { numRuns: 200 },
      );
    });

    it('hour is always 2-digit (00-23)', () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const result = formatWATTime(date);
          const hour = parseInt(result.split(':')[0]!, 10);
          expect(hour).toBeGreaterThanOrEqual(0);
          expect(hour).toBeLessThanOrEqual(23);
          expect(result.split(':')[0]).toHaveLength(2);
        }),
        { numRuns: 200 },
      );
    });

    it('minute is always 2-digit (00-59)', () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const result = formatWATTime(date);
          const minute = parseInt(result.split(':')[1]!, 10);
          expect(minute).toBeGreaterThanOrEqual(0);
          expect(minute).toBeLessThanOrEqual(59);
          expect(result.split(':')[1]).toHaveLength(2);
        }),
        { numRuns: 200 },
      );
    });

    it('WAT time is exactly UTC + 1 hour', () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const watTime = formatWATTime(date);
          const watHour = parseInt(watTime.split(':')[0]!, 10);
          const watMinute = parseInt(watTime.split(':')[1]!, 10);

          const utcHour = date.getUTCHours();
          const utcMinute = date.getUTCMinutes();

          // WAT = UTC + 1, so the hour should be (utcHour + 1) % 24
          const expectedWatHour = (utcHour + 1) % 24;

          expect(watHour).toBe(expectedWatHour);
          expect(watMinute).toBe(utcMinute);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('formatWATDateTime combines date and time correctly', () => {
    it('always matches DD/MM/YYYY, HH:MM pattern', () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const result = formatWATDateTime(date);
          expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/);
        }),
        { numRuns: 200 },
      );
    });

    it('date part matches formatWATDate and time part matches formatWATTime', () => {
      fc.assert(
        fc.property(arbDate, (date) => {
          const dateTime = formatWATDateTime(date);
          const [datePart, timePart] = dateTime.split(', ');

          expect(datePart).toBe(formatWATDate(date));
          expect(timePart).toBe(formatWATTime(date));
        }),
        { numRuns: 200 },
      );
    });
  });
});

/**
 * Property-based tests for Naira (₦) currency formatting.
 *
 * **Property 9: Currency Formatting**
 * _For any_ monetary amount displayed, it SHALL be formatted as Naira (₦) with proper
 * thousands separators.
 *
 * **Validates: Requirements 15.2**
 */
import {
  formatNaira,
  formatNairaCompact,
  koboToNaira,
  nairaToKobo,
} from './localization';

/**
 * Generates arbitrary non-negative integer Kobo amounts.
 * Range: 0 to 100 billion Kobo (₦1 billion) — covers realistic SME amounts.
 */
const arbKobo = fc.integer({ min: 0, max: 100_000_000_000 });

/**
 * Generates arbitrary non-negative integer Kobo amounts that are exact multiples of 100
 * (i.e. whole Naira values with no fractional Kobo).
 */
const arbWholeNairaKobo = fc
  .integer({ min: 0, max: 1_000_000_000 })
  .map((n) => n * 100);

/**
 * Generates arbitrary non-negative integer Kobo amounts that are NOT multiples of 100
 * (i.e. amounts with fractional Kobo).
 */
const arbFractionalKobo = fc
  .integer({ min: 0, max: 999_999_999 })
  .chain((wholeNaira) =>
    fc.integer({ min: 1, max: 99 }).map((remainder) => wholeNaira * 100 + remainder),
  );

describe('Property 9: Currency Formatting', () => {
  describe('formatNaira starts with ₦ for any non-negative Kobo amount', () => {
    it('always starts with ₦', () => {
      fc.assert(
        fc.property(arbKobo, (kobo) => {
          const result = formatNaira(kobo);
          expect(result.startsWith('₦')).toBe(true);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('formatNaira always has exactly 2 decimal places', () => {
    it('always ends with .XX where X is a digit', () => {
      fc.assert(
        fc.property(arbKobo, (kobo) => {
          const result = formatNaira(kobo);
          expect(result).toMatch(/\.\d{2}$/);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('formatNaira uses commas as thousands separators', () => {
    it('digits before decimal are grouped by commas in groups of 3', () => {
      fc.assert(
        fc.property(arbKobo, (kobo) => {
          const result = formatNaira(kobo);
          // Strip the ₦ prefix and the decimal portion
          const [integerPart] = result.slice(1).split('.');
          // Integer part should match optional leading digits then groups of ,XXX
          // e.g. "1", "12", "123", "1,234", "12,345", "123,456", "1,234,567"
          expect(integerPart).toMatch(/^\d{1,3}(,\d{3})*$/);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('koboToNaira and nairaToKobo are inverse operations', () => {
    it('roundtrip: nairaToKobo(koboToNaira(k)) === k for integer Kobo', () => {
      fc.assert(
        fc.property(arbKobo, (kobo) => {
          const naira = koboToNaira(kobo);
          const backToKobo = nairaToKobo(naira);
          expect(backToKobo).toBe(kobo);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('formatNairaCompact omits decimals for whole Naira amounts', () => {
    it('has no decimal point when Kobo is a multiple of 100', () => {
      fc.assert(
        fc.property(arbWholeNairaKobo, (kobo) => {
          const result = formatNairaCompact(kobo);
          expect(result).not.toContain('.');
        }),
        { numRuns: 200 },
      );
    });

    it('has decimal places when Kobo is NOT a multiple of 100', () => {
      fc.assert(
        fc.property(arbFractionalKobo, (kobo) => {
          const result = formatNairaCompact(kobo);
          expect(result).toMatch(/\.\d{1,2}$/);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('formatNairaCompact starts with ₦ for any non-negative Kobo amount', () => {
    it('always starts with ₦', () => {
      fc.assert(
        fc.property(arbKobo, (kobo) => {
          const result = formatNairaCompact(kobo);
          expect(result.startsWith('₦')).toBe(true);
        }),
        { numRuns: 200 },
      );
    });
  });
});
