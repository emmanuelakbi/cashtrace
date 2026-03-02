/**
 * Property-based tests for secret management module.
 *
 * Validates Property 6: Secret Isolation — for any secret, it SHALL only
 * be accessible to the environment it's configured for.
 *
 * Validates: Requirements 6.1, 6.4
 *
 * @module deployment/secretManagement.property.test
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  checkSecretIsolation,
  isSecretAccessAuthorized,
  SECRET_ENVIRONMENTS,
  SECRET_NAME_PATTERN,
  validateSecretConfig,
  validateSecretName,
} from './secretManagement.js';
import { makeSecretAccessLog } from './testHelpers.js';

const NUM_RUNS = 200;

// ─── Arbitrary Generators ────────────────────────────────────────────────────

/** Generates a valid secret name matching SECRET_NAME_PATTERN. */
const validSecretNameArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'), {
      minLength: 1,
      maxLength: 1,
    }),
    fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/-'),
      { minLength: 2, maxLength: 50 },
    ),
  )
  .map(([first, rest]) => first + rest);

/** Generates an invalid secret name that does NOT match SECRET_NAME_PATTERN. */
const invalidSecretNameArb = fc.oneof(
  // Empty string
  fc.constant(''),
  // Single character (too short — min 3 total)
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), {
    minLength: 1,
    maxLength: 1,
  }),
  // Two characters (still too short)
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), {
    minLength: 2,
    maxLength: 2,
  }),
  // Starts with a digit
  fc
    .tuple(
      fc.stringOf(fc.constantFrom(...'0123456789'), { minLength: 1, maxLength: 1 }),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_/-'), {
        minLength: 2,
        maxLength: 20,
      }),
    )
    .map(([d, rest]) => d + rest),
  // Contains invalid characters
  fc
    .tuple(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), {
        minLength: 1,
        maxLength: 1,
      }),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), {
        minLength: 2,
        maxLength: 10,
      }),
      fc.constantFrom(' ', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '+', '='),
    )
    .map(([first, mid, bad]) => first + mid + bad),
);

/** Generates a valid environment from SECRET_ENVIRONMENTS. */
const validEnvironmentArb = fc.constantFrom(...SECRET_ENVIRONMENTS);

/** Generates an invalid environment string not in SECRET_ENVIRONMENTS. */
const invalidEnvironmentArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !(SECRET_ENVIRONMENTS as readonly string[]).includes(s));

/** Generates a valid rotation days value (1–365). */
const validRotationDaysArb = fc.integer({ min: 1, max: 365 });

/** Generates a non-empty principal string. */
const principalArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('secretManagement property tests', () => {
  /**
   * Property: Secret names matching SECRET_NAME_PATTERN always validate as true.
   *
   * For any string that matches the regex ^[a-zA-Z][a-zA-Z0-9_/-]{2,127}$,
   * validateSecretName must return true.
   *
   * Validates: Requirement 6.1 (secret naming conventions)
   */
  describe('validateSecretName', () => {
    it('should return true for any name matching SECRET_NAME_PATTERN', () => {
      fc.assert(
        fc.property(validSecretNameArb, (name) => {
          expect(SECRET_NAME_PATTERN.test(name)).toBe(true);
          expect(validateSecretName(name)).toBe(true);
        }),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Secret names NOT matching SECRET_NAME_PATTERN always validate as false.
     *
     * For any string that does not match the pattern, validateSecretName must return false.
     *
     * Validates: Requirement 6.1 (reject invalid secret names)
     */
    it('should return false for any name not matching SECRET_NAME_PATTERN', () => {
      fc.assert(
        fc.property(invalidSecretNameArb, (name) => {
          expect(SECRET_NAME_PATTERN.test(name)).toBe(false);
          expect(validateSecretName(name)).toBe(false);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  /**
   * Property: Valid SecretConfig always passes validation.
   *
   * For any config with a valid name, valid environment, and rotationDays in [1, 365],
   * validateSecretConfig must return { valid: true, errors: [] }.
   *
   * Validates: Requirements 6.1, 6.4 (valid configuration acceptance)
   */
  describe('validateSecretConfig', () => {
    it('should pass validation for any valid config', () => {
      fc.assert(
        fc.property(
          validSecretNameArb,
          validEnvironmentArb,
          validRotationDaysArb,
          fc.boolean(),
          (name, environment, rotationDays, autoRotate) => {
            const result = validateSecretConfig({ name, environment, rotationDays, autoRotate });
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Invalid environment always fails validation.
     *
     * For any config with an environment not in SECRET_ENVIRONMENTS,
     * validateSecretConfig must return { valid: false } with an environment error.
     *
     * Validates: Requirement 6.4 (environment isolation enforcement)
     */
    it('should fail validation for any invalid environment', () => {
      fc.assert(
        fc.property(
          validSecretNameArb,
          invalidEnvironmentArb,
          validRotationDaysArb,
          fc.boolean(),
          (name, environment, rotationDays, autoRotate) => {
            const result = validateSecretConfig({ name, environment, rotationDays, autoRotate });
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors.some((e) => e.includes('environment'))).toBe(true);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  /**
   * Property: Secrets with unique name-per-environment are always isolated.
   *
   * For any set of secrets where each name appears in exactly one environment,
   * checkSecretIsolation must return { isolated: true, violations: [] }.
   *
   * Validates: Property 6 — Secret Isolation (Requirements 6.1, 6.4)
   */
  describe('checkSecretIsolation', () => {
    it('should report isolated when each secret name is in exactly one environment', () => {
      fc.assert(
        fc.property(
          fc.array(fc.tuple(validSecretNameArb, validEnvironmentArb), {
            minLength: 1,
            maxLength: 20,
          }),
          (pairs) => {
            // Deduplicate: keep only the first environment per name
            const seen = new Map<string, string>();
            const secrets: Array<{ name: string; environment: string }> = [];
            for (const [name, environment] of pairs) {
              if (!seen.has(name)) {
                seen.set(name, environment);
                secrets.push({ name, environment });
              }
            }

            const result = checkSecretIsolation(secrets);
            expect(result.isolated).toBe(true);
            expect(result.violations).toEqual([]);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Secrets sharing a name across multiple environments always have violations.
     *
     * For any secret name that appears in at least two distinct environments,
     * checkSecretIsolation must return { isolated: false } with violations.
     *
     * Validates: Property 6 — Secret Isolation (Requirements 6.1, 6.4)
     */
    it('should report violations when a secret name appears in multiple environments', () => {
      fc.assert(
        fc.property(
          validSecretNameArb,
          fc.shuffledSubarray([...SECRET_ENVIRONMENTS], { minLength: 2 }),
          (name, envs) => {
            const secrets = envs.map((environment) => ({ name, environment }));
            const result = checkSecretIsolation(secrets);
            expect(result.isolated).toBe(false);
            expect(result.violations.length).toBeGreaterThan(0);
            expect(result.violations.some((v) => v.includes(name))).toBe(true);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  /**
   * Property: Authorized principals always return true from isSecretAccessAuthorized.
   *
   * For any access log where the principal is in the allowed list and success is true,
   * isSecretAccessAuthorized must return true.
   *
   * Validates: Requirement 6.4 (access authorization)
   */
  describe('isSecretAccessAuthorized', () => {
    it('should return true when principal is in allowed list and access succeeded', () => {
      fc.assert(
        fc.property(
          principalArb,
          fc.array(principalArb, { minLength: 0, maxLength: 10 }),
          (principal, extraPrincipals) => {
            const allowedPrincipals = [principal, ...extraPrincipals];
            const log = makeSecretAccessLog({ principal, success: true });
            expect(isSecretAccessAuthorized(log, allowedPrincipals)).toBe(true);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    /**
     * Property: Unauthorized principals always return false from isSecretAccessAuthorized.
     *
     * For any access log where the principal is NOT in the allowed list,
     * isSecretAccessAuthorized must return false regardless of success flag.
     *
     * Validates: Requirement 6.4 (access denial for unauthorized principals)
     */
    it('should return false when principal is not in allowed list', () => {
      fc.assert(
        fc.property(
          principalArb,
          fc.array(principalArb, { minLength: 1, maxLength: 10 }),
          fc.boolean(),
          (principal, allowedPrincipals, success) => {
            // Ensure the principal is NOT in the allowed list
            const filtered = allowedPrincipals.filter((p) => p !== principal);
            const log = makeSecretAccessLog({ principal, success });
            expect(isSecretAccessAuthorized(log, filtered)).toBe(false);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });
});
