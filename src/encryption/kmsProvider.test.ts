import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryKmsProvider } from './inMemoryKmsProvider.js';

describe('InMemoryKmsProvider', () => {
  let kms: InMemoryKmsProvider;
  let masterKeyId: string;

  beforeEach(async () => {
    kms = new InMemoryKmsProvider();
    masterKeyId = await kms.createMasterKey('test-key');
  });

  describe('createMasterKey', () => {
    it('returns a unique key ID', async () => {
      const id1 = await kms.createMasterKey();
      const id2 = await kms.createMasterKey();
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });
  });

  describe('describeKey', () => {
    it('returns key info for existing key', async () => {
      const info = await kms.describeKey(masterKeyId);
      expect(info.keyId).toBe(masterKeyId);
      expect(info.enabled).toBe(true);
    });

    it('throws for non-existent key', async () => {
      await expect(kms.describeKey('non-existent')).rejects.toThrow('Master key not found');
    });
  });

  describe('generateDataKey', () => {
    it('returns plaintext and encrypted data key', async () => {
      const result = await kms.generateDataKey(masterKeyId);

      expect(result.plaintextKey).toBeInstanceOf(Buffer);
      expect(result.encryptedKey).toBeInstanceOf(Buffer);
      expect(result.masterKeyId).toBe(masterKeyId);
      expect(result.plaintextKey.length).toBe(32);
    });

    it('supports custom key length', async () => {
      const result = await kms.generateDataKey(masterKeyId, 16);
      expect(result.plaintextKey.length).toBe(16);
    });

    it('encrypted key can be decrypted back to plaintext key', async () => {
      const result = await kms.generateDataKey(masterKeyId);
      const decrypted = await kms.decrypt(masterKeyId, result.encryptedKey);
      expect(decrypted.plaintext).toEqual(result.plaintextKey);
    });

    it('generates unique data keys each call', async () => {
      const r1 = await kms.generateDataKey(masterKeyId);
      const r2 = await kms.generateDataKey(masterKeyId);
      expect(r1.plaintextKey).not.toEqual(r2.plaintextKey);
    });

    it('throws for non-existent master key', async () => {
      await expect(kms.generateDataKey('bad-id')).rejects.toThrow('Master key not found');
    });
  });

  describe('encrypt / decrypt', () => {
    it('round-trips data correctly', async () => {
      const plaintext = Buffer.from('sensitive financial data');
      const encrypted = await kms.encrypt(masterKeyId, plaintext);
      const decrypted = await kms.decrypt(masterKeyId, encrypted.ciphertext);

      expect(decrypted.plaintext).toEqual(plaintext);
      expect(decrypted.keyId).toBe(masterKeyId);
    });

    it('produces different ciphertext for same plaintext', async () => {
      const plaintext = Buffer.from('same data');
      const e1 = await kms.encrypt(masterKeyId, plaintext);
      const e2 = await kms.encrypt(masterKeyId, plaintext);
      expect(e1.ciphertext).not.toEqual(e2.ciphertext);
    });

    it('fails to decrypt with wrong master key', async () => {
      const otherKeyId = await kms.createMasterKey('other');
      const plaintext = Buffer.from('isolated data');
      const encrypted = await kms.encrypt(masterKeyId, plaintext);

      await expect(kms.decrypt(otherKeyId, encrypted.ciphertext)).rejects.toThrow();
    });

    it('fails to decrypt tampered ciphertext', async () => {
      const plaintext = Buffer.from('tamper test');
      const encrypted = await kms.encrypt(masterKeyId, plaintext);

      // Flip a byte in the ciphertext portion
      const tampered = Buffer.from(encrypted.ciphertext);
      tampered[tampered.length - 1] ^= 0xff;

      await expect(kms.decrypt(masterKeyId, tampered)).rejects.toThrow();
    });

    it('fails to decrypt truncated ciphertext', async () => {
      await expect(kms.decrypt(masterKeyId, Buffer.alloc(10))).rejects.toThrow('too short');
    });
  });

  describe('key enable/disable', () => {
    it('disabled key rejects operations', async () => {
      kms.disableKey(masterKeyId);

      await expect(kms.generateDataKey(masterKeyId)).rejects.toThrow('disabled');
      await expect(kms.encrypt(masterKeyId, Buffer.from('x'))).rejects.toThrow('disabled');
    });

    it('re-enabled key works again', async () => {
      kms.disableKey(masterKeyId);
      kms.enableKey(masterKeyId);

      const result = await kms.generateDataKey(masterKeyId);
      expect(result.plaintextKey.length).toBe(32);
    });

    it('describeKey shows disabled status', async () => {
      kms.disableKey(masterKeyId);
      const info = await kms.describeKey(masterKeyId);
      expect(info.enabled).toBe(false);
    });
  });

  describe('envelope encryption pattern', () => {
    it('supports full envelope encryption workflow', async () => {
      // 1. Generate a data key
      const dataKey = await kms.generateDataKey(masterKeyId);

      // 2. Use plaintext data key to encrypt application data (simulated)
      const appData = Buffer.from('account-number: 1234567890');

      // 3. Store encrypted data key alongside encrypted data
      expect(dataKey.encryptedKey).toBeInstanceOf(Buffer);

      // 4. Later: decrypt the data key using master key
      const recovered = await kms.decrypt(masterKeyId, dataKey.encryptedKey);
      expect(recovered.plaintext).toEqual(dataKey.plaintextKey);

      // The plaintext data key can then be used to decrypt the application data
    });
  });
});
