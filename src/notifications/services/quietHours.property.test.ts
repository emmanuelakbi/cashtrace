/**
 * Property-Based Tests — Quiet Hours Respect
 *
 * **Property 4: Quiet Hours Respect**
 * For any non-critical notification during user's quiet hours, delivery SHALL
 * be delayed until quiet hours end.
 *
 * **Validates: Requirements 5.3, 5.4**
 *
 * @module notifications/services/quietHours.property.test
 */

import fc from 'fast-check';
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

const USER_ID = 'user-quiet-hours';

/**
 * Create a UTC Date that corresponds to a specific WAT (UTC+1) hour and minute.
 * WAT = UTC + 1, so UTC = WAT - 1.
 */
function utcDateForWat(watHour: number, watMinute: number): Date {
  const utcHour = (watHour - 1 + 24) % 24;
  return new Date(Date.UTC(2025, 0, 15, utcHour, watMinute, 0, 0));
}

/**
 * Check whether a WAT time falls within a quiet hours window.
 * Handles overnight windows (e.g. 22:00 → 07:00) where start > end.
 */
function isInWindow(
  watHour: number,
  watMinute: number,
  startH: number,
  startM: number,
  endH: number,
  endM: number,
): boolean {
  const watMinutes = watHour * 60 + watMinute;
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes > endMinutes) {
    // Overnight window: e.g. 22:00 → 07:00
    return watMinutes >= startMinutes || watMinutes < endMinutes;
  }
  // Same-day window: e.g. 01:00 → 05:00
  return watMinutes >= startMinutes && watMinutes < endMinutes;
}

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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const hourArb = fc.integer({ min: 0, max: 23 });
const minuteArb = fc.integer({ min: 0, max: 59 });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PreferenceService — Property 4: Quiet Hours Respect', () => {
  let pool: MockPool;
  let service: PreferenceService;

  beforeEach(() => {
    pool = createMockPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = createPreferenceService(pool as any);
  });

  /**
   * For any WAT time that falls within the default quiet hours window
   * (22:00–07:00), isInQuietHours SHALL return true when quiet hours
   * are enabled.
   *
   * Validates: Requirements 5.3, 5.4
   */
  it('returns true for any time during quiet hours when enabled', async () => {
    await fc.assert(
      fc.asyncProperty(hourArb, minuteArb, async (hour, minute) => {
        // Only test times that are inside the default 22:00–07:00 window
        fc.pre(isInWindow(hour, minute, 22, 0, 7, 0));

        const row = makePreferenceRow({
          quiet_hours: { enabled: true, startTime: '22:00', endTime: '07:00' },
        });
        pool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await service.isInQuietHours(USER_ID, utcDateForWat(hour, minute));

        expect(result).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * For any WAT time that falls outside the default quiet hours window
   * (22:00–07:00), isInQuietHours SHALL return false when quiet hours
   * are enabled.
   *
   * Validates: Requirements 5.3, 5.4
   */
  it('returns false for any time outside quiet hours when enabled', async () => {
    await fc.assert(
      fc.asyncProperty(hourArb, minuteArb, async (hour, minute) => {
        // Only test times that are outside the default 22:00–07:00 window
        fc.pre(!isInWindow(hour, minute, 22, 0, 7, 0));

        const row = makePreferenceRow({
          quiet_hours: { enabled: true, startTime: '22:00', endTime: '07:00' },
        });
        pool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await service.isInQuietHours(USER_ID, utcDateForWat(hour, minute));

        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * isInQuietHours SHALL always return false when quiet hours are disabled,
   * regardless of the current time.
   *
   * Validates: Requirements 5.3
   */
  it('always returns false when quiet hours are disabled', async () => {
    await fc.assert(
      fc.asyncProperty(hourArb, minuteArb, async (hour, minute) => {
        const row = makePreferenceRow({
          quiet_hours: { enabled: false, startTime: '22:00', endTime: '07:00' },
        });
        pool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await service.isInQuietHours(USER_ID, utcDateForWat(hour, minute));

        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * The default quiet hours window (22:00–07:00 WAT) SHALL be correctly
   * applied when no stored preferences exist (empty query result).
   *
   * Validates: Requirements 5.4
   */
  it('applies default 22:00-07:00 WAT window when no preferences stored', async () => {
    await fc.assert(
      fc.asyncProperty(hourArb, minuteArb, async (hour, minute) => {
        // No stored preferences → service returns defaults (enabled, 22:00–07:00)
        pool.query.mockResolvedValueOnce({ rows: [] });

        const result = await service.isInQuietHours(USER_ID, utcDateForWat(hour, minute));
        const expected = isInWindow(hour, minute, 22, 0, 7, 0);

        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});
