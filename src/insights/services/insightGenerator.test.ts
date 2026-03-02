/**
 * Unit tests for InsightGenerator.
 *
 * **Validates: Requirements 9.1, 9.5**
 *
 * @module insights/services/insightGenerator.test
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  makeAnalysisContext,
  makeBusinessProfile,
  makeInsight,
  makeRawInsight,
} from '../test/fixtures.js';
import type {
  AnalysisContext,
  BusinessEvent,
  InsightCategory,
  RawInsight,
} from '../types/index.js';

import { DismissalCooldownTracker } from './dismissalCooldown.js';
import { InsightLimitEnforcer } from './insightLimiter.js';
import { InsightGenerator, type InsightAnalyzer } from './insightGenerator.js';
import { PriorityScorer } from './priorityScorer.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Create a stub analyzer that returns the given raw insights. */
function makeStubAnalyzer(category: InsightCategory, insights: RawInsight[] = []): InsightAnalyzer {
  return {
    analyze: async (_ctx: AnalysisContext) => insights,
    getCategory: () => category,
    getRequiredData: () => [],
  };
}

/** Create a default InsightGenerator with all analyzers. */
function makeGenerator(
  analyzers: InsightAnalyzer[],
  overrides: {
    scorer?: PriorityScorer;
    limiter?: InsightLimitEnforcer;
    cooldownTracker?: DismissalCooldownTracker;
  } = {},
): InsightGenerator {
  return new InsightGenerator({
    analyzers,
    scorer: overrides.scorer ?? new PriorityScorer(),
    limiter: overrides.limiter ?? new InsightLimitEnforcer(),
    cooldownTracker: overrides.cooldownTracker ?? new DismissalCooldownTracker(),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('InsightGenerator', () => {
  let scorer: PriorityScorer;
  let limiter: InsightLimitEnforcer;
  let cooldownTracker: DismissalCooldownTracker;

  beforeEach(() => {
    scorer = new PriorityScorer();
    limiter = new InsightLimitEnforcer();
    cooldownTracker = new DismissalCooldownTracker();
  });

  // ── generateForBusiness() ──────────────────────────────────────────────

  describe('generateForBusiness()', () => {
    it('returns scored insights from all analyzers', async () => {
      const taxInsight = makeRawInsight({
        category: 'tax',
        type: 'vat_liability',
        financialImpact: 500_000_00,
        urgency: 80,
      });
      const cashflowInsight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        financialImpact: 1_000_000_00,
        urgency: 90,
      });

      const analyzers = [
        makeStubAnalyzer('tax', [taxInsight]),
        makeStubAnalyzer('cashflow', [cashflowInsight]),
      ];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();

      const results = await generator.generateForBusiness(context);

      expect(results).toHaveLength(2);
      expect(results.every((r) => typeof r.score === 'number')).toBe(true);
      expect(results.every((r) => typeof r.priority === 'string')).toBe(true);
    });

    it('returns empty array when no analyzers produce insights', async () => {
      const analyzers = [makeStubAnalyzer('tax', []), makeStubAnalyzer('cashflow', [])];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();

      const results = await generator.generateForBusiness(context);

      expect(results).toHaveLength(0);
    });

    it('sorts results by priority then score (highest first)', async () => {
      const criticalInsight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        title: 'Critical cashflow',
        financialImpact: 10_000_000_00,
        urgency: 95,
        confidence: 90,
      });
      const lowInsight = makeRawInsight({
        category: 'spending',
        type: 'personal_spending',
        title: 'Low spending',
        financialImpact: 10_000_00,
        urgency: 10,
        confidence: 30,
      });

      const analyzers = [
        makeStubAnalyzer('spending', [lowInsight]),
        makeStubAnalyzer('cashflow', [criticalInsight]),
      ];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();

      const results = await generator.generateForBusiness(context);

      expect(results.length).toBeGreaterThanOrEqual(2);
      // First result should have higher or equal priority rank
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
    });

    it('filters out dismissed insights within cooldown period', async () => {
      const insight = makeRawInsight({
        category: 'tax',
        type: 'vat_liability',
        financialImpact: 500_000_00,
        urgency: 80,
      });

      const context = makeAnalysisContext();
      cooldownTracker.recordDismissal(context.businessId, 'vat_liability');

      const analyzers = [makeStubAnalyzer('tax', [insight])];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });

      const results = await generator.generateForBusiness(context);

      expect(results).toHaveLength(0);
    });

    it('enforces the 10-insight limit', async () => {
      // Create 15 insights across multiple analyzers
      const manyInsights: RawInsight[] = [];
      for (let i = 0; i < 15; i++) {
        manyInsights.push(
          makeRawInsight({
            category: 'cashflow',
            type: 'cashflow_risk',
            title: `Insight ${i}`,
            financialImpact: (15 - i) * 100_000_00,
            urgency: 50 + i,
            confidence: 70,
          }),
        );
      }

      const analyzers = [makeStubAnalyzer('cashflow', manyInsights)];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();

      const results = await generator.generateForBusiness(context);

      expect(results.length).toBeLessThanOrEqual(10);
    });

    // ── Sector-based filtering (Req 9.1) ─────────────────────────────────

    it('skips tax analyzer for education sector (Req 9.1)', async () => {
      const taxInsight = makeRawInsight({
        category: 'tax',
        type: 'vat_liability',
        financialImpact: 500_000_00,
        urgency: 80,
      });
      const complianceInsight = makeRawInsight({
        category: 'compliance',
        type: 'compliance_deadline',
        financialImpact: 0,
        urgency: 60,
      });

      const analyzers = [
        makeStubAnalyzer('tax', [taxInsight]),
        makeStubAnalyzer('compliance', [complianceInsight]),
      ];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext({
        businessProfile: makeBusinessProfile({ sector: 'education' }),
      });

      const results = await generator.generateForBusiness(context);

      // Should only have compliance insight, not tax
      const categories = results.map((r) => r.category);
      expect(categories).not.toContain('tax');
      expect(categories).toContain('compliance');
    });

    it('skips tax analyzer for healthcare sector (Req 9.1)', async () => {
      const taxInsight = makeRawInsight({
        category: 'tax',
        type: 'vat_liability',
        financialImpact: 500_000_00,
        urgency: 80,
      });

      const analyzers = [makeStubAnalyzer('tax', [taxInsight])];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext({
        businessProfile: makeBusinessProfile({ sector: 'healthcare' }),
      });

      const results = await generator.generateForBusiness(context);

      expect(results).toHaveLength(0);
    });

    it('includes tax analyzer for retail sector (Req 9.1)', async () => {
      const taxInsight = makeRawInsight({
        category: 'tax',
        type: 'vat_liability',
        financialImpact: 500_000_00,
        urgency: 80,
      });

      const analyzers = [makeStubAnalyzer('tax', [taxInsight])];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext({
        businessProfile: makeBusinessProfile({ sector: 'retail' }),
      });

      const results = await generator.generateForBusiness(context);

      expect(results).toHaveLength(1);
      expect(results[0]!.category).toBe('tax');
    });

    // ── Business size consideration (Req 9.5) ────────────────────────────

    it('passes business size to scoring context (Req 9.5)', async () => {
      const insight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        financialImpact: 500_000_00,
        urgency: 50,
        confidence: 50,
      });

      const analyzers = [makeStubAnalyzer('cashflow', [insight])];

      // Micro businesses get a higher relevance multiplier
      const microGenerator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const microContext = makeAnalysisContext({
        businessProfile: makeBusinessProfile({ size: 'micro' }),
      });
      const microResults = await microGenerator.generateForBusiness(microContext);

      const mediumGenerator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const mediumContext = makeAnalysisContext({
        businessProfile: makeBusinessProfile({ size: 'medium' }),
      });
      const mediumResults = await mediumGenerator.generateForBusiness(mediumContext);

      // Both should produce results, but micro may have slightly higher score
      expect(microResults).toHaveLength(1);
      expect(mediumResults).toHaveLength(1);
      expect(microResults[0]!.score).toBeGreaterThanOrEqual(mediumResults[0]!.score);
    });
  });

  // ── generateByCategory() ───────────────────────────────────────────────

  describe('generateByCategory()', () => {
    it('returns insights only from the matching analyzer', async () => {
      const taxInsight = makeRawInsight({
        category: 'tax',
        type: 'vat_liability',
        financialImpact: 500_000_00,
        urgency: 80,
      });
      const cashflowInsight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        financialImpact: 1_000_000_00,
        urgency: 90,
      });

      const analyzers = [
        makeStubAnalyzer('tax', [taxInsight]),
        makeStubAnalyzer('cashflow', [cashflowInsight]),
      ];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();

      const results = await generator.generateByCategory(context, 'tax');

      expect(results).toHaveLength(1);
      expect(results[0]!.category).toBe('tax');
    });

    it('returns empty array when no analyzer matches the category', async () => {
      const analyzers = [makeStubAnalyzer('tax', [makeRawInsight()])];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();

      const results = await generator.generateByCategory(context, 'revenue');

      expect(results).toHaveLength(0);
    });

    it('respects sector filtering for category requests (Req 9.1)', async () => {
      const taxInsight = makeRawInsight({
        category: 'tax',
        type: 'vat_liability',
        financialImpact: 500_000_00,
        urgency: 80,
      });

      const analyzers = [makeStubAnalyzer('tax', [taxInsight])];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext({
        businessProfile: makeBusinessProfile({ sector: 'education' }),
      });

      const results = await generator.generateByCategory(context, 'tax');

      expect(results).toHaveLength(0);
    });

    it('filters out dismissed insights in category results', async () => {
      const insight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        financialImpact: 1_000_000_00,
        urgency: 90,
      });

      const context = makeAnalysisContext();
      cooldownTracker.recordDismissal(context.businessId, 'cashflow_risk');

      const analyzers = [makeStubAnalyzer('cashflow', [insight])];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });

      const results = await generator.generateByCategory(context, 'cashflow');

      expect(results).toHaveLength(0);
    });

    it('sorts category results by priority then score', async () => {
      const highInsight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        title: 'High urgency',
        financialImpact: 5_000_000_00,
        urgency: 90,
        confidence: 85,
      });
      const lowInsight = makeRawInsight({
        category: 'cashflow',
        type: 'negative_projection',
        title: 'Low urgency',
        financialImpact: 100_000_00,
        urgency: 20,
        confidence: 50,
      });

      const analyzers = [makeStubAnalyzer('cashflow', [lowInsight, highInsight])];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();

      const results = await generator.generateByCategory(context, 'cashflow');

      expect(results.length).toBe(2);
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
    });
  });

  // ── evaluateRealTime() ──────────────────────────────────────────────

  describe('evaluateRealTime()', () => {
    /** Helper to create a BusinessEvent. */
    function makeEvent(overrides: Partial<BusinessEvent> = {}): BusinessEvent {
      return {
        type: 'transaction_created',
        businessId: 'biz-1',
        data: {},
        timestamp: new Date(),
        ...overrides,
      };
    }

    it('runs transaction-related analyzers for transaction_created event', async () => {
      const cashflowInsight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        financialImpact: 1_000_000_00,
        urgency: 80,
      });
      const complianceInsight = makeRawInsight({
        category: 'compliance',
        type: 'compliance_deadline',
        financialImpact: 0,
        urgency: 50,
      });

      const analyzers = [
        makeStubAnalyzer('cashflow', [cashflowInsight]),
        makeStubAnalyzer('compliance', [complianceInsight]),
      ];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();
      const event = makeEvent({ type: 'transaction_created' });

      const results = await generator.evaluateRealTime(context, event);

      // Should include cashflow (transaction-related) but NOT compliance
      const categories = results.map((r) => r.category);
      expect(categories).toContain('cashflow');
      expect(categories).not.toContain('compliance');
    });

    it('runs compliance analyzer for document_processed event', async () => {
      const complianceInsight = makeRawInsight({
        category: 'compliance',
        type: 'compliance_deadline',
        financialImpact: 0,
        urgency: 60,
      });
      const cashflowInsight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        financialImpact: 500_000_00,
        urgency: 70,
      });

      const analyzers = [
        makeStubAnalyzer('compliance', [complianceInsight]),
        makeStubAnalyzer('cashflow', [cashflowInsight]),
      ];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();
      const event = makeEvent({ type: 'document_processed' });

      const results = await generator.evaluateRealTime(context, event);

      const categories = results.map((r) => r.category);
      expect(categories).toContain('compliance');
      expect(categories).not.toContain('cashflow');
    });

    it('runs all analyzers for threshold_crossed event', async () => {
      const cashflowInsight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        financialImpact: 1_000_000_00,
        urgency: 80,
      });
      const complianceInsight = makeRawInsight({
        category: 'compliance',
        type: 'compliance_deadline',
        financialImpact: 0,
        urgency: 50,
      });
      const taxInsight = makeRawInsight({
        category: 'tax',
        type: 'vat_liability',
        financialImpact: 500_000_00,
        urgency: 70,
      });

      const analyzers = [
        makeStubAnalyzer('cashflow', [cashflowInsight]),
        makeStubAnalyzer('compliance', [complianceInsight]),
        makeStubAnalyzer('tax', [taxInsight]),
      ];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();
      const event = makeEvent({ type: 'threshold_crossed' });

      const results = await generator.evaluateRealTime(context, event);

      const categories = results.map((r) => r.category);
      expect(categories).toContain('cashflow');
      expect(categories).toContain('compliance');
      expect(categories).toContain('tax');
    });

    it('respects sector filtering for real-time events', async () => {
      const taxInsight = makeRawInsight({
        category: 'tax',
        type: 'vat_liability',
        financialImpact: 500_000_00,
        urgency: 80,
      });
      const spendingInsight = makeRawInsight({
        category: 'spending',
        type: 'personal_spending',
        financialImpact: 100_000_00,
        urgency: 40,
      });

      const analyzers = [
        makeStubAnalyzer('tax', [taxInsight]),
        makeStubAnalyzer('spending', [spendingInsight]),
      ];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext({
        businessProfile: makeBusinessProfile({ sector: 'education' }),
      });
      const event = makeEvent({ type: 'transaction_created' });

      const results = await generator.evaluateRealTime(context, event);

      // Tax should be excluded for education sector
      const categories = results.map((r) => r.category);
      expect(categories).not.toContain('tax');
      expect(categories).toContain('spending');
    });

    it('filters out dismissed insights in real-time evaluation', async () => {
      const insight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        financialImpact: 1_000_000_00,
        urgency: 90,
      });

      const context = makeAnalysisContext();
      cooldownTracker.recordDismissal(context.businessId, 'cashflow_risk');

      const analyzers = [makeStubAnalyzer('cashflow', [insight])];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const event = makeEvent({ type: 'transaction_created' });

      const results = await generator.evaluateRealTime(context, event);

      expect(results).toHaveLength(0);
    });

    it('sorts real-time results by priority then score', async () => {
      const highInsight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        title: 'Critical cashflow',
        financialImpact: 10_000_000_00,
        urgency: 95,
        confidence: 90,
      });
      const lowInsight = makeRawInsight({
        category: 'spending',
        type: 'personal_spending',
        title: 'Low spending',
        financialImpact: 10_000_00,
        urgency: 10,
        confidence: 30,
      });

      const analyzers = [
        makeStubAnalyzer('cashflow', [highInsight]),
        makeStubAnalyzer('spending', [lowInsight]),
      ];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();
      const event = makeEvent({ type: 'transaction_created' });

      const results = await generator.evaluateRealTime(context, event);

      expect(results.length).toBe(2);
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
    });

    it('returns empty array when no analyzers match the event type', async () => {
      // Only have a revenue analyzer, but document_processed only triggers compliance
      const revenueInsight = makeRawInsight({
        category: 'revenue',
        type: 'revenue_opportunity',
        financialImpact: 500_000_00,
        urgency: 50,
      });

      const analyzers = [makeStubAnalyzer('revenue', [revenueInsight])];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();
      const event = makeEvent({ type: 'document_processed' });

      const results = await generator.evaluateRealTime(context, event);

      expect(results).toHaveLength(0);
    });

    it('returns empty array when analyzers produce no insights', async () => {
      const analyzers = [makeStubAnalyzer('cashflow', [])];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();
      const event = makeEvent({ type: 'transaction_created' });

      const results = await generator.evaluateRealTime(context, event);

      expect(results).toHaveLength(0);
    });

    it('includes spending, tax, and revenue analyzers for transaction_created', async () => {
      const spendingInsight = makeRawInsight({
        category: 'spending',
        type: 'personal_spending',
        financialImpact: 200_000_00,
        urgency: 40,
      });
      const taxInsight = makeRawInsight({
        category: 'tax',
        type: 'vat_liability',
        financialImpact: 500_000_00,
        urgency: 70,
      });
      const revenueInsight = makeRawInsight({
        category: 'revenue',
        type: 'revenue_opportunity',
        financialImpact: 300_000_00,
        urgency: 50,
      });

      const analyzers = [
        makeStubAnalyzer('spending', [spendingInsight]),
        makeStubAnalyzer('tax', [taxInsight]),
        makeStubAnalyzer('revenue', [revenueInsight]),
      ];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();
      const event = makeEvent({ type: 'transaction_created' });

      const results = await generator.evaluateRealTime(context, event);

      const categories = results.map((r) => r.category);
      expect(categories).toContain('spending');
      expect(categories).toContain('tax');
      expect(categories).toContain('revenue');
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty analyzer list', async () => {
      const generator = makeGenerator([], { scorer, limiter, cooldownTracker });
      const context = makeAnalysisContext();

      const results = await generator.generateForBusiness(context);

      expect(results).toHaveLength(0);
    });

    it('handles all insights being dismissed', async () => {
      const insight1 = makeRawInsight({
        category: 'tax',
        type: 'vat_liability',
        urgency: 80,
      });
      const insight2 = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        urgency: 90,
      });

      const context = makeAnalysisContext();
      cooldownTracker.recordDismissal(context.businessId, 'vat_liability');
      cooldownTracker.recordDismissal(context.businessId, 'cashflow_risk');

      const analyzers = [
        makeStubAnalyzer('tax', [insight1]),
        makeStubAnalyzer('cashflow', [insight2]),
      ];
      const generator = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });

      const results = await generator.generateForBusiness(context);

      expect(results).toHaveLength(0);
    });

    it('includes previous insights in scoring context', async () => {
      const insight = makeRawInsight({
        category: 'cashflow',
        type: 'cashflow_risk',
        financialImpact: 500_000_00,
        urgency: 50,
        confidence: 50,
      });

      const analyzers = [makeStubAnalyzer('cashflow', [insight])];

      // With no previous insights
      const generator1 = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context1 = makeAnalysisContext({ previousInsights: [] });
      const results1 = await generator1.generateForBusiness(context1);

      // With many previous active cashflow insights (reduces relevance)
      const generator2 = makeGenerator(analyzers, { scorer, limiter, cooldownTracker });
      const context2 = makeAnalysisContext({
        previousInsights: [
          makeInsight({ category: 'cashflow', status: 'active' }),
          makeInsight({ category: 'cashflow', status: 'active' }),
          makeInsight({ category: 'cashflow', status: 'active' }),
        ],
      });
      const results2 = await generator2.generateForBusiness(context2);

      expect(results1).toHaveLength(1);
      expect(results2).toHaveLength(1);
      // Score with no existing insights should be >= score with many existing
      expect(results1[0]!.score).toBeGreaterThanOrEqual(results2[0]!.score);
    });
  });
});
