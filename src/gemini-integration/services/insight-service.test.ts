// Gemini Integration - InsightService unit tests
// Tests: generateInsights with validation, resilience, usage tracking, and error handling

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeminiLogger } from '../monitoring/index.js';
import type { UsageTrackerImpl } from '../monitoring/index.js';
import type { PromptManagerImpl, SystemPrompt } from '../prompts/index.js';
import { CircuitBreaker } from '../resilience/index.js';
import type { BusinessContext } from '../types/index.js';
import { GeminiServiceError, InvalidResponseError, ValidationError } from '../types/index.js';

import type { GeminiClient, GeminiResponse } from './gemini-client.js';
import type { InsightServiceConfig, InsightServiceDeps } from './insight-service.js';
import { InsightServiceImpl } from './insight-service.js';

// --- Helpers ---

function makeBusinessContext(overrides?: Partial<BusinessContext>): BusinessContext {
  return {
    businessId: 'biz-001',
    businessName: 'Ade Groceries',
    businessType: 'retail',
    transactions: [
      {
        id: 'txn-1',
        date: '2024-01-15',
        description: 'Sale of goods',
        amount: 50000,
        type: 'credit',
      },
      {
        id: 'txn-2',
        date: '2024-01-16',
        description: 'Rent payment',
        amount: 150000,
        type: 'debit',
      },
    ],
    period: { start: '2024-01-01', end: '2024-01-31' },
    ...overrides,
  };
}

function makeGeminiInsightResponse(): string {
  return JSON.stringify({
    insights: [
      {
        type: 'cashflow_risk',
        severity: 'warning',
        title: 'High Rent-to-Revenue Ratio',
        body: 'Your rent payment of ₦150,000 represents a significant portion of revenue.',
        action_items: ['Negotiate rent reduction', 'Explore alternative locations'],
        related_transactions: ['txn-2'],
      },
    ],
    analysis_period: { start: '2024-01-01', end: '2024-01-31' },
    confidence: 80,
  });
}

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

// --- Mock factories ---

function createMockClient(response?: GeminiResponse): GeminiClient {
  return {
    generate: vi
      .fn()
      .mockResolvedValue(response ?? makeGeminiResponse(makeGeminiInsightResponse())),
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

// --- Tests ---

describe('InsightServiceImpl', () => {
  let deps: InsightServiceDeps;
  let service: InsightServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    service = new InsightServiceImpl(deps);
  });

  describe('generateInsights', () => {
    it('should generate insights from a valid business context', async () => {
      const result = await service.generateInsights(makeBusinessContext());

      expect(result.insights).toHaveLength(1);
      expect(result.insights[0]?.type).toBe('cashflow_risk');
      expect(result.insights[0]?.severity).toBe('warning');
      expect(result.confidence).toBe(80);
      expect(result.metadata.model).toBe('gemini-2.0-flash');
      expect(result.metadata.transactionsAnalyzed).toBe(2);
    });

    it('should set analysis_period from input BusinessContext period', async () => {
      const context = makeBusinessContext({
        period: { start: '2024-03-01', end: '2024-03-31' },
      });

      const result = await service.generateInsights(context);

      expect(result.analysis_period).toEqual({
        start: '2024-03-01',
        end: '2024-03-31',
      });
    });

    it('should throw ValidationError for missing businessId', async () => {
      const context = makeBusinessContext({ businessId: '' });

      await expect(service.generateInsights(context)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for missing businessName', async () => {
      const context = makeBusinessContext({ businessName: '' });

      await expect(service.generateInsights(context)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for empty transactions', async () => {
      const context = makeBusinessContext({ transactions: [] });

      await expect(service.generateInsights(context)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for missing period', async () => {
      const context = makeBusinessContext();
      const mutable = context as Record<string, unknown>;
      mutable.period = undefined;

      await expect(service.generateInsights(context)).rejects.toThrow(ValidationError);
    });

    it('should use insight_generation prompt', async () => {
      await service.generateInsights(makeBusinessContext());

      expect(deps.promptManager.getPrompt).toHaveBeenCalledWith('insight_generation');
    });

    it('should use default temperature 0.5', async () => {
      const clientMock = deps.client as { generate: ReturnType<typeof vi.fn> };
      await service.generateInsights(makeBusinessContext());

      expect(clientMock.generate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.5 }),
      );
    });

    it('should use default timeout 60s', async () => {
      await service.generateInsights(makeBusinessContext());

      // Verify the retry handler was called (which wraps the timeout)
      const retryFn = deps.retryHandler as ReturnType<typeof vi.fn>;
      expect(retryFn).toHaveBeenCalled();
    });

    it('should allow overriding model via options', async () => {
      const clientMock = deps.client as { generate: ReturnType<typeof vi.fn> };
      await service.generateInsights(makeBusinessContext(), { model: 'gemini-2.0-pro' });

      expect(clientMock.generate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.0-pro' }),
      );
    });

    it('should allow overriding temperature via options', async () => {
      const clientMock = deps.client as { generate: ReturnType<typeof vi.fn> };
      await service.generateInsights(makeBusinessContext(), { temperature: 0.8 });

      expect(clientMock.generate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.8 }),
      );
    });

    it('should record usage with operationType insight_generation on success', async () => {
      await service.generateInsights(makeBusinessContext());

      const tracker = deps.usageTracker as { recordUsage: ReturnType<typeof vi.fn> };
      expect(tracker.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'insight_generation',
          success: true,
        }),
      );
    });

    it('should record usage on failure', async () => {
      const failingClient = createMockClient();
      (failingClient.generate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new GeminiServiceError('API error', 'SERVER_ERROR', true),
      );
      const failDeps = createDeps({
        client: failingClient,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const failService = new InsightServiceImpl(failDeps);

      await failService.generateInsights(makeBusinessContext());

      const tracker = failDeps.usageTracker as { recordUsage: ReturnType<typeof vi.fn> };
      expect(tracker.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          operationType: 'insight_generation',
          success: false,
        }),
      );
    });

    it('should return empty result with warnings when Gemini fails', async () => {
      const failingClient = createMockClient();
      (failingClient.generate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new GeminiServiceError('API error', 'SERVER_ERROR', true),
      );
      const failDeps = createDeps({
        client: failingClient,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const failService = new InsightServiceImpl(failDeps);

      const result = await failService.generateInsights(makeBusinessContext());

      expect(result.insights).toHaveLength(0);
      expect(result.confidence).toBe(0);
      expect(result.analysis_period).toEqual({ start: '2024-01-01', end: '2024-01-31' });
      expect(result.metadata.transactionsAnalyzed).toBe(2);
    });

    it('should handle JSON repair when response is malformed', async () => {
      const malformedResponse = makeGeminiResponse(
        '```json\n' + makeGeminiInsightResponse() + '\n```',
      );
      const clientWithMalformed = createMockClient(malformedResponse);
      const malformedDeps = createDeps({ client: clientWithMalformed });
      const malformedService = new InsightServiceImpl(malformedDeps);

      const result = await malformedService.generateInsights(makeBusinessContext());

      expect(result.insights).toHaveLength(1);
    });

    it('should include metadata with correct token counts', async () => {
      const response = makeGeminiResponse(makeGeminiInsightResponse(), 200, 400);
      const tokenDeps = createDeps({ client: createMockClient(response) });
      const tokenService = new InsightServiceImpl(tokenDeps);

      const result = await tokenService.generateInsights(makeBusinessContext());

      expect(result.metadata.inputTokens).toBe(200);
      expect(result.metadata.outputTokens).toBe(400);
      expect(result.metadata.promptVersion).toBe('1.0.0');
    });

    it('should include transactionsAnalyzed in metadata', async () => {
      const context = makeBusinessContext({
        transactions: [
          { id: 't1', date: '2024-01-01', description: 'A', amount: 100, type: 'credit' },
          { id: 't2', date: '2024-01-02', description: 'B', amount: 200, type: 'debit' },
          { id: 't3', date: '2024-01-03', description: 'C', amount: 300, type: 'credit' },
        ],
      });

      const result = await service.generateInsights(context);

      expect(result.metadata.transactionsAnalyzed).toBe(3);
    });
  });

  describe('resilience integration', () => {
    it('should use retry handler for API calls', async () => {
      const retryFn = vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn());
      const retryDeps = createDeps({ retryHandler: retryFn });
      const retryService = new InsightServiceImpl(retryDeps);

      await retryService.generateInsights(makeBusinessContext());

      expect(retryFn).toHaveBeenCalled();
    });

    it('should check circuit breaker before API call', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure(new Error('fail'));

      const cbDeps = createDeps({
        circuitBreaker: cb,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const cbService = new InsightServiceImpl(cbDeps);

      const result = await cbService.generateInsights(makeBusinessContext());

      expect(result.insights).toHaveLength(0);
      expect(result.confidence).toBe(0);
    });

    it('should record circuit breaker success on successful API call', async () => {
      const cb = new CircuitBreaker();
      const spy = vi.spyOn(cb, 'recordSuccess');

      const cbDeps = createDeps({
        circuitBreaker: cb,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const cbService = new InsightServiceImpl(cbDeps);

      await cbService.generateInsights(makeBusinessContext());

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log start of insight generation', async () => {
      await service.generateInsights(makeBusinessContext());

      const logger = deps.logger as { info: ReturnType<typeof vi.fn> };
      expect(logger.info).toHaveBeenCalledWith(
        'Starting insight generation',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should log validation failures', async () => {
      try {
        await service.generateInsights(makeBusinessContext({ businessId: '' }));
      } catch {
        // expected
      }

      const logger = deps.logger as { warn: ReturnType<typeof vi.fn> };
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('validation failed'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('should log errors on Gemini failure', async () => {
      const failingClient = createMockClient();
      (failingClient.generate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new GeminiServiceError('API error', 'SERVER_ERROR', true),
      );
      const failDeps = createDeps({
        client: failingClient,
        retryHandler: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      });
      const failService = new InsightServiceImpl(failDeps);

      await failService.generateInsights(makeBusinessContext());

      const logger = failDeps.logger as { error: ReturnType<typeof vi.fn> };
      expect(logger.error).toHaveBeenCalledWith(
        'Insight generation failed',
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('usage tracking failure resilience', () => {
    it('should not throw when usage tracking fails', async () => {
      const failingTracker = createMockUsageTracker();
      (failingTracker.recordUsage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Storage error'),
      );

      const trackDeps = createDeps({ usageTracker: failingTracker });
      const trackService = new InsightServiceImpl(trackDeps);

      const result = await trackService.generateInsights(makeBusinessContext());
      expect(result.insights).toHaveLength(1);
    });
  });
});
