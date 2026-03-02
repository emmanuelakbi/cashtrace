/**
 * Property-based tests for Financial Precision (Kobo utilities).
 *
 * **Property 1: Financial Precision**
 * For any insight involving financial amounts, all values SHALL be stored
 * and calculated in Kobo (integers) to prevent floating-point errors.
 *
 * **Validates: Requirements 1.4**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { formatNaira, isValidKoboAmount, koboToNaira, nairaToKobo } from './index.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Arbitrary Naira amount (positive, up to 2 decimal places). */
const nairaArb = fc.integer({ min: 0, max: 1_000_000_000 }).map((kobo) => kobo / 100);

/** Arbitrary valid Kobo amount (non-negative integer). */
const validKoboArb = fc.integer({ min: 0, max: 1_000_000_000_00 });

/** Arbitrary non-negative integer for Kobo validation. */
const nonNegativeIntArb = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

/** Arbitrary negative number. */
const negativeArb = fc.integer({ min: -1_000_000_000, max: -1 });

/** Arbitrary non-integer (floating-point) number. */
const nonIntegerArb = fc
  .tuple(fc.integer({ min: 0, max: 1_000_000_000 }), fc.integer({ min: 1, max: 99 }))
  .map(([whole, frac]) => whole + frac / 100);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Financial Precision (Property 1)', () => {
  /**
   * **Validates: Requirements 1.4**
   * nairaToKobo always produces an integer (no floating-point drift).
   */
  it('nairaToKobo always produces an integer', () => {
    fc.assert(
      fc.property(nairaArb, (naira) => {
        const kobo = nairaToKobo(naira);
        expect(Number.isInteger(kobo)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   * nairaToKobo(koboToNaira(kobo)) ≈ kobo for valid Kobo amounts (round-trip).
   */
  it('nairaToKobo and koboToNaira are inverse for valid Kobo amounts', () => {
    fc.assert(
      fc.property(validKoboArb, (kobo) => {
        const roundTripped = nairaToKobo(koboToNaira(kobo));
        expect(roundTripped).toBe(kobo);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   * isValidKoboAmount returns true for all non-negative integers.
   */
  it('isValidKoboAmount returns true for non-negative integers', () => {
    fc.assert(
      fc.property(nonNegativeIntArb, (amount) => {
        expect(isValidKoboAmount(amount)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   * isValidKoboAmount returns false for negative numbers.
   */
  it('isValidKoboAmount returns false for negative numbers', () => {
    fc.assert(
      fc.property(negativeArb, (amount) => {
        expect(isValidKoboAmount(amount)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   * isValidKoboAmount returns false for non-integer numbers.
   */
  it('isValidKoboAmount returns false for non-integers', () => {
    fc.assert(
      fc.property(nonIntegerArb, (amount) => {
        expect(isValidKoboAmount(amount)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   * formatNaira always produces a string starting with "₦".
   */
  it('formatNaira always produces a string starting with ₦', () => {
    fc.assert(
      fc.property(validKoboArb, (kobo) => {
        const formatted = formatNaira(kobo);
        expect(formatted.startsWith('₦')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   * All insight financial amounts (financialImpactKobo) are valid Kobo amounts
   * when created via nairaToKobo conversion.
   */
  it('nairaToKobo output is always a valid Kobo amount for non-negative Naira', () => {
    fc.assert(
      fc.property(nairaArb, (naira) => {
        const kobo = nairaToKobo(naira);
        expect(isValidKoboAmount(kobo)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
