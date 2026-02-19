/**
 * Unit tests for per-business encryption key isolation.
 *
 * Verifies that data encrypted for one business cannot be decrypted
 * using another business's key, ensuring data isolation.
 *
 * Validates: Requirement 1.3 — unique encryption keys per business.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessKeyManager } from './businessKeyManager.js';
import { EncryptionServiceImpl } from './encryptionService.js';
import { InMemoryKmsProvider } from './inMemoryKmsProvider.js';

describe('Per-business encryption key isolation', () => {
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

  it('encrypts and decrypts field data for a single business', async () => {
    const encrypted = await service.encryptFieldForBusiness('secret-data', 'pii', 'biz-1');
    const decrypted = await service.decryptField(encrypted, 'pii');
    expect(decrypted).toBe('secret-data');
  });

  it('uses business-specific key in the encrypted envelope', async () => {
    const encrypted = await service.encryptFieldForBusiness('data', 'pii', 'biz-1');
    const envelope = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8'));
    const bizKey = manager.getExistingKey('biz-1');
    expect(envelope.payload.keyId).toBe(bizKey);
  });

  it('different businesses get different keyIds in their envelopes', async () => {
    const enc1 = await service.encryptFieldForBusiness('data', 'pii', 'biz-1');
    const enc2 = await service.encryptFieldForBusiness('data', 'pii', 'biz-2');

    const env1 = JSON.parse(Buffer.from(enc1, 'base64').toString('utf8'));
    const env2 = JSON.parse(Buffer.from(enc2, 'base64').toString('utf8'));

    expect(env1.payload.keyId).not.toBe(env2.payload.keyId);
  });

  it('data encrypted for business A cannot be decrypted with business B key', async () => {
    // Encrypt data for biz-1
    const encrypted = await service.encryptFieldForBusiness('sensitive', 'pii', 'biz-1');

    // Tamper: swap the keyId in the envelope to biz-2's key
    const bizBKey = await manager.getKeyForBusiness('biz-2');
    const envelope = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8'));
    envelope.payload.keyId = bizBKey;
    const tampered = Buffer.from(JSON.stringify(envelope)).toString('base64');

    // Decryption should fail because the data key was encrypted under biz-1's master key
    await expect(service.decryptField(tampered, 'pii')).rejects.toThrow();
  });

  it('throws when BusinessKeyManager is not configured', async () => {
    const defaultKey = await kms.createMasterKey('no-bkm');
    const svcNoBkm = new EncryptionServiceImpl({
      kmsProvider: kms,
      defaultMasterKeyId: defaultKey,
    });
    await expect(svcNoBkm.encryptFieldForBusiness('data', 'pii', 'biz-1')).rejects.toThrow(
      'BusinessKeyManager not configured',
    );
  });

  it('each business key is a valid KMS master key', async () => {
    const key1 = await manager.getKeyForBusiness('biz-1');
    const key2 = await manager.getKeyForBusiness('biz-2');

    const desc1 = await kms.describeKey(key1);
    const desc2 = await kms.describeKey(key2);

    expect(desc1.enabled).toBe(true);
    expect(desc2.enabled).toBe(true);
    expect(desc1.keyId).not.toBe(desc2.keyId);
  });
});
