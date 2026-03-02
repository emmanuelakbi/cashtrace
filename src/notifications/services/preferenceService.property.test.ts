/**
 * Property-Based Tests — Preference Enforcement
 *
 * **Property 2: Preference Enforcement**
 * For any notification, delivery SHALL only occur on channels enabled by the
 * user for that category, except for security notifications which are always
 * delivered.
 *
 * **Validates: Requirements 5.1, 8.2**
 *
 * @module notifications/services/preferenceService.property.test
 */

import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationCategory, NotificationChannel } from '../types/index.js';

import { createPreferenceService, type PreferenceService } from './preferenceService.js';

// ─── Mock Pool ───────────────────────────────────────────────────────────────

interface MockPool {
  query: ReturnType<typeof vi.fn>;
}

function createMockPool(): MockPool {
  return { query: vi.fn() };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const categoryArb: fc.Arbitrary<NotificationCategory> = fc.constantFrom(
  'security',
  'transactions',
  'insights',
  'compliance',
  'system',
  'marketing',
);

const channelArb: fc.Arbitrary<NotificationChannel> = fc.constantFrom('email', 'in_app', 'push');

const nonSecurityCategoryArb: fc.Arbitrary<NotificationCategory> = fc.constantFrom(
  'transactions',
  'insights',
  'compliance',
  'system',
  'marketing',
);

const allCategories: NotificationCategory[] = [
  'security',
  'transactions',
  'insights',
  'compliance',
  'system',
  'marketing',
];

const allChannels: NotificationChannel[] = ['email', 'in_app', 'push'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePreferenceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-0000-0000-000000000099',
    user_id: 'user-1',
    enabled_categories: [...allCategories],
    channel_preferences: Object.fromEntries(allCategories.map((c) => [c, [...allChannels]])),
    frequency: 'immediate',
    quiet_hours: { enabled: true, startTime: '22:00', endTime: '07:00' },
    unsubscribed_categories: [],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PreferenceService — Property 2: Preference Enforcement', () => {
  let pool: MockPool;
  let service: PreferenceService;

  beforeEach(() => {
    pool = createMockPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = createPreferenceService(pool as any);
  });

  /**
   * Security notifications are ALWAYS delivered on any channel,
   * regardless of what the user's stored preferences say.
   *
   * Validates: Requirement 8.2
   */
  it('security notifications are always delivered on any channel', async () => {
    await fc.assert(
      fc.asyncProperty(
        channelArb,
        fc.subarray(
          allCategories.filter((c) => c !== 'security'),
          { minLength: 0 },
        ),
        fc.subarray(allChannels, { minLength: 0 }),
        async (channel, enabledCategories, securityChannels) => {
          // Even with arbitrary enabled categories and channel prefs,
          // security should always return true
          const row = makePreferenceRow({
            enabled_categories: enabledCategories, // security may be missing
            channel_preferences: {
              ...Object.fromEntries(allCategories.map((c) => [c, []])),
              security: securityChannels, // may be empty
            },
            unsubscribed_categories: ['security'], // even if "unsubscribed"
          });
          pool.query.mockResolvedValueOnce({ rows: [row] });

          const result = await service.shouldDeliver('user-1', 'security', channel);

          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * For non-security categories, shouldDeliver returns false when the
   * category is not in the user's enabledCategories list.
   *
   * Validates: Requirement 5.1
   */
  it('non-security: returns false when category is disabled', async () => {
    await fc.assert(
      fc.asyncProperty(nonSecurityCategoryArb, channelArb, async (category, channel) => {
        // Enabled categories does NOT include the target category
        const enabledWithoutTarget = allCategories.filter((c) => c !== category);
        const row = makePreferenceRow({
          enabled_categories: enabledWithoutTarget,
          channel_preferences: Object.fromEntries(allCategories.map((c) => [c, [...allChannels]])),
          unsubscribed_categories: [],
        });
        pool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await service.shouldDeliver('user-1', category, channel);

        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * For non-security categories, shouldDeliver returns false when the
   * requested channel is not in the user's channel preferences for that
   * category.
   *
   * Validates: Requirement 5.1
   */
  it('non-security: returns false when channel is not preferred for category', async () => {
    await fc.assert(
      fc.asyncProperty(nonSecurityCategoryArb, channelArb, async (category, channel) => {
        // All channels EXCEPT the requested one for this category
        const channelsWithoutTarget = allChannels.filter((ch) => ch !== channel);
        const row = makePreferenceRow({
          enabled_categories: [...allCategories],
          channel_preferences: {
            ...Object.fromEntries(allCategories.map((c) => [c, [...allChannels]])),
            [category]: channelsWithoutTarget,
          },
          unsubscribed_categories: [],
        });
        pool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await service.shouldDeliver('user-1', category, channel);

        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * For non-security categories, shouldDeliver returns false when the
   * category is in the user's unsubscribedCategories list.
   *
   * Validates: Requirement 5.1, 8.2
   */
  it('non-security: returns false when category is unsubscribed', async () => {
    await fc.assert(
      fc.asyncProperty(nonSecurityCategoryArb, channelArb, async (category, channel) => {
        const row = makePreferenceRow({
          enabled_categories: [...allCategories],
          channel_preferences: Object.fromEntries(allCategories.map((c) => [c, [...allChannels]])),
          unsubscribed_categories: [category],
        });
        pool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await service.shouldDeliver('user-1', category, channel);

        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
