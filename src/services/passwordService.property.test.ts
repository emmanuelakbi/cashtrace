/**
 * Property-based tests for password hashing round-trip.
 *
 * **Property 3: Password Hashing Round-Trip**
 * For any valid password string, hashing it with bcrypt (cost factor 12) and
 * then verifying the original password against the hash SHALL return true,
 * AND verifying any different password against the hash SHALL return false.
 *
 * **Validates: Requirements 1.4, 2.1**
 *
 * Tag: Feature: core-auth, Property 3: Password Hashing Round-Trip
 *
 * NOTE: bcrypt with cost factor 12 is intentionally slow (~250ms per hash).
 * We use a reduced numRuns (15) to keep test execution time reasonable
 * while still providing meaningful property coverage. At 15 runs, the test
 * exercises ~15 random passwords which is sufficient to catch systematic
 * issues in the hash/verify round-trip.
 *
 * @module services/passwordService.property.test
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { hashPassword, verifyPassword } from './passwordService.js';
import { validPasswordArb } from '../test/arbitraries.js';

describe('Property 3: Password Hashing Round-Trip', () => {
  /**
   * **Validates: Requirements 1.4, 2.1**
   *
   * For any valid password, hashing it and then verifying the original
   * password against the hash SHALL return true.
   */
  it('should verify the original password against its own hash', async () => {
    await fc.assert(
      fc.asyncProperty(validPasswordArb, async (password) => {
        const hash = await hashPassword(password);
        const result = await verifyPassword(password, hash);
        expect(result).toBe(true);
      }),
      {
        numRuns: 15,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 1.4, 2.1**
   *
   * For any two distinct valid passwords, hashing the first and then
   * verifying the second against that hash SHALL return false.
   */
  it('should reject a different password against the hash', async () => {
    await fc.assert(
      fc.asyncProperty(validPasswordArb, validPasswordArb, async (password, otherPassword) => {
        // Only test when the two passwords are actually different
        fc.pre(password !== otherPassword);

        const hash = await hashPassword(password);
        const result = await verifyPassword(otherPassword, hash);
        expect(result).toBe(false);
      }),
      {
        numRuns: 15,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * For any valid password, hashing it twice SHALL produce different hashes
   * (because bcrypt generates a unique salt each time), but both hashes
   * SHALL verify against the original password.
   */
  it(
    'should produce unique hashes for the same password (unique salts)',
    { timeout: 60000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(validPasswordArb, async (password) => {
          const hash1 = await hashPassword(password);
          const hash2 = await hashPassword(password);

          // Hashes should be different due to unique salts
          expect(hash1).not.toBe(hash2);

          // Both hashes should verify against the original password
          const result1 = await verifyPassword(password, hash1);
          const result2 = await verifyPassword(password, hash2);
          expect(result1).toBe(true);
          expect(result2).toBe(true);
        }),
        {
          numRuns: 5,
          verbose: true,
        },
      );
    },
  );
});
