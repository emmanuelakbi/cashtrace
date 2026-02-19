/**
 * Property-based tests for Consent Enforcement
 *
 * **Property 6: Consent Enforcement**
 * For any data processing activity, it SHALL only proceed if valid consent
 * exists for that activity type.
 *
 * **Validates: Requirements 7.1**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ConsentManager } from './consentManager.js';
import type { ConsentType } from './types.js';

// ─── Generators ──────────────────────────────────────────────────────────────

const ALL_CONSENT_TYPES: ConsentType[] = [
  'terms',
  'privacy',
  'marketing',
  'data_processing',
  'third_party',
];

const consentTypeArb: fc.Arbitrary<ConsentType> = fc.constantFrom(...ALL_CONSENT_TYPES);

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{1,12}$/);

const versionArb = fc.stringMatching(/^[0-9]{1,3}\.[0-9]{1,3}$/);

const ipArb = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

const userAgentArb = fc.stringMatching(/^[a-zA-Z0-9\/ ]{1,30}$/);

/** Generate consent record input for recordConsent. */
const consentInputArb = fc.record({
  userId: userIdArb,
  consentType: consentTypeArb,
  version: versionArb,
  ipAddress: ipArb,
  userAgent: userAgentArb,
});

/** Generate a pair of distinct consent types. */
const distinctConsentTypePairArb = fc
  .integer({ min: 0, max: ALL_CONSENT_TYPES.length - 1 })
  .chain((i) => {
    const typeA = ALL_CONSENT_TYPES[i];
    const remaining = ALL_CONSENT_TYPES.filter((_, idx) => idx !== i);
    return fc
      .constantFrom(...remaining)
      .map((typeB) => [typeA, typeB] as [ConsentType, ConsentType]);
  });

/** Generate a pair of distinct user IDs. */
const distinctUserIdPairArb = fc.tuple(userIdArb, userIdArb).filter(([a, b]) => a !== b);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Consent Enforcement (Property 6)', () => {
  /**
   * For any user and consent type, hasConsent returns false when no consent
   * has been recorded — processing must not proceed without consent.
   */
  it('denies processing when no consent has been granted', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, consentTypeArb, async (userId, consentType) => {
        const manager = new ConsentManager();
        const result = await manager.hasConsent(userId, consentType);
        expect(result).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any consent that has been recorded, hasConsent returns true —
   * processing is allowed when valid consent exists.
   */
  it('allows processing when valid consent has been granted', async () => {
    await fc.assert(
      fc.asyncProperty(consentInputArb, async (input) => {
        const manager = new ConsentManager();
        await manager.recordConsent(input);
        const result = await manager.hasConsent(input.userId, input.consentType);
        expect(result).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any consent that has been revoked, hasConsent returns false —
   * processing must not proceed after consent is withdrawn.
   */
  it('denies processing after consent has been revoked', async () => {
    await fc.assert(
      fc.asyncProperty(consentInputArb, async (input) => {
        const manager = new ConsentManager();
        await manager.recordConsent(input);
        await manager.revokeConsent(input.userId, input.consentType);
        const result = await manager.hasConsent(input.userId, input.consentType);
        expect(result).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any user with multiple consent types, revoking one type does not
   * affect the validity of other consent types.
   */
  it('revoking one consent type does not affect other types', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        distinctConsentTypePairArb,
        versionArb,
        ipArb,
        userAgentArb,
        async (userId, [typeA, typeB], version, ip, ua) => {
          const manager = new ConsentManager();
          await manager.recordConsent({
            userId,
            consentType: typeA,
            version,
            ipAddress: ip,
            userAgent: ua,
          });
          await manager.recordConsent({
            userId,
            consentType: typeB,
            version,
            ipAddress: ip,
            userAgent: ua,
          });

          // Revoke only typeA
          await manager.revokeConsent(userId, typeA);

          expect(await manager.hasConsent(userId, typeA)).toBe(false);
          expect(await manager.hasConsent(userId, typeB)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * For any re-granted consent (grant → revoke → grant), processing is
   * allowed again — consent can be restored.
   */
  it('allows processing after consent is re-granted', async () => {
    await fc.assert(
      fc.asyncProperty(consentInputArb, async (input) => {
        const manager = new ConsentManager();

        await manager.recordConsent(input);
        await manager.revokeConsent(input.userId, input.consentType);
        expect(await manager.hasConsent(input.userId, input.consentType)).toBe(false);

        // Re-grant
        await manager.recordConsent(input);
        expect(await manager.hasConsent(input.userId, input.consentType)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any user, consent is tracked per-user — granting consent for one
   * user does not grant it for another user.
   */
  it('consent is isolated per user', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctUserIdPairArb,
        consentTypeArb,
        versionArb,
        ipArb,
        userAgentArb,
        async ([userA, userB], consentType, version, ip, ua) => {
          const manager = new ConsentManager();
          await manager.recordConsent({
            userId: userA,
            consentType,
            version,
            ipAddress: ip,
            userAgent: ua,
          });

          expect(await manager.hasConsent(userA, consentType)).toBe(true);
          expect(await manager.hasConsent(userB, consentType)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
