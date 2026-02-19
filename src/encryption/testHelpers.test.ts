import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createTestKmsContext,
  createMultiBusinessKmsContext,
  generateTestDataKey,
} from './testHelpers.js';

describe('Test Helpers', () => {
  it('createTestKmsContext provides a working KMS with master key', async () => {
    const ctx = await createTestKmsContext();
    expect(ctx.kms).toBeDefined();
    expect(ctx.masterKeyId).toBeTruthy();

    // Verify the key is usable
    const info = await ctx.kms.describeKey(ctx.masterKeyId);
    expect(info.enabled).toBe(true);
  });

  it('createMultiBusinessKmsContext creates isolated keys per business', async () => {
    const businessIds = ['biz-1', 'biz-2', 'biz-3'];
    const { kms, keyMap } = await createMultiBusinessKmsContext(businessIds);

    expect(keyMap.size).toBe(3);
    for (const id of businessIds) {
      const keyId = keyMap.get(id)!;
      const info = await kms.describeKey(keyId);
      expect(info.enabled).toBe(true);
    }
  });

  it('generateTestDataKey returns valid data key pair', async () => {
    const ctx = await createTestKmsContext();
    const dataKey = await generateTestDataKey(ctx);

    expect(dataKey.plaintextKey).toBeInstanceOf(Buffer);
    expect(dataKey.encryptedKey).toBeInstanceOf(Buffer);
    expect(dataKey.plaintextKey.length).toBe(32);

    // Verify round-trip
    const decrypted = await ctx.kms.decrypt(ctx.masterKeyId, dataKey.encryptedKey);
    expect(decrypted.plaintext).toEqual(dataKey.plaintextKey);
  });

  it('fast-check integration works with test helpers', async () => {
    const ctx = await createTestKmsContext();

    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 200 }), async (plaintext) => {
        const buf = Buffer.from(plaintext, 'utf-8');
        const encrypted = await ctx.kms.encrypt(ctx.masterKeyId, buf);
        const decrypted = await ctx.kms.decrypt(ctx.masterKeyId, encrypted.ciphertext);
        return decrypted.plaintext.equals(buf);
      }),
      { numRuns: 50 },
    );
  });
});
