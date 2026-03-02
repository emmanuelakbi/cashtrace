/**
 * Property-based tests for disaster recovery configuration validation.
 *
 * Validates Property 8: Backup Verification
 * > For any database backup, restore capability SHALL be verified weekly.
 * > Validates: Requirements 11.4
 *
 * @module deployment/disasterRecovery.property.test
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  BACKUP_VERIFICATION_INTERVAL_DAYS,
  TARGET_RPO_HOURS,
  TARGET_RTO_HOURS,
  checkBackupVerification,
  meetsRpo,
  meetsRto,
  validateDrConfig,
} from './disasterRecovery.js';
import type { DrConfig } from './disasterRecovery.js';

const NUM_RUNS = 200;

/**
 * Arbitrary that generates a non-empty string that is NOT 'af-south-1'
 * and not blank, for use as an invalid primary region.
 */
const invalidPrimaryRegionArb = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0 && s !== 'af-south-1');

/**
 * Arbitrary that generates a non-empty, non-blank secondary region
 * different from 'af-south-1'.
 */
const validSecondaryRegionArb = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0 && s !== 'af-south-1');

/** Arbitrary for RPO hours at or below the target (0, TARGET_RPO_HOURS]. */
const validRpoArb = fc.double({ min: 0, max: TARGET_RPO_HOURS, noNaN: true });

/** Arbitrary for RTO hours at or below the target (0, TARGET_RTO_HOURS]. */
const validRtoArb = fc.double({ min: 0, max: TARGET_RTO_HOURS, noNaN: true });

/**
 * Arbitrary that builds a fully valid DrConfig.
 *
 * - primaryRegion = 'af-south-1'
 * - secondaryRegion is non-empty and different from primary
 * - crossRegionReplication = true
 * - rpoHours <= TARGET_RPO_HOURS
 * - rtoHours <= TARGET_RTO_HOURS
 */
const validDrConfigArb: fc.Arbitrary<DrConfig> = fc.record({
  primaryRegion: fc.constant('af-south-1'),
  secondaryRegion: validSecondaryRegionArb,
  crossRegionReplication: fc.constant(true),
  rpoHours: validRpoArb,
  rtoHours: validRtoArb,
});

describe('disasterRecovery property tests', () => {
  /**
   * Property: Valid DR configs always pass validation.
   * Validates: Requirements 11.1–11.4
   */
  it('valid DR configs always pass validation', () => {
    fc.assert(
      fc.property(validDrConfigArb, (config) => {
        const result = validateDrConfig(config);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property: Invalid primaryRegion always fails validation.
   * Validates: Requirements 11.1 (Nigerian data residency — af-south-1)
   */
  it('invalid primaryRegion always fails validation', () => {
    fc.assert(
      fc.property(
        invalidPrimaryRegionArb,
        validSecondaryRegionArb,
        validRpoArb,
        validRtoArb,
        (primaryRegion, secondaryRegion, rpoHours, rtoHours) => {
          const config: DrConfig = {
            primaryRegion,
            secondaryRegion,
            crossRegionReplication: true,
            rpoHours,
            rtoHours,
          };
          const result = validateDrConfig(config);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
          expect(result.errors.some((e) => e.includes('primaryRegion'))).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property: RPO at or below TARGET_RPO_HOURS always meets RPO.
   * Validates: Requirements 11.3 (RPO compliance)
   */
  it('RPO at or below target always meets RPO', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: TARGET_RPO_HOURS, noNaN: true }), (rpoHours) => {
        expect(meetsRpo(rpoHours)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property: RPO above TARGET_RPO_HOURS never meets RPO.
   * Validates: Requirements 11.3 (RPO compliance)
   */
  it('RPO above target never meets RPO', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }).filter((v) => v > TARGET_RPO_HOURS),
        (rpoHours) => {
          expect(meetsRpo(rpoHours)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property: RTO at or below TARGET_RTO_HOURS always meets RTO.
   * Validates: Requirements 11.3 (RTO compliance)
   */
  it('RTO at or below target always meets RTO', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: TARGET_RTO_HOURS, noNaN: true }), (rtoHours) => {
        expect(meetsRto(rtoHours)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property: RTO above TARGET_RTO_HOURS never meets RTO.
   * Validates: Requirements 11.3 (RTO compliance)
   */
  it('RTO above target never meets RTO', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }).filter((v) => v > TARGET_RTO_HOURS),
        (rtoHours) => {
          expect(meetsRto(rtoHours)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property: Backup verified within 7 days never needs verification.
   * Validates: Requirements 11.4 (weekly backup verification)
   */
  it('backup verified within 7 days never needs verification', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: BACKUP_VERIFICATION_INTERVAL_DAYS - 1 }), (daysAgo) => {
        const now = new Date('2025-06-01T00:00:00Z');
        const lastVerification = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
        const result = checkBackupVerification(lastVerification, now);
        expect(result.verified).toBe(true);
        expect(result.daysSinceVerification).toBe(daysAgo);
        expect(result.needsVerification).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property: Backup verified 7+ days ago always needs verification.
   * Validates: Requirements 11.4 (weekly backup verification)
   */
  it('backup verified 7+ days ago always needs verification', () => {
    fc.assert(
      fc.property(fc.integer({ min: BACKUP_VERIFICATION_INTERVAL_DAYS, max: 365 }), (daysAgo) => {
        const now = new Date('2025-06-01T00:00:00Z');
        const lastVerification = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
        const result = checkBackupVerification(lastVerification, now);
        expect(result.verified).toBe(true);
        expect(result.daysSinceVerification).toBe(daysAgo);
        expect(result.needsVerification).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property: No last verification always needs verification.
   * Validates: Requirements 11.4 (weekly backup verification)
   */
  it('no last verification always needs verification', () => {
    fc.assert(
      fc.property(fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }), (now) => {
        const result = checkBackupVerification(undefined, now);
        expect(result.verified).toBe(false);
        expect(result.daysSinceVerification).toBe(Infinity);
        expect(result.needsVerification).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
