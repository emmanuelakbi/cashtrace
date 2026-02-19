/**
 * Property-based tests for device fingerprint security.
 *
 * **Property 9: Device Fingerprint Security**
 * For any refresh token, if it is used from a device with a different fingerprint
 * than the one it was issued to, the system SHALL invalidate ALL refresh tokens
 * for that user.
 *
 * **Validates: Requirements 4.6**
 *
 * Tag: Feature: core-auth, Property 9: Device Fingerprint Security
 *
 * @module services/sessionService.property.test
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
 * Mock for `../utils/db.js` — the `query` function used by
 * `findTokenById` inside sessionService to look up refresh tokens by ID.
 *
 * Supports: SELECT ... WHERE id = $1
 */
const mockQuery = vi.fn((text: string, params?: unknown[]) => {
  const sql = text.replace(/\s+/g, ' ').trim().toUpperCase();

  // SELECT ... WHERE id = $1  (used by findTokenById)
  if (sql.startsWith('SELECT') && sql.includes('WHERE ID = $1')) {
    const tokenId = String(params?.[0] ?? '');
    const rows = store.filter((r) => r.id === tokenId);
    return Promise.resolve({ rows, rowCount: rows.length });
  }

  return Promise.resolve({ rows: [], rowCount: 0 });
});

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(args[0] as string, args[1] as unknown[]),
}));

/**
 * Mock for `../repositories/sessionRepository.js`.
 * We only need `revokeAllForUser` — the function called on device mismatch.
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
  // Provide stubs for other exports that may be referenced
  findByTokenHash: vi.fn(),
  findActiveByUserId: vi.fn(),
  revokeToken: vi.fn(),
  createToken: vi.fn(),
}));

/**
 * Mock for `./tokenService.js`.
 * sessionService imports `generateTokenPair` and `sha256` from tokenService.
 * These are not used by `validateDeviceFingerprint` but must be present for the module to load.
 */
vi.mock('./tokenService.js', () => ({
  generateTokenPair: vi.fn(),
  sha256: vi.fn(),
}));

// ─── Import Under Test ──────────────────────────────────────────────────────

const { validateDeviceFingerprint } = await import('./sessionService.js');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 9: Device Fingerprint Security', () => {
  beforeEach(() => {
    resetStore();
    mockQuery.mockClear();
    mockRevokeAllForUser.mockClear();
  });

  /**
   * **Validates: Requirements 4.6**
   *
   * For any session with a stored device fingerprint, when
   * validateDeviceFingerprint is called with the SAME fingerprint,
   * it SHALL return true and SHALL NOT invalidate any sessions.
   */
  it('should return true and not invalidate sessions when fingerprints match', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        deviceFingerprintArb,
        async (sessionId, userId, fingerprint) => {
          resetStore();
          mockQuery.mockClear();
          mockRevokeAllForUser.mockClear();

          // Seed the in-memory store with a token that has the given fingerprint
          insertToken({
            id: sessionId,
            user_id: userId,
            device_fingerprint: fingerprint,
            revoked_at: null,
            revoked_reason: null,
          });

          // Call with the SAME fingerprint
          const result = await validateDeviceFingerprint(sessionId, fingerprint);

          // Should return true (fingerprints match)
          expect(result).toBe(true);

          // Should NOT have called revokeAllForUser
          expect(mockRevokeAllForUser).not.toHaveBeenCalled();
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 4.6**
   *
   * For any session with a stored device fingerprint, when
   * validateDeviceFingerprint is called with a DIFFERENT fingerprint,
   * it SHALL return false and SHALL invalidate ALL sessions for that user.
   */
  it('should return false and invalidate all sessions on fingerprint mismatch', async () => {
    // Generate two distinct fingerprints
    const distinctFingerprintsArb = fc
      .tuple(deviceFingerprintArb, deviceFingerprintArb)
      .filter(([a, b]) => a !== b);

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        distinctFingerprintsArb,
        async (sessionId, userId, [storedFingerprint, requestFingerprint]) => {
          resetStore();
          mockQuery.mockClear();
          mockRevokeAllForUser.mockClear();

          // Seed the store with a token using the stored fingerprint
          insertToken({
            id: sessionId,
            user_id: userId,
            device_fingerprint: storedFingerprint,
            revoked_at: null,
            revoked_reason: null,
          });

          // Also add additional sessions for the same user to verify ALL are invalidated
          const extraSessionId = `extra-${sessionId.slice(6)}`;
          insertToken({
            id: extraSessionId,
            user_id: userId,
            device_fingerprint: storedFingerprint,
            revoked_at: null,
            revoked_reason: null,
          });

          // Call with a DIFFERENT fingerprint
          const result = await validateDeviceFingerprint(sessionId, requestFingerprint);

          // Should return false (fingerprints don't match)
          expect(result).toBe(false);

          // Should have called revokeAllForUser with the correct userId and reason
          expect(mockRevokeAllForUser).toHaveBeenCalledOnce();
          expect(mockRevokeAllForUser).toHaveBeenCalledWith(userId, 'device_mismatch');

          // Verify ALL sessions for the user were invalidated in the store
          const userTokens = store.filter((r) => r.user_id === userId);
          for (const token of userTokens) {
            expect(token.revoked_at).not.toBeNull();
            expect(token.revoked_reason).toBe('device_mismatch');
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
   * **Validates: Requirements 4.6**
   *
   * When validateDeviceFingerprint is called with a session ID that
   * does not exist, it SHALL throw an error with code AUTH_SESSION_INVALID.
   */
  it('should throw AUTH_SESSION_INVALID when session does not exist', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, deviceFingerprintArb, async (sessionId, fingerprint) => {
        resetStore();
        mockQuery.mockClear();
        mockRevokeAllForUser.mockClear();

        // Store is empty — no session exists

        await expect(validateDeviceFingerprint(sessionId, fingerprint)).rejects.toThrow(
          'AUTH_SESSION_INVALID',
        );

        // Should NOT have called revokeAllForUser
        expect(mockRevokeAllForUser).not.toHaveBeenCalled();
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });
});
