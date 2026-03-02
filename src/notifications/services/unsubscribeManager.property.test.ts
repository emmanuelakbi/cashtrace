/**
 * Property-Based Tests — Unsubscribe Effectiveness
 *
 * **Property 8: Unsubscribe Effectiveness**
 * For any unsubscribe request, no further notifications of that category
 * SHALL be delivered to that user.
 *
 * **Validates: Requirements 12.2, 12.6**
 *
 * @module notifications/services/unsubscribeManager.property.test
 */

import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPreferences,
} from '../types/index.js';

import type { PreferenceService } from './preferenceService.js';
import {
  createUnsubscribeManager,
  type UnsubscribeManager,
  type UnsubscribeManagerConfig,
} from './unsubscribeManager.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_CATEGORIES: NotificationCategory[] = [
  'security',
  'transactions',
  'insights',
  'compliance',
  'system',
  'marketing',
];

const NON_SECURITY_CATEGORIES: NotificationCategory[] = [
  'transactions',
  'insights',
  'compliance',
  'system',
  'marketing',
];

const ALL_CHANNELS: NotificationChannel[] = ['email', 'in_app', 'push'];

const CONFIG: UnsubscribeManagerConfig = {
  baseUrl: 'https://cashtrace.ng',
  secret: 'test-hmac-secret-for-property-tests-minimum-length',
};

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const nonSecurityCategoryArb: fc.Arbitrary<NotificationCategory> = fc.constantFrom(
  ...NON_SECURITY_CATEGORIES,
);

const categoryArb: fc.Arbitrary<NotificationCategory> = fc.constantFrom(...ALL_CATEGORIES);

const channelArb: fc.Arbitrary<NotificationChannel> = fc.constantFrom(...ALL_CHANNELS);

// ─── In-Memory PreferenceService ─────────────────────────────────────────────

function buildDefaultPreferences(userId: string): NotificationPreferences {
  return {
    userId,
    enabledCategories: [...ALL_CATEGORIES],
    channelPreferences: Object.fromEntries(
      ALL_CATEGORIES.map((c) => [c, [...ALL_CHANNELS]]),
    ) as Record<NotificationCategory, NotificationChannel[]>,
    frequency: 'immediate',
    quietHours: { enabled: true, startTime: '22:00', endTime: '07:00' },
    unsubscribedCategories: [],
  };
}

/**
 * Creates an in-memory PreferenceService backed by a Map.
 * This avoids mocking and lets us verify real state transitions.
 */
function createInMemoryPreferenceService(): PreferenceService {
  const store = new Map<string, NotificationPreferences>();

  return {
    async getPreferences(userId: string): Promise<NotificationPreferences> {
      return store.get(userId) ?? buildDefaultPreferences(userId);
    },

    async updatePreferences(
      userId: string,
      preferences: Partial<NotificationPreferences>,
    ): Promise<void> {
      const current = store.get(userId) ?? buildDefaultPreferences(userId);
      store.set(userId, { ...current, ...preferences, userId });
    },

    async shouldDeliver(
      userId: string,
      category: NotificationCategory,
      channel: NotificationChannel,
    ): Promise<boolean> {
      if (category === 'security') return true;
      const prefs = store.get(userId) ?? buildDefaultPreferences(userId);
      if (!prefs.enabledCategories.includes(category)) return false;
      if (prefs.unsubscribedCategories.includes(category)) return false;
      const channels = prefs.channelPreferences[category];
      return channels ? channels.includes(channel) : false;
    },

    async getQuietHours(userId: string) {
      const prefs = store.get(userId) ?? buildDefaultPreferences(userId);
      return prefs.quietHours;
    },

    async isInQuietHours(_userId: string, _currentTime?: Date): Promise<boolean> {
      return false;
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('UnsubscribeManager — Property 8: Unsubscribe Effectiveness', () => {
  let preferenceService: PreferenceService;
  let manager: UnsubscribeManager;

  beforeEach(() => {
    preferenceService = createInMemoryPreferenceService();
    manager = createUnsubscribeManager(preferenceService, CONFIG);
  });

  /**
   * After unsubscribing from any non-security category, isUnsubscribed
   * returns true for that category.
   *
   * Validates: Requirement 12.2
   */
  it('after unsubscribing, isUnsubscribed returns true for that category', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), nonSecurityCategoryArb, async (userId, category) => {
        await manager.unsubscribeFromCategory(userId, category);

        const result = await manager.isUnsubscribed(userId, category);
        expect(result).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Security category can never be unsubscribed — isUnsubscribed always
   * returns false and unsubscribeFromCategory returns false.
   *
   * Validates: Requirement 12.6
   */
  it('security category can never be unsubscribed', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (userId) => {
        const result = await manager.unsubscribeFromCategory(userId, 'security');
        expect(result).toBe(false);

        const isUnsub = await manager.isUnsubscribed(userId, 'security');
        expect(isUnsub).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Unsubscribe is idempotent — calling it multiple times has the same
   * effect as calling it once.
   *
   * Validates: Requirement 12.2
   */
  it('unsubscribe is idempotent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        nonSecurityCategoryArb,
        fc.integer({ min: 2, max: 5 }),
        async (userId, category, repeatCount) => {
          for (let i = 0; i < repeatCount; i++) {
            const ok = await manager.unsubscribeFromCategory(userId, category);
            expect(ok).toBe(true);
          }

          const isUnsub = await manager.isUnsubscribed(userId, category);
          expect(isUnsub).toBe(true);

          const categories = await manager.getUnsubscribedCategories(userId);
          const occurrences = categories.filter((c) => c === category).length;
          expect(occurrences).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * After unsubscribing, the category appears in getUnsubscribedCategories.
   *
   * Validates: Requirement 12.2
   */
  it('unsubscribed category appears in getUnsubscribedCategories', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), nonSecurityCategoryArb, async (userId, category) => {
        await manager.unsubscribeFromCategory(userId, category);

        const categories = await manager.getUnsubscribedCategories(userId);
        expect(categories).toContain(category);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Token round-trip: generateUnsubscribeLink → extract token →
   * processUnsubscribe succeeds and the user is unsubscribed.
   *
   * Validates: Requirements 12.2, 12.6
   */
  it('token round-trip: generate link → process unsubscribe succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), nonSecurityCategoryArb, async (userId, category) => {
        const link = manager.generateUnsubscribeLink(userId, category);

        // Extract token from the URL query parameter
        const url = new URL(link);
        const token = url.searchParams.get('token');
        expect(token).toBeTruthy();

        const result = await manager.processUnsubscribe(token!);
        expect(result.success).toBe(true);
        expect(result.userId).toBe(userId);
        expect(result.category).toBe(category);

        // After processing, user should be unsubscribed
        const isUnsub = await manager.isUnsubscribed(userId, category);
        expect(isUnsub).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * After unsubscribing, shouldDeliver returns false for that category
   * on all channels — no further notifications of that category are delivered.
   *
   * Validates: Requirements 12.2, 12.6
   */
  it('after unsubscribing, shouldDeliver returns false for all channels', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        nonSecurityCategoryArb,
        channelArb,
        async (userId, category, channel) => {
          await manager.unsubscribeFromCategory(userId, category);

          const shouldDeliver = await preferenceService.shouldDeliver(userId, category, channel);
          expect(shouldDeliver).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
