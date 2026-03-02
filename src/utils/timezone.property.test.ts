/**
 * Property-based tests for WAT Timezone Consistency.
 *
 * **Property 6: WAT Timezone Consistency**
 * For any date/time in insight content, it SHALL be formatted in WAT (UTC+1) timezone.
 *
 * **Validates: Requirements 1.5, 14.5**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  WAT_OFFSET_MS,
  toWAT,
  formatDateWAT,
  formatDateNigerian,
  createWATDate,
  startOfDayWAT,
  isSameWATDay,
} from './timezone.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Arbitrary Date within a reasonable range (2000–2099). */
const dateArb = fc
  .integer({ min: 946_684_800_000, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms));

/** Arbitrary valid WAT date components (year, month 1-12, day 1-28, hours 0-23, min 0-59, sec 0-59). */
const watComponentsArb = fc.record({
  year: fc.integer({ min: 2000, max: 2099 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }),
  hours: fc.integer({ min: 0, max: 23 }),
  minutes: fc.integer({ min: 0, max: 59 }),
  seconds: fc.integer({ min: 0, max: 59 }),
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('WAT Timezone Consistency (Property 6)', () => {
  /**
   * **Validates: Requirements 1.5, 14.5**
   * toWAT always adds exactly 1 hour (WAT_OFFSET_MS) to any UTC date.
   */
  it('toWAT always adds exactly 1 hour to any UTC date', () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const wat = toWAT(date);
        expect(wat.getTime()).toBe(date.getTime() + WAT_OFFSET_MS);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 14.5**
   * formatDateWAT always ends with +01:00 offset indicator.
   */
  it('formatDateWAT always ends with +01:00', () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const formatted = formatDateWAT(date);
        expect(formatted.endsWith('+01:00')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 14.5**
   * formatDateNigerian always ends with WAT suffix.
   */
  it('formatDateNigerian always ends with WAT', () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const formatted = formatDateNigerian(date);
        expect(formatted.endsWith('WAT')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 14.5**
   * createWATDate round-trips correctly through toWAT — the WAT-local
   * components of toWAT(createWATDate(...)) match the original inputs.
   */
  it('createWATDate round-trips correctly through toWAT', () => {
    fc.assert(
      fc.property(watComponentsArb, ({ year, month, day, hours, minutes, seconds }) => {
        const date = createWATDate(year, month, day, hours, minutes, seconds);
        const wat = toWAT(date);
        expect(wat.getUTCFullYear()).toBe(year);
        expect(wat.getUTCMonth()).toBe(month - 1);
        expect(wat.getUTCDate()).toBe(day);
        expect(wat.getUTCHours()).toBe(hours);
        expect(wat.getUTCMinutes()).toBe(minutes);
        expect(wat.getUTCSeconds()).toBe(seconds);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 14.5**
   * isSameWATDay is reflexive — any date is on the same WAT day as itself.
   */
  it('isSameWATDay is reflexive', () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        expect(isSameWATDay(date, date)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 14.5**
   * startOfDayWAT always produces midnight in WAT (00:00:00).
   */
  it('startOfDayWAT always produces midnight WAT', () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const start = startOfDayWAT(date);
        const wat = toWAT(start);
        expect(wat.getUTCHours()).toBe(0);
        expect(wat.getUTCMinutes()).toBe(0);
        expect(wat.getUTCSeconds()).toBe(0);
        expect(wat.getUTCMilliseconds()).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
