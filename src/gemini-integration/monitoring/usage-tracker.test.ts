import { describe, it, expect, beforeEach } from 'vitest';

import type { ApiUsage } from './usage-storage.js';
import { InMemoryUsageStorage } from './usage-storage.js';
import { calculateCost, UsageTrackerImpl } from './usage-tracker.js';

function makeUsage(overrides?: Partial<ApiUsage>): ApiUsage {
  return {
    operationType: 'receipt_extraction',
    model: 'gemini-2.0-flash',
    inputTokens: 1000,
    outputTokens: 500,
    latencyMs: 250,
    success: true,
    timestamp: new Date('2024-06-15T10:00:00Z'),
    ...overrides,
  };
}

describe('calculateCost', () => {
  it('calculates cost for gemini-2.0-flash', () => {
    // Flash: $0.075/1M input, $0.30/1M output
    const cost = calculateCost('gemini-2.0-flash', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.075 + 0.3, 6);
  });

  it('calculates cost for gemini-2.0-pro', () => {
    // Pro: $1.25/1M input, $5.00/1M output
    const cost = calculateCost('gemini-2.0-pro', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(1.25 + 5.0, 6);
  });

  it('returns 0 for zero tokens', () => {
    expect(calculateCost('gemini-2.0-flash', 0, 0)).toBe(0);
  });

  it('scales linearly with token count', () => {
    const cost1 = calculateCost('gemini-2.0-flash', 500_000, 250_000);
    const cost2 = calculateCost('gemini-2.0-flash', 1_000_000, 500_000);
    expect(cost2).toBeCloseTo(cost1 * 2, 6);
  });
});

describe('UsageTrackerImpl', () => {
  let storage: InMemoryUsageStorage;
  let tracker: UsageTrackerImpl;

  beforeEach(() => {
    storage = new InMemoryUsageStorage();
    tracker = new UsageTrackerImpl(storage);
  });

  describe('recordUsage', () => {
    it('stores a usage record via storage', async () => {
      await tracker.recordUsage(makeUsage());
      expect(storage.getRecordCount()).toBe(1);
    });

    it('stores multiple records', async () => {
      await tracker.recordUsage(makeUsage());
      await tracker.recordUsage(makeUsage({ operationType: 'insight_generation' }));
      expect(storage.getRecordCount()).toBe(2);
    });
  });

  describe('getStats', () => {
    it('returns zero stats when no records exist', async () => {
      const stats = await tracker.getStats();
      expect(stats.totalCalls).toBe(0);
      expect(stats.successfulCalls).toBe(0);
      expect(stats.failedCalls).toBe(0);
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.estimatedCostUsd).toBe(0);
      expect(stats.averageLatencyMs).toBe(0);
    });

    it('aggregates token counts correctly', async () => {
      await tracker.recordUsage(makeUsage({ inputTokens: 100, outputTokens: 50 }));
      await tracker.recordUsage(makeUsage({ inputTokens: 200, outputTokens: 100 }));

      const stats = await tracker.getStats();
      expect(stats.totalInputTokens).toBe(300);
      expect(stats.totalOutputTokens).toBe(150);
      expect(stats.totalTokens).toBe(450);
    });

    it('counts successful and failed calls', async () => {
      await tracker.recordUsage(makeUsage({ success: true }));
      await tracker.recordUsage(makeUsage({ success: true }));
      await tracker.recordUsage(makeUsage({ success: false }));

      const stats = await tracker.getStats();
      expect(stats.totalCalls).toBe(3);
      expect(stats.successfulCalls).toBe(2);
      expect(stats.failedCalls).toBe(1);
    });

    it('calculates average latency', async () => {
      await tracker.recordUsage(makeUsage({ latencyMs: 100 }));
      await tracker.recordUsage(makeUsage({ latencyMs: 300 }));

      const stats = await tracker.getStats();
      expect(stats.averageLatencyMs).toBe(200);
    });

    it('calculates estimated cost', async () => {
      await tracker.recordUsage(
        makeUsage({ model: 'gemini-2.0-flash', inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      );

      const stats = await tracker.getStats();
      expect(stats.estimatedCostUsd).toBeCloseTo(0.075 + 0.3, 6);
    });

    it('includes byOperation breakdown', async () => {
      await tracker.recordUsage(
        makeUsage({
          operationType: 'receipt_extraction',
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 200,
        }),
      );
      await tracker.recordUsage(
        makeUsage({
          operationType: 'insight_generation',
          inputTokens: 200,
          outputTokens: 100,
          latencyMs: 400,
        }),
      );

      const stats = await tracker.getStats();
      expect(stats.byOperation).toBeDefined();
      expect(stats.byOperation!.receipt_extraction.calls).toBe(1);
      expect(stats.byOperation!.receipt_extraction.tokens).toBe(150);
      expect(stats.byOperation!.receipt_extraction.avgLatencyMs).toBe(200);
      expect(stats.byOperation!.insight_generation.calls).toBe(1);
      expect(stats.byOperation!.insight_generation.tokens).toBe(300);
    });

    it('includes byModel breakdown', async () => {
      await tracker.recordUsage(
        makeUsage({ model: 'gemini-2.0-flash', inputTokens: 100, outputTokens: 50 }),
      );
      await tracker.recordUsage(
        makeUsage({ model: 'gemini-2.0-pro', inputTokens: 200, outputTokens: 100 }),
      );

      const stats = await tracker.getStats();
      expect(stats.byModel).toBeDefined();
      expect(stats.byModel!['gemini-2.0-flash'].calls).toBe(1);
      expect(stats.byModel!['gemini-2.0-flash'].tokens).toBe(150);
      expect(stats.byModel!['gemini-2.0-pro'].calls).toBe(1);
      expect(stats.byModel!['gemini-2.0-pro'].tokens).toBe(300);
    });

    it('filters by date range', async () => {
      await tracker.recordUsage(makeUsage({ timestamp: new Date('2024-06-01T00:00:00Z') }));
      await tracker.recordUsage(makeUsage({ timestamp: new Date('2024-06-15T00:00:00Z') }));
      await tracker.recordUsage(makeUsage({ timestamp: new Date('2024-06-30T00:00:00Z') }));

      const stats = await tracker.getStats({
        startDate: new Date('2024-06-10T00:00:00Z'),
        endDate: new Date('2024-06-20T00:00:00Z'),
      });
      expect(stats.totalCalls).toBe(1);
    });

    it('filters by model', async () => {
      await tracker.recordUsage(makeUsage({ model: 'gemini-2.0-flash' }));
      await tracker.recordUsage(makeUsage({ model: 'gemini-2.0-pro' }));

      const stats = await tracker.getStats({ model: 'gemini-2.0-pro' });
      expect(stats.totalCalls).toBe(1);
    });

    it('generates time series when groupBy is specified', async () => {
      await tracker.recordUsage(
        makeUsage({
          timestamp: new Date('2024-06-15T10:00:00Z'),
          inputTokens: 100,
          outputTokens: 50,
        }),
      );
      await tracker.recordUsage(
        makeUsage({
          timestamp: new Date('2024-06-15T10:30:00Z'),
          inputTokens: 200,
          outputTokens: 100,
        }),
      );
      await tracker.recordUsage(
        makeUsage({
          timestamp: new Date('2024-06-15T11:00:00Z'),
          inputTokens: 300,
          outputTokens: 150,
        }),
      );

      const stats = await tracker.getStats({ groupBy: 'hour' });
      expect(stats.timeSeries).toBeDefined();
      expect(stats.timeSeries).toHaveLength(2);
      expect(stats.timeSeries![0]!.period).toBe('2024-06-15T10:00');
      expect(stats.timeSeries![0]!.calls).toBe(2);
      expect(stats.timeSeries![1]!.period).toBe('2024-06-15T11:00');
      expect(stats.timeSeries![1]!.calls).toBe(1);
    });

    it('generates daily time series', async () => {
      await tracker.recordUsage(makeUsage({ timestamp: new Date('2024-06-15T10:00:00Z') }));
      await tracker.recordUsage(makeUsage({ timestamp: new Date('2024-06-15T14:00:00Z') }));
      await tracker.recordUsage(makeUsage({ timestamp: new Date('2024-06-16T10:00:00Z') }));

      const stats = await tracker.getStats({ groupBy: 'day' });
      expect(stats.timeSeries).toHaveLength(2);
      expect(stats.timeSeries![0]!.period).toBe('2024-06-15');
      expect(stats.timeSeries![0]!.calls).toBe(2);
      expect(stats.timeSeries![1]!.period).toBe('2024-06-16');
    });

    it('generates monthly time series', async () => {
      await tracker.recordUsage(makeUsage({ timestamp: new Date('2024-06-15T10:00:00Z') }));
      await tracker.recordUsage(makeUsage({ timestamp: new Date('2024-07-15T10:00:00Z') }));

      const stats = await tracker.getStats({ groupBy: 'month' });
      expect(stats.timeSeries).toHaveLength(2);
      expect(stats.timeSeries![0]!.period).toBe('2024-06');
      expect(stats.timeSeries![1]!.period).toBe('2024-07');
    });

    it('does not include timeSeries when groupBy is not specified', async () => {
      await tracker.recordUsage(makeUsage());
      const stats = await tracker.getStats();
      expect(stats.timeSeries).toBeUndefined();
    });
  });

  describe('getStatsByOperation', () => {
    it('returns stats filtered by operation type', async () => {
      await tracker.recordUsage(
        makeUsage({ operationType: 'receipt_extraction', inputTokens: 100, outputTokens: 50 }),
      );
      await tracker.recordUsage(
        makeUsage({ operationType: 'insight_generation', inputTokens: 200, outputTokens: 100 }),
      );
      await tracker.recordUsage(
        makeUsage({ operationType: 'receipt_extraction', inputTokens: 300, outputTokens: 150 }),
      );

      const stats = await tracker.getStatsByOperation('receipt_extraction');
      expect(stats.totalCalls).toBe(2);
      expect(stats.totalInputTokens).toBe(400);
      expect(stats.totalOutputTokens).toBe(200);
    });

    it('returns zero stats when no records match', async () => {
      await tracker.recordUsage(makeUsage({ operationType: 'receipt_extraction' }));

      const stats = await tracker.getStatsByOperation('insight_generation');
      expect(stats.totalCalls).toBe(0);
    });

    it('combines operation filter with other options', async () => {
      await tracker.recordUsage(
        makeUsage({
          operationType: 'receipt_extraction',
          model: 'gemini-2.0-flash',
          timestamp: new Date('2024-06-15T00:00:00Z'),
        }),
      );
      await tracker.recordUsage(
        makeUsage({
          operationType: 'receipt_extraction',
          model: 'gemini-2.0-pro',
          timestamp: new Date('2024-06-15T00:00:00Z'),
        }),
      );
      await tracker.recordUsage(
        makeUsage({
          operationType: 'receipt_extraction',
          model: 'gemini-2.0-flash',
          timestamp: new Date('2024-06-01T00:00:00Z'),
        }),
      );

      const stats = await tracker.getStatsByOperation('receipt_extraction', {
        model: 'gemini-2.0-flash',
        startDate: new Date('2024-06-10T00:00:00Z'),
      });
      expect(stats.totalCalls).toBe(1);
    });

    it('supports groupBy with operation filter', async () => {
      await tracker.recordUsage(
        makeUsage({
          operationType: 'receipt_extraction',
          timestamp: new Date('2024-06-15T10:00:00Z'),
        }),
      );
      await tracker.recordUsage(
        makeUsage({
          operationType: 'receipt_extraction',
          timestamp: new Date('2024-06-16T10:00:00Z'),
        }),
      );

      const stats = await tracker.getStatsByOperation('receipt_extraction', { groupBy: 'day' });
      expect(stats.timeSeries).toHaveLength(2);
    });
  });
});
