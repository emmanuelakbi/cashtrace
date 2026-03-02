/**
 * Unit tests for InsightLimitEnforcer.
 *
 * **Validates: Requirements 7.4**
 *
 * @module insights/services/insightLimiter.test
 */

import { describe, expect, it } from 'vitest';

import { makeInsight } from '../test/fixtures.js';
import type { InsightPriority } from '../types/index.js';

import { InsightLimitEnforcer, MAX_ACTIVE_INSIGHTS } from './insightLimiter.js';

describe('InsightLimitEnforcer', () => {
  const enforcer = new InsightLimitEnforcer();
  const businessId = 'biz-001';

  describe('enforce', () => {
    it('should return all active insights when count is within limit', () => {
      const insights = Array.from({ length: 5 }, (_, i) =>
        makeInsight({ businessId, status: 'active', score: 50 + i }),
      );

      const result = enforcer.enforce(insights);

      expect(result.active).toHaveLength(5);
      expect(result.expired).toHaveLength(0);
    });

    it('should return all active insights when count equals limit', () => {
      const insights = Array.from({ length: MAX_ACTIVE_INSIGHTS }, (_, i) =>
        makeInsight({ businessId, status: 'active', score: 50 + i }),
      );

      const result = enforcer.enforce(insights);

      expect(result.active).toHaveLength(MAX_ACTIVE_INSIGHTS);
      expect(result.expired).toHaveLength(0);
    });

    it('should expire lowest-priority insights when count exceeds limit', () => {
      const insights = [
        ...Array.from({ length: 8 }, () =>
          makeInsight({ businessId, status: 'active', priority: 'high', score: 70 }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeInsight({ businessId, status: 'active', priority: 'info', score: 15 }),
        ),
      ];

      const result = enforcer.enforce(insights);

      expect(result.active).toHaveLength(MAX_ACTIVE_INSIGHTS);
      expect(result.expired).toHaveLength(3);
      // All expired should be info priority (lowest)
      for (const expired of result.expired) {
        expect(expired.priority).toBe('info');
      }
    });

    it('should expire lower-score insights within the same priority', () => {
      const insights = Array.from({ length: 12 }, (_, i) =>
        makeInsight({ businessId, status: 'active', priority: 'medium', score: i * 5 }),
      );

      const result = enforcer.enforce(insights);

      expect(result.active).toHaveLength(MAX_ACTIVE_INSIGHTS);
      expect(result.expired).toHaveLength(2);

      // The two lowest-score insights should be expired (score 0 and 5)
      const expiredScores = result.expired.map((i) => i.score).sort((a, b) => a - b);
      expect(expiredScores).toEqual([0, 5]);

      // Active insights should have the highest scores
      const minActiveScore = Math.min(...result.active.map((i) => i.score));
      const maxExpiredScore = Math.max(...result.expired.map((i) => i.score));
      expect(minActiveScore).toBeGreaterThan(maxExpiredScore);
    });

    it('should ignore non-active insights when counting', () => {
      const activeInsights = Array.from({ length: 8 }, () =>
        makeInsight({ businessId, status: 'active', score: 60 }),
      );
      const nonActiveInsights = [
        makeInsight({ businessId, status: 'dismissed', score: 90 }),
        makeInsight({ businessId, status: 'resolved', score: 85 }),
        makeInsight({ businessId, status: 'expired', score: 80 }),
        makeInsight({ businessId, status: 'acknowledged', score: 75 }),
      ];

      const result = enforcer.enforce([...activeInsights, ...nonActiveInsights]);

      expect(result.active).toHaveLength(8);
      expect(result.expired).toHaveLength(0);
    });

    it('should return empty arrays for no insights', () => {
      const result = enforcer.enforce([]);

      expect(result.active).toHaveLength(0);
      expect(result.expired).toHaveLength(0);
    });

    it('should prioritize critical insights over all others', () => {
      const insights = [
        makeInsight({ businessId, status: 'active', priority: 'critical', score: 90 }),
        makeInsight({ businessId, status: 'active', priority: 'critical', score: 85 }),
        ...Array.from({ length: 6 }, () =>
          makeInsight({ businessId, status: 'active', priority: 'high', score: 65 }),
        ),
        ...Array.from({ length: 5 }, () =>
          makeInsight({ businessId, status: 'active', priority: 'low', score: 25 }),
        ),
      ];

      const result = enforcer.enforce(insights);

      expect(result.active).toHaveLength(MAX_ACTIVE_INSIGHTS);
      // Both critical insights must be in active
      const activeCritical = result.active.filter((i) => i.priority === 'critical');
      expect(activeCritical).toHaveLength(2);
      // All expired should be low priority
      for (const expired of result.expired) {
        expect(expired.priority).toBe('low');
      }
    });

    it('should keep higher-priority insights when enforcing limit', () => {
      const priorities: InsightPriority[] = [
        'info',
        'low',
        'medium',
        'high',
        'critical',
        'info',
        'low',
        'medium',
        'high',
        'critical',
        'info',
        'low',
      ];
      const insights = priorities.map((priority, i) =>
        makeInsight({ businessId, status: 'active', priority, score: (i + 1) * 5 }),
      );

      const result = enforcer.enforce(insights);

      expect(result.active).toHaveLength(MAX_ACTIVE_INSIGHTS);
      expect(result.expired).toHaveLength(2);
      // The expired insights should be the lowest-priority ones (info)
      for (const expired of result.expired) {
        expect(expired.priority).toBe('info');
      }
    });
  });
});
