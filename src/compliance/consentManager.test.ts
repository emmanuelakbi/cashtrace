import { describe, it, expect, beforeEach } from 'vitest';
import { ConsentManager } from './consentManager.js';
import type { ConsentType } from './types.js';

describe('ConsentManager', () => {
  let manager: ConsentManager;

  beforeEach(() => {
    manager = new ConsentManager();
  });

  describe('recordConsent', () => {
    it('should record a consent and return a complete record', async () => {
      const record = await manager.recordConsent({
        userId: 'user-1',
        consentType: 'terms',
        version: '1.0',
        ipAddress: '192.168.1.1',
        userAgent: 'TestAgent/1.0',
      });

      expect(record.id).toBeDefined();
      expect(record.userId).toBe('user-1');
      expect(record.consentType).toBe('terms');
      expect(record.version).toBe('1.0');
      expect(record.grantedAt).toBeInstanceOf(Date);
      expect(record.revokedAt).toBeUndefined();
      expect(record.ipAddress).toBe('192.168.1.1');
      expect(record.userAgent).toBe('TestAgent/1.0');
    });

    it('should auto-generate id and grantedAt when not provided', async () => {
      const record = await manager.recordConsent({
        userId: 'user-1',
        consentType: 'privacy',
        version: '2.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      expect(record.id).toBeTruthy();
      expect(record.grantedAt).toBeInstanceOf(Date);
    });

    it('should revoke existing active consent of the same type when recording new one', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'marketing',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      // Record a new consent of the same type
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'marketing',
        version: '2.0',
        ipAddress: '10.0.0.2',
        userAgent: 'Agent',
      });

      const consents = await manager.getConsents('user-1');
      const marketingConsents = consents.filter((c) => c.consentType === 'marketing');
      expect(marketingConsents).toHaveLength(2);

      // First should be revoked, second should be active
      const revoked = marketingConsents.find((c) => c.version === '1.0');
      const active = marketingConsents.find((c) => c.version === '2.0');
      expect(revoked?.revokedAt).toBeInstanceOf(Date);
      expect(active?.revokedAt).toBeUndefined();
    });

    it('should not revoke consents of different types', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'terms',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'privacy',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      expect(await manager.hasConsent('user-1', 'terms')).toBe(true);
      expect(await manager.hasConsent('user-1', 'privacy')).toBe(true);
    });

    it('should not revoke consents of different users', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'terms',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      await manager.recordConsent({
        userId: 'user-2',
        consentType: 'terms',
        version: '1.0',
        ipAddress: '10.0.0.2',
        userAgent: 'Agent',
      });

      expect(await manager.hasConsent('user-1', 'terms')).toBe(true);
      expect(await manager.hasConsent('user-2', 'terms')).toBe(true);
    });

    it('should handle all consent types', async () => {
      const types: ConsentType[] = [
        'terms',
        'privacy',
        'marketing',
        'data_processing',
        'third_party',
      ];

      for (const type of types) {
        await manager.recordConsent({
          userId: 'user-1',
          consentType: type,
          version: '1.0',
          ipAddress: '10.0.0.1',
          userAgent: 'Agent',
        });
      }

      const consents = await manager.getConsents('user-1');
      expect(consents).toHaveLength(types.length);
    });
  });

  describe('revokeConsent', () => {
    it('should revoke an active consent and return true', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'marketing',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      const result = await manager.revokeConsent('user-1', 'marketing');
      expect(result).toBe(true);
      expect(await manager.hasConsent('user-1', 'marketing')).toBe(false);
    });

    it('should return false when no active consent exists', async () => {
      const result = await manager.revokeConsent('user-1', 'marketing');
      expect(result).toBe(false);
    });

    it('should return false when consent is already revoked', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'terms',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      await manager.revokeConsent('user-1', 'terms');
      const secondRevoke = await manager.revokeConsent('user-1', 'terms');
      expect(secondRevoke).toBe(false);
    });

    it('should set revokedAt timestamp on the consent record', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'privacy',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      await manager.revokeConsent('user-1', 'privacy');

      const consents = await manager.getConsents('user-1');
      expect(consents[0]?.revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('getConsents', () => {
    it('should return empty array for user with no consents', async () => {
      const consents = await manager.getConsents('nonexistent');
      expect(consents).toEqual([]);
    });

    it('should return all consents for a user including revoked ones', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'terms',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'privacy',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      await manager.revokeConsent('user-1', 'privacy');

      const consents = await manager.getConsents('user-1');
      expect(consents).toHaveLength(2);
    });

    it('should not return consents from other users', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'terms',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      await manager.recordConsent({
        userId: 'user-2',
        consentType: 'terms',
        version: '1.0',
        ipAddress: '10.0.0.2',
        userAgent: 'Agent',
      });

      const consents = await manager.getConsents('user-1');
      expect(consents).toHaveLength(1);
      expect(consents[0]?.userId).toBe('user-1');
    });
  });

  describe('hasConsent', () => {
    it('should return true for active consent', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'data_processing',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      expect(await manager.hasConsent('user-1', 'data_processing')).toBe(true);
    });

    it('should return false for revoked consent', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'third_party',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      await manager.revokeConsent('user-1', 'third_party');
      expect(await manager.hasConsent('user-1', 'third_party')).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      expect(await manager.hasConsent('ghost', 'terms')).toBe(false);
    });

    it('should return false for consent type never granted', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'terms',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      expect(await manager.hasConsent('user-1', 'marketing')).toBe(false);
    });
  });

  describe('exportConsents', () => {
    it('should export all consents for a user', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'terms',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'privacy',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      const exported = await manager.exportConsents('user-1');
      expect(exported.userId).toBe('user-1');
      expect(exported.exportedAt).toBeInstanceOf(Date);
      expect(exported.consents).toHaveLength(2);
    });

    it('should export empty consents for user with no records', async () => {
      const exported = await manager.exportConsents('nonexistent');
      expect(exported.userId).toBe('nonexistent');
      expect(exported.consents).toEqual([]);
    });

    it('should include revoked consents in export', async () => {
      await manager.recordConsent({
        userId: 'user-1',
        consentType: 'marketing',
        version: '1.0',
        ipAddress: '10.0.0.1',
        userAgent: 'Agent',
      });

      await manager.revokeConsent('user-1', 'marketing');

      const exported = await manager.exportConsents('user-1');
      expect(exported.consents).toHaveLength(1);
      expect(exported.consents[0]?.revokedAt).toBeInstanceOf(Date);
    });
  });
});
