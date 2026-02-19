/**
 * Property-based tests for session management (logout and logout-all).
 *
 * **Property 12: Logout Invalidates Current Session**
 * For any logout operation, the current session's access token and refresh token
 * SHALL be invalidated and cannot be used for subsequent requests.
 *
 * **Property 13: Logout-All Invalidates All Sessions**
 * For any logout-all operation, ALL refresh tokens for that user SHALL be
 * invalidated, regardless of which device they were issued to.
 *
 * **Validates: Requirements 6.1, 6.2**
 *
 * Tag: Feature: core-auth, Property 12: Logout Invalidates Current Session
 * Tag: Feature: core-auth, Property 13: Logout-All Invalidates All Sessions
 *
 * @module repositories/sessionRepository.property.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { uuidArb, deviceFingerprintArb, hexTokenArb } from '../test/arbitraries.js';

// ─── In-Memory Store & Mock ──────────────────────────────────────────────────

/**
 * In-memory store that simulates the PostgreSQL refresh_tokens table.
 * Each row mirrors the database schema with snake_case column names.
 */
interface StoredRefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  device_fingerprint: string;
  expires_at: Date;
  created_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

let store: StoredRefreshTokenRow[];
let idCounter: number;

function resetStore(): void {
  store = [];
  idCounter = 0;
}

/**
 * Mock implementation of the `query` function from `../utils/db.js`.
 *
 * Supports the SQL operations used by sessionRepository:
 * - INSERT INTO refresh_tokens: creates a new token row
 * - SELECT ... WHERE token_hash = $1: finds token by hash
 * - SELECT ... WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW(): finds active tokens
 * - UPDATE ... WHERE id = $1 AND revoked_at IS NULL: revokes a single token
 * - UPDATE ... WHERE user_id = $1 AND revoked_at IS NULL: revokes all tokens for a user
 */
function mockQuery(text: string, params?: unknown[]) {
  const sql = text.replace(/\s+/g, ' ').trim().toUpperCase();

  // INSERT INTO refresh_tokens
  if (sql.startsWith('INSERT INTO REFRESH_TOKENS')) {
    const userId = String(params?.[0] ?? '');
    const tokenHash = String(params?.[1] ?? '');
    const deviceFingerprint = String(params?.[2] ?? '');
    const expiresAt = new Date(String(params?.[3] ?? ''));

    const now = new Date();
    idCounter += 1;
    const row: StoredRefreshTokenRow = {
      id: `00000000-0000-0000-0000-${String(idCounter).padStart(12, '0')}`,
      user_id: userId,
      token_hash: tokenHash,
      device_fingerprint: deviceFingerprint,
      expires_at: expiresAt,
      created_at: now,
      revoked_at: null,
      revoked_reason: null,
    };
    store.push(row);
    return Promise.resolve({ rows: [row], rowCount: 1 });
  }

  // SELECT ... WHERE token_hash = $1
  if (sql.startsWith('SELECT') && sql.includes('TOKEN_HASH = $1')) {
    const tokenHash = String(params?.[0] ?? '');
    const rows = store.filter((r) => r.token_hash === tokenHash);
    return Promise.resolve({ rows, rowCount: rows.length });
  }

  // SELECT ... WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
  if (
    sql.startsWith('SELECT') &&
    sql.includes('USER_ID = $1') &&
    sql.includes('REVOKED_AT IS NULL')
  ) {
    const userId = String(params?.[0] ?? '');
    const now = new Date();
    const rows = store.filter(
      (r) => r.user_id === userId && r.revoked_at === null && r.expires_at > now,
    );
    return Promise.resolve({ rows, rowCount: rows.length });
  }

  // UPDATE ... SET revoked_at = NOW() ... WHERE id = $1 AND revoked_at IS NULL
  if (
    sql.startsWith('UPDATE') &&
    sql.includes('WHERE ID = $1') &&
    sql.includes('REVOKED_AT IS NULL')
  ) {
    const tokenId = String(params?.[0] ?? '');
    const reason = String(params?.[1] ?? '');
    const now = new Date();
    let count = 0;
    for (const row of store) {
      if (row.id === tokenId && row.revoked_at === null) {
        row.revoked_at = now;
        row.revoked_reason = reason;
        count += 1;
      }
    }
    return Promise.resolve({ rows: [], rowCount: count });
  }

  // UPDATE ... SET revoked_at = NOW() ... WHERE user_id = $1 AND revoked_at IS NULL
  if (
    sql.startsWith('UPDATE') &&
    sql.includes('WHERE USER_ID = $1') &&
    sql.includes('REVOKED_AT IS NULL')
  ) {
    const userId = String(params?.[0] ?? '');
    const reason = String(params?.[1] ?? '');
    const now = new Date();
    let count = 0;
    for (const row of store) {
      if (row.user_id === userId && row.revoked_at === null) {
        row.revoked_at = now;
        row.revoked_reason = reason;
        count += 1;
      }
    }
    return Promise.resolve({ rows: [], rowCount: count });
  }

  return Promise.resolve({ rows: [], rowCount: 0 });
}

// Wire up the mock before importing the module under test
vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(args[0] as string, args[1] as unknown[]),
}));

// Dynamic import so the mock is in place before the module resolves `query`
const { createToken, findByTokenHash, revokeToken, revokeAllForUser, findActiveByUserId } =
  await import('./sessionRepository.js');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 12: Logout Invalidates Current Session', () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * For any created refresh token, revoking it (simulating logout) SHALL
   * result in the token having a non-null revokedAt timestamp when looked
   * up by its token hash.
   */
  it('should invalidate a token after revokeToken is called', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        hexTokenArb,
        deviceFingerprintArb,
        async (userId, tokenHash, deviceFingerprint) => {
          resetStore();

          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
          const token = await createToken(userId, tokenHash, deviceFingerprint, expiresAt);

          // Before revocation: token should not be revoked
          const beforeRevoke = await findByTokenHash(tokenHash);
          expect(beforeRevoke).not.toBeNull();
          expect(beforeRevoke!.revokedAt).toBeNull();

          // Revoke the token (simulating logout)
          await revokeToken(token.id, 'logout');

          // After revocation: token should be revoked
          const afterRevoke = await findByTokenHash(tokenHash);
          expect(afterRevoke).not.toBeNull();
          expect(afterRevoke!.revokedAt).not.toBeNull();
          expect(afterRevoke!.revokedReason).toBe('logout');
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * For any revoked token, it SHALL no longer appear in the active tokens
   * list for that user (findActiveByUserId excludes revoked tokens).
   */
  it('should exclude revoked token from active tokens list', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        hexTokenArb,
        deviceFingerprintArb,
        async (userId, tokenHash, deviceFingerprint) => {
          resetStore();

          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          const token = await createToken(userId, tokenHash, deviceFingerprint, expiresAt);

          // Before revocation: token should be in active list
          const activeBefore = await findActiveByUserId(userId);
          expect(activeBefore.some((t) => t.id === token.id)).toBe(true);

          // Revoke the token
          await revokeToken(token.id, 'logout');

          // After revocation: token should NOT be in active list
          const activeAfter = await findActiveByUserId(userId);
          expect(activeAfter.some((t) => t.id === token.id)).toBe(false);
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * Revoking a token SHALL be idempotent — calling revokeToken on an
   * already-revoked token should not change its revokedAt or revokedReason.
   */
  it('should be idempotent when revoking an already-revoked token', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        hexTokenArb,
        deviceFingerprintArb,
        async (userId, tokenHash, deviceFingerprint) => {
          resetStore();

          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          const token = await createToken(userId, tokenHash, deviceFingerprint, expiresAt);

          // First revocation
          await revokeToken(token.id, 'logout');
          const afterFirst = await findByTokenHash(tokenHash);
          const firstRevokedAt = afterFirst!.revokedAt;
          const firstReason = afterFirst!.revokedReason;

          // Second revocation attempt (should be no-op due to WHERE revoked_at IS NULL)
          await revokeToken(token.id, 'different_reason');
          const afterSecond = await findByTokenHash(tokenHash);

          // revokedAt and reason should remain unchanged
          expect(afterSecond!.revokedAt).toEqual(firstRevokedAt);
          expect(afterSecond!.revokedReason).toBe(firstReason);
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });
});

describe('Property 13: Logout-All Invalidates All Sessions', () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * Arbitrary that generates a list of 2–5 distinct device fingerprints
   * for simulating multiple sessions across different devices.
   */
  const multiDeviceArb = fc
    .array(deviceFingerprintArb, { minLength: 2, maxLength: 5 })
    .filter((arr) => new Set(arr).size === arr.length);

  /**
   * **Validates: Requirements 6.2**
   *
   * For any user with multiple active sessions across different devices,
   * calling revokeAllForUser SHALL revoke ALL of them — every token's
   * revokedAt must be non-null afterwards.
   */
  it('should invalidate all tokens for a user across all devices', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        multiDeviceArb,
        fc.array(hexTokenArb, { minLength: 2, maxLength: 5 }),
        async (userId, fingerprints, tokenHashes) => {
          resetStore();

          // Use the minimum length of both arrays to create tokens
          const count = Math.min(fingerprints.length, tokenHashes.length);
          const uniqueHashes = [...new Set(tokenHashes.slice(0, count))];
          if (uniqueHashes.length < 2) return; // Need at least 2 distinct tokens

          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

          // Create tokens across different devices
          const createdTokens = [];
          for (let i = 0; i < uniqueHashes.length; i++) {
            const token = await createToken(
              userId,
              uniqueHashes[i]!,
              fingerprints[i % fingerprints.length]!,
              expiresAt,
            );
            createdTokens.push(token);
          }

          // Verify all tokens are active before logout-all
          const activeBefore = await findActiveByUserId(userId);
          expect(activeBefore.length).toBe(uniqueHashes.length);

          // Logout-all: revoke all tokens for the user
          await revokeAllForUser(userId, 'logout_all');

          // After logout-all: no active tokens should remain
          const activeAfter = await findActiveByUserId(userId);
          expect(activeAfter.length).toBe(0);

          // Verify each token individually has revokedAt set
          for (const hash of uniqueHashes) {
            const token = await findByTokenHash(hash);
            expect(token).not.toBeNull();
            expect(token!.revokedAt).not.toBeNull();
            expect(token!.revokedReason).toBe('logout_all');
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
   * **Validates: Requirements 6.2**
   *
   * Revoking all tokens for one user SHALL NOT affect tokens belonging
   * to a different user.
   */
  it('should not affect tokens of other users', async () => {
    const distinctUserPairArb = fc.tuple(uuidArb, uuidArb).filter(([a, b]) => a !== b);

    await fc.assert(
      fc.asyncProperty(
        distinctUserPairArb,
        hexTokenArb,
        hexTokenArb,
        deviceFingerprintArb,
        async ([userA, userB], tokenHashA, tokenHashB, fingerprint) => {
          // Ensure distinct token hashes
          if (tokenHashA === tokenHashB) return;
          resetStore();

          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

          // Create a token for each user
          await createToken(userA, tokenHashA, fingerprint, expiresAt);
          await createToken(userB, tokenHashB, fingerprint, expiresAt);

          // Revoke all tokens for user A
          await revokeAllForUser(userA, 'logout_all');

          // User A's token should be revoked
          const tokenA = await findByTokenHash(tokenHashA);
          expect(tokenA!.revokedAt).not.toBeNull();

          // User B's token should still be active
          const tokenB = await findByTokenHash(tokenHashB);
          expect(tokenB!.revokedAt).toBeNull();

          // User B should still have active tokens
          const activeBTokens = await findActiveByUserId(userB);
          expect(activeBTokens.length).toBe(1);
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 6.2**
   *
   * Calling revokeAllForUser when the user has no active tokens
   * SHALL succeed without error (no-op).
   */
  it('should handle logout-all gracefully when user has no tokens', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, async (userId) => {
        resetStore();

        // No tokens created — revokeAllForUser should not throw
        await expect(revokeAllForUser(userId, 'logout_all')).resolves.toBeUndefined();

        // Active tokens list should be empty
        const active = await findActiveByUserId(userId);
        expect(active.length).toBe(0);
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });
});
