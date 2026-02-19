/**
 * Property-based tests for Key Isolation — Property 2: Key Isolation
 *
 * For any business, data SHALL be encrypted with business-specific keys,
 * preventing cross-business decryption.
 *
 * **Validates: Requirements 1.3**
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { EncryptionServiceImpl } from './encryptionService.js';
import { BusinessKeyManager } from './businessKeyManager.js';
import { InMemoryKmsProvider } from './inMemoryKmsProvider.js';
import type { FieldType } from './types.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a non-empty business ID string. */
const businessIdArb = fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/).filter((s) => s.length >= 3);

/** Generate a pair of distinct business IDs. */
const distinctBusinessPairArb = fc.tuple(businessIdArb, businessIdArb).filter(([a, b]) => a !== b);

/** Generate arbitrary non-empty data strings for encryption. */
const dataArb = fc.string({ minLength: 1, maxLength: 500 });

/** Generate a field type. */
const fieldTypeArb = fc.constantFrom<FieldType>('pii', 'financial', 'sensitive', 'standard');

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Key Isolation (Property 2)', () => {
  let kms: InMemoryKmsProvider;
  let manager: BusinessKeyManager;
  let service: EncryptionServiceImpl;

  beforeEach(async () => {
    kms = new InMemoryKmsProvider();
    manager = new BusinessKeyManager(kms);
    const defaultKey = await kms.createMasterKey('default');
    service = new EncryptionServiceImpl({
      kmsProvider: kms,
      defaultMasterKeyId: defaultKey,
      businessKeyManager: manager,
    });
  });

  /**
   * **Validates: Requirements 1.3**
   * For any two distinct businesses, each SHALL receive a unique master key ID,
   * ensuring per-business key isolation.
   */
  it('assigns unique master keys to distinct businesses', async () => {
    await fc.assert(
      fc.asyncProperty(distinctBusinessPairArb, async ([bizA, bizB]) => {
        // Fresh manager per run to avoid cross-test state
        const localKms = new InMemoryKmsProvider();
        const localManager = new BusinessKeyManager(localKms);

        const keyA = await localManager.getKeyForBusiness(bizA);
        const keyB = await localManager.getKeyForBusiness(bizB);

        // Different businesses must get different master key IDs
        expect(keyA).not.toBe(keyB);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   * For any business and any data, encrypting with that business's key SHALL
   * produce an envelope whose keyId matches the business's assigned master key.
   */
  it('encrypts data using the business-specific master key', async () => {
    await fc.assert(
      fc.asyncProperty(businessIdArb, dataArb, fieldTypeArb, async (bizId, data, fieldType) => {
        const localKms = new InMemoryKmsProvider();
        const localManager = new BusinessKeyManager(localKms);
        const defaultKey = await localKms.createMasterKey('default');
        const localService = new EncryptionServiceImpl({
          kmsProvider: localKms,
          defaultMasterKeyId: defaultKey,
          businessKeyManager: localManager,
        });

        const encrypted = await localService.encryptFieldForBusiness(data, fieldType, bizId);
        const envelope = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8'));

        const expectedKeyId = localManager.getExistingKey(bizId);
        expect(envelope.payload.keyId).toBe(expectedKeyId);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   * For any two distinct businesses and any data, data encrypted with business A's
   * key SHALL NOT be decryptable using business B's key. Cross-business decryption
   * must fail, ensuring data isolation.
   */
  it('prevents cross-business decryption: data encrypted for A cannot be decrypted with B key', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctBusinessPairArb,
        dataArb,
        fieldTypeArb,
        async ([bizA, bizB], data, fieldType) => {
          const localKms = new InMemoryKmsProvider();
          const localManager = new BusinessKeyManager(localKms);
          const defaultKey = await localKms.createMasterKey('default');
          const localService = new EncryptionServiceImpl({
            kmsProvider: localKms,
            defaultMasterKeyId: defaultKey,
            businessKeyManager: localManager,
          });

          // Encrypt data for business A
          const encrypted = await localService.encryptFieldForBusiness(data, fieldType, bizA);

          // Get business B's key (creates it if needed)
          const bizBKey = await localManager.getKeyForBusiness(bizB);

          // Tamper: swap the keyId in the envelope to business B's key
          const envelope = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8'));
          envelope.payload.keyId = bizBKey;
          const tampered = Buffer.from(JSON.stringify(envelope)).toString('base64');

          // Decryption must fail — the data key was encrypted under A's master key,
          // so B's master key cannot recover it
          await expect(localService.decryptField(tampered, fieldType)).rejects.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   * For any business and any data, data encrypted for that business SHALL
   * round-trip correctly when decrypted with the same business's key.
   * This confirms the isolation mechanism doesn't break legitimate access.
   */
  it('round-trips data correctly within the same business', async () => {
    await fc.assert(
      fc.asyncProperty(businessIdArb, dataArb, fieldTypeArb, async (bizId, data, fieldType) => {
        const localKms = new InMemoryKmsProvider();
        const localManager = new BusinessKeyManager(localKms);
        const defaultKey = await localKms.createMasterKey('default');
        const localService = new EncryptionServiceImpl({
          kmsProvider: localKms,
          defaultMasterKeyId: defaultKey,
          businessKeyManager: localManager,
        });

        const encrypted = await localService.encryptFieldForBusiness(data, fieldType, bizId);
        const decrypted = await localService.decryptField(encrypted, fieldType);

        // Compare as strings to handle JSON.parse number coercion
        expect(String(decrypted)).toBe(data);
      }),
      { numRuns: 100 },
    );
  });
});
