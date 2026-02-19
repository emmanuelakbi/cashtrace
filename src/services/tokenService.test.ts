/**
 * Unit tests for the token service.
 *
 * Tests JWT access token generation and validation, refresh token
 * generation with SHA-256 hashing, token pair generation, and
 * the JWT secret helper.
 *
 * @module services/tokenService.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  getJwtSecret,
  sha256,
  generateAccessToken,
  validateAccessToken,
  refreshTokens,
  revokeRefreshToken,
  revokeAllUserTokens,
  generateMagicToken,
  validateMagicToken,
  invalidateMagicToken,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  REFRESH_TOKEN_EXPIRY_MS,
  MAGIC_TOKEN_EXPIRY_MS,
} from './tokenService.js';

// Mock the database module before importing anything that uses it
vi.mock('../utils/db.js', () => ({
  query: vi.fn(),
}));

import { query } from '../utils/db.js';

const mockQuery = vi.mocked(query);

const TEST_SECRET = 'test-jwt-secret-for-unit-tests-minimum-length-32chars!';

describe('tokenService', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
    mockQuery.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ─── Constants ───────────────────────────────────────────────────────

  describe('constants', () => {
    it('should set access token expiry to 15 minutes (900 seconds)', () => {
      expect(ACCESS_TOKEN_EXPIRY_SECONDS).toBe(900);
    });

    it('should set refresh token expiry to 7 days in milliseconds', () => {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(REFRESH_TOKEN_EXPIRY_MS).toBe(sevenDaysMs);
    });
  });

  // ─── getJwtSecret ────────────────────────────────────────────────────

  describe('getJwtSecret', () => {
    it('should return the JWT_SECRET environment variable', () => {
      expect(getJwtSecret()).toBe(TEST_SECRET);
    });

    it('should throw if JWT_SECRET is not set', () => {
      vi.stubEnv('JWT_SECRET', '');
      expect(() => getJwtSecret()).toThrow('JWT_SECRET environment variable is not set');
    });

    it('should throw if JWT_SECRET is undefined', () => {
      delete process.env['JWT_SECRET'];
      expect(() => getJwtSecret()).toThrow('JWT_SECRET environment variable is not set');
    });
  });

  // ─── sha256 ──────────────────────────────────────────────────────────

  describe('sha256', () => {
    it('should return a 64-character hex string', () => {
      const hash = sha256('test-input');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce consistent hashes for the same input', () => {
      const hash1 = sha256('same-input');
      const hash2 = sha256('same-input');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = sha256('input-one');
      const hash2 = sha256('input-two');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = sha256('');
      expect(hash).toHaveLength(64);
      // Known SHA-256 of empty string
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
  });

  // ─── generateAccessToken ─────────────────────────────────────────────

  describe('generateAccessToken', () => {
    it('should return a valid JWT string', () => {
      const { accessToken } = generateAccessToken('user-123');
      expect(typeof accessToken).toBe('string');
      // JWT has 3 parts separated by dots
      expect(accessToken.split('.')).toHaveLength(3);
    });

    it('should include userId in the payload', () => {
      const { accessToken } = generateAccessToken('user-abc');
      const decoded = jwt.verify(accessToken, TEST_SECRET) as Record<string, unknown>;
      expect(decoded['userId']).toBe('user-abc');
    });

    it('should include type=access in the payload', () => {
      const { accessToken } = generateAccessToken('user-123');
      const decoded = jwt.verify(accessToken, TEST_SECRET) as Record<string, unknown>;
      expect(decoded['type']).toBe('access');
    });

    it('should set expiration to 15 minutes from now', () => {
      const before = Math.floor(Date.now() / 1000);
      const { accessToken } = generateAccessToken('user-123');
      const after = Math.floor(Date.now() / 1000);

      const decoded = jwt.verify(accessToken, TEST_SECRET) as Record<string, unknown>;
      const exp = decoded['exp'] as number;
      const iat = decoded['iat'] as number;

      // exp should be iat + 900 (15 minutes)
      expect(exp - iat).toBe(ACCESS_TOKEN_EXPIRY_SECONDS);
      // iat should be within the test window
      expect(iat).toBeGreaterThanOrEqual(before);
      expect(iat).toBeLessThanOrEqual(after);
    });

    it('should return an accessTokenExpiresAt date approximately 15 minutes from now', () => {
      const before = Date.now();
      const { accessTokenExpiresAt } = generateAccessToken('user-123');
      const after = Date.now();

      const expectedMin = before + ACCESS_TOKEN_EXPIRY_SECONDS * 1000;
      const expectedMax = after + ACCESS_TOKEN_EXPIRY_SECONDS * 1000;

      expect(accessTokenExpiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin - 1000);
      expect(accessTokenExpiresAt.getTime()).toBeLessThanOrEqual(expectedMax + 1000);
    });

    it('should produce different tokens for different user IDs', () => {
      const { accessToken: token1 } = generateAccessToken('user-1');
      const { accessToken: token2 } = generateAccessToken('user-2');
      expect(token1).not.toBe(token2);
    });

    it('should use HS256 algorithm', () => {
      const { accessToken } = generateAccessToken('user-123');
      const header = JSON.parse(
        Buffer.from(accessToken.split('.')[0]!, 'base64url').toString(),
      ) as Record<string, unknown>;
      expect(header['alg']).toBe('HS256');
    });
  });

  // ─── validateAccessToken ─────────────────────────────────────────────

  describe('validateAccessToken', () => {
    it('should return payload for a valid access token', async () => {
      const { accessToken } = generateAccessToken('user-xyz');
      const payload = await validateAccessToken(accessToken);

      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('user-xyz');
      expect(typeof payload!.iat).toBe('number');
      expect(typeof payload!.exp).toBe('number');
    });

    it('should return null for an expired token', async () => {
      const secret = getJwtSecret();
      const expiredToken = jwt.sign({ userId: 'user-123', type: 'access' }, secret, {
        algorithm: 'HS256',
        expiresIn: -10,
      });

      const payload = await validateAccessToken(expiredToken);
      expect(payload).toBeNull();
    });

    it('should return null for a token signed with a different secret', async () => {
      const wrongToken = jwt.sign(
        { userId: 'user-123', type: 'access' },
        'wrong-secret-key-that-is-different',
        { algorithm: 'HS256', expiresIn: 900 },
      );

      const payload = await validateAccessToken(wrongToken);
      expect(payload).toBeNull();
    });

    it('should return null for a malformed token string', async () => {
      const payload = await validateAccessToken('not-a-valid-jwt');
      expect(payload).toBeNull();
    });

    it('should return null for an empty string', async () => {
      const payload = await validateAccessToken('');
      expect(payload).toBeNull();
    });

    it('should return null for a token without type=access', async () => {
      const secret = getJwtSecret();
      const refreshLikeToken = jwt.sign({ userId: 'user-123', type: 'refresh' }, secret, {
        algorithm: 'HS256',
        expiresIn: 900,
      });

      const payload = await validateAccessToken(refreshLikeToken);
      expect(payload).toBeNull();
    });

    it('should return null for a token without userId', async () => {
      const secret = getJwtSecret();
      const noUserToken = jwt.sign({ type: 'access' }, secret, {
        algorithm: 'HS256',
        expiresIn: 900,
      });

      const payload = await validateAccessToken(noUserToken);
      expect(payload).toBeNull();
    });

    it('should return null for a token with non-string userId', async () => {
      const secret = getJwtSecret();
      const badUserToken = jwt.sign({ userId: 12345, type: 'access' }, secret, {
        algorithm: 'HS256',
        expiresIn: 900,
      });

      const payload = await validateAccessToken(badUserToken);
      expect(payload).toBeNull();
    });

    it('should correctly extract iat and exp from a valid token', async () => {
      const { accessToken } = generateAccessToken('user-123');
      const payload = await validateAccessToken(accessToken);

      expect(payload).not.toBeNull();
      expect(payload!.exp - payload!.iat).toBe(ACCESS_TOKEN_EXPIRY_SECONDS);
    });

    it('should return email as empty string when not in payload', async () => {
      const { accessToken } = generateAccessToken('user-123');
      const payload = await validateAccessToken(accessToken);

      expect(payload).not.toBeNull();
      expect(payload!.email).toBe('');
    });
  });

  // ─── refreshTokens ────────────────────────────────────────────────────

  describe('refreshTokens', () => {
    const rawToken = 'a'.repeat(64);
    const userId = 'user-abc-123';
    const fingerprint = 'device-fp-001';
    const tokenId = 'token-id-001';

    function makeStoredRow(overrides: Record<string, unknown> = {}) {
      return {
        id: tokenId,
        user_id: userId,
        device_fingerprint: fingerprint,
        expires_at: new Date(Date.now() + 3_600_000), // 1 hour from now
        revoked_at: null,
        ...overrides,
      };
    }

    it('should throw AUTH_TOKEN_INVALID when token hash is not found in DB', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await expect(refreshTokens(rawToken, fingerprint)).rejects.toThrow('AUTH_TOKEN_INVALID');
    });

    it('should throw AUTH_TOKEN_INVALID when token has been revoked', async () => {
      const row = makeStoredRow({ revoked_at: new Date() });
      mockQuery.mockResolvedValueOnce({
        rows: [row],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await expect(refreshTokens(rawToken, fingerprint)).rejects.toThrow('AUTH_TOKEN_INVALID');
    });

    it('should throw AUTH_TOKEN_EXPIRED when token has expired', async () => {
      const row = makeStoredRow({ expires_at: new Date(Date.now() - 1000) });
      mockQuery.mockResolvedValueOnce({
        rows: [row],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await expect(refreshTokens(rawToken, fingerprint)).rejects.toThrow('AUTH_TOKEN_EXPIRED');
    });

    it('should revoke ALL user tokens and throw AUTH_DEVICE_MISMATCH on fingerprint mismatch (Req 4.6)', async () => {
      const row = makeStoredRow();
      // SELECT query
      mockQuery.mockResolvedValueOnce({
        rows: [row],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // revokeAllUserTokens UPDATE query
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 2,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await expect(refreshTokens(rawToken, 'different-fingerprint')).rejects.toThrow(
        'AUTH_DEVICE_MISMATCH',
      );

      // Verify revokeAllUserTokens was called with the user's ID
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const revokeCall = mockQuery.mock.calls[1]!;
      expect(revokeCall[0]).toContain('UPDATE refresh_tokens');
      expect(revokeCall[0]).toContain('user_id');
      expect(revokeCall[1]).toEqual([userId]);
    });

    it('should revoke old token and return new token pair on valid refresh (Req 4.4)', async () => {
      const row = makeStoredRow();
      // SELECT lookup
      mockQuery.mockResolvedValueOnce({
        rows: [row],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // revokeRefreshToken UPDATE
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });
      // generateRefreshToken INSERT (called inside generateTokenPair)
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const result = await refreshTokens(rawToken, fingerprint);

      // Should have a new token pair
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.accessTokenExpiresAt).toBeInstanceOf(Date);
      expect(result.refreshTokenExpiresAt).toBeInstanceOf(Date);

      // Verify the old token was revoked (second call is the UPDATE for revocation)
      expect(mockQuery).toHaveBeenCalledTimes(3);
      const revokeCall = mockQuery.mock.calls[1]!;
      expect(revokeCall[0]).toContain('UPDATE refresh_tokens');
      expect(revokeCall[1]).toEqual([tokenId]);
    });

    it('should hash the refresh token with SHA-256 before DB lookup', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const { sha256: computeSha256 } = await import('./tokenService.js');
      const expectedHash = computeSha256(rawToken);

      await expect(refreshTokens(rawToken, fingerprint)).rejects.toThrow();

      const selectCall = mockQuery.mock.calls[0]!;
      expect(selectCall[1]).toEqual([expectedHash]);
    });

    it('should generate a new refresh token different from the old one', async () => {
      const row = makeStoredRow();
      mockQuery.mockResolvedValueOnce({
        rows: [row],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const result = await refreshTokens(rawToken, fingerprint);

      // The new refresh token should be different from the old one
      expect(result.refreshToken).not.toBe(rawToken);
    });
  });

  // ─── revokeRefreshToken ──────────────────────────────────────────────

  describe('revokeRefreshToken', () => {
    it('should execute UPDATE query with the token ID', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await revokeRefreshToken('token-id-xyz');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const call = mockQuery.mock.calls[0]!;
      expect(call[0]).toContain('UPDATE refresh_tokens');
      expect(call[0]).toContain('revoked_at');
      expect(call[0]).toContain('revoked_reason');
      expect(call[1]).toEqual(['token-id-xyz']);
    });

    it('should only update tokens that are not already revoked', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await revokeRefreshToken('already-revoked-id');

      const call = mockQuery.mock.calls[0]!;
      expect(call[0]).toContain('revoked_at IS NULL');
    });
  });

  // ─── revokeAllUserTokens ─────────────────────────────────────────────

  describe('revokeAllUserTokens', () => {
    it('should execute UPDATE query with the user ID', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 3,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await revokeAllUserTokens('user-id-456');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const call = mockQuery.mock.calls[0]!;
      expect(call[0]).toContain('UPDATE refresh_tokens');
      expect(call[0]).toContain('user_id');
      expect(call[1]).toEqual(['user-id-456']);
    });

    it('should only revoke tokens that are not already revoked', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await revokeAllUserTokens('user-id-789');

      const call = mockQuery.mock.calls[0]!;
      expect(call[0]).toContain('revoked_at IS NULL');
    });

    it('should set revoked_reason to revoked_all', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 2,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await revokeAllUserTokens('user-id-abc');

      const call = mockQuery.mock.calls[0]!;
      expect(call[0]).toContain('revoked_all');
    });
  });

  // ─── Magic Token Constants ─────────────────────────────────────────────

  describe('MAGIC_TOKEN_EXPIRY_MS', () => {
    it('should be 15 minutes in milliseconds', () => {
      expect(MAGIC_TOKEN_EXPIRY_MS).toBe(15 * 60 * 1000);
    });
  });

  // ─── generateMagicToken ──────────────────────────────────────────────

  describe('generateMagicToken', () => {
    it('should return a 64-character hex string (32 random bytes)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const token = await generateMagicToken('user-123');
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should store the SHA-256 hash in magic_link_tokens table', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const token = await generateMagicToken('user-456');
      const expectedHash = sha256(token);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const call = mockQuery.mock.calls[0]!;
      expect(call[0]).toContain('INSERT INTO magic_link_tokens');
      expect(call[1]![0]).toBe('user-456');
      expect(call[1]![1]).toBe(expectedHash);
    });

    it('should set expiration to 15 minutes from now', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const before = Date.now();
      await generateMagicToken('user-789');
      const after = Date.now();

      const call = mockQuery.mock.calls[0]!;
      const expiresAtStr = call[1]![2] as string;
      const expiresAt = new Date(expiresAtStr).getTime();

      const expectedMin = before + MAGIC_TOKEN_EXPIRY_MS;
      const expectedMax = after + MAGIC_TOKEN_EXPIRY_MS;

      expect(expiresAt).toBeGreaterThanOrEqual(expectedMin - 1000);
      expect(expiresAt).toBeLessThanOrEqual(expectedMax + 1000);
    });

    it('should generate unique tokens on each call', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const token1 = await generateMagicToken('user-123');
      const token2 = await generateMagicToken('user-123');
      expect(token1).not.toBe(token2);
    });
  });

  // ─── validateMagicToken ──────────────────────────────────────────────

  describe('validateMagicToken', () => {
    const rawToken = 'b'.repeat(64);
    const userId = 'user-magic-123';
    const tokenId = 'magic-token-id-001';

    function makeMagicRow(overrides: Record<string, unknown> = {}) {
      return {
        id: tokenId,
        user_id: userId,
        expires_at: new Date(Date.now() + 600_000), // 10 minutes from now
        used_at: null,
        ...overrides,
      };
    }

    it('should return MagicTokenPayload for a valid, unused, non-expired token', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeMagicRow()],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const payload = await validateMagicToken(rawToken);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe(userId);
      expect(payload!.tokenId).toBe(tokenId);
    });

    it('should return null when token hash is not found in DB', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const payload = await validateMagicToken(rawToken);
      expect(payload).toBeNull();
    });

    it('should return null when token has already been used (Req 3.5)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeMagicRow({ used_at: new Date() })],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const payload = await validateMagicToken(rawToken);
      expect(payload).toBeNull();
    });

    it('should return null when token has expired (Req 3.2)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeMagicRow({ expires_at: new Date(Date.now() - 1000) })],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const payload = await validateMagicToken(rawToken);
      expect(payload).toBeNull();
    });

    it('should hash the token with SHA-256 before DB lookup', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const expectedHash = sha256(rawToken);
      await validateMagicToken(rawToken);

      const call = mockQuery.mock.calls[0]!;
      expect(call[0]).toContain('SELECT');
      expect(call[0]).toContain('magic_link_tokens');
      expect(call[1]).toEqual([expectedHash]);
    });
  });

  // ─── invalidateMagicToken ────────────────────────────────────────────

  describe('invalidateMagicToken', () => {
    it('should execute UPDATE query setting used_at on the token', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await invalidateMagicToken('c'.repeat(64));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const call = mockQuery.mock.calls[0]!;
      expect(call[0]).toContain('UPDATE magic_link_tokens');
      expect(call[0]).toContain('used_at');
    });

    it('should hash the token with SHA-256 before updating', async () => {
      const rawToken = 'd'.repeat(64);
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const expectedHash = sha256(rawToken);
      await invalidateMagicToken(rawToken);

      const call = mockQuery.mock.calls[0]!;
      expect(call[1]).toEqual([expectedHash]);
    });

    it('should only update tokens that have not been used yet', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      await invalidateMagicToken('e'.repeat(64));

      const call = mockQuery.mock.calls[0]!;
      expect(call[0]).toContain('used_at IS NULL');
    });
  });
});
