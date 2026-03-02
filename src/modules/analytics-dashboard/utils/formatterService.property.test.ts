/**
 * Property-based tests for FormatterService — Naira formatting round-trip.
 *
 * Feature: analytics-dashboard, Property 13: Naira Formatting Round-Trip
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 1.8
 *
 * For any kobo amount (integer), the formatted Naira string SHALL:
 * - Start with "₦" (or "-₦" for negative amounts)
 * - Include thousands separators (commas)
 * - Have exactly 2 decimal places
 * - When parsed back, equal the original kobo value / 100
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  formatAsNaira,
  formatAsNairaWithSign,
  koboToNaira,
  createAmountDisplay,
} from './formatterService.js';

const koboArb = fc.integer({ min: -100_000_000_00, max: 100_000_000_00 });

describe('Feature: analytics-dashboard, Property 13: Naira Formatting Round-Trip', () => {
  /**
   * Validates: Requirements 7.1, 7.5
   *
   * formatAsNaira always starts with ₦ for non-negative amounts
   * and -₦ for negative amounts.
   */
  it('formatAsNaira always starts with ₦ or -₦', () => {
    fc.assert(
      fc.property(koboArb, (kobo) => {
        const result = formatAsNaira(kobo);
        if (kobo < 0) {
          expect(result).toMatch(/^-₦/);
        } else {
          expect(result).toMatch(/^₦/);
          expect(result).not.toMatch(/^-/);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 7.3
   *
   * formatAsNaira always produces exactly 2 decimal places.
   */
  it('formatAsNaira always has exactly 2 decimal places', () => {
    fc.assert(
      fc.property(koboArb, (kobo) => {
        const result = formatAsNaira(kobo);
        // Match the decimal portion: a dot followed by exactly 2 digits at end
        expect(result).toMatch(/\.\d{2}$/);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4
   *
   * Round-trip: parsing the formatted Naira string back gives the original
   * kobo / 100 value.
   */
  it('round-trip: parsing formatted string back gives original kobo/100', () => {
    fc.assert(
      fc.property(koboArb, (kobo) => {
        const formatted = formatAsNaira(kobo);
        // Strip ₦, minus sign, and commas, then parse as float
        const parsed = parseFloat(formatted.replace(/[₦,]/g, ''));
        const expected = koboToNaira(kobo);
        expect(parsed).toBeCloseTo(expected, 2);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 7.4
   *
   * createAmountDisplay.kobo always equals the input kobo value.
   */
  it('createAmountDisplay.kobo always equals the input', () => {
    fc.assert(
      fc.property(koboArb, (kobo) => {
        const display = createAmountDisplay(kobo);
        expect(display.kobo).toBe(kobo);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 7.4
   *
   * createAmountDisplay.naira always equals kobo / 100.
   */
  it('createAmountDisplay.naira always equals kobo / 100', () => {
    fc.assert(
      fc.property(koboArb, (kobo) => {
        const display = createAmountDisplay(kobo);
        expect(display.naira).toBe(kobo / 100);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 7.1, 7.5
   *
   * formatAsNairaWithSign: positive values start with +₦,
   * negative values start with -₦, zero starts with ₦ (no sign).
   */
  it('formatAsNairaWithSign: positive → +₦, negative → -₦, zero → ₦', () => {
    fc.assert(
      fc.property(koboArb, (kobo) => {
        const result = formatAsNairaWithSign(kobo);
        if (kobo > 0) {
          expect(result).toMatch(/^\+₦/);
        } else if (kobo < 0) {
          expect(result).toMatch(/^-₦/);
        } else {
          expect(result).toBe('₦0.00');
        }
      }),
      { numRuns: 100 },
    );
  });
});
