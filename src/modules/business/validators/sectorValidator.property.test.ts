/**
 * Property-based tests for business sector validation.
 *
 * **Property 2: Sector Validation Correctness**
 * For any string input, the sector validator SHALL accept it if and only if
 * it matches one of the 11 predefined Nigerian SME sector values.
 *
 * **Validates: Requirements 2.1, 2.3**
 *
 * Tag: Feature: business-management, Property 2: Sector Validation Correctness
 *
 * @module modules/business/validators/sectorValidator.property.test
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { BusinessSector } from '../types/index.js';

import { validateBusinessSector } from './sectorValidator.js';

/** All valid sector enum values */
const ALL_VALID_SECTORS = Object.values(BusinessSector);

/** Arbitrary that produces one of the 11 valid sector values */
const validSectorArb = fc.constantFrom(...ALL_VALID_SECTORS);

/** Arbitrary that produces strings NOT in the valid sector set */
const invalidSectorArb = fc
  .string()
  .filter((s) => !ALL_VALID_SECTORS.includes(s as BusinessSector));

describe('Property 2: Sector Validation Correctness', () => {
  /**
   * **Validates: Requirements 2.1, 2.3**
   *
   * For any valid sector (from BusinessSector enum), validateBusinessSector
   * returns valid: true.
   */
  it('should accept any valid BusinessSector enum value', () => {
    fc.assert(
      fc.property(validSectorArb, (sector) => {
        const result = validateBusinessSector(sector);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.3**
   *
   * For any arbitrary string NOT in the enum, validateBusinessSector
   * returns valid: false.
   */
  it('should reject any string not in the BusinessSector enum', () => {
    fc.assert(
      fc.property(invalidSectorArb, (sector) => {
        const result = validateBusinessSector(sector);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * For any invalid sector, the error message contains all valid options
   * so the caller knows what values are accepted.
   */
  it('should include all valid options in the error message for invalid sectors', () => {
    fc.assert(
      fc.property(invalidSectorArb, (sector) => {
        const result = validateBusinessSector(sector);
        expect(result.valid).toBe(false);
        const errorMessage = result.errors[0];
        for (const validSector of ALL_VALID_SECTORS) {
          expect(errorMessage).toContain(validSector);
        }
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 2.1**
   *
   * The validator accepts exactly 11 values (completeness check).
   * This ensures the enum and validator stay in sync.
   */
  it('should accept exactly 11 predefined sector values', () => {
    expect(ALL_VALID_SECTORS).toHaveLength(11);

    const acceptedSectors = ALL_VALID_SECTORS.filter(
      (sector) => validateBusinessSector(sector).valid,
    );
    expect(acceptedSectors).toHaveLength(11);
    expect(acceptedSectors).toEqual(ALL_VALID_SECTORS);
  });
});
