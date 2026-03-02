/**
 * Property-based tests for InsightLimitEnforcer.
 *
 * **Property 3: Insight Limit**
 * For any business, the number of active insights SHALL NOT exceed 10,
 * with lower-priority insights being auto-expired when limit is reached.
 *
 * **Validates: Requirements 7.4**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { Insight, InsightPriority, InsightStatus } from '../types/index.js';
import { makeInsight } from '../test/fixtures.js';

import { InsightLimitEnforcer, MAX_ACTIVE_INSIGHTS } from './insightLimiter.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const PRIORITIES: InsightPriority[] = ['critical', 'high', 'medium', 'low', 'info'];

const PRIORITY_RANK: Record<InsightPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const NON_ACTIVE_STATUSES: InsightStatus[] = ['acknowledged', 'dismissed', 'resolved', 'expired'];

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a random InsightPriority. */
const priorityArb = fc.constantFrom(...PRIORITIES);

/** Generate a score between 0 and 100. */
const scoreArb = fc.integer({ min: 0, max: 100 });

/** Generate an active insight with random priority and score. */
const activeInsightArb = fc
  .tuple(priorityArb, scoreArb, fc.uuid())
  .map(([priority, score, id]) => makeInsight({ id, priority, score, status: 'active' }));

/** Generate a non-active insight (acknowledged, dismissed, resolved, or expired). */
const nonActiveInsightArb = fc
  .tuple(fc.constantFrom(...NON_ACTIVE_STATUSES), priorityArb, scoreArb, fc.uuid())
  .map(([status, priority, score, id]) => makeInsight({ id, priority, score, status }));

/** Generate a list of active insights (1 to 25). */
const activeInsightsArb = fc.array(activeInsightArb, { minLength: 1, maxLength: 25 });

/** Generate a mixed list of active and non-active insights. */
const mixedInsightsArb = fc
  .tuple(
    fc.array(activeInsightArb, { minLength: 0, maxLength: 20 }),
    fc.array(nonActiveInsightArb, { minLength: 0, maxLength: 10 }),
  )
  .map(([active, nonActive]) => [...active, ...nonActive]);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Insight Limit (Property 3)', () => {
  const enforcer = new InsightLimitEnforcer();

  /**
   * **Validates: Requirements 7.4**
   * For any list of insights, enforce() never returns more than 10 active insights.
   */
  it('never returns more than MAX_ACTIVE_INSIGHTS active insights', () => {
    fc.assert(
      fc.property(activeInsightsArb, (insights) => {
        const result = enforcer.enforce(insights);
        expect(result.active.length).toBeLessThanOrEqual(MAX_ACTIVE_INSIGHTS);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   * Total count is preserved: active.length + expired.length equals the number
   * of input active insights.
   */
  it('preserves total count of active input insights across active and expired buckets', () => {
    fc.assert(
      fc.property(activeInsightsArb, (insights) => {
        const inputActiveCount = insights.filter((i) => i.status === 'active').length;
        const result = enforcer.enforce(insights);
        expect(result.active.length + result.expired.length).toBe(inputActiveCount);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   * All expired insights have lower or equal priority/score compared to all
   * active insights — the enforcer keeps the highest-priority, highest-score
   * insights active.
   */
  it('expires only lower-priority or lower-score insights', () => {
    fc.assert(
      fc.property(activeInsightsArb, (insights) => {
        const result = enforcer.enforce(insights);

        if (result.active.length === 0 || result.expired.length === 0) {
          return; // nothing to compare
        }

        // Find the "worst" kept insight (highest rank number / lowest score)
        const worstKept = result.active.reduce<Insight>((worst, current) => {
          const worstRank = PRIORITY_RANK[worst.priority];
          const currentRank = PRIORITY_RANK[current.priority];
          if (currentRank > worstRank) return current;
          if (currentRank === worstRank && current.score < worst.score) return current;
          return worst;
        }, result.active[0]!);

        // Every expired insight must be <= the worst kept insight in ordering
        for (const expired of result.expired) {
          const expiredRank = PRIORITY_RANK[expired.priority];
          const worstKeptRank = PRIORITY_RANK[worstKept.priority];

          const expiredIsWorseOrEqual =
            expiredRank > worstKeptRank ||
            (expiredRank === worstKeptRank && expired.score <= worstKept.score);

          expect(expiredIsWorseOrEqual).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   * Non-active insights (acknowledged, dismissed, resolved, expired) are
   * filtered out and never appear in the result.
   */
  it('excludes non-active insights from the result', () => {
    fc.assert(
      fc.property(mixedInsightsArb, (insights) => {
        const result = enforcer.enforce(insights);

        const allResultIds = [...result.active, ...result.expired].map((i) => i.id);
        const nonActiveIds = insights.filter((i) => i.status !== 'active').map((i) => i.id);

        for (const id of nonActiveIds) {
          expect(allResultIds).not.toContain(id);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 7.4**
   * When input has at most MAX_ACTIVE_INSIGHTS active insights, no insights
   * are expired.
   */
  it('does not expire any insights when active count is within limit', () => {
    const withinLimitArb = fc.array(activeInsightArb, {
      minLength: 0,
      maxLength: MAX_ACTIVE_INSIGHTS,
    });

    fc.assert(
      fc.property(withinLimitArb, (insights) => {
        const result = enforcer.enforce(insights);
        expect(result.expired).toHaveLength(0);
        expect(result.active.length).toBe(insights.length);
      }),
      { numRuns: 200 },
    );
  });
});
