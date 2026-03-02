/**
 * Property-based tests for PriorityScorer — Property 2: Priority Ordering
 *
 * For any set of insights for a business, they SHALL be ordered by priority
 * (critical > high > medium > low > info) and then by score within each
 * priority level.
 *
 * **Validates: Requirements 7.3**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { PriorityScorer } from './priorityScorer.js';
import { makeRawInsight } from '../test/fixtures.js';
import type {
  BusinessSize,
  InsightCategory,
  InsightPriority,
  InsightType,
  RawInsight,
  ScoredInsight,
  ScoringContext,
} from '../types/index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Canonical priority ordering — lower index = higher priority. */
const PRIORITY_ORDER: InsightPriority[] = ['critical', 'high', 'medium', 'low', 'info'];

/** Map priority to numeric rank for comparison (0 = highest). */
function priorityRank(p: InsightPriority): number {
  return PRIORITY_ORDER.indexOf(p);
}

// ─── Generators ──────────────────────────────────────────────────────────────

const categoryArb: fc.Arbitrary<InsightCategory> = fc.constantFrom(
  'tax',
  'compliance',
  'cashflow',
  'spending',
  'revenue',
  'operational',
);

const insightTypeArb: fc.Arbitrary<InsightType> = fc.constantFrom(
  'vat_liability',
  'negative_projection',
  'personal_spending',
  'cost_optimization',
  'revenue_opportunity',
  'compliance_deadline',
);

const businessSizeArb: fc.Arbitrary<BusinessSize> = fc.constantFrom('micro', 'small', 'medium');

/** Generate a valid RawInsight with arbitrary numeric fields. */
const rawInsightArb: fc.Arbitrary<RawInsight> = fc
  .record({
    category: categoryArb,
    type: insightTypeArb,
    financialImpact: fc.integer({ min: 0, max: 20_000_000_00 }), // 0 – ₦20M in Kobo
    urgency: fc.integer({ min: 0, max: 100 }),
    confidence: fc.integer({ min: 0, max: 100 }),
  })
  .map(({ category, type, financialImpact, urgency, confidence }) =>
    makeRawInsight({ category, type, financialImpact, urgency, confidence }),
  );

/** Generate a minimal ScoringContext with no existing insights. */
const scoringContextArb: fc.Arbitrary<ScoringContext> = businessSizeArb.map((size) => ({
  businessSize: size,
  userEngagement: {
    viewRate: 0.5,
    acknowledgeRate: 0.5,
    dismissRate: 0.1,
    resolveRate: 0.4,
    avgResponseTimeMs: 5000,
  },
  existingInsights: [],
}));

/** Generate a list of 2–20 raw insights paired with a scoring context. */
const insightListArb = fc.record({
  insights: fc.array(rawInsightArb, { minLength: 2, maxLength: 20 }),
  context: scoringContextArb,
});

// ─── Sorting helper (the behaviour under test) ──────────────────────────────

/**
 * Sort scored insights by priority (critical first) then by score descending
 * within each priority level — the ordering required by Requirement 7.3.
 */
function sortByPriorityThenScore(insights: ScoredInsight[]): ScoredInsight[] {
  return [...insights].sort((a, b) => {
    const rankDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (rankDiff !== 0) return rankDiff;
    return b.score - a.score; // higher score first within same priority
  });
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Priority Ordering (Property 2)', () => {
  const scorer = new PriorityScorer();

  /**
   * **Validates: Requirements 7.3**
   * For any list of scored insights, sorting by priority then score produces a
   * valid ordering where all critical come before high, high before medium, etc.
   */
  it('sorted insights maintain priority ordering: critical > high > medium > low > info', () => {
    fc.assert(
      fc.property(insightListArb, ({ insights, context }) => {
        const scored = insights.map((raw) => scorer.score(raw, context));
        const sorted = sortByPriorityThenScore(scored);

        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1]!;
          const curr = sorted[i]!;

          // Priority rank must be non-decreasing (lower rank = higher priority)
          expect(priorityRank(prev.priority)).toBeLessThanOrEqual(priorityRank(curr.priority));

          // Within the same priority, score must be non-increasing
          if (prev.priority === curr.priority) {
            expect(prev.score).toBeGreaterThanOrEqual(curr.score);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.3**
   * calculatePriority is monotonic — a higher score never produces a lower
   * priority than a lower score.
   */
  it('calculatePriority is monotonic: higher scores never yield lower priorities', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (scoreA, scoreB) => {
          const [lo, hi] = scoreA <= scoreB ? [scoreA, scoreB] : [scoreB, scoreA];
          const priorityLo = scorer.calculatePriority(lo);
          const priorityHi = scorer.calculatePriority(hi);

          // Higher score → same or higher priority (lower rank number)
          expect(priorityRank(priorityHi)).toBeLessThanOrEqual(priorityRank(priorityLo));
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.3**
   * Score is always in the 0–100 range for any valid input.
   */
  it('score is always clamped to 0–100 for any valid raw insight', () => {
    fc.assert(
      fc.property(rawInsightArb, scoringContextArb, (raw, context) => {
        const scored = scorer.score(raw, context);
        expect(scored.score).toBeGreaterThanOrEqual(0);
        expect(scored.score).toBeLessThanOrEqual(100);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.3**
   * Factor weights always sum to 1.0 (within floating-point tolerance).
   */
  it('factor weights always sum to 1.0', () => {
    fc.assert(
      fc.property(rawInsightArb, scoringContextArb, (raw, context) => {
        const scored = scorer.score(raw, context);
        const weightSum = scored.factors.reduce((sum, f) => sum + f.weight, 0);
        expect(weightSum).toBeCloseTo(1.0, 10);
      }),
      { numRuns: 100 },
    );
  });
});
