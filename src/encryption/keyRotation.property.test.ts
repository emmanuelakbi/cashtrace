/**
 * Property-based tests for Key Rotation
 *
 * **Property 3: Key Rotation**
 * For any encryption key older than 90 days, rotation SHALL be triggered automatically.
 *
 * **Validates: Requirements 3.2**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { KeyManagerImpl, KEY_ROTATION_DAYS } from './keyManager.js';
import { InMemoryKmsProvider } from './inMemoryKmsProvider.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a fresh KeyManager for each property iteration to avoid state leaks. */
function freshKeyManager(): KeyManagerImpl {
  return new KeyManagerImpl({ kmsProvider: new InMemoryKmsProvider() });
}

/** Compute a Date that is `days` days after `base`. */
function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Arbitrary business ID: alphanumeric with hyphens, 1–30 chars. */
const businessIdArb = fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,29}$/);

/** Arbitrary key age in days that is >= KEY_ROTATION_DAYS (expired). */
const expiredAgeDaysArb = fc.integer({ min: KEY_ROTATION_DAYS, max: 365 * 5 });

/** Arbitrary key age in days that is < KEY_ROTATION_DAYS (fresh). */
const freshAgeDaysArb = fc.integer({ min: 0, max: KEY_ROTATION_DAYS - 1 });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Key Rotation (Property 3)', () => {
  /**
   * For any business ID and any key age >= 90 days, needsRotation returns true.
   */
  it('needsRotation returns true for any active key aged >= 90 days', async () => {
    await fc.assert(
      fc.asyncProperty(businessIdArb, expiredAgeDaysArb, async (bizId, ageDays) => {
        const km = freshKeyManager();
        const key = await km.createKey(bizId);
        const checkDate = addDays(key.createdAt, ageDays);
        expect(km.needsRotation(key.id, checkDate)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any business ID and any key age < 90 days, needsRotation returns false.
   */
  it('needsRotation returns false for any active key aged < 90 days', async () => {
    await fc.assert(
      fc.asyncProperty(businessIdArb, freshAgeDaysArb, async (bizId, ageDays) => {
        const km = freshKeyManager();
        const key = await km.createKey(bizId);
        const checkDate = addDays(key.createdAt, ageDays);
        expect(km.needsRotation(key.id, checkDate)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any business ID and any key age >= 90 days, checkAndRotateKey
   * triggers rotation and returns a new active key with incremented version.
   */
  it('checkAndRotateKey triggers rotation for any expired key', async () => {
    await fc.assert(
      fc.asyncProperty(businessIdArb, expiredAgeDaysArb, async (bizId, ageDays) => {
        const km = freshKeyManager();
        const key = await km.createKey(bizId);
        const checkDate = addDays(key.createdAt, ageDays);

        const rotated = await km.checkAndRotateKey(key.id, checkDate);

        expect(rotated).not.toBeNull();
        expect(rotated!.status).toBe('active');
        expect(rotated!.version).toBe(key.version + 1);
        expect(rotated!.businessId).toBe(bizId);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any business ID and any key age < 90 days, checkAndRotateKey
   * does NOT trigger rotation and returns null.
   */
  it('checkAndRotateKey returns null for any fresh key', async () => {
    await fc.assert(
      fc.asyncProperty(businessIdArb, freshAgeDaysArb, async (bizId, ageDays) => {
        const km = freshKeyManager();
        const key = await km.createKey(bizId);
        const checkDate = addDays(key.createdAt, ageDays);

        const result = await km.checkAndRotateKey(key.id, checkDate);
        expect(result).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any expired key, after rotation the old key is deprecated
   * and the old key version is still retrievable (version history preserved).
   */
  it('rotation deprecates old key and preserves version history', async () => {
    await fc.assert(
      fc.asyncProperty(businessIdArb, expiredAgeDaysArb, async (bizId, ageDays) => {
        const km = freshKeyManager();
        const key = await km.createKey(bizId);
        const checkDate = addDays(key.createdAt, ageDays);

        await km.checkAndRotateKey(key.id, checkDate);

        // Old key should be deprecated
        const oldKey = await km.getKey(key.id);
        expect(oldKey.status).toBe('deprecated');

        // Old version should still be retrievable
        const v1 = await km.getKeyByVersion(bizId, 1);
        expect(v1).not.toBeNull();
        expect(v1!.id).toBe(key.id);
      }),
      { numRuns: 150 },
    );
  });
});
