// Gemini Integration - InsightService property-based tests
// Uses fast-check to verify universal correctness properties across random inputs

import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeminiLogger } from '../monitoring/index.js';
import type { UsageTrackerImpl } from '../monitoring/index.js';
import type { PromptManagerImpl, SystemPrompt } from '../prompts/index.js';
import { CircuitBreaker } from '../resilience/index.js';
import type { BusinessContext, InsightType, InsightSeverity } from '../types/index.js';
import { ValidationError } from '../types/index.js';

import type { GeminiClient, GeminiResponse } from './gemini-client.js';
import type { InsightServiceConfig, InsightServiceDeps } from './insight-service.js';
import { InsightServiceImpl } from './insight-service.js';

// --- Helpers ---

function makePrompt(): SystemPrompt {
  return {
    type: 'insight_generation',
    version: '1.0.0',
    systemInstruction: 'Generate business insights for Nigerian SME.',
    exampleOutputs: ['{}'],
    jsonSchema: {},
  };
}

function makeGeminiResponse(text: string, inputTokens = 150, outputTokens = 300): GeminiResponse {
  return { text, inputTokens, outputTokens };
}

function makeGeminiInsightResponseForPeriod(start: string, end: string): string {
  return JSON.stringify({
    insights: [
      {
        type: 'cashflow_risk',
        severity: 'warning',
        title: 'Cash Flow Concern',
        body: 'Your expenses are high relative to revenue this period.',
        action_items: ['Review recurring expenses'],
      },
    ],
    analysis_period: { start, end },
    confidence: 80,
  });
}

// --- Mock factories ---

function createMockClient(response?: GeminiResponse): GeminiClient {
  return {
    generate: vi
      .fn()
      .mockResolvedValue(
        response ??
          makeGeminiResponse(makeGeminiInsightResponseForPeriod('2024-01-01', '2024-01-31')),
      ),
  } as unknown as GeminiClient;
}

function createMockPromptManager(): PromptManagerImpl {
  return {
    getPrompt: vi.fn().mockImplementation(() => makePrompt()),
    getActiveVersion: vi.fn().mockReturnValue('1.0.0'),
    listVersions: vi.fn().mockReturnValue([]),
    setActiveVersion: vi.fn(),
    registerPrompt: vi.fn(),
  } as unknown as PromptManagerImpl;
}

function createMockUsageTracker(): UsageTrackerImpl {
  return {
    recordUsage: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({}),
    getStatsByOperation: vi.fn().mockResolvedValue({}),
  } as unknown as UsageTrackerImpl;
}

function createMockLogger(): GeminiLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getEntries: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
  } as unknown as GeminiLogger;
}

const defaultConfig: InsightServiceConfig = {
  insightTimeoutMs: 60_000,
  insightTemperature: 0.5,
  defaultModel: 'gemini-2.0-flash',
  maxOutputTokens: 2048,
};

function createDeps(overrides?: Partial<InsightServiceDeps>): InsightServiceDeps {
  return {
    client: createMockClient(),
    promptManager: createMockPromptManager(),
    retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
    circuitBreaker: new CircuitBreaker(),
    usageTracker: createMockUsageTracker(),
    logger: createMockLogger(),
    config: defaultConfig,
    ...overrides,
  };
}

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('test-correlation-id'),
}));

// --- Arbitraries ---

/** Generate a valid ISO date string (YYYY-MM-DD) */
const isoDateArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`);

/** Generate a valid date period where start <= end */
const periodArb = isoDateArb.chain((start) =>
  isoDateArb.map((end) => {
    // Ensure start <= end by sorting
    const sorted = [start, end].sort();
    return { start: sorted[0]!, end: sorted[1]! };
  }),
);

/** Generate a valid TransactionSummary */
const transactionSummaryArb = fc.record({
  id: fc.uuid(),
  date: isoDateArb,
  description: fc.string({ minLength: 3, maxLength: 60 }),
  amount: fc.integer({ min: 100, max: 10_000_000 }),
  type: fc.constantFrom('credit' as const, 'debit' as const),
});

/** Generate a valid BusinessContext with arbitrary period */
const businessContextArb = periodArb.chain((period) =>
  fc
    .tuple(
      fc.uuid(),
      fc.string({ minLength: 2, maxLength: 40 }),
      fc.constantFrom('retail', 'services', 'manufacturing', 'agriculture', 'technology'),
      fc.array(transactionSummaryArb, { minLength: 1, maxLength: 5 }),
    )
    .map(([businessId, businessName, businessType, transactions]) => ({
      businessId,
      businessName,
      businessType,
      transactions,
      period,
    })),
);

// --- Property Tests ---

describe('InsightService Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 27: Insight Analysis Period Consistency
   *
   * For any InsightResult, the analysis_period.start and analysis_period.end
   * SHALL match the period provided in the BusinessContext input.
   *
   * **Validates: Requirements 4.5**
   */
  describe('Property 27: Insight Analysis Period Consistency', () => {
    it('should always return analysis_period matching the input BusinessContext period', async () => {
      await fc.assert(
        fc.asyncProperty(businessContextArb, async (context) => {
          vi.clearAllMocks();

          // Mock client to return a response with potentially different period
          // (the service should override it with the input context period)
          const geminiResponseText = makeGeminiInsightResponseForPeriod('1999-01-01', '1999-12-31');
          const client = createMockClient(makeGeminiResponse(geminiResponseText));
          const freshDeps = createDeps({ client });
          const freshService = new InsightServiceImpl(freshDeps);

          const result = await freshService.generateInsights(context);

          expect(result.analysis_period.start).toBe(context.period.start);
          expect(result.analysis_period.end).toBe(context.period.end);
        }),
        { numRuns: 100 },
      );
    });

    it('should return matching analysis_period even when Gemini API fails (fallback)', async () => {
      await fc.assert(
        fc.asyncProperty(businessContextArb, async (context) => {
          vi.clearAllMocks();

          // Mock client that throws an error to trigger the fallback empty result
          const failingClient = {
            generate: vi.fn().mockRejectedValue(new Error('Gemini API unavailable')),
          } as unknown as GeminiClient;
          const freshDeps = createDeps({ client: failingClient });
          const freshService = new InsightServiceImpl(freshDeps);

          const result = await freshService.generateInsights(context);

          // Even on failure, analysis_period should match input
          expect(result.analysis_period.start).toBe(context.period.start);
          expect(result.analysis_period.end).toBe(context.period.end);
        }),
        { numRuns: 100 },
      );
    });
  });
});
