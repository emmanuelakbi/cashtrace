/**
 * Property-based tests for refresh token rotation.
 *
 * **Property 8: Refresh Token Rotation**
 * For any token refresh operation, the system SHALL invalidate the old refresh
 * token AND issue a new refresh token, such that the old token cannot be used
 * again.
 *
 * **Validates: Requirements 4.4**
 *
 * Tag: Feature: core-auth, Property 8: Refresh Token Rotation
 *
 * @module services/tokenService.rotation.property.test
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fc from 'fast-check';
import { uuidArb, deviceFingerprintArb } from '../test/arbitraries.js';
import { sha256 } from './tokenService.js';

// ─── Test Setup ──────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = 'test-jwt-secret-for-property-tests-minimum-length-32chars';

/**
 * In-memory store that simulates the refresh_tokens database table.
 * Each entry is keyed by token_hash and holds the row data.
 */
interface StoredRefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  device_fingerprint: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

let tokenStore: Map<string, StoredRefreshToken>;
let idCounter: number;

/**
 * Mock the database `query` function to simulate refresh token storage,
 * lookup, revocation, and insertion using an in-memory Map.
 *
 * The mock inspects the SQL string to determine which operation is being
 * performed and routes to the appropriate in-memory logic.
 */
const mockQuery = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

beforeAll(() => {
  process.env['JWT_SECRET'] = TEST_JWT_SECRET;
});

afterAll(() => {
  delete process.env['JWT_SECRET'];
});

beforeEach(() => {
  tokenStore = new Map();
  idCounter = 0;
  mockQuery.mockReset();

  mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    const normalised = sql.replace(/\s+/g, ' ').trim();

    // SELECT — lookup refresh token by hash
    if (normalised.startsWith('SELECT') && normalised.includes('FROM refresh_tokens')) {
      const tokenHash = params[0] as string;
      const stored = tokenStore.get(tokenHash);
      if (!stored) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [
          {
            id: stored.id,
            user_id: stored.user_id,
            device_fingerprint: stored.device_fingerprint,
            expires_at: stored.expires_at,
            revoked_at: stored.revoked_at,
          },
        ],
        rowCount: 1,
      };
    }

    // UPDATE — revoke a single token by id (rotation)
    if (normalised.startsWith('UPDATE refresh_tokens') && normalised.includes('WHERE id = $1')) {
      const tokenId = params[0] as string;
      for (const stored of tokenStore.values()) {
        if (stored.id === tokenId && stored.revoked_at === null) {
          stored.revoked_at = new Date();
          stored.revoked_reason = 'rotation';
        }
      }
      return { rows: [], rowCount: 1 };
    }

    // UPDATE — revoke all tokens for a user
    if (
      normalised.startsWith('UPDATE refresh_tokens') &&
      normalised.includes('WHERE user_id = $1')
    ) {
      const userId = params[0] as string;
      for (const stored of tokenStore.values()) {
        if (stored.user_id === userId && stored.revoked_at === null) {
          stored.revoked_at = new Date();
          stored.revoked_reason = 'logout_all';
        }
      }
      return { rows: [], rowCount: 1 };
    }

    // INSERT — store a new refresh token
    if (normalised.startsWith('INSERT INTO refresh_tokens')) {
      const [userId, tokenHash, deviceFingerprint, expiresAt] = params as [
        string,
        string,
        string,
        string,
      ];
      idCounter += 1;
      const newToken: StoredRefreshToken = {
        id: `token-id-${idCounter}`,
        user_id: userId,
        token_hash: tokenHash,
        device_fingerprint: deviceFingerprint,
        expires_at: new Date(expiresAt),
        revoked_at: null,
        revoked_reason: null,
      };
      tokenStore.set(tokenHash, newToken);
      return { rows: [], rowCount: 1 };
    }

    // Default fallback
    return { rows: [], rowCount: 0 };
  });
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 8: Refresh Token Rotation', () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * For any userId and deviceFingerprint, after a successful token refresh
   * the old refresh token SHALL be invalidated and cannot be used again.
   * A second call with the same old token SHALL throw AUTH_TOKEN_INVALID.
   */
  it('should invalidate the old refresh token after rotation so it cannot be reused', async () => {
    // Import dynamically so the mock is in place
    const { generateTokenPair, refreshTokens } = await import('./tokenService.js');

    await fc.assert(
      fc.asyncProperty(uuidArb, deviceFingerprintArb, async (userId, deviceFingerprint) => {
        // Reset the in-memory store for each iteration
        tokenStore.clear();
        idCounter = 0;

        // Step 1: Generate an initial token pair
        const initialPair = await generateTokenPair(userId, deviceFingerprint);
        const oldRefreshToken = initialPair.refreshToken;

        // Step 2: Refresh using the old token — should succeed
        const newPair = await refreshTokens(oldRefreshToken, deviceFingerprint);

        // The new pair must be valid
        expect(newPair.accessToken).toBeDefined();
        expect(newPair.refreshToken).toBeDefined();
        expect(typeof newPair.accessToken).toBe('string');
        expect(typeof newPair.refreshToken).toBe('string');

        // Step 3: Attempt to reuse the old refresh token — should fail
        await expect(refreshTokens(oldRefreshToken, deviceFingerprint)).rejects.toThrow(
          'AUTH_TOKEN_INVALID',
        );
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * For any token refresh operation, the new refresh token SHALL be different
   * from the old refresh token, ensuring fresh cryptographic material.
   */
  it('should issue a new refresh token that is different from the old one', async () => {
    const { generateTokenPair, refreshTokens } = await import('./tokenService.js');

    await fc.assert(
      fc.asyncProperty(uuidArb, deviceFingerprintArb, async (userId, deviceFingerprint) => {
        tokenStore.clear();
        idCounter = 0;

        // Generate initial pair
        const initialPair = await generateTokenPair(userId, deviceFingerprint);
        const oldRefreshToken = initialPair.refreshToken;

        // Refresh
        const newPair = await refreshTokens(oldRefreshToken, deviceFingerprint);

        // The new refresh token must differ from the old one
        expect(newPair.refreshToken).not.toBe(oldRefreshToken);

        // The new refresh token hash must also differ from the old one
        const oldHash = sha256(oldRefreshToken);
        const newHash = sha256(newPair.refreshToken);
        expect(newHash).not.toBe(oldHash);
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * For any token refresh operation, the newly issued refresh token SHALL
   * itself be usable for a subsequent refresh, proving the rotation chain
   * works correctly.
   */
  it('should allow the new refresh token to be used for a subsequent refresh', async () => {
    const { generateTokenPair, refreshTokens } = await import('./tokenService.js');

    await fc.assert(
      fc.asyncProperty(uuidArb, deviceFingerprintArb, async (userId, deviceFingerprint) => {
        tokenStore.clear();
        idCounter = 0;

        // Generate initial pair
        const initialPair = await generateTokenPair(userId, deviceFingerprint);

        // First rotation
        const secondPair = await refreshTokens(initialPair.refreshToken, deviceFingerprint);

        // Second rotation using the new token — should succeed
        const thirdPair = await refreshTokens(secondPair.refreshToken, deviceFingerprint);

        expect(thirdPair.accessToken).toBeDefined();
        expect(thirdPair.refreshToken).toBeDefined();

        // All three refresh tokens must be distinct
        const tokens = new Set([
          initialPair.refreshToken,
          secondPair.refreshToken,
          thirdPair.refreshToken,
        ]);
        expect(tokens.size).toBe(3);
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });
});
