/**
 * Property-based tests for Rollback Capability
 *
 * **Property 5: Rollback Capability**
 * Validates that rollback request validation, time-limit checks, and
 * eligibility determination behave correctly across all generated inputs.
 *
 * **Validates: Requirement 2.4**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  checkRollbackEligibility,
  checkRollbackTimeLimit,
  MAX_ROLLBACK_SECONDS,
  ROLLBACK_ENVIRONMENTS,
  validateRollbackRequest,
} from './rollback.js';
import { makeDeployment, makeRollbackRequest } from './testHelpers.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid rollback environment. */
const validEnvironmentArb = fc.constantFrom(...ROLLBACK_ENVIRONMENTS);

/** Generate an environment NOT in ROLLBACK_ENVIRONMENTS. */
const invalidEnvironmentArb = fc
  .string({ minLength: 1 })
  .filter((s) => !ROLLBACK_ENVIRONMENTS.includes(s as (typeof ROLLBACK_ENVIRONMENTS)[number]));

/** Generate a non-empty trimmed string (for initiatedBy / targetVersion). */
const nonEmptyStringArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

/** Generate a valid timeoutSeconds in (0, MAX_ROLLBACK_SECONDS]. */
const validTimeoutArb = fc.integer({ min: 1, max: MAX_ROLLBACK_SECONDS });

/** Generate a base Date for time-limit tests. */
const baseDateArb = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2030-01-01T00:00:00Z'),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 5: Rollback Capability', () => {
  /**
   * **Validates: Requirement 2.4**
   *
   * Any rollback request with a valid environment, non-empty initiatedBy,
   * optional non-empty targetVersion, and optional timeoutSeconds in
   * (0, MAX_ROLLBACK_SECONDS] must pass validation.
   */
  it('valid rollback requests always pass validation', () => {
    fc.assert(
      fc.property(
        validEnvironmentArb,
        nonEmptyStringArb,
        fc.option(nonEmptyStringArb, { nil: undefined }),
        fc.option(validTimeoutArb, { nil: undefined }),
        (environment, initiatedBy, targetVersion, timeoutSeconds) => {
          const request = makeRollbackRequest({
            environment,
            initiatedBy,
            targetVersion,
            timeoutSeconds,
          });
          const result = validateRollbackRequest(request);

          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 2.4**
   *
   * Any rollback request with an environment NOT in ROLLBACK_ENVIRONMENTS
   * must fail validation with an error mentioning the environment.
   */
  it('invalid environments always fail validation', () => {
    fc.assert(
      fc.property(invalidEnvironmentArb, (environment) => {
        const request = makeRollbackRequest({ environment });
        const result = validateRollbackRequest(request);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => e.toLowerCase().includes('environment'))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 2.4**
   *
   * When elapsed time between startedAt and completedAt is ≤ MAX_ROLLBACK_SECONDS,
   * the time-limit check must report withinLimit=true.
   */
  it('rollback within time limit always reports withinLimit=true', () => {
    fc.assert(
      fc.property(
        baseDateArb,
        fc.integer({ min: 0, max: MAX_ROLLBACK_SECONDS }),
        (startedAt, elapsedSeconds) => {
          const completedAt = new Date(startedAt.getTime() + elapsedSeconds * 1000);
          const result = checkRollbackTimeLimit(startedAt, completedAt);

          expect(result.withinLimit).toBe(true);
          expect(result.limitSeconds).toBe(MAX_ROLLBACK_SECONDS);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 2.4**
   *
   * When elapsed time between startedAt and completedAt exceeds MAX_ROLLBACK_SECONDS,
   * the time-limit check must report withinLimit=false.
   */
  it('rollback exceeding time limit always reports withinLimit=false', () => {
    fc.assert(
      fc.property(
        baseDateArb,
        fc.integer({ min: MAX_ROLLBACK_SECONDS + 1, max: MAX_ROLLBACK_SECONDS * 10 }),
        (startedAt, elapsedSeconds) => {
          const completedAt = new Date(startedAt.getTime() + elapsedSeconds * 1000);
          const result = checkRollbackTimeLimit(startedAt, completedAt);

          expect(result.withinLimit).toBe(false);
          expect(result.elapsedSeconds).toBeGreaterThan(MAX_ROLLBACK_SECONDS);
          expect(result.limitSeconds).toBe(MAX_ROLLBACK_SECONDS);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 2.4**
   *
   * A deployment with status 'succeeded' or 'failed', no rollbackOf set,
   * and a previous deployment provided must be eligible for rollback
   * with no reasons.
   */
  it('eligible deployments have no reasons', () => {
    fc.assert(
      fc.property(fc.constantFrom('succeeded' as const, 'failed' as const), (status) => {
        const current = makeDeployment({ status, rollbackOf: undefined });
        const previous = makeDeployment();
        const result = checkRollbackEligibility(current, previous);

        expect(result.eligible).toBe(true);
        expect(result.reasons).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 2.4**
   *
   * A deployment that violates at least one eligibility rule must be
   * ineligible with at least one reason. Violations include:
   * - status is 'pending', 'in_progress', or 'rolled_back'
   * - rollbackOf is set (already a rollback)
   * - no previous deployment provided
   */
  it('ineligible deployments always have reasons', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'ineligible_status' as const,
          'already_rollback' as const,
          'no_previous' as const,
        ),
        (violation) => {
          let current = makeDeployment({ status: 'succeeded', rollbackOf: undefined });
          let previous: ReturnType<typeof makeDeployment> | undefined = makeDeployment();

          switch (violation) {
            case 'ineligible_status':
              current = makeDeployment({
                status: fc.sample(
                  fc.constantFrom(
                    'pending' as const,
                    'in_progress' as const,
                    'rolled_back' as const,
                  ),
                  1,
                )[0],
                rollbackOf: undefined,
              });
              break;
            case 'already_rollback':
              current = makeDeployment({
                status: 'succeeded',
                rollbackOf: 'deploy-abc-123',
              });
              break;
            case 'no_previous':
              previous = undefined;
              break;
          }

          const result = checkRollbackEligibility(current, previous);

          expect(result.eligible).toBe(false);
          expect(result.reasons.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
