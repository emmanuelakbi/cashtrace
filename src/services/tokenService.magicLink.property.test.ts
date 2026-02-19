/**
 * Property-based tests for magic link token single-use and expiration enforcement.
 *
 * **Property 6: Magic Link Single-Use Enforcement**
 * For any magic link token, after it has been used once for authentication,
 * subsequent attempts to use the same token SHALL fail with an invalid token error.
 *
 * **Property 7: Magic Link Expiration Enforcement**
 * For any magic link token, verification attempts after 15 minutes from creation
 * SHALL fail with an expiration error.
 *
 * **Validates: Requirements 3.2, 3.5, 3.6**
 *
 * Tag: Feature: core-auth, Property 6: Magic Link Single-Use Enforcement
 * Tag: Feature: core-auth, Property 7: Magic Link Expiration Enforcement
 *
 * @module services/tokenService.magicLink.property.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { uuidArb } from '../test/arbitraries.js';
import { sha256, MAGIC_TOKEN_EXPIRY_MS } from './tokenService.js';

// ─── Test Setup ──────────────────────────────────────────────────────────────

/**
 * In-memory store that simulates the magic_link_tokens database table.
 * Each entry is keyed by token_hash and holds the row data.
 */
interface StoredMagicToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  used_at: Date | null;
}

let magicTokenStore: Map<string, StoredMagicToken>;
let idCounter: number;

/**
 * Mock the database `query` function to simulate magic link token storage,
 * lookup, and invalidation using an in-memory Map.
 *
 * The mock inspects the SQL string to determine which operation is being
 * performed and routes to the appropriate in-memory logic.
 */
const mockQuery = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

beforeEach(() => {
  magicTokenStore = new Map();
  idCounter = 0;
  mockQuery.mockReset();

  mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    const normalised = sql.replace(/\s+/g, ' ').trim();

    // INSERT — store a new magic link token
    if (normalised.startsWith('INSERT INTO magic_link_tokens')) {
      const [userId, tokenHash, expiresAt] = params as [string, string, string];
      idCounter += 1;
      const newToken: StoredMagicToken = {
        id: `magic-token-id-${idCounter}`,
        user_id: userId,
        token_hash: tokenHash,
        expires_at: new Date(expiresAt),
        created_at: new Date(),
        used_at: null,
      };
      magicTokenStore.set(tokenHash, newToken);
      return { rows: [], rowCount: 1 };
    }

    // SELECT — lookup magic link token by hash
    if (normalised.startsWith('SELECT') && normalised.includes('FROM magic_link_tokens')) {
      const tokenHash = params[0] as string;
      const stored = magicTokenStore.get(tokenHash);
      if (!stored) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [
          {
            id: stored.id,
            user_id: stored.user_id,
            expires_at: stored.expires_at,
            used_at: stored.used_at,
          },
        ],
        rowCount: 1,
      };
    }

    // UPDATE — mark magic link token as used
    if (normalised.startsWith('UPDATE magic_link_tokens') && normalised.includes('SET used_at')) {
      const tokenHash = params[0] as string;
      const stored = magicTokenStore.get(tokenHash);
      if (stored && stored.used_at === null) {
        stored.used_at = new Date();
      }
      return { rows: [], rowCount: stored ? 1 : 0 };
    }

    // Default fallback
    return { rows: [], rowCount: 0 };
  });
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 6: Magic Link Single-Use Enforcement', () => {
  /**
   * **Validates: Requirements 3.5**
   *
   * For any userId, after generating a magic link token, validating it once
   * (succeeds), then invalidating it, subsequent validation attempts SHALL
   * return null (indicating the token cannot be reused).
   */
  it('should reject a magic link token after it has been used once', async () => {
    const { generateMagicToken, validateMagicToken, invalidateMagicToken } =
      await import('./tokenService.js');

    await fc.assert(
      fc.asyncProperty(uuidArb, async (userId) => {
        // Reset the in-memory store for each iteration
        magicTokenStore.clear();
        idCounter = 0;

        // Step 1: Generate a magic link token
        const rawToken = await generateMagicToken(userId);
        expect(typeof rawToken).toBe('string');
        expect(rawToken.length).toBeGreaterThan(0);

        // Step 2: First validation — should succeed
        const firstValidation = await validateMagicToken(rawToken);
        expect(firstValidation).not.toBeNull();
        expect(firstValidation!.userId).toBe(userId);

        // Step 3: Invalidate the token (mark as used)
        await invalidateMagicToken(rawToken);

        // Step 4: Second validation — should return null (single-use enforcement)
        const secondValidation = await validateMagicToken(rawToken);
        expect(secondValidation).toBeNull();
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * For any userId, after generating and invalidating a magic link token,
   * ALL subsequent validation attempts (not just the second) SHALL return null.
   * This verifies the invalidation is permanent.
   */
  it('should permanently reject a used magic link token across multiple attempts', async () => {
    const { generateMagicToken, validateMagicToken, invalidateMagicToken } =
      await import('./tokenService.js');

    await fc.assert(
      fc.asyncProperty(uuidArb, fc.integer({ min: 2, max: 5 }), async (userId, retryCount) => {
        magicTokenStore.clear();
        idCounter = 0;

        // Generate and use the token
        const rawToken = await generateMagicToken(userId);
        const firstValidation = await validateMagicToken(rawToken);
        expect(firstValidation).not.toBeNull();

        // Invalidate
        await invalidateMagicToken(rawToken);

        // All subsequent attempts must fail
        for (let i = 0; i < retryCount; i++) {
          const result = await validateMagicToken(rawToken);
          expect(result).toBeNull();
        }
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });
});

describe('Property 7: Magic Link Expiration Enforcement', () => {
  /**
   * **Validates: Requirements 3.2, 3.6**
   *
   * For any magic link token, verification attempts after 15 minutes from
   * creation SHALL fail with an expiration error (return null).
   */
  it('should reject a magic link token after 15 minutes have elapsed', async () => {
    vi.useFakeTimers();

    try {
      const { generateMagicToken, validateMagicToken } = await import('./tokenService.js');

      await fc.assert(
        fc.asyncProperty(uuidArb, fc.integer({ min: 1, max: 60 }), async (userId, extraMinutes) => {
          magicTokenStore.clear();
          idCounter = 0;

          // Step 1: Generate a magic link token at current time
          const rawToken = await generateMagicToken(userId);

          // Step 2: Validate immediately — should succeed
          const immediateValidation = await validateMagicToken(rawToken);
          expect(immediateValidation).not.toBeNull();
          expect(immediateValidation!.userId).toBe(userId);

          // Step 3: Advance time past the 15-minute expiry
          const msToAdvance = MAGIC_TOKEN_EXPIRY_MS + extraMinutes * 60 * 1000;
          vi.advanceTimersByTime(msToAdvance);

          // Step 4: Validate after expiry — should return null
          const expiredValidation = await validateMagicToken(rawToken);
          expect(expiredValidation).toBeNull();
        }),
        {
          numRuns: 100,
          verbose: true,
        },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **Validates: Requirements 3.2, 3.6**
   *
   * For any magic link token, verification attempts within the 15-minute
   * window SHALL succeed (the token is still valid before expiry).
   */
  it('should accept a magic link token before 15 minutes have elapsed', async () => {
    vi.useFakeTimers();

    try {
      const { generateMagicToken, validateMagicToken } = await import('./tokenService.js');

      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          // Generate a time offset strictly less than 15 minutes (in ms)
          fc.integer({ min: 0, max: MAGIC_TOKEN_EXPIRY_MS - 1000 }),
          async (userId, msToAdvance) => {
            magicTokenStore.clear();
            idCounter = 0;

            // Generate a magic link token
            const rawToken = await generateMagicToken(userId);

            // Advance time but stay within the expiry window
            vi.advanceTimersByTime(msToAdvance);

            // Validate — should still succeed
            const validation = await validateMagicToken(rawToken);
            expect(validation).not.toBeNull();
            expect(validation!.userId).toBe(userId);
          },
        ),
        {
          numRuns: 100,
          verbose: true,
        },
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
