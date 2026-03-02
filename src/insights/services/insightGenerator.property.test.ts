/**
 * Property-based tests for InsightGenerator — Sector Relevance.
 *
 * **Property 7: Sector Relevance**
 * _For any_ insight generated, it SHALL be relevant to the business's sector
 * as defined in the business profile.
 *
 * **Validates: Requirements 9.1**
 *
 * @module insights/services/insightGenerator.property.test
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { makeAnalysisContext, makeRawInsight } from '../test/fixtures.js';
import type { BusinessEvent, InsightCategory, NigerianSector, RawInsight } from '../types/index.js';

import { DismissalCooldownTracker } from './dismissalCooldown.js';
import { InsightLimitEnforcer } from './insightLimiter.js';
import { InsightAnalyzer, InsightGenerator } from './insightGenerator.js';
import { PriorityScorer } from './priorityScorer.js';

// ─── Constants ─────────────────────────────────────────────────────────────

const ALL_SECTORS: NigerianSector[] = [
  'retail',
  'services',
  'manufacturing',
  'agriculture',
  'technology',
  'healthcare',
  'education',
  'logistics',
  'hospitality',
];

const TAX_EXEMPT_SECTORS: NigerianSector[] = ['education', 'healthcare'];

const NON_EXEMPT_SECTORS: NigerianSector[] = ALL_SECTORS.filter(
  (s) => !TAX_EXEMPT_SECTORS.includes(s),
);

const VALID_CATEGORIES: InsightCategory[] = [
  'tax',
  'compliance',
  'cashflow',
  'spending',
  'revenue',
  'operational',
];

// ─── Stub Analyzer ─────────────────────────────────────────────────────────

/** Creates a stub analyzer that returns predetermined insights for a category. */
function makeStubAnalyzer(category: InsightCategory, insights: RawInsight[]): InsightAnalyzer {
  return {
    analyze: async () => insights,
    getCategory: () => category,
    getRequiredData: () => [],
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build an InsightGenerator with the given analyzers. */
function buildGenerator(analyzers: InsightAnalyzer[]): InsightGenerator {
  return new InsightGenerator({
    analyzers,
    scorer: new PriorityScorer(),
    limiter: new InsightLimitEnforcer(),
    cooldownTracker: new DismissalCooldownTracker(),
  });
}

// ─── Property Tests ────────────────────────────────────────────────────────

describe('InsightGenerator — Property 7: Sector Relevance', () => {
  /**
   * **Validates: Requirements 9.1**
   *
   * For any sector in TAX_EXEMPT_SECTORS (education, healthcare),
   * generateForBusiness never returns tax-category insights.
   */
  it('should never return tax insights for tax-exempt sectors', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...TAX_EXEMPT_SECTORS), async (sector) => {
        const taxInsight = makeRawInsight({
          category: 'tax',
          type: 'vat_liability',
          title: 'VAT liability detected',
        });

        const generator = buildGenerator([
          makeStubAnalyzer('tax', [taxInsight]),
          makeStubAnalyzer('cashflow', [
            makeRawInsight({ category: 'cashflow', type: 'negative_projection' }),
          ]),
        ]);

        const context = makeAnalysisContext({
          businessProfile: { sector } as ReturnType<typeof makeAnalysisContext>['businessProfile'],
        });
        // Ensure the sector override is applied on the full profile
        context.businessProfile = { ...context.businessProfile, sector };

        const results = await generator.generateForBusiness(context);

        expect(results.every((r) => r.category !== 'tax')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.1**
   *
   * For any sector NOT in TAX_EXEMPT_SECTORS, generateForBusiness includes
   * tax insights when the tax analyzer produces them.
   */
  it('should include tax insights for non-exempt sectors', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...NON_EXEMPT_SECTORS), async (sector) => {
        const taxInsight = makeRawInsight({
          category: 'tax',
          type: 'vat_liability',
          title: 'VAT liability detected',
        });

        const generator = buildGenerator([makeStubAnalyzer('tax', [taxInsight])]);

        const context = makeAnalysisContext();
        context.businessProfile = { ...context.businessProfile, sector };

        const results = await generator.generateForBusiness(context);

        expect(results.some((r) => r.category === 'tax')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.1**
   *
   * For any sector, all returned insights have valid categories.
   */
  it('should only return insights with valid categories for any sector', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ALL_SECTORS), async (sector) => {
        const generator = buildGenerator([
          makeStubAnalyzer('tax', [makeRawInsight({ category: 'tax', type: 'vat_liability' })]),
          makeStubAnalyzer('compliance', [
            makeRawInsight({ category: 'compliance', type: 'compliance_deadline' }),
          ]),
          makeStubAnalyzer('cashflow', [
            makeRawInsight({ category: 'cashflow', type: 'negative_projection' }),
          ]),
          makeStubAnalyzer('spending', [
            makeRawInsight({ category: 'spending', type: 'personal_spending' }),
          ]),
          makeStubAnalyzer('revenue', [
            makeRawInsight({ category: 'revenue', type: 'revenue_opportunity' }),
          ]),
        ]);

        const context = makeAnalysisContext();
        context.businessProfile = { ...context.businessProfile, sector };

        const results = await generator.generateForBusiness(context);

        for (const insight of results) {
          expect(VALID_CATEGORIES).toContain(insight.category);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.1**
   *
   * For any exempt sector, generateByCategory('tax') returns empty.
   */
  it('should return empty for generateByCategory("tax") on exempt sectors', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...TAX_EXEMPT_SECTORS), async (sector) => {
        const taxInsight = makeRawInsight({
          category: 'tax',
          type: 'vat_liability',
          title: 'VAT liability detected',
        });

        const generator = buildGenerator([makeStubAnalyzer('tax', [taxInsight])]);

        const context = makeAnalysisContext();
        context.businessProfile = { ...context.businessProfile, sector };

        const results = await generator.generateByCategory(context, 'tax');

        expect(results).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10: Real-Time Trigger Response ───────────────────────────────

/**
 * Property-based tests for InsightGenerator — Real-Time Trigger Response.
 *
 * **Property 10: Real-Time Trigger Response**
 * _For any_ significant business event, the `evaluateRealTime()` method SHALL
 * trigger real-time insight evaluation and return properly scored results.
 *
 * **Validates: Requirements 10.4**
 */

const ALL_EVENT_TYPES: BusinessEvent['type'][] = [
  'transaction_created',
  'document_processed',
  'threshold_crossed',
];

/**
 * Maps event types to the categories that should be evaluated,
 * mirroring EVENT_CATEGORY_MAP in the implementation.
 */
const EXPECTED_EVENT_CATEGORIES: Record<BusinessEvent['type'], InsightCategory[]> = {
  transaction_created: ['cashflow', 'spending', 'tax', 'revenue'],
  document_processed: ['compliance'],
  threshold_crossed: ['cashflow', 'spending', 'tax', 'revenue', 'compliance', 'operational'],
};

/** fast-check arbitrary for BusinessEvent */
const arbBusinessEvent: fc.Arbitrary<BusinessEvent> = fc.record({
  type: fc.constantFrom<BusinessEvent['type']>(...ALL_EVENT_TYPES),
  businessId: fc.uuid(),
  data: fc.constant({} as Record<string, unknown>),
  timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
});

describe('InsightGenerator — Property 10: Real-Time Trigger Response', () => {
  /**
   * **Validates: Requirements 10.4**
   *
   * For any valid BusinessEvent, evaluateRealTime returns a ScoredInsight[]
   * without throwing.
   */
  it('should return results without throwing for any valid event', async () => {
    await fc.assert(
      fc.asyncProperty(arbBusinessEvent, fc.constantFrom(...ALL_SECTORS), async (event, sector) => {
        const categories = EXPECTED_EVENT_CATEGORIES[event.type];
        const analyzers = categories.map((cat) =>
          makeStubAnalyzer(cat, [makeRawInsight({ category: cat })]),
        );

        const generator = buildGenerator(analyzers);
        const context = makeAnalysisContext();
        context.businessProfile = { ...context.businessProfile, sector };

        const results = await generator.evaluateRealTime(context, event);

        expect(Array.isArray(results)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.4**
   *
   * For any event type, evaluateRealTime handles all three event types
   * ('transaction_created', 'document_processed', 'threshold_crossed')
   * and returns scored insights from the matching categories.
   */
  it('should handle all event types and return insights from matching categories', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<BusinessEvent['type']>(...ALL_EVENT_TYPES),
        async (eventType) => {
          const expectedCategories = EXPECTED_EVENT_CATEGORIES[eventType];

          // Create analyzers for ALL categories so we can verify filtering
          const analyzers = VALID_CATEGORIES.map((cat) =>
            makeStubAnalyzer(cat, [makeRawInsight({ category: cat })]),
          );

          const generator = buildGenerator(analyzers);
          const context = makeAnalysisContext();
          // Use 'retail' — a non-exempt sector so tax insights are not filtered
          context.businessProfile = { ...context.businessProfile, sector: 'retail' };

          const event: BusinessEvent = {
            type: eventType,
            businessId: context.businessId,
            data: {},
            timestamp: new Date(),
          };

          const results = await generator.evaluateRealTime(context, event);

          // Every returned insight must belong to a category relevant to the event
          for (const insight of results) {
            expect(expectedCategories).toContain(insight.category);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.4**
   *
   * For any valid event, all returned ScoredInsights have score >= 0.
   */
  it('should return insights with score >= 0 for any event', async () => {
    await fc.assert(
      fc.asyncProperty(arbBusinessEvent, async (event) => {
        const categories = EXPECTED_EVENT_CATEGORIES[event.type];
        const analyzers = categories.map((cat) =>
          makeStubAnalyzer(cat, [makeRawInsight({ category: cat })]),
        );

        const generator = buildGenerator(analyzers);
        const context = makeAnalysisContext();
        // Use non-exempt sector to ensure insights are returned
        context.businessProfile = { ...context.businessProfile, sector: 'retail' };

        const results = await generator.evaluateRealTime(context, event);

        for (const insight of results) {
          expect(insight.score).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.4**
   *
   * For any valid event, all returned ScoredInsights have a valid priority.
   */
  it('should return insights with valid priority for any event', async () => {
    const validPriorities: string[] = ['critical', 'high', 'medium', 'low', 'info'];

    await fc.assert(
      fc.asyncProperty(arbBusinessEvent, async (event) => {
        const categories = EXPECTED_EVENT_CATEGORIES[event.type];
        const analyzers = categories.map((cat) =>
          makeStubAnalyzer(cat, [makeRawInsight({ category: cat })]),
        );

        const generator = buildGenerator(analyzers);
        const context = makeAnalysisContext();
        context.businessProfile = { ...context.businessProfile, sector: 'retail' };

        const results = await generator.evaluateRealTime(context, event);

        for (const insight of results) {
          expect(validPriorities).toContain(insight.priority);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.4**
   *
   * For any sector and event combination, evaluateRealTime completes
   * without throwing — even when analyzers return empty results.
   */
  it('should complete without throwing for arbitrary sector/event combos with empty analyzers', async () => {
    await fc.assert(
      fc.asyncProperty(arbBusinessEvent, fc.constantFrom(...ALL_SECTORS), async (event, sector) => {
        // Empty analyzers — no insights to return
        const generator = buildGenerator([]);
        const context = makeAnalysisContext();
        context.businessProfile = { ...context.businessProfile, sector };

        const results = await generator.evaluateRealTime(context, event);

        expect(Array.isArray(results)).toBe(true);
        expect(results).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
