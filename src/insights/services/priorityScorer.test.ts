/**
 * Unit tests for PriorityScorer.
 *
 * **Validates: Requirements 7.1, 7.2**
 *
 * @module insights/services/priorityScorer.test
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { makeInsight, makeRawInsight } from '../test/fixtures.js';
import type { ScoringContext, UserEngagement } from '../types/index.js';

import { PriorityScorer } from './priorityScorer.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeEngagement(overrides: Partial<UserEngagement> = {}): UserEngagement {
  return {
    viewRate: 0.7,
    acknowledgeRate: 0.5,
    dismissRate: 0.1,
    resolveRate: 0.6,
    avgResponseTimeMs: 3600_000,
    ...overrides,
  };
}

function makeContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    businessSize: 'small',
    userEngagement: makeEngagement(),
    existingInsights: [],
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('PriorityScorer', () => {
  let scorer: PriorityScorer;

  beforeEach(() => {
    scorer = new PriorityScorer();
  });

  // ── score() ────────────────────────────────────────────────────────────

  describe('score()', () => {
    it('returns a ScoredInsight with score, priority, and factors', () => {
      const raw = makeRawInsight({ financialImpact: 1_000_000_00, urgency: 80, confidence: 70 });
      const ctx = makeContext();

      const result = scorer.score(raw, ctx);

      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('priority');
      expect(result).toHaveProperty('factors');
      expect(result.factors).toHaveLength(4);
    });

    it('produces a score in the 0–100 range', () => {
      const raw = makeRawInsight({ financialImpact: 500_000_00, urgency: 50, confidence: 50 });
      const ctx = makeContext();

      const result = scorer.score(raw, ctx);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('assigns higher scores to insights with larger financial impact', () => {
      const ctx = makeContext();
      const lowImpact = makeRawInsight({ financialImpact: 10_000_00, urgency: 50, confidence: 50 });
      const highImpact = makeRawInsight({
        financialImpact: 10_000_000_00,
        urgency: 50,
        confidence: 50,
      });

      const lowResult = scorer.score(lowImpact, ctx);
      const highResult = scorer.score(highImpact, ctx);

      expect(highResult.score).toBeGreaterThan(lowResult.score);
    });

    it('assigns higher scores to more urgent insights', () => {
      const ctx = makeContext();
      const lowUrgency = makeRawInsight({
        financialImpact: 500_000_00,
        urgency: 10,
        confidence: 50,
      });
      const highUrgency = makeRawInsight({
        financialImpact: 500_000_00,
        urgency: 90,
        confidence: 50,
      });

      const lowResult = scorer.score(lowUrgency, ctx);
      const highResult = scorer.score(highUrgency, ctx);

      expect(highResult.score).toBeGreaterThan(lowResult.score);
    });

    it('includes all four scoring factors', () => {
      const raw = makeRawInsight();
      const ctx = makeContext();

      const result = scorer.score(raw, ctx);
      const factorNames = result.factors.map((f) => f.name);

      expect(factorNames).toContain('financialImpact');
      expect(factorNames).toContain('urgency');
      expect(factorNames).toContain('confidence');
      expect(factorNames).toContain('relevance');
    });

    it('factor weights sum to 1.0', () => {
      const raw = makeRawInsight();
      const ctx = makeContext();

      const result = scorer.score(raw, ctx);
      const totalWeight = result.factors.reduce((sum, f) => sum + f.weight, 0);

      expect(totalWeight).toBeCloseTo(1.0);
    });

    it('reduces relevance when many active insights exist in the same category', () => {
      const raw = makeRawInsight({
        category: 'cashflow',
        urgency: 50,
        confidence: 50,
        financialImpact: 500_000_00,
      });
      const noExisting = makeContext({ existingInsights: [] });
      const manyExisting = makeContext({
        existingInsights: [
          makeInsight({ category: 'cashflow', status: 'active' }),
          makeInsight({ category: 'cashflow', status: 'active' }),
          makeInsight({ category: 'cashflow', status: 'active' }),
        ],
      });

      const freshResult = scorer.score(raw, noExisting);
      const saturatedResult = scorer.score(raw, manyExisting);

      expect(freshResult.score).toBeGreaterThanOrEqual(saturatedResult.score);
    });

    it('boosts score for low-engagement users', () => {
      const raw = makeRawInsight({ financialImpact: 500_000_00, urgency: 50, confidence: 50 });
      const highEngagement = makeContext({
        userEngagement: makeEngagement({ viewRate: 0.9, acknowledgeRate: 0.8, resolveRate: 0.7 }),
      });
      const lowEngagement = makeContext({
        userEngagement: makeEngagement({ viewRate: 0.1, acknowledgeRate: 0.05, resolveRate: 0.05 }),
      });

      const highResult = scorer.score(raw, highEngagement);
      const lowResult = scorer.score(raw, lowEngagement);

      expect(lowResult.score).toBeGreaterThanOrEqual(highResult.score);
    });

    it('applies business size multiplier to relevance', () => {
      const raw = makeRawInsight({ financialImpact: 500_000_00, urgency: 50, confidence: 50 });
      const micro = makeContext({ businessSize: 'micro' });
      const medium = makeContext({ businessSize: 'medium' });

      const microResult = scorer.score(raw, micro);
      const mediumResult = scorer.score(raw, medium);

      // Micro businesses get a 1.2x relevance multiplier vs 0.9x for medium
      expect(microResult.score).toBeGreaterThanOrEqual(mediumResult.score);
    });

    it('preserves all original RawInsight fields in the result', () => {
      const raw = makeRawInsight({ title: 'Test Insight', body: 'Test body' });
      const ctx = makeContext();

      const result = scorer.score(raw, ctx);

      expect(result.title).toBe('Test Insight');
      expect(result.body).toBe('Test body');
      expect(result.category).toBe(raw.category);
      expect(result.type).toBe(raw.type);
      expect(result.actionItems).toEqual(raw.actionItems);
    });
  });

  // ── calculatePriority() ────────────────────────────────────────────────

  describe('calculatePriority()', () => {
    it('returns "critical" for scores >= 80', () => {
      expect(scorer.calculatePriority(80)).toBe('critical');
      expect(scorer.calculatePriority(100)).toBe('critical');
      expect(scorer.calculatePriority(95)).toBe('critical');
    });

    it('returns "high" for scores 60–79', () => {
      expect(scorer.calculatePriority(60)).toBe('high');
      expect(scorer.calculatePriority(79)).toBe('high');
    });

    it('returns "medium" for scores 40–59', () => {
      expect(scorer.calculatePriority(40)).toBe('medium');
      expect(scorer.calculatePriority(59)).toBe('medium');
    });

    it('returns "low" for scores 20–39', () => {
      expect(scorer.calculatePriority(20)).toBe('low');
      expect(scorer.calculatePriority(39)).toBe('low');
    });

    it('returns "info" for scores 0–19', () => {
      expect(scorer.calculatePriority(0)).toBe('info');
      expect(scorer.calculatePriority(19)).toBe('info');
    });

    it('clamps scores above 100 to "critical"', () => {
      expect(scorer.calculatePriority(150)).toBe('critical');
    });

    it('clamps negative scores to "info"', () => {
      expect(scorer.calculatePriority(-10)).toBe('info');
    });
  });
});
