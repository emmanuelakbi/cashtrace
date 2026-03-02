/**
 * Property-based tests for usage tracking.
 *
 * **Property 18: Usage Tracking Completeness**
 * For any set of API usage records, after recording all of them, getStats()
 * SHALL return totalCalls equal to the number of records, and
 * totalInputTokens/totalOutputTokens equal to the sum of all input/output tokens.
 *
 * **Property 19: Usage Aggregation Correctness**
 * For any set of API usage records, the aggregated stats SHALL satisfy:
 * totalTokens = totalInputTokens + totalOutputTokens,
 * successfulCalls + failedCalls = totalCalls,
 * and estimatedCostUsd = sum of individual costs.
 *
 * **Property 20: Usage Filtering Correctness**
 * For any set of API usage records and any filter criteria, getStats(filter)
 * SHALL only include records matching the filter, and the counts SHALL be consistent.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
 *
 * @module gemini-integration/monitoring/usage-tracker.property.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

import type { GeminiModel } from '../types/index.js';

import type { ApiUsage, OperationType } from './usage-storage.js';
import { InMemoryUsageStorage } from './usage-storage.js';
import { UsageTrackerImpl, calculateCost } from './usage-tracker.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const operationTypeArb: fc.Arbitrary<OperationType> = fc.constantFrom(
  'receipt_extraction',
  'bank_statement_extraction',
  'pos_export_extraction',
  'insight_generation',
);

const geminiModelArb: fc.Arbitrary<GeminiModel> = fc.constantFrom(
  'gemini-2.0-flash',
  'gemini-2.0-pro',
);

const apiUsageArb: fc.Arbitrary<ApiUsage> = fc.record({
  operationType: operationTypeArb,
  model: geminiModelArb,
  inputTokens: fc.integer({ min: 0, max: 100_000 }),
  outputTokens: fc.integer({ min: 0, max: 100_000 }),
  latencyMs: fc.integer({ min: 1, max: 60_000 }),
  success: fc.boolean(),
  timestamp: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
});

const apiUsageListArb: fc.Arbitrary<ApiUsage[]> = fc.array(apiUsageArb, {
  minLength: 1,
  maxLength: 50,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTracker(): { tracker: UsageTrackerImpl; storage: InMemoryUsageStorage } {
  const storage = new InMemoryUsageStorage();
  const tracker = new UsageTrackerImpl(storage);
  return { tracker, storage };
}

async function recordAll(tracker: UsageTrackerImpl, records: ApiUsage[]): Promise<void> {
  for (const record of records) {
    await tracker.recordUsage(record);
  }
}

// ─── Property 18: Usage Tracking Completeness ────────────────────────────────

describe('Property 18: Usage Tracking Completeness', () => {
  /**
   * **Validates: Requirements 6.1**
   *
   * For any set of API usage records, after recording all of them,
   * getStats() SHALL return totalCalls equal to the number of records.
   */
  it('should report totalCalls equal to the number of recorded usage entries', () => {
    fc.assert(
      fc.asyncProperty(apiUsageListArb, async (records) => {
        const { tracker } = createTracker();
        await recordAll(tracker, records);

        const stats = await tracker.getStats();

        expect(stats.totalCalls).toBe(records.length);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * For any set of API usage records, totalInputTokens SHALL equal
   * the sum of all individual inputTokens.
   */
  it('should report totalInputTokens equal to the sum of all input tokens', () => {
    fc.assert(
      fc.asyncProperty(apiUsageListArb, async (records) => {
        const { tracker } = createTracker();
        await recordAll(tracker, records);

        const stats = await tracker.getStats();
        const expectedInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0);

        expect(stats.totalInputTokens).toBe(expectedInputTokens);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * For any set of API usage records, totalOutputTokens SHALL equal
   * the sum of all individual outputTokens.
   */
  it('should report totalOutputTokens equal to the sum of all output tokens', () => {
    fc.assert(
      fc.asyncProperty(apiUsageListArb, async (records) => {
        const { tracker } = createTracker();
        await recordAll(tracker, records);

        const stats = await tracker.getStats();
        const expectedOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);

        expect(stats.totalOutputTokens).toBe(expectedOutputTokens);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 19: Usage Aggregation Correctness ──────────────────────────────

describe('Property 19: Usage Aggregation Correctness', () => {
  /**
   * **Validates: Requirements 6.2, 6.3, 6.4**
   *
   * For any set of usage records, totalTokens SHALL equal
   * totalInputTokens + totalOutputTokens.
   */
  it('should satisfy totalTokens = totalInputTokens + totalOutputTokens', () => {
    fc.assert(
      fc.asyncProperty(apiUsageListArb, async (records) => {
        const { tracker } = createTracker();
        await recordAll(tracker, records);

        const stats = await tracker.getStats();

        expect(stats.totalTokens).toBe(stats.totalInputTokens + stats.totalOutputTokens);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.2, 6.4**
   *
   * For any set of usage records, successfulCalls + failedCalls SHALL
   * equal totalCalls.
   */
  it('should satisfy successfulCalls + failedCalls = totalCalls', () => {
    fc.assert(
      fc.asyncProperty(apiUsageListArb, async (records) => {
        const { tracker } = createTracker();
        await recordAll(tracker, records);

        const stats = await tracker.getStats();

        expect(stats.successfulCalls + stats.failedCalls).toBe(stats.totalCalls);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * For any set of usage records, estimatedCostUsd SHALL equal the sum
   * of individual calculateCost() results for each record.
   */
  it('should compute estimatedCostUsd as the sum of individual record costs', () => {
    fc.assert(
      fc.asyncProperty(apiUsageListArb, async (records) => {
        const { tracker } = createTracker();
        await recordAll(tracker, records);

        const stats = await tracker.getStats();
        const expectedCost = records.reduce(
          (sum, r) => sum + calculateCost(r.model, r.inputTokens, r.outputTokens),
          0,
        );

        expect(stats.estimatedCostUsd).toBeCloseTo(expectedCost, 10);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 20: Usage Filtering Correctness ────────────────────────────────

describe('Property 20: Usage Filtering Correctness', () => {
  /**
   * **Validates: Requirements 6.5**
   *
   * For any set of usage records and any operation type filter,
   * getStats({ operationType }) SHALL only count records matching
   * that operation type.
   */
  it('should filter by operationType and return only matching record counts', () => {
    fc.assert(
      fc.asyncProperty(apiUsageListArb, operationTypeArb, async (records, filterOp) => {
        const { tracker } = createTracker();
        await recordAll(tracker, records);

        const stats = await tracker.getStats({ operationType: filterOp });
        const matchingRecords = records.filter((r) => r.operationType === filterOp);

        expect(stats.totalCalls).toBe(matchingRecords.length);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * For any set of usage records and any operation type filter,
   * the filtered token totals SHALL match the sum of tokens from
   * matching records only.
   */
  it('should filter by operationType and return correct token totals', () => {
    fc.assert(
      fc.asyncProperty(apiUsageListArb, operationTypeArb, async (records, filterOp) => {
        const { tracker } = createTracker();
        await recordAll(tracker, records);

        const stats = await tracker.getStats({ operationType: filterOp });
        const matching = records.filter((r) => r.operationType === filterOp);
        const expectedInput = matching.reduce((sum, r) => sum + r.inputTokens, 0);
        const expectedOutput = matching.reduce((sum, r) => sum + r.outputTokens, 0);

        expect(stats.totalInputTokens).toBe(expectedInput);
        expect(stats.totalOutputTokens).toBe(expectedOutput);
        expect(stats.totalTokens).toBe(expectedInput + expectedOutput);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * For any set of usage records and any model filter,
   * getStats({ model }) SHALL only count records matching that model.
   */
  it('should filter by model and return only matching record counts', () => {
    fc.assert(
      fc.asyncProperty(apiUsageListArb, geminiModelArb, async (records, filterModel) => {
        const { tracker } = createTracker();
        await recordAll(tracker, records);

        const stats = await tracker.getStats({ model: filterModel });
        const matchingRecords = records.filter((r) => r.model === filterModel);

        expect(stats.totalCalls).toBe(matchingRecords.length);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * For any set of usage records, getStatsByOperation SHALL return
   * stats consistent with getStats filtered by the same operation type.
   */
  it('should return consistent results between getStatsByOperation and getStats with filter', () => {
    fc.assert(
      fc.asyncProperty(apiUsageListArb, operationTypeArb, async (records, op) => {
        const { tracker } = createTracker();
        await recordAll(tracker, records);

        const statsByOp = await tracker.getStatsByOperation(op);
        const statsFiltered = await tracker.getStats({ operationType: op });

        expect(statsByOp.totalCalls).toBe(statsFiltered.totalCalls);
        expect(statsByOp.totalInputTokens).toBe(statsFiltered.totalInputTokens);
        expect(statsByOp.totalOutputTokens).toBe(statsFiltered.totalOutputTokens);
        expect(statsByOp.totalTokens).toBe(statsFiltered.totalTokens);
        expect(statsByOp.estimatedCostUsd).toBeCloseTo(statsFiltered.estimatedCostUsd, 10);
      }),
      { numRuns: 100 },
    );
  });
});
