import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationCategory, NotificationPreferences } from '../types/index.js';
import { makePreferences } from '../test/helpers.js';

import type { PreferenceService } from './preferenceService.js';
import {
  createUnsubscribeManager,
  type UnsubscribeManager,
  type UnsubscribeManagerConfig,
} from './unsubscribeManager.js';

// ─── Mock PreferenceService ──────────────────────────────────────────────────

function createMockPreferenceService(
  initial?: Partial<NotificationPreferences>,
): PreferenceService {
  let stored: NotificationPreferences = makePreferences({
    unsubscribedCategories: [],
    enabledCategories: [
      'security',
      'transactions',
      'insights',
      'compliance',
      'system',
      'marketing',
    ],
    ...initial,
  });

  return {
    getPreferences: vi.fn(async (_userId: string) => stored),
    updatePreferences: vi.fn(async (_userId: string, update: Partial<NotificationPreferences>) => {
      stored = { ...stored, ...update };
    }),
    shouldDeliver: vi.fn(async () => true),
    getQuietHours: vi.fn(async () => stored.quietHours),
    isInQuietHours: vi.fn(async () => false),
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const USER_ID = '00000000-0000-0000-0000-000000000001';
const CONFIG: UnsubscribeManagerConfig = {
  baseUrl: 'https://cashtrace.ng',
  secret: 'test-hmac-secret-key-for-unit-tests',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('UnsubscribeManager', () => {
  let prefService: PreferenceService;
  let manager: UnsubscribeManager;

  beforeEach(() => {
    prefService = createMockPreferenceService();
    manager = createUnsubscribeManager(prefService, CONFIG);
  });

  // ── generateUnsubscribeLink ──────────────────────────────────────────────

  describe('generateUnsubscribeLink', () => {
    it('generates a URL with a base64url token', () => {
      const link = manager.generateUnsubscribeLink(USER_ID, 'marketing');

      expect(link).toContain('https://cashtrace.ng/api/notifications/unsubscribe?token=');
      const url = new URL(link);
      const token = url.searchParams.get('token');
      expect(token).toBeTruthy();
      expect(token!.length).toBeGreaterThan(10);
    });

    it('strips trailing slashes from baseUrl', () => {
      const mgr = createUnsubscribeManager(prefService, {
        ...CONFIG,
        baseUrl: 'https://cashtrace.ng/',
      });
      const link = mgr.generateUnsubscribeLink(USER_ID, 'transactions');

      expect(link).toMatch(/^https:\/\/cashtrace\.ng\/api\//);
      expect(link).not.toContain('//api');
    });

    it('throws when generating link for security category', () => {
      expect(() => manager.generateUnsubscribeLink(USER_ID, 'security')).toThrow(
        'Cannot generate unsubscribe link for security notifications',
      );
    });

    it('generates different tokens for different categories', () => {
      const link1 = manager.generateUnsubscribeLink(USER_ID, 'marketing');
      const link2 = manager.generateUnsubscribeLink(USER_ID, 'transactions');

      const token1 = new URL(link1).searchParams.get('token');
      const token2 = new URL(link2).searchParams.get('token');
      expect(token1).not.toBe(token2);
    });
  });

  // ── processUnsubscribe ───────────────────────────────────────────────────

  describe('processUnsubscribe', () => {
    it('processes a valid token and unsubscribes the user', async () => {
      const link = manager.generateUnsubscribeLink(USER_ID, 'marketing');
      const token = new URL(link).searchParams.get('token')!;

      const result = await manager.processUnsubscribe(token);

      expect(result.success).toBe(true);
      expect(result.userId).toBe(USER_ID);
      expect(result.category).toBe('marketing');
    });

    it('rejects an invalid token string', async () => {
      const result = await manager.processUnsubscribe('not-a-valid-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    it('rejects a token with tampered signature', async () => {
      const link = manager.generateUnsubscribeLink(USER_ID, 'marketing');
      const token = new URL(link).searchParams.get('token')!;
      // Tamper with the last character
      const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');

      const result = await manager.processUnsubscribe(tampered);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid token/);
    });

    it('rejects an expired token', async () => {
      // Generate a token, then advance time past expiry
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const link = manager.generateUnsubscribeLink(USER_ID, 'marketing');
      const token = new URL(link).searchParams.get('token')!;

      // Advance 31 days
      vi.setSystemTime(now + 31 * 24 * 60 * 60 * 1000);

      const result = await manager.processUnsubscribe(token);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token expired');

      vi.useRealTimers();
    });

    it('rejects a token signed with a different secret', async () => {
      const otherManager = createUnsubscribeManager(prefService, {
        ...CONFIG,
        secret: 'different-secret',
      });
      const link = otherManager.generateUnsubscribeLink(USER_ID, 'marketing');
      const token = new URL(link).searchParams.get('token')!;

      // Verify with the original manager (different secret)
      const result = await manager.processUnsubscribe(token);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid token signature');
    });

    it('updates preferences via PreferenceService on success', async () => {
      const link = manager.generateUnsubscribeLink(USER_ID, 'marketing');
      const token = new URL(link).searchParams.get('token')!;

      await manager.processUnsubscribe(token);

      expect(prefService.updatePreferences).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({
          unsubscribedCategories: expect.arrayContaining(['marketing']),
        }),
      );
    });
  });

  // ── unsubscribeFromCategory ──────────────────────────────────────────────

  describe('unsubscribeFromCategory', () => {
    it('unsubscribes a user from a valid category', async () => {
      const result = await manager.unsubscribeFromCategory(USER_ID, 'marketing');

      expect(result).toBe(true);
      expect(prefService.updatePreferences).toHaveBeenCalled();
    });

    it('returns false when trying to unsubscribe from security', async () => {
      const result = await manager.unsubscribeFromCategory(USER_ID, 'security');

      expect(result).toBe(false);
      expect(prefService.updatePreferences).not.toHaveBeenCalled();
    });

    it('is idempotent — returns true if already unsubscribed', async () => {
      prefService = createMockPreferenceService({
        unsubscribedCategories: ['marketing'],
      });
      manager = createUnsubscribeManager(prefService, CONFIG);

      const result = await manager.unsubscribeFromCategory(USER_ID, 'marketing');

      expect(result).toBe(true);
      expect(prefService.updatePreferences).not.toHaveBeenCalled();
    });

    it('removes category from enabledCategories on unsubscribe', async () => {
      await manager.unsubscribeFromCategory(USER_ID, 'insights');

      const updateCall = vi.mocked(prefService.updatePreferences).mock.calls[0];
      expect(updateCall).toBeDefined();
      const update = updateCall![1];
      expect(update.enabledCategories).not.toContain('insights');
      expect(update.unsubscribedCategories).toContain('insights');
    });
  });

  // ── getUnsubscribedCategories ────────────────────────────────────────────

  describe('getUnsubscribedCategories', () => {
    it('returns empty array when nothing is unsubscribed', async () => {
      const categories = await manager.getUnsubscribedCategories(USER_ID);

      expect(categories).toEqual([]);
    });

    it('returns unsubscribed categories from preferences', async () => {
      prefService = createMockPreferenceService({
        unsubscribedCategories: ['marketing', 'insights'],
      });
      manager = createUnsubscribeManager(prefService, CONFIG);

      const categories = await manager.getUnsubscribedCategories(USER_ID);

      expect(categories).toEqual(['marketing', 'insights']);
    });
  });

  // ── isUnsubscribed ───────────────────────────────────────────────────────

  describe('isUnsubscribed', () => {
    it('returns false for security category regardless of state', async () => {
      const result = await manager.isUnsubscribed(USER_ID, 'security');

      expect(result).toBe(false);
    });

    it('returns false when user is subscribed to category', async () => {
      const result = await manager.isUnsubscribed(USER_ID, 'transactions');

      expect(result).toBe(false);
    });

    it('returns true when user has unsubscribed from category', async () => {
      prefService = createMockPreferenceService({
        unsubscribedCategories: ['marketing'],
      });
      manager = createUnsubscribeManager(prefService, CONFIG);

      const result = await manager.isUnsubscribed(USER_ID, 'marketing');

      expect(result).toBe(true);
    });

    it('checks each category independently', async () => {
      prefService = createMockPreferenceService({
        unsubscribedCategories: ['marketing'],
      });
      manager = createUnsubscribeManager(prefService, CONFIG);

      const categories: NotificationCategory[] = [
        'transactions',
        'insights',
        'compliance',
        'system',
        'marketing',
      ];

      const results = await Promise.all(categories.map((c) => manager.isUnsubscribed(USER_ID, c)));

      expect(results).toEqual([false, false, false, false, true]);
    });
  });

  // ── getAuditTrail ────────────────────────────────────────────────────────

  describe('getAuditTrail', () => {
    it('returns empty array when no unsubscribes have occurred', async () => {
      const trail = await manager.getAuditTrail(USER_ID);

      expect(trail).toEqual([]);
    });

    it('records an audit entry with method "direct" on unsubscribeFromCategory', async () => {
      await manager.unsubscribeFromCategory(USER_ID, 'marketing');

      const trail = await manager.getAuditTrail(USER_ID);

      expect(trail).toHaveLength(1);
      expect(trail[0]).toMatchObject({
        userId: USER_ID,
        category: 'marketing',
        action: 'unsubscribe',
        method: 'direct',
      });
      expect(trail[0]!.id).toBeTruthy();
      expect(trail[0]!.timestamp).toBeInstanceOf(Date);
    });

    it('records an audit entry with method "one_click_link" on processUnsubscribe', async () => {
      const link = manager.generateUnsubscribeLink(USER_ID, 'insights');
      const token = new URL(link).searchParams.get('token')!;

      await manager.processUnsubscribe(token);

      const trail = await manager.getAuditTrail(USER_ID);

      // processUnsubscribe calls unsubscribeFromCategory internally (direct),
      // then records its own one_click_link entry
      const oneClickEntry = trail.find((e) => e.method === 'one_click_link');
      expect(oneClickEntry).toBeDefined();
      expect(oneClickEntry).toMatchObject({
        userId: USER_ID,
        category: 'insights',
        action: 'unsubscribe',
        method: 'one_click_link',
      });
    });

    it('accumulates multiple audit entries for the same user', async () => {
      await manager.unsubscribeFromCategory(USER_ID, 'marketing');
      await manager.unsubscribeFromCategory(USER_ID, 'insights');

      const trail = await manager.getAuditTrail(USER_ID);

      expect(trail).toHaveLength(2);
      expect(trail[0]!.category).toBe('marketing');
      expect(trail[1]!.category).toBe('insights');
    });

    it('does not record audit entry for failed security unsubscribe', async () => {
      await manager.unsubscribeFromCategory(USER_ID, 'security');

      const trail = await manager.getAuditTrail(USER_ID);

      expect(trail).toHaveLength(0);
    });

    it('does not record audit entry for already-unsubscribed category', async () => {
      prefService = createMockPreferenceService({
        unsubscribedCategories: ['marketing'],
      });
      manager = createUnsubscribeManager(prefService, CONFIG);

      await manager.unsubscribeFromCategory(USER_ID, 'marketing');

      const trail = await manager.getAuditTrail(USER_ID);

      expect(trail).toHaveLength(0);
    });

    it('isolates audit trails between different users', async () => {
      const OTHER_USER = '00000000-0000-0000-0000-000000000002';

      await manager.unsubscribeFromCategory(USER_ID, 'marketing');

      const trail1 = await manager.getAuditTrail(USER_ID);
      const trail2 = await manager.getAuditTrail(OTHER_USER);

      expect(trail1).toHaveLength(1);
      expect(trail2).toHaveLength(0);
    });

    it('does not record audit entry when processUnsubscribe fails', async () => {
      const result = await manager.processUnsubscribe('invalid-token');

      expect(result.success).toBe(false);

      const trail = await manager.getAuditTrail(USER_ID);

      expect(trail).toHaveLength(0);
    });
  });
});
