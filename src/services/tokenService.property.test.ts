/**
 * Property-based tests for token issuance.
 *
 * **Property 5: Successful Authentication Issues Valid Tokens**
 * For any successful authentication (password login or magic link verification),
 * the system SHALL issue a JWT access token with 15-minute expiration AND a
 * refresh token with 7-day expiration, both associated with the authenticated user.
 *
 * **Validates: Requirements 2.2, 3.4, 4.1, 4.2**
 *
 * Tag: Feature: core-auth, Property 5: Successful Authentication Issues Valid Tokens
 *
 * @module services/tokenService.property.test
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import jwt from 'jsonwebtoken';
import {
  generateTokenPair,
  generateAccessToken,
  generateRefreshToken,
  validateAccessToken,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  REFRESH_TOKEN_EXPIRY_MS,
} from './tokenService.js';
import { uuidArb, deviceFingerprintArb } from '../test/arbitraries.js';

// ─── Test Setup ──────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = 'test-jwt-secret-for-property-tests-minimum-length-32chars';

/**
 * Mock the database `query` function so refresh token storage does not
 * require a live PostgreSQL connection. The mock resolves successfully
 * for every INSERT, simulating a healthy database.
 */
vi.mock('../utils/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
}));

beforeAll(() => {
  process.env['JWT_SECRET'] = TEST_JWT_SECRET;
});

afterAll(() => {
  delete process.env['JWT_SECRET'];
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 5: Successful Authentication Issues Valid Tokens', () => {
  /**
   * **Validates: Requirements 2.2, 3.4, 4.1, 4.2**
   *
   * For any userId and deviceFingerprint, generateTokenPair SHALL return
   * a TokenPair containing both an access token and a refresh token.
   */
  it('should issue both access and refresh tokens for any valid user', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, deviceFingerprintArb, async (userId, deviceFingerprint) => {
        const tokenPair = await generateTokenPair(userId, deviceFingerprint);

        // Both tokens must be present and non-empty strings
        expect(tokenPair.accessToken).toBeDefined();
        expect(typeof tokenPair.accessToken).toBe('string');
        expect(tokenPair.accessToken.length).toBeGreaterThan(0);

        expect(tokenPair.refreshToken).toBeDefined();
        expect(typeof tokenPair.refreshToken).toBe('string');
        expect(tokenPair.refreshToken.length).toBeGreaterThan(0);

        // Expiration dates must be present
        expect(tokenPair.accessTokenExpiresAt).toBeInstanceOf(Date);
        expect(tokenPair.refreshTokenExpiresAt).toBeInstanceOf(Date);
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * For any userId, the access token SHALL be a valid JWT with a 15-minute
   * expiration, and its payload SHALL contain the correct userId.
   */
  it('should issue JWT access tokens with 15-minute expiration and correct userId', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, async (userId) => {
        const beforeIssue = Math.floor(Date.now() / 1000);
        const { accessToken, accessTokenExpiresAt } = generateAccessToken(userId);
        const afterIssue = Math.floor(Date.now() / 1000);

        // Decode and verify the JWT
        const decoded = jwt.verify(accessToken, TEST_JWT_SECRET, {
          algorithms: ['HS256'],
        }) as jwt.JwtPayload;

        // The token payload must contain the correct userId
        expect(decoded['userId']).toBe(userId);
        expect(decoded['type']).toBe('access');

        // The token must have iat and exp claims
        expect(decoded.iat).toBeDefined();
        expect(decoded.exp).toBeDefined();

        // exp - iat must equal 15 minutes (900 seconds)
        expect(decoded.exp! - decoded.iat!).toBe(ACCESS_TOKEN_EXPIRY_SECONDS);

        // iat should be within the time window of the test execution
        expect(decoded.iat!).toBeGreaterThanOrEqual(beforeIssue);
        expect(decoded.iat!).toBeLessThanOrEqual(afterIssue);

        // accessTokenExpiresAt should be within 1 second of the exp claim
        // (rounding differences between Date.now() and jwt iat can cause off-by-one)
        const expFromDate = Math.floor(accessTokenExpiresAt.getTime() / 1000);
        expect(Math.abs(expFromDate - decoded.exp!)).toBeLessThanOrEqual(1);
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 4.1**
   *
   * For any userId and deviceFingerprint, the refresh token SHALL be a
   * 64-character hex string with a 7-day expiration.
   */
  it('should issue refresh tokens as 64-char hex strings with 7-day expiration', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, deviceFingerprintArb, async (userId, deviceFingerprint) => {
        const beforeIssue = Date.now();
        const { refreshToken, refreshTokenExpiresAt } = await generateRefreshToken(
          userId,
          deviceFingerprint,
        );
        const afterIssue = Date.now();

        // Refresh token must be a 64-character hex string (32 random bytes)
        expect(refreshToken).toMatch(/^[0-9a-f]{64}$/);

        // Expiration must be approximately 7 days from now
        const expiresAtMs = refreshTokenExpiresAt.getTime();
        const expectedMinExpiry = beforeIssue + REFRESH_TOKEN_EXPIRY_MS;
        const expectedMaxExpiry = afterIssue + REFRESH_TOKEN_EXPIRY_MS;

        expect(expiresAtMs).toBeGreaterThanOrEqual(expectedMinExpiry);
        expect(expiresAtMs).toBeLessThanOrEqual(expectedMaxExpiry);
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 2.2, 3.4**
   *
   * For any userId and deviceFingerprint, the access token returned by
   * generateTokenPair SHALL be validatable via validateAccessToken and
   * SHALL contain the correct userId.
   */
  it('should issue access tokens that are validatable and contain the correct userId', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, deviceFingerprintArb, async (userId, deviceFingerprint) => {
        const tokenPair = await generateTokenPair(userId, deviceFingerprint);

        // The access token must be validatable
        const payload = await validateAccessToken(tokenPair.accessToken);
        expect(payload).not.toBeNull();
        expect(payload!.userId).toBe(userId);
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any userId and deviceFingerprint, the access token expiration SHALL
   * be before the refresh token expiration (15 min < 7 days).
   */
  it('should issue access tokens that expire before refresh tokens', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, deviceFingerprintArb, async (userId, deviceFingerprint) => {
        const tokenPair = await generateTokenPair(userId, deviceFingerprint);

        // Access token must expire before refresh token
        expect(tokenPair.accessTokenExpiresAt.getTime()).toBeLessThan(
          tokenPair.refreshTokenExpiresAt.getTime(),
        );
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });
});
