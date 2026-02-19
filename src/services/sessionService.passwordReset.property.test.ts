/**
 * Property-based tests for password reset session invalidation.
 *
 * **Property 11: Password Reset Invalidates Sessions**
 * For any successful password reset operation, ALL existing refresh tokens
 * for that user SHALL be invalidated.
 *
 * **Validates: Requirements 5.5**
 *
 * Tag: Feature: core-auth, Property 11: Password Reset Invalidates Sessions
 *
 * @module services/sessionService.passwordReset.property.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { uuidArb, deviceFingerprintArb } from '../test/arbitraries.js';

// ─── In-Memory Store ─────────────────────────────────────────────────────────

/**
 * In-memory row representing a refresh_tokens record (PostgreSQL schema).
 */
interface StoredRefreshTokenRow {
  id: string;
  user_id: string;
  device_fingerprint: string;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

let store: StoredRefreshTokenRow[];

function resetStore(): void {
  store = [];
}

/**
 * Insert a token row into the in-memory store.
 */
function insertToken(row: StoredRefreshTokenRow): void {
  store.push(row);
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

/**
 * Mock for `../utils/db.js` — the `query` function.
 * Not directly used by `invalidateSessionsForPasswordReset`, but required
 * for the module to load (used by `findTokenById` and other helpers).
 */
vi.mock('../utils/db.js', () => ({
  query: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
}));

/**
 * Mock for `../repositories/sessionRepository.js`.
 * `invalidateSessionsForPasswordReset` delegates to `revokeAllForUser(userId, 'password_reset')`.
 */
const mockRevokeAllForUser = vi.fn((userId: string, reason: string) => {
  const now = new Date();
  for (const row of store) {
    if (row.user_id === userId && row.revoked_at === null) {
      row.revoked_at = now;
      row.revoked_reason = reason;
    }
  }
  return Promise.resolve();
});

vi.mock('../repositories/sessionRepository.js', () => ({
  revokeAllForUser: (...args: unknown[]) =>
    mockRevokeAllForUser(args[0] as string, args[1] as string),
  findByTokenHash: vi.fn(),
  findActiveByUserId: vi.fn(),
  revokeToken: vi.fn(),
  createToken: vi.fn(),
}));

/**
 * Mock for `./tokenService.js`.
 * sessionService imports `generateTokenPair` and `sha256` from tokenService.
 * These are not used by `invalidateSessionsForPasswordReset` but must be
 * present for the module to load.
 */
vi.mock('./tokenService.js', () => ({
  generateTokenPair: vi.fn(),
  sha256: vi.fn(),
}));

// ─── Import Under Test ──────────────────────────────────────────────────────

const { invalidateSessionsForPasswordReset } = await import('./sessionService.js');

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Arbitrary for the number of sessions a user may have (0, 1, or many).
 * Covers the edge case of zero sessions and scales up to a reasonable count.
 */
const sessionCountArb = fc.integer({ min: 0, max: 10 });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 11: Password Reset Invalidates Sessions', () => {
  beforeEach(() => {
    resetStore();
    mockRevokeAllForUser.mockClear();
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * For any user with any number of active sessions (0, 1, or many),
   * calling `invalidateSessionsForPasswordReset(userId)` SHALL revoke
   * ALL refresh tokens for that user with reason 'password_reset'.
   */
  it('should invalidate ALL refresh tokens for the user with reason password_reset', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        sessionCountArb,
        fc.array(deviceFingerprintArb, { minLength: 0, maxLength: 10 }),
        async (userId, sessionCount, fingerprints) => {
          resetStore();
          mockRevokeAllForUser.mockClear();

          // Clamp fingerprints array to sessionCount
          const count = Math.min(sessionCount, fingerprints.length);

          // Seed the store with `count` active sessions for this user
          for (let i = 0; i < count; i++) {
            insertToken({
              id: `session-${userId}-${i}`,
              user_id: userId,
              device_fingerprint: fingerprints[i]!,
              revoked_at: null,
              revoked_reason: null,
            });
          }

          // Act: perform password reset session invalidation
          await invalidateSessionsForPasswordReset(userId);

          // Assert: revokeAllForUser was called exactly once with correct args
          expect(mockRevokeAllForUser).toHaveBeenCalledOnce();
          expect(mockRevokeAllForUser).toHaveBeenCalledWith(userId, 'password_reset');

          // Assert: ALL tokens for this user are now revoked
          const userTokens = store.filter((r) => r.user_id === userId);
          for (const token of userTokens) {
            expect(token.revoked_at).not.toBeNull();
            expect(token.revoked_reason).toBe('password_reset');
          }
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * For any password reset operation on user A, tokens belonging to
   * OTHER users SHALL NOT be affected.
   */
  it('should NOT affect tokens belonging to other users', async () => {
    // Generate two distinct user IDs
    const distinctUsersArb = fc.tuple(uuidArb, uuidArb).filter(([a, b]) => a !== b);

    await fc.assert(
      fc.asyncProperty(
        distinctUsersArb,
        sessionCountArb,
        sessionCountArb,
        fc.array(deviceFingerprintArb, { minLength: 1, maxLength: 10 }),
        fc.array(deviceFingerprintArb, { minLength: 1, maxLength: 10 }),
        async (
          [targetUserId, otherUserId],
          targetCount,
          otherCount,
          targetFingerprints,
          otherFingerprints,
        ) => {
          resetStore();
          mockRevokeAllForUser.mockClear();

          // Clamp counts to available fingerprints
          const tCount = Math.min(targetCount, targetFingerprints.length);
          const oCount = Math.min(otherCount, otherFingerprints.length);

          // Seed sessions for the target user
          for (let i = 0; i < tCount; i++) {
            insertToken({
              id: `target-${targetUserId}-${i}`,
              user_id: targetUserId,
              device_fingerprint: targetFingerprints[i]!,
              revoked_at: null,
              revoked_reason: null,
            });
          }

          // Seed sessions for the other user
          for (let i = 0; i < oCount; i++) {
            insertToken({
              id: `other-${otherUserId}-${i}`,
              user_id: otherUserId,
              device_fingerprint: otherFingerprints[i]!,
              revoked_at: null,
              revoked_reason: null,
            });
          }

          // Act: invalidate sessions for the TARGET user only
          await invalidateSessionsForPasswordReset(targetUserId);

          // Assert: revokeAllForUser was called with the target user ID
          expect(mockRevokeAllForUser).toHaveBeenCalledOnce();
          expect(mockRevokeAllForUser).toHaveBeenCalledWith(targetUserId, 'password_reset');

          // Assert: other user's tokens are untouched
          const otherTokens = store.filter((r) => r.user_id === otherUserId);
          for (const token of otherTokens) {
            expect(token.revoked_at).toBeNull();
            expect(token.revoked_reason).toBeNull();
          }
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * The function works correctly regardless of how many sessions the
   * user has — including the edge case of zero sessions.
   */
  it('should work correctly with zero, one, and many sessions', async () => {
    // Explicitly test 0, 1, and a larger count
    const edgeCaseCountArb = fc.oneof(
      fc.constant(0),
      fc.constant(1),
      fc.integer({ min: 2, max: 10 }),
    );

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        edgeCaseCountArb,
        fc.array(deviceFingerprintArb, { minLength: 0, maxLength: 10 }),
        async (userId, sessionCount, fingerprints) => {
          resetStore();
          mockRevokeAllForUser.mockClear();

          const count = Math.min(sessionCount, fingerprints.length);

          // Seed the store
          for (let i = 0; i < count; i++) {
            insertToken({
              id: `edge-${userId}-${i}`,
              user_id: userId,
              device_fingerprint: fingerprints[i]!,
              revoked_at: null,
              revoked_reason: null,
            });
          }

          // Act
          await invalidateSessionsForPasswordReset(userId);

          // Assert: function completes without error and calls revokeAllForUser
          expect(mockRevokeAllForUser).toHaveBeenCalledOnce();
          expect(mockRevokeAllForUser).toHaveBeenCalledWith(userId, 'password_reset');

          // Assert: all user tokens are revoked (if any existed)
          const userTokens = store.filter((r) => r.user_id === userId);
          expect(userTokens).toHaveLength(count);
          for (const token of userTokens) {
            expect(token.revoked_at).not.toBeNull();
            expect(token.revoked_reason).toBe('password_reset');
          }
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });
});
