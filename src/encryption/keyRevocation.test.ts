/**
 * Unit tests for key revocation functionality (Requirement 3.4).
 *
 * Validates:
 *  - Revocation records reason and timestamp
 *  - Revoked keys cannot be used for encryption (rotateKey rejects them)
 *  - isRevoked correctly reports key status
 *  - Idempotent revocation
 *  - Revocation of non-existent keys throws
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KeyManagerImpl } from './keyManager.js';
import { InMemoryKmsProvider } from './inMemoryKmsProvider.js';

describe('Key Revocation (Req 3.4)', () => {
  let kms: InMemoryKmsProvider;
  let keyManager: KeyManagerImpl;

  beforeEach(() => {
    kms = new InMemoryKmsProvider();
    keyManager = new KeyManagerImpl({ kmsProvider: kms });
  });

  it('should set status to revoked and record reason and timestamp', async () => {
    const key = await keyManager.createKey('biz-1');
    const beforeRevoke = new Date();

    await keyManager.revokeKey(key.id, 'compromised');

    const revoked = await keyManager.getKey(key.id);
    expect(revoked.status).toBe('revoked');
    expect(revoked.revocationReason).toBe('compromised');
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(revoked.revokedAt!.getTime()).toBeGreaterThanOrEqual(beforeRevoke.getTime());
  });

  it('should report isRevoked as true after revocation', async () => {
    const key = await keyManager.createKey('biz-1');
    expect(keyManager.isRevoked(key.id)).toBe(false);

    await keyManager.revokeKey(key.id, 'emergency');

    expect(keyManager.isRevoked(key.id)).toBe(true);
  });

  it('should prevent rotation of a revoked key', async () => {
    const key = await keyManager.createKey('biz-1');
    await keyManager.revokeKey(key.id, 'security incident');

    await expect(keyManager.rotateKey(key.id)).rejects.toThrow(/cannot rotate a revoked key/i);
  });

  it('should be idempotent — revoking an already-revoked key is a no-op', async () => {
    const key = await keyManager.createKey('biz-1');
    await keyManager.revokeKey(key.id, 'first reason');

    const afterFirst = await keyManager.getKey(key.id);
    const firstRevokedAt = afterFirst.revokedAt;

    // Second revocation should not change anything
    await keyManager.revokeKey(key.id, 'second reason');

    const afterSecond = await keyManager.getKey(key.id);
    expect(afterSecond.revocationReason).toBe('first reason');
    expect(afterSecond.revokedAt).toEqual(firstRevokedAt);
  });

  it('should throw when revoking a non-existent key', async () => {
    await expect(keyManager.revokeKey('no-such-key', 'reason')).rejects.toThrow(/key not found/i);
  });

  it('should throw when checking isRevoked for a non-existent key', () => {
    expect(() => keyManager.isRevoked('no-such-key')).toThrow(/key not found/i);
  });

  it('should allow revoking keys in any non-revoked status', async () => {
    const key = await keyManager.createKey('biz-2');
    // Rotate to get a deprecated key
    await keyManager.rotateKey(key.id);
    const deprecated = await keyManager.getKey(key.id);
    expect(deprecated.status).toBe('deprecated');

    // Revoke the deprecated key
    await keyManager.revokeKey(key.id, 'deprecated key compromised');
    expect(keyManager.isRevoked(key.id)).toBe(true);

    const revoked = await keyManager.getKey(key.id);
    expect(revoked.revocationReason).toBe('deprecated key compromised');
  });

  it('should reflect revoked status in listKeys', async () => {
    const key = await keyManager.createKey('biz-3');
    await keyManager.revokeKey(key.id, 'audit finding');

    const keys = await keyManager.listKeys('biz-3');
    const revokedMeta = keys.find((k) => k.id === key.id);
    expect(revokedMeta).toBeDefined();
    expect(revokedMeta!.status).toBe('revoked');
  });

  it('should not flag a revoked key as needing rotation', async () => {
    const key = await keyManager.createKey('biz-4');
    await keyManager.revokeKey(key.id, 'done');

    // Even with a far-future date, revoked keys don't need rotation
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    expect(keyManager.needsRotation(key.id, farFuture)).toBe(false);
  });
});
