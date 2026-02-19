import { describe, it, expect, beforeEach } from 'vitest';
import { EncryptionServiceImpl } from './encryptionService.js';
import { createTestKmsContext, type TestKmsContext } from './testHelpers.js';
import type { FieldType, EncryptedData } from './types.js';

describe('EncryptionServiceImpl', () => {
  let ctx: TestKmsContext;
  let service: EncryptionServiceImpl;

  beforeEach(async () => {
    ctx = await createTestKmsContext();
    service = new EncryptionServiceImpl({
      kmsProvider: ctx.kms,
      defaultMasterKeyId: ctx.masterKeyId,
    });
  });

  describe('encrypt / decrypt', () => {
    it('should round-trip a simple string', async () => {
      const plaintext = 'Hello, CashTrace!';
      const encrypted = await service.encrypt(plaintext, ctx.masterKeyId);
      const decrypted = await service.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should return EncryptedData with all required fields', async () => {
      const encrypted = await service.encrypt('test', ctx.masterKeyId);
      expect(encrypted.keyId).toBe(ctx.masterKeyId);
      expect(encrypted.keyVersion).toBe(1);
      expect(encrypted.algorithm).toBe('aes-256-gcm');
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.tag).toBeTruthy();
      expect(encrypted.ciphertext).toBeTruthy();
    });

    it('should produce different ciphertext for the same plaintext', async () => {
      const plaintext = 'same input';
      const a = await service.encrypt(plaintext, ctx.masterKeyId);
      const b = await service.encrypt(plaintext, ctx.masterKeyId);
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    it('should handle empty string', async () => {
      const encrypted = await service.encrypt('', ctx.masterKeyId);
      const decrypted = await service.decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('should handle unicode content', async () => {
      const plaintext = '₦50,000 — Ọlá Adébáyọ̀';
      const encrypted = await service.encrypt(plaintext, ctx.masterKeyId);
      const decrypted = await service.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should reject tampered ciphertext', async () => {
      const encrypted = await service.encrypt('secret', ctx.masterKeyId);
      const tampered: EncryptedData = { ...encrypted, tag: 'AAAAAAAAAAAAAAAAAAAAAA==' };
      await expect(service.decrypt(tampered)).rejects.toThrow();
    });

    it('should reject invalid format (no dot separator)', async () => {
      const encrypted = await service.encrypt('test', ctx.masterKeyId);
      const bad: EncryptedData = { ...encrypted, ciphertext: 'nodothere' };
      await expect(service.decrypt(bad)).rejects.toThrow('Invalid encrypted data format');
    });
  });

  describe('encryptField / decryptField', () => {
    it('should round-trip a PII string field', async () => {
      const value = 'John Doe';
      const encrypted = await service.encryptField(value, 'pii');
      const decrypted = await service.decryptField(encrypted, 'pii');
      expect(decrypted).toBe(value);
    });

    it('should round-trip a financial numeric value', async () => {
      const value = 50000.75;
      const encrypted = await service.encryptField(value, 'financial');
      const decrypted = await service.decryptField(encrypted, 'financial');
      expect(decrypted).toBe(value);
    });

    it('should round-trip an object value', async () => {
      const value = { account: '1234567890', bank: 'GTBank' };
      const encrypted = await service.encryptField(value, 'financial');
      const decrypted = await service.decryptField(encrypted, 'financial');
      expect(decrypted).toEqual(value);
    });

    it('should round-trip a boolean value', async () => {
      const encrypted = await service.encryptField(true, 'standard');
      const decrypted = await service.decryptField(encrypted, 'standard');
      expect(decrypted).toBe(true);
    });

    it('should produce base64-encoded output', async () => {
      const encrypted = await service.encryptField('test', 'pii');
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
      // Should be valid JSON when decoded
      const decoded = Buffer.from(encrypted, 'base64').toString('utf8');
      const envelope = JSON.parse(decoded);
      expect(envelope).toHaveProperty('encryptedDataKey');
      expect(envelope).toHaveProperty('payload');
      expect(envelope.payload).toHaveProperty('algorithm', 'aes-256-gcm');
    });

    it('should handle all field types', async () => {
      const fieldTypes: FieldType[] = ['pii', 'financial', 'sensitive', 'standard'];
      for (const ft of fieldTypes) {
        const encrypted = await service.encryptField('test-value', ft);
        const decrypted = await service.decryptField(encrypted, ft);
        expect(decrypted).toBe('test-value');
      }
    });

    it('should produce different ciphertext for same field value', async () => {
      const a = await service.encryptField('same', 'pii');
      const b = await service.encryptField('same', 'pii');
      expect(a).not.toBe(b);
    });
  });
});
