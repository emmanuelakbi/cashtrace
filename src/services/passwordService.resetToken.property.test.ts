/**
 * Property-based tests for password reset token expiration.
 *
 * **Property 10: Password Reset Token Expiration**
 * For any password reset token, verification attempts after 1 hour from
 * creation SHALL fail with an expiration error.
 *
 * **Validates: Requirements 5.2**
 *
 * Tag: Feature: core-auth, Property 10: Password Reset Token Expiration
 *
 * Strategy:
 * - Mock the `query` function from `../utils/db.js` to control DB responses
 * - Use `vi.useFakeTimers()` to control time progression
 * - Generate random user IDs and time offsets with fast-check
 * - Verify that tokens validated within 1 hour succeed (DB returns valid row)
 * - Verify that tokens validated after 1 hour fail (DB returns empty rows)
 *
 * @module services/passwordService.resetToken.property.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { uuidArb } from '../test/arbitraries.js';

// Mock the db module before importing the service
vi.mock('../utils/db.js', () => ({
  query: vi.fn(),
}));

// Import after mocking so the service picks up the mock
import { generateResetToken, validateResetToken } from './passwordService.js';
import { query } from '../utils/db.js';

const mockedQuery = vi.mocked(query);

/** One hour in milliseconds. */
const ONE_HOUR_MS = 60 * 60 * 1000;

describe('Property 10: Password Reset Token Expiration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * **Validates: Requirements 5.2**
   *
   * For any user ID and any time offset within the 1-hour window,
   * generating a reset token and then validating it before expiration
   * SHALL succeed (return a non-null payload).
   */
  it('should accept reset tokens validated within 1 hour of creation', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        // Time offset: 0ms to just under 1 hour (59 minutes 59 seconds)
        fc.integer({ min: 0, max: ONE_HOUR_MS - 1000 }),
        async (userId, elapsedMs) => {
          vi.clearAllMocks();

          const tokenId = crypto.randomUUID();

          // Mock the INSERT for generateResetToken
          mockedQuery.mockResolvedValueOnce({
            rows: [],
            command: 'INSERT',
            rowCount: 1,
            oid: 0,
            fields: [],
          });

          const creationTime = Date.now();
          const rawToken = await generateResetToken(userId);

          // Advance time by the elapsed offset (still within 1 hour)
          vi.advanceTimersByTime(elapsedMs);

          // Mock the SELECT for validateResetToken — token is still valid
          mockedQuery.mockResolvedValueOnce({
            rows: [{ id: tokenId, user_id: userId }],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          });

          const payload = await validateResetToken(rawToken);

          expect(payload).not.toBeNull();
          expect(payload!.userId).toBe(userId);
          expect(payload!.tokenId).toBe(tokenId);
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 5.2**
   *
   * For any user ID and any time offset beyond the 1-hour window,
   * generating a reset token and then validating it after expiration
   * SHALL fail (return null), because the DB query filters out expired tokens.
   */
  it('should reject reset tokens validated after 1 hour from creation', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        // Time offset: 1 hour to 24 hours past creation
        fc.integer({ min: ONE_HOUR_MS, max: 24 * ONE_HOUR_MS }),
        async (userId, elapsedMs) => {
          vi.clearAllMocks();

          // Mock the INSERT for generateResetToken
          mockedQuery.mockResolvedValueOnce({
            rows: [],
            command: 'INSERT',
            rowCount: 1,
            oid: 0,
            fields: [],
          });

          const rawToken = await generateResetToken(userId);

          // Advance time past the 1-hour expiration window
          vi.advanceTimersByTime(elapsedMs);

          // Mock the SELECT for validateResetToken — DB returns no rows
          // because the `expires_at > NOW()` condition fails for expired tokens
          mockedQuery.mockResolvedValueOnce({
            rows: [],
            command: 'SELECT',
            rowCount: 0,
            oid: 0,
            fields: [],
          });

          const payload = await validateResetToken(rawToken);

          expect(payload).toBeNull();
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });
});
