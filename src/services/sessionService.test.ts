/**
 * Unit tests for the SessionService module.
 *
 * All database calls are mocked via vi.mock so these tests run
 * without a live PostgreSQL connection. Tests verify:
 * - Session creation with device fingerprint (Requirement 4.5)
 * - Device fingerprint validation and mismatch handling (Requirement 4.6)
 * - Session retrieval, invalidation, and bulk invalidation
 * - Error handling for missing sessions
 *
 * @module services/sessionService.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RefreshToken, TokenPair } from '../types/index.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGenerateTokenPair = vi.fn();
const mockSha256 = vi.fn();

vi.mock('./tokenService.js', () => ({
  generateTokenPair: (...args: unknown[]) => mockGenerateTokenPair(...args),
  sha256: (...args: unknown[]) => mockSha256(...args),
}));

const mockFindByTokenHash = vi.fn();
const mockFindActiveByUserId = vi.fn();
const mockRevokeToken = vi.fn();
const mockRevokeAllForUser = vi.fn();

vi.mock('../repositories/sessionRepository.js', () => ({
  findByTokenHash: (...args: unknown[]) => mockFindByTokenHash(...args),
  findActiveByUserId: (...args: unknown[]) => mockFindActiveByUserId(...args),
  revokeToken: (...args: unknown[]) => mockRevokeToken(...args),
  revokeAllForUser: (...args: unknown[]) => mockRevokeAllForUser(...args),
}));

const mockQuery = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mocks are set up
const {
  createSession,
  getUserSessions,
  invalidateSession,
  invalidateAllUserSessions,
  invalidateSessionsForPasswordReset,
  validateDeviceFingerprint,
} = await import('./sessionService.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USER_ID = 'usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee';
const SESSION_ID = 'tok-uuid-1234-5678-abcd-ef0123456789';
const FINGERPRINT = 'a'.repeat(64);
const OTHER_FINGERPRINT = 'b'.repeat(64);
const TOKEN_HASH = 'c'.repeat(64);

function fakeTokenPair(): TokenPair {
  return {
    accessToken: 'jwt.access.token',
    refreshToken: 'raw-refresh-token-hex',
    accessTokenExpiresAt: new Date('2024-07-15T10:15:00Z'),
    refreshTokenExpiresAt: new Date('2024-07-22T10:00:00Z'),
  };
}

function fakeRefreshToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    tokenHash: TOKEN_HASH,
    deviceFingerprint: FINGERPRINT,
    expiresAt: new Date('2024-07-22T10:00:00Z'),
    createdAt: new Date('2024-07-15T10:00:00Z'),
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

/** Wrap rows in a pg-style QueryResult shape. */
function pgResult(rows: Record<string, unknown>[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGenerateTokenPair.mockReset();
  mockSha256.mockReset();
  mockFindByTokenHash.mockReset();
  mockFindActiveByUserId.mockReset();
  mockRevokeToken.mockReset();
  mockRevokeAllForUser.mockReset();
  mockQuery.mockReset();
});

describe('sessionService', () => {
  // ── createSession ──────────────────────────────────────────────────────

  describe('createSession', () => {
    it('should generate a token pair and return a session with the token pair', async () => {
      const tokenPair = fakeTokenPair();
      const storedToken = fakeRefreshToken();

      mockGenerateTokenPair.mockResolvedValueOnce(tokenPair);
      mockSha256.mockReturnValueOnce(TOKEN_HASH);
      mockFindByTokenHash.mockResolvedValueOnce(storedToken);

      const result = await createSession(USER_ID, {
        fingerprint: FINGERPRINT,
        userAgent: 'TestAgent/1.0',
        ipAddress: '192.168.1.1',
      });

      // Verify generateTokenPair was called with correct args
      expect(mockGenerateTokenPair).toHaveBeenCalledWith(USER_ID, FINGERPRINT);

      // Verify sha256 was called to hash the refresh token
      expect(mockSha256).toHaveBeenCalledWith(tokenPair.refreshToken);

      // Verify findByTokenHash was called with the hash
      expect(mockFindByTokenHash).toHaveBeenCalledWith(TOKEN_HASH);

      // Verify the returned session
      expect(result.session).toEqual({
        id: SESSION_ID,
        userId: USER_ID,
        deviceFingerprint: FINGERPRINT,
        createdAt: storedToken.createdAt,
        expiresAt: storedToken.expiresAt,
      });

      // Verify the returned token pair
      expect(result.tokenPair).toBe(tokenPair);
    });

    it('should throw INTERNAL_ERROR if the stored token cannot be found after creation', async () => {
      mockGenerateTokenPair.mockResolvedValueOnce(fakeTokenPair());
      mockSha256.mockReturnValueOnce(TOKEN_HASH);
      mockFindByTokenHash.mockResolvedValueOnce(null);

      await expect(
        createSession(USER_ID, {
          fingerprint: FINGERPRINT,
          userAgent: 'TestAgent/1.0',
          ipAddress: '192.168.1.1',
        }),
      ).rejects.toThrow('INTERNAL_ERROR');
    });

    it('should pass the device fingerprint from deviceInfo to generateTokenPair', async () => {
      const customFp = 'd'.repeat(64);
      mockGenerateTokenPair.mockResolvedValueOnce(fakeTokenPair());
      mockSha256.mockReturnValueOnce(TOKEN_HASH);
      mockFindByTokenHash.mockResolvedValueOnce(fakeRefreshToken({ deviceFingerprint: customFp }));

      await createSession(USER_ID, {
        fingerprint: customFp,
        userAgent: 'Mobile/2.0',
        ipAddress: '10.0.0.1',
      });

      expect(mockGenerateTokenPair).toHaveBeenCalledWith(USER_ID, customFp);
    });
  });

  // ── getUserSessions ────────────────────────────────────────────────────

  describe('getUserSessions', () => {
    it('should return mapped Session objects for active tokens', async () => {
      const token1 = fakeRefreshToken({ id: 'tok-1', deviceFingerprint: 'fp1'.padEnd(64, '0') });
      const token2 = fakeRefreshToken({ id: 'tok-2', deviceFingerprint: 'fp2'.padEnd(64, '0') });
      mockFindActiveByUserId.mockResolvedValueOnce([token1, token2]);

      const sessions = await getUserSessions(USER_ID);

      expect(mockFindActiveByUserId).toHaveBeenCalledWith(USER_ID);
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toEqual({
        id: 'tok-1',
        userId: USER_ID,
        deviceFingerprint: 'fp1'.padEnd(64, '0'),
        createdAt: token1.createdAt,
        expiresAt: token1.expiresAt,
      });
      expect(sessions[1]).toEqual({
        id: 'tok-2',
        userId: USER_ID,
        deviceFingerprint: 'fp2'.padEnd(64, '0'),
        createdAt: token2.createdAt,
        expiresAt: token2.expiresAt,
      });
    });

    it('should return an empty array when no active sessions exist', async () => {
      mockFindActiveByUserId.mockResolvedValueOnce([]);

      const sessions = await getUserSessions(USER_ID);

      expect(sessions).toEqual([]);
    });

    it('should not include repository-only fields (tokenHash, revokedAt, revokedReason) in sessions', async () => {
      const token = fakeRefreshToken();
      mockFindActiveByUserId.mockResolvedValueOnce([token]);

      const sessions = await getUserSessions(USER_ID);

      const session = sessions[0]!;
      expect(session).not.toHaveProperty('tokenHash');
      expect(session).not.toHaveProperty('revokedAt');
      expect(session).not.toHaveProperty('revokedReason');
    });
  });

  // ── invalidateSession ──────────────────────────────────────────────────

  describe('invalidateSession', () => {
    it('should revoke the token with reason "logout"', async () => {
      mockRevokeToken.mockResolvedValueOnce(undefined);

      await invalidateSession(SESSION_ID);

      expect(mockRevokeToken).toHaveBeenCalledOnce();
      expect(mockRevokeToken).toHaveBeenCalledWith(SESSION_ID, 'logout');
    });
  });

  // ── invalidateAllUserSessions ──────────────────────────────────────────

  describe('invalidateAllUserSessions', () => {
    it('should revoke all tokens for the user with reason "logout_all"', async () => {
      mockRevokeAllForUser.mockResolvedValueOnce(undefined);

      await invalidateAllUserSessions(USER_ID);

      expect(mockRevokeAllForUser).toHaveBeenCalledOnce();
      expect(mockRevokeAllForUser).toHaveBeenCalledWith(USER_ID, 'logout_all');
    });
  });

  // ── invalidateSessionsForPasswordReset ─────────────────────────────────

  describe('invalidateSessionsForPasswordReset', () => {
    it('should revoke all tokens for the user with reason "password_reset" (Requirement 5.5)', async () => {
      mockRevokeAllForUser.mockResolvedValueOnce(undefined);

      await invalidateSessionsForPasswordReset(USER_ID);

      expect(mockRevokeAllForUser).toHaveBeenCalledOnce();
      expect(mockRevokeAllForUser).toHaveBeenCalledWith(USER_ID, 'password_reset');
    });

    it('should use a distinct reason from invalidateAllUserSessions for audit trail', async () => {
      mockRevokeAllForUser.mockResolvedValue(undefined);

      await invalidateSessionsForPasswordReset(USER_ID);
      const passwordResetReason = mockRevokeAllForUser.mock.calls[0]![1];

      mockRevokeAllForUser.mockClear();

      await invalidateAllUserSessions(USER_ID);
      const logoutAllReason = mockRevokeAllForUser.mock.calls[0]![1];

      expect(passwordResetReason).toBe('password_reset');
      expect(logoutAllReason).toBe('logout_all');
      expect(passwordResetReason).not.toBe(logoutAllReason);
    });

    it('should call revokeAllForUser on the session repository', async () => {
      mockRevokeAllForUser.mockResolvedValueOnce(undefined);

      await invalidateSessionsForPasswordReset(USER_ID);

      expect(mockRevokeAllForUser).toHaveBeenCalledOnce();
    });

    it('should propagate errors from the repository', async () => {
      mockRevokeAllForUser.mockRejectedValueOnce(new Error('DB connection failed'));

      await expect(invalidateSessionsForPasswordReset(USER_ID)).rejects.toThrow(
        'DB connection failed',
      );
    });
  });

  // ── validateDeviceFingerprint ──────────────────────────────────────────

  describe('validateDeviceFingerprint', () => {
    it('should return true when fingerprints match', async () => {
      mockQuery.mockResolvedValueOnce(
        pgResult([
          {
            id: SESSION_ID,
            user_id: USER_ID,
            device_fingerprint: FINGERPRINT,
            revoked_at: null,
          },
        ]),
      );

      const result = await validateDeviceFingerprint(SESSION_ID, FINGERPRINT);

      expect(result).toBe(true);
      // Should NOT revoke any tokens
      expect(mockRevokeAllForUser).not.toHaveBeenCalled();
    });

    it('should return false and invalidate all sessions on fingerprint mismatch (Requirement 4.6)', async () => {
      mockQuery.mockResolvedValueOnce(
        pgResult([
          {
            id: SESSION_ID,
            user_id: USER_ID,
            device_fingerprint: FINGERPRINT,
            revoked_at: null,
          },
        ]),
      );
      mockRevokeAllForUser.mockResolvedValueOnce(undefined);

      const result = await validateDeviceFingerprint(SESSION_ID, OTHER_FINGERPRINT);

      expect(result).toBe(false);
      expect(mockRevokeAllForUser).toHaveBeenCalledOnce();
      expect(mockRevokeAllForUser).toHaveBeenCalledWith(USER_ID, 'device_mismatch');
    });

    it('should throw AUTH_SESSION_INVALID when session is not found', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await expect(
        validateDeviceFingerprint('nonexistent-session-id', FINGERPRINT),
      ).rejects.toThrow('AUTH_SESSION_INVALID');
    });

    it('should query the refresh_tokens table by session ID', async () => {
      mockQuery.mockResolvedValueOnce(
        pgResult([
          {
            id: SESSION_ID,
            user_id: USER_ID,
            device_fingerprint: FINGERPRINT,
            revoked_at: null,
          },
        ]),
      );

      await validateDeviceFingerprint(SESSION_ID, FINGERPRINT);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('FROM refresh_tokens');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([SESSION_ID]);
    });

    it('should invalidate all sessions for the correct user on mismatch', async () => {
      const otherUserId = 'usr-other-uuid';
      mockQuery.mockResolvedValueOnce(
        pgResult([
          {
            id: SESSION_ID,
            user_id: otherUserId,
            device_fingerprint: FINGERPRINT,
            revoked_at: null,
          },
        ]),
      );
      mockRevokeAllForUser.mockResolvedValueOnce(undefined);

      await validateDeviceFingerprint(SESSION_ID, OTHER_FINGERPRINT);

      // Should revoke tokens for the user who owns the session, not some other user
      expect(mockRevokeAllForUser).toHaveBeenCalledWith(otherUserId, 'device_mismatch');
    });
  });
});
