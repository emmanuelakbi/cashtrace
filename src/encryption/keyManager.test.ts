/**
 * Unit tests for KeyManagerImpl.
 *
 * Validates:
 *  Requirement 3.1 — Master keys stored in KMS (HSM-backed service)
 *  Requirement 3.6 — Envelope encryption (data keys encrypted by master key)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { KeyManagerImpl } from './keyManager.js';
import { InMemoryKmsProvider } from './inMemoryKmsProvider.js';

describe('KeyManagerImpl', () => {
  let kms: InMemoryKmsProvider;
  let keyManager: KeyManagerImpl;

  beforeEach(() => {
    kms = new InMemoryKmsProvider();
    keyManager = new KeyManagerImpl({ kmsProvider: kms });
  });

  describe('createKey', () => {
    it('creates a key with correct metadata', async () => {
      const key = await keyManager.createKey('biz-1');

      expect(key.id).toBeTruthy();
      expect(key.businessId).toBe('biz-1');
      expect(key.version).toBe(1);
      expect(key.algorithm).toBe('aes-256-gcm');
      expect(key.status).toBe('active');
      expect(key.createdAt).toBeInstanceOf(Date);
      expect(key.expiresAt).toBeInstanceOf(Date);
    });

    it('creates a KMS master key for the new key', async () => {
      const key = await keyManager.createKey('biz-1');
      const masterKeyId = keyManager.getMasterKeyId(key.id);

      // Verify the master key exists in KMS
      const desc = await kms.describeKey(masterKeyId);
      expect(desc.enabled).toBe(true);
    });

    it('sets expiry to 90 days by default', async () => {
      const key = await keyManager.createKey('biz-1');
      const diffMs = key.expiresAt!.getTime() - key.createdAt.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(90);
    });

    it('respects custom expiry days', async () => {
      const km = new KeyManagerImpl({ kmsProvider: kms, defaultExpiryDays: 30 });
      const key = await km.createKey('biz-1');
      const diffMs = key.expiresAt!.getTime() - key.createdAt.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(30);
    });

    it('creates separate keys for different businesses', async () => {
      const key1 = await keyManager.createKey('biz-1');
      const key2 = await keyManager.createKey('biz-2');

      expect(key1.id).not.toBe(key2.id);
      expect(keyManager.getMasterKeyId(key1.id)).not.toBe(keyManager.getMasterKeyId(key2.id));
    });
  });

  describe('getKey', () => {
    it('retrieves a previously created key', async () => {
      const created = await keyManager.createKey('biz-1');
      const retrieved = await keyManager.getKey(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.businessId).toBe('biz-1');
      expect(retrieved.version).toBe(1);
      expect(retrieved.status).toBe('active');
    });

    it('throws for a non-existent key', async () => {
      await expect(keyManager.getKey('non-existent')).rejects.toThrow('Key not found');
    });
  });

  describe('rotateKey', () => {
    it('creates a new key with incremented version', async () => {
      const original = await keyManager.createKey('biz-1');
      const rotated = await keyManager.rotateKey(original.id);

      expect(rotated.version).toBe(2);
      expect(rotated.businessId).toBe('biz-1');
      expect(rotated.status).toBe('active');
      expect(rotated.rotatedAt).toBeInstanceOf(Date);
    });

    it('deprecates the old key after rotation', async () => {
      const original = await keyManager.createKey('biz-1');
      await keyManager.rotateKey(original.id);

      const oldKey = await keyManager.getKey(original.id);
      expect(oldKey.status).toBe('deprecated');
    });

    it('creates a new KMS master key for the rotated key', async () => {
      const original = await keyManager.createKey('biz-1');
      const rotated = await keyManager.rotateKey(original.id);

      const oldMasterKeyId = keyManager.getMasterKeyId(original.id);
      const newMasterKeyId = keyManager.getMasterKeyId(rotated.id);
      expect(oldMasterKeyId).not.toBe(newMasterKeyId);
    });

    it('throws when rotating a revoked key', async () => {
      const key = await keyManager.createKey('biz-1');
      await keyManager.revokeKey(key.id, 'compromised');

      await expect(keyManager.rotateKey(key.id)).rejects.toThrow('Cannot rotate a revoked key');
    });

    it('throws for a non-existent key', async () => {
      await expect(keyManager.rotateKey('non-existent')).rejects.toThrow('Key not found');
    });
  });

  describe('revokeKey', () => {
    it('sets key status to revoked', async () => {
      const key = await keyManager.createKey('biz-1');
      await keyManager.revokeKey(key.id, 'compromised');

      const revoked = await keyManager.getKey(key.id);
      expect(revoked.status).toBe('revoked');
    });

    it('is idempotent for already-revoked keys', async () => {
      const key = await keyManager.createKey('biz-1');
      await keyManager.revokeKey(key.id, 'compromised');
      await keyManager.revokeKey(key.id, 'double revoke');

      const revoked = await keyManager.getKey(key.id);
      expect(revoked.status).toBe('revoked');
    });

    it('throws for a non-existent key', async () => {
      await expect(keyManager.revokeKey('non-existent', 'reason')).rejects.toThrow('Key not found');
    });
  });

  describe('listKeys', () => {
    it('returns empty array for a business with no keys', async () => {
      const keys = await keyManager.listKeys('biz-unknown');
      expect(keys).toEqual([]);
    });

    it('lists all keys for a business', async () => {
      await keyManager.createKey('biz-1');
      await keyManager.createKey('biz-1');

      const keys = await keyManager.listKeys('biz-1');
      expect(keys).toHaveLength(2);
      expect(keys[0].version).toBe(1);
      expect(keys[1].version).toBe(1);
    });

    it('includes rotated keys in the list', async () => {
      const original = await keyManager.createKey('biz-1');
      await keyManager.rotateKey(original.id);

      const keys = await keyManager.listKeys('biz-1');
      expect(keys).toHaveLength(2);
      expect(keys.some((k) => k.status === 'deprecated')).toBe(true);
      expect(keys.some((k) => k.status === 'active')).toBe(true);
    });

    it('does not include keys from other businesses', async () => {
      await keyManager.createKey('biz-1');
      await keyManager.createKey('biz-2');

      const keys = await keyManager.listKeys('biz-1');
      expect(keys).toHaveLength(1);
      expect(keys[0].businessId).toBe('biz-1');
    });

    it('returns KeyMetadata shape (no masterKeyId leaked)', async () => {
      await keyManager.createKey('biz-1');
      const keys = await keyManager.listKeys('biz-1');

      const meta = keys[0];
      expect(meta).toHaveProperty('id');
      expect(meta).toHaveProperty('businessId');
      expect(meta).toHaveProperty('version');
      expect(meta).toHaveProperty('status');
      expect(meta).toHaveProperty('createdAt');
      expect(meta).not.toHaveProperty('masterKeyId');
      expect(meta).not.toHaveProperty('algorithm');
    });
  });

  describe('getMasterKeyId', () => {
    it('returns the KMS master key ID for a key', async () => {
      const key = await keyManager.createKey('biz-1');
      const masterKeyId = keyManager.getMasterKeyId(key.id);
      expect(masterKeyId).toBeTruthy();
    });

    it('throws for a non-existent key', () => {
      expect(() => keyManager.getMasterKeyId('non-existent')).toThrow('Key not found');
    });
  });

  describe('envelope encryption integration', () => {
    it('master key can generate data keys for envelope encryption', async () => {
      const key = await keyManager.createKey('biz-1');
      const masterKeyId = keyManager.getMasterKeyId(key.id);

      const dataKeyResult = await kms.generateDataKey(masterKeyId);
      expect(dataKeyResult.plaintextKey).toBeInstanceOf(Buffer);
      expect(dataKeyResult.encryptedKey).toBeInstanceOf(Buffer);
      expect(dataKeyResult.masterKeyId).toBe(masterKeyId);
    });

    it('encrypted data key can be decrypted back with the master key', async () => {
      const key = await keyManager.createKey('biz-1');
      const masterKeyId = keyManager.getMasterKeyId(key.id);

      const { plaintextKey, encryptedKey } = await kms.generateDataKey(masterKeyId);
      const { plaintext: decryptedKey } = await kms.decrypt(masterKeyId, encryptedKey);

      expect(decryptedKey).toEqual(plaintextKey);
    });
  });
});
