import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationPreferences } from '../types/index.js';

import { createPreferenceService, type PreferenceService } from './preferenceService.js';

// ─── Mock Pool ───────────────────────────────────────────────────────────────

interface MockPool {
  query: ReturnType<typeof vi.fn>;
}

function createMockPool(): MockPool {
  return { query: vi.fn() };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USER_ID = '00000000-0000-0000-0000-000000000001';

function makePreferenceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-0000-0000-000000000099',
    user_id: USER_ID,
    enabled_categories: [
      'security',
      'transactions',
      'insights',
      'compliance',
      'system',
      'marketing',
    ],
    channel_preferences: {
      security: ['email', 'in_app', 'push'],
      transactions: ['email', 'in_app'],
      insights: ['in_app'],
      compliance: ['email'],
      system: ['in_app'],
      marketing: ['email'],
    },
    frequency: 'immediate',
    quiet_hours: { enabled: true, startTime: '22:00', endTime: '07:00' },
    unsubscribed_categories: [],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PreferenceService', () => {
  let pool: MockPool;
  let service: PreferenceService;

  beforeEach(() => {
    pool = createMockPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = createPreferenceService(pool as any);
  });

  describe('getPreferences', () => {
    it('returns default preferences when no record exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const prefs = await service.getPreferences(USER_ID);

      expect(prefs.userId).toBe(USER_ID);
      expect(prefs.enabledCategories).toContain('security');
      expect(prefs.enabledCategories).toHaveLength(6);
      expect(prefs.frequency).toBe('immediate');
      expect(prefs.quietHours).toEqual({ enabled: true, startTime: '22:00', endTime: '07:00' });
      expect(prefs.unsubscribedCategories).toEqual([]);
    });

    it('returns stored preferences when record exists', async () => {
      const row = makePreferenceRow({ frequency: 'daily_digest' });
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const prefs = await service.getPreferences(USER_ID);

      expect(prefs.frequency).toBe('daily_digest');
      expect(prefs.channelPreferences.transactions).toEqual(['email', 'in_app']);
    });

    it('enforces security category is always enabled', async () => {
      const row = makePreferenceRow({
        enabled_categories: ['transactions'],
        channel_preferences: {
          security: ['email'],
          transactions: ['email', 'in_app'],
        },
      });
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const prefs = await service.getPreferences(USER_ID);

      expect(prefs.enabledCategories).toContain('security');
      expect(prefs.channelPreferences.security).toEqual(['email', 'in_app', 'push']);
    });

    it('removes security from unsubscribed categories', async () => {
      const row = makePreferenceRow({
        unsubscribed_categories: ['security', 'marketing'],
      });
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const prefs = await service.getPreferences(USER_ID);

      expect(prefs.unsubscribedCategories).not.toContain('security');
      expect(prefs.unsubscribedCategories).toContain('marketing');
    });
  });

  describe('updatePreferences', () => {
    it('upserts preferences with security invariant enforced', async () => {
      // First call: getPreferences (no existing record)
      pool.query.mockResolvedValueOnce({ rows: [] });
      // Second call: INSERT ... ON CONFLICT
      pool.query.mockResolvedValueOnce({ rows: [] });

      const update: Partial<NotificationPreferences> = {
        enabledCategories: ['transactions', 'insights'],
        frequency: 'weekly_digest',
      };

      await service.updatePreferences(USER_ID, update);

      expect(pool.query).toHaveBeenCalledTimes(2);
      const insertCall = pool.query.mock.calls[1];
      // Verify security is in the enabled categories even though it wasn't in the update
      const enabledCategories = JSON.parse(insertCall[1][1] as string) as string[];
      expect(enabledCategories).toContain('security');
      // Verify frequency was updated
      expect(insertCall[1][3]).toBe('weekly_digest');
    });

    it('prevents removing security from enabled categories', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      pool.query.mockResolvedValueOnce({ rows: [] });

      await service.updatePreferences(USER_ID, {
        enabledCategories: ['transactions'],
      });

      const insertCall = pool.query.mock.calls[1];
      const enabledCategories = JSON.parse(insertCall[1][1] as string) as string[];
      expect(enabledCategories).toContain('security');
    });
  });

  describe('shouldDeliver', () => {
    it('always returns true for security category', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.shouldDeliver(USER_ID, 'security', 'email');

      expect(result).toBe(true);
    });

    it('returns true when category is enabled and channel is preferred', async () => {
      const row = makePreferenceRow();
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const result = await service.shouldDeliver(USER_ID, 'transactions', 'email');

      expect(result).toBe(true);
    });

    it('returns false when category is disabled', async () => {
      const row = makePreferenceRow({
        enabled_categories: ['security'],
      });
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const result = await service.shouldDeliver(USER_ID, 'transactions', 'email');

      expect(result).toBe(false);
    });

    it('returns false when channel is not preferred for category', async () => {
      const row = makePreferenceRow({
        channel_preferences: {
          security: ['email', 'in_app', 'push'],
          transactions: ['in_app'],
        },
      });
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const result = await service.shouldDeliver(USER_ID, 'transactions', 'email');

      expect(result).toBe(false);
    });

    it('returns false when category is unsubscribed', async () => {
      const row = makePreferenceRow({
        unsubscribed_categories: ['marketing'],
      });
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const result = await service.shouldDeliver(USER_ID, 'marketing', 'email');

      expect(result).toBe(false);
    });

    it('returns true for security even when all other categories are disabled', async () => {
      const row = makePreferenceRow({
        enabled_categories: [],
        unsubscribed_categories: ['transactions', 'insights', 'compliance', 'system', 'marketing'],
      });
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const result = await service.shouldDeliver(USER_ID, 'security', 'push');

      expect(result).toBe(true);
    });
  });

  describe('getQuietHours', () => {
    it('returns default quiet hours when no record exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const qh = await service.getQuietHours(USER_ID);

      expect(qh).toEqual({ enabled: true, startTime: '22:00', endTime: '07:00' });
    });

    it('returns stored quiet hours', async () => {
      const row = makePreferenceRow({
        quiet_hours: { enabled: false, startTime: '23:00', endTime: '06:00' },
      });
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const qh = await service.getQuietHours(USER_ID);

      expect(qh).toEqual({ enabled: false, startTime: '23:00', endTime: '06:00' });
    });
  });
});
