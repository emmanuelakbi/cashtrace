/**
 * Property-based tests for data residency module.
 *
 * Validates Property 7: Data Residency Compliance — for any user data,
 * it SHALL be stored in African region (Cape Town) only.
 *
 * Validates: Requirements 13.1, 13.2
 *
 * @module deployment/dataResidency.property.test
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  checkResidencyGuardrail,
  COMPLIANT_BACKUP_REGIONS,
  COMPLIANT_REGIONS,
  DATA_CLASSIFICATION_LEVELS,
  isCompliantBackupRegion,
  isCompliantRegion,
  NON_COMPLIANT_REGIONS,
  validateDataFlow,
  validateDataResidencyConfig,
} from './dataResidency.js';

const NUM_RUNS = 200;

// ─── Arbitrary Generators ────────────────────────────────────────────────────

/** Generates a compliant primary region. */
const compliantRegionArb = fc.constantFrom(...COMPLIANT_REGIONS);

/** Generates a compliant backup region. */
const compliantBackupRegionArb = fc.constantFrom(...COMPLIANT_BACKUP_REGIONS);

/** Generates a non-compliant region (known examples + random strings). */
const nonCompliantRegionArb = fc.oneof(
  fc.constantFrom(...NON_COMPLIANT_REGIONS),
  fc
    .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'), {
      minLength: 5,
      maxLength: 20,
    })
    .filter(
      (s) =>
        !(COMPLIANT_REGIONS as readonly string[]).includes(s) &&
        !(COMPLIANT_BACKUP_REGIONS as readonly string[]).includes(s),
    ),
);

/** Generates a region that is NOT in COMPLIANT_BACKUP_REGIONS. */
const nonCompliantBackupRegionArb = fc.oneof(
  fc.constantFrom(...NON_COMPLIANT_REGIONS),
  fc
    .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'), {
      minLength: 5,
      maxLength: 20,
    })
    .filter((s) => !(COMPLIANT_BACKUP_REGIONS as readonly string[]).includes(s)),
);

/** Generates a valid data classification level. */
const validClassificationArb = fc.constantFrom(...DATA_CLASSIFICATION_LEVELS);

/** Generates a non-public classification level. */
const nonPublicClassificationArb = fc.constantFrom(
  'internal' as const,
  'confidential' as const,
  'restricted' as const,
);

/** Generates a classification level that requires encryption. */
const encryptionRequiredClassificationArb = fc.constantFrom(
  'confidential' as const,
  'restricted' as const,
);

/** Generates a non-empty purpose string. */
const purposeArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('dataResidency property tests', () => {
  // ── isCompliantRegion ────────────────────────────────────────────────────

  describe('isCompliantRegion', () => {
    /**
     * Property: Every region in COMPLIANT_REGIONS passes isCompliantRegion.
     * Validates: Requirement 13.1
     */
    it('compliant regions always pass', () => {
      fc.assert(
        fc.property(compliantRegionArb, (region) => {
          expect(isCompliantRegion(region)).toBe(true);
        }),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Regions not in COMPLIANT_REGIONS always fail isCompliantRegion.
     * Validates: Requirement 13.1
     */
    it('non-compliant regions always fail', () => {
      fc.assert(
        fc.property(nonCompliantRegionArb, (region) => {
          expect(isCompliantRegion(region)).toBe(false);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // ── isCompliantBackupRegion ──────────────────────────────────────────────

  describe('isCompliantBackupRegion', () => {
    /**
     * Property: Every region in COMPLIANT_BACKUP_REGIONS passes.
     * Validates: Requirement 13.2
     */
    it('compliant backup regions always pass', () => {
      fc.assert(
        fc.property(compliantBackupRegionArb, (region) => {
          expect(isCompliantBackupRegion(region)).toBe(true);
        }),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Regions not in COMPLIANT_BACKUP_REGIONS always fail.
     * Validates: Requirement 13.2
     */
    it('non-compliant backup regions always fail', () => {
      fc.assert(
        fc.property(nonCompliantBackupRegionArb, (region) => {
          expect(isCompliantBackupRegion(region)).toBe(false);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // ── validateDataResidencyConfig ──────────────────────────────────────────

  describe('validateDataResidencyConfig', () => {
    /**
     * Property: Configs with compliant primary region, compliant backup regions,
     * valid classification, and correct encryption always pass validation.
     * Validates: Requirements 13.1, 13.2
     */
    it('valid configs with compliant regions always pass', () => {
      fc.assert(
        fc.property(
          compliantRegionArb,
          fc.array(compliantBackupRegionArb, { minLength: 0, maxLength: 3 }),
          validClassificationArb,
          (primaryRegion, backupRegions, classification) => {
            const encryptionRequired =
              classification === 'confidential' || classification === 'restricted';
            const result = validateDataResidencyConfig({
              primaryRegion,
              backupRegions,
              dataClassification: classification,
              encryptionRequired,
            });
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Configs with a non-compliant primary region always fail.
     * Validates: Requirement 13.1
     */
    it('configs with non-compliant primary regions always fail', () => {
      fc.assert(
        fc.property(
          nonCompliantRegionArb,
          validClassificationArb,
          (primaryRegion, classification) => {
            const encryptionRequired =
              classification === 'confidential' || classification === 'restricted';
            const result = validateDataResidencyConfig({
              primaryRegion,
              backupRegions: ['af-south-1'],
              dataClassification: classification,
              encryptionRequired,
            });
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThanOrEqual(1);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Configs with at least one non-compliant backup region always fail.
     * Validates: Requirement 13.2
     */
    it('configs with non-compliant backup regions always fail', () => {
      fc.assert(
        fc.property(
          compliantRegionArb,
          nonCompliantBackupRegionArb,
          (primaryRegion, badBackupRegion) => {
            const result = validateDataResidencyConfig({
              primaryRegion,
              backupRegions: ['af-south-1', badBackupRegion],
              dataClassification: 'public',
              encryptionRequired: false,
            });
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes(badBackupRegion))).toBe(true);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Confidential/restricted data without encryption always fails.
     * Validates: Requirement 13.1
     */
    it('sensitive data without encryption always fails', () => {
      fc.assert(
        fc.property(
          compliantRegionArb,
          encryptionRequiredClassificationArb,
          (primaryRegion, classification) => {
            const result = validateDataResidencyConfig({
              primaryRegion,
              backupRegions: ['af-south-1'],
              dataClassification: classification,
              encryptionRequired: false,
            });
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes('encryptionRequired'))).toBe(true);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // ── validateDataFlow ─────────────────────────────────────────────────────

  describe('validateDataFlow', () => {
    /**
     * Property: Data flows to non-compliant destinations for non-public data
     * always have violations.
     * Validates: Requirements 13.1, 13.2
     */
    it('flows to non-compliant regions for non-public data always have violations', () => {
      fc.assert(
        fc.property(
          nonCompliantRegionArb,
          nonPublicClassificationArb,
          purposeArb,
          (destinationRegion, classification, purpose) => {
            const result = validateDataFlow({
              sourceRegion: 'af-south-1',
              destinationRegion,
              dataClassification: classification,
              purpose,
              encrypted: true,
            });
            expect(result.valid).toBe(false);
            expect(result.violations.length).toBeGreaterThanOrEqual(1);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Unencrypted confidential/restricted flows always have violations.
     * Validates: Requirement 13.1
     */
    it('unencrypted sensitive flows always have violations', () => {
      fc.assert(
        fc.property(encryptionRequiredClassificationArb, purposeArb, (classification, purpose) => {
          const result = validateDataFlow({
            sourceRegion: 'af-south-1',
            destinationRegion: 'af-south-1',
            dataClassification: classification,
            purpose,
            encrypted: false,
          });
          expect(result.valid).toBe(false);
          expect(result.violations.some((v) => v.includes('encrypted'))).toBe(true);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // ── checkResidencyGuardrail ──────────────────────────────────────────────

  describe('checkResidencyGuardrail', () => {
    /**
     * Property: Guardrails always block non-compliant regions for non-public data.
     * Validates: Requirements 13.1, 13.4
     */
    it('always blocks non-compliant regions for non-public data', () => {
      fc.assert(
        fc.property(
          nonCompliantRegionArb,
          nonPublicClassificationArb,
          (targetRegion, classification) => {
            const result = checkResidencyGuardrail(targetRegion, classification);
            expect(result.allowed).toBe(false);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Guardrails always allow compliant regions for any classification.
     * Validates: Requirements 13.1, 13.4
     */
    it('always allows compliant primary regions for any classification', () => {
      fc.assert(
        fc.property(compliantRegionArb, validClassificationArb, (targetRegion, classification) => {
          const result = checkResidencyGuardrail(targetRegion, classification);
          expect(result.allowed).toBe(true);
        }),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Guardrails block non-compliant backup regions even for public data.
     * Validates: Requirement 13.4
     */
    it('blocks non-compliant regions for public data', () => {
      fc.assert(
        fc.property(nonCompliantRegionArb, (targetRegion) => {
          const result = checkResidencyGuardrail(targetRegion, 'public');
          expect(result.allowed).toBe(false);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });
});
