/**
 * Property-based tests for business name validation.
 *
 * **Property 1: Name Validation Correctness**
 * For any string input, the business name validator SHALL accept it if and only
 * if it contains between 2 and 100 characters inclusive (after trimming).
 *
 * **Validates: Requirements 1.2, 3.2**
 *
 * Tag: Feature: business-management, Property 1: Name Validation Correctness
 *
 * @module modules/business/validators/nameValidator.property.test
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { validateBusinessName } from './nameValidator.js';

/** Valid names: strings with trimmed length 2-100 */
const validBusinessNameArb = fc
  .string({ minLength: 2, maxLength: 100 })
  .filter((s) => s.trim().length >= 2 && s.trim().length <= 100);

/** Invalid: too short (trimmed length 0-1) */
const tooShortNameArb = fc.string({ maxLength: 1 });

/** Invalid: too long (trimmed length > 100) */
const tooLongNameArb = fc
  .string({ minLength: 101, maxLength: 200 })
  .filter((s) => s.trim().length > 100);

describe('Property 1: Name Validation Correctness', () => {
  /**
   * **Validates: Requirements 1.2, 3.2**
   *
   * For any valid name (trimmed length 2-100), validateBusinessName
   * returns valid: true.
   */
  it('should accept any name with trimmed length between 2 and 100', () => {
    fc.assert(
      fc.property(validBusinessNameArb, (name) => {
        const result = validateBusinessName(name);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 1.2, 3.2**
   *
   * For any too-short name (trimmed length 0-1), validateBusinessName
   * returns valid: false.
   */
  it('should reject any name with trimmed length less than 2', () => {
    fc.assert(
      fc.property(tooShortNameArb, (name) => {
        const result = validateBusinessName(name);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 1.2, 3.2**
   *
   * For any too-long name (trimmed length > 100), validateBusinessName
   * returns valid: false.
   */
  it('should reject any name with trimmed length greater than 100', () => {
    fc.assert(
      fc.property(tooLongNameArb, (name) => {
        const result = validateBusinessName(name);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 1.2, 3.2**
   *
   * Trimming idempotency: validating a name gives the same result as
   * validating its trimmed version.
   */
  it('should produce the same validation result for a name and its trimmed version', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 150 }), (name) => {
        const resultOriginal = validateBusinessName(name);
        const resultTrimmed = validateBusinessName(name.trim());
        expect(resultOriginal.valid).toBe(resultTrimmed.valid);
      }),
      { numRuns: 100, verbose: true },
    );
  });
});
