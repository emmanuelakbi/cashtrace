/**
 * Unit tests for BusinessKeyManager and per-business encryption key isolation.
 *
 * Validates: Requirement 1.3 — unique encryption keys per business for data isolation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessKeyManager } from './businessKeyManager.js';
import { EncryptionServiceImpl } from './encryptionService.js';
import { InMemoryKmsProvider } from './inMemoryKmsProvider.js';

describe('BusinessKeyManager', () => {
  let kms: InMemoryKmsProvider;
  let manager: BusinessKeyManager;

  beforeEach(() => {
    kms = new InMemoryKmsProvider();
    manager = new BusinessKeyManager(kms);
  });

  it('creates a unique key for a new business', async () => {
    const keyId = await manager.getKeyForBusiness('biz-1');
    expect(keyId).toBeTruthy();
    expect(manager.hasKey('biz-1')).toBe(true);
  });

  it('returns the same key on subsequent calls for the same business', async () => {
    const first = await manager.getKeyForBusiness('biz-1');
    const second = await manager.getKeyForBusiness('biz-1');
    expect(first).toBe(second);
  });

  it('creates different keys for different businesses', async () => {
    const key1 = await manager.getKeyForBusiness('biz-1');
    const key2 = await manager.getKeyForBusiness('biz-2');
    expect(key1).not.toBe(key2);
  });

  it('reports hasKey correctly', async () => {
    expect(manager.hasKey('biz-1')).toBe(false);
    await manager.getKeyForBusiness('biz-1');
    expect(manager.hasKey('biz-1')).toBe(true);
    expect(manager.hasKey('biz-2')).toBe(false);
  });

  it('returns undefined for getExistingKey when no key assigned', () => {
    expect(manager.getExistingKey('biz-1')).toBeUndefined();
  });

  it('returns the key for getExistingKey after creation', async () => {
    const keyId = await manager.getKeyForBusiness('biz-1');
    expect(manager.getExistingKey('biz-1')).toBe(keyId);
  });

  it('allows registering an external key', async () => {
    const externalKeyId = await kms.createMasterKey('external');
    manager.registerKey('biz-ext', externalKeyId);
    expect(manager.hasKey('biz-ext')).toBe(true);
    expect(manager.getExistingKey('biz-ext')).toBe(externalKeyId);
  });
});
