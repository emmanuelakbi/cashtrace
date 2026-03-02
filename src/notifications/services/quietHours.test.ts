import { beforeEach, describe, expect, it, vi } from 'vitest';

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

/**
 * Create a UTC Date that corresponds to a specific WAT (UTC+1) hour and minute.
 * WAT = UTC + 1, so UTC = WAT - 1.
 */
function utcDateForWat(watHour: number, watMinute: number): Date {
  const utcHour = (watHour - 1 + 24) % 24;
  const d = new Date(Date.UTC(2025, 0, 15, utcHour, watMinute, 0, 0));
  return d;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PreferenceService.isInQuietHours', () => {
  let pool: MockPool;
  let service: PreferenceService;

  beforeEach(() => {
    pool = createMockPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = createPreferenceService(pool as any);
  });

  it('returns false when quiet hours are disabled', async () => {
    const row = makePreferenceRow({
      quiet_hours: { enabled: false, startTime: '22:00', endTime: '07:00' },
    });
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const result = await service.isInQuietHours(USER_ID, utcDateForWat(23, 0));

    expect(result).toBe(false);
  });

  it('returns true during quiet hours (23:00 WAT, window 22:00-07:00)', async () => {
    const row = makePreferenceRow({
      quiet_hours: { enabled: true, startTime: '22:00', endTime: '07:00' },
    });
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const result = await service.isInQuietHours(USER_ID, utcDateForWat(23, 0));

    expect(result).toBe(true);
  });

  it('returns false outside quiet hours (12:00 WAT, window 22:00-07:00)', async () => {
    const row = makePreferenceRow({
      quiet_hours: { enabled: true, startTime: '22:00', endTime: '07:00' },
    });
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const result = await service.isInQuietHours(USER_ID, utcDateForWat(12, 0));

    expect(result).toBe(false);
  });

  it('handles midnight crossing — returns true at 02:00 WAT (window 22:00-07:00)', async () => {
    const row = makePreferenceRow({
      quiet_hours: { enabled: true, startTime: '22:00', endTime: '07:00' },
    });
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const result = await service.isInQuietHours(USER_ID, utcDateForWat(2, 0));

    expect(result).toBe(true);
  });

  it('handles midnight crossing — returns false at 07:00 WAT (end boundary)', async () => {
    const row = makePreferenceRow({
      quiet_hours: { enabled: true, startTime: '22:00', endTime: '07:00' },
    });
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const result = await service.isInQuietHours(USER_ID, utcDateForWat(7, 0));

    expect(result).toBe(false);
  });

  it('returns true at exactly the start of quiet hours (22:00 WAT)', async () => {
    const row = makePreferenceRow({
      quiet_hours: { enabled: true, startTime: '22:00', endTime: '07:00' },
    });
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const result = await service.isInQuietHours(USER_ID, utcDateForWat(22, 0));

    expect(result).toBe(true);
  });

  it('uses WAT timezone (UTC+1) correctly', async () => {
    // 21:30 UTC = 22:30 WAT → should be in quiet hours
    const row = makePreferenceRow({
      quiet_hours: { enabled: true, startTime: '22:00', endTime: '07:00' },
    });
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const utcTime = new Date(Date.UTC(2025, 0, 15, 21, 30, 0, 0));
    const result = await service.isInQuietHours(USER_ID, utcTime);

    expect(result).toBe(true);
  });

  it('uses WAT timezone — 21:00 UTC = 22:00 WAT is in quiet hours', async () => {
    const row = makePreferenceRow({
      quiet_hours: { enabled: true, startTime: '22:00', endTime: '07:00' },
    });
    pool.query.mockResolvedValueOnce({ rows: [row] });

    // 20:59 UTC = 21:59 WAT → should NOT be in quiet hours
    const utcTime = new Date(Date.UTC(2025, 0, 15, 20, 59, 0, 0));
    const result = await service.isInQuietHours(USER_ID, utcTime);

    expect(result).toBe(false);
  });

  it('uses default quiet hours when no record exists', async () => {
    // No stored preferences → defaults: enabled, 22:00-07:00
    pool.query.mockResolvedValueOnce({ rows: [] });

    // 23:00 WAT → in default quiet hours
    const result = await service.isInQuietHours(USER_ID, utcDateForWat(23, 0));

    expect(result).toBe(true);
  });
});
