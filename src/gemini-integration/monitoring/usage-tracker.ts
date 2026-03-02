// Gemini Integration - Usage Tracker
// Tracks API usage, aggregates statistics, and estimates costs

import type { GeminiModel } from '../types/index.js';

import type { ApiUsage, OperationType, UsageStatsOptions, UsageStorage } from './usage-storage.js';

export interface OperationStats {
  calls: number;
  tokens: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface ModelStats {
  calls: number;
  tokens: number;
  costUsd: number;
}

export interface TimeSeriesStats {
  period: string;
  calls: number;
  tokens: number;
  costUsd: number;
}

export interface UsageStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  averageLatencyMs: number;
  byOperation?: Record<OperationType, OperationStats>;
  byModel?: Record<GeminiModel, ModelStats>;
  timeSeries?: TimeSeriesStats[];
}

// Gemini pricing per 1M tokens (USD)
const MODEL_PRICING: Record<GeminiModel, { input: number; output: number }> = {
  'gemini-2.0-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-pro': { input: 1.25, output: 5.0 },
};

export function calculateCost(
  model: GeminiModel,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

function getTimePeriodKey(date: Date, groupBy: 'hour' | 'day' | 'month'): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');

  switch (groupBy) {
    case 'hour':
      return `${year}-${month}-${day}T${hour}:00`;
    case 'day':
      return `${year}-${month}-${day}`;
    case 'month':
      return `${year}-${month}`;
  }
}

function buildTimeSeries(
  records: ApiUsage[],
  groupBy: 'hour' | 'day' | 'month',
): TimeSeriesStats[] {
  const groups = new Map<string, { calls: number; tokens: number; costUsd: number }>();

  for (const record of records) {
    const key = getTimePeriodKey(record.timestamp, groupBy);
    const existing = groups.get(key) ?? { calls: 0, tokens: 0, costUsd: 0 };
    const totalTokens = record.inputTokens + record.outputTokens;
    const cost = calculateCost(record.model, record.inputTokens, record.outputTokens);

    groups.set(key, {
      calls: existing.calls + 1,
      tokens: existing.tokens + totalTokens,
      costUsd: existing.costUsd + cost,
    });
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, stats]) => ({ period, ...stats }));
}

export interface UsageTracker {
  recordUsage(usage: ApiUsage): Promise<void>;
  getStats(options?: UsageStatsOptions): Promise<UsageStats>;
  getStatsByOperation(operation: OperationType, options?: UsageStatsOptions): Promise<UsageStats>;
}

export class UsageTrackerImpl implements UsageTracker {
  private readonly storage: UsageStorage;

  constructor(storage: UsageStorage) {
    this.storage = storage;
  }

  async recordUsage(usage: ApiUsage): Promise<void> {
    await this.storage.store(usage);
  }

  async getStats(options?: UsageStatsOptions): Promise<UsageStats> {
    const records = await this.storage.query(options);
    return this.aggregate(records, options?.groupBy);
  }

  async getStatsByOperation(
    operation: OperationType,
    options?: UsageStatsOptions,
  ): Promise<UsageStats> {
    const mergedOptions: UsageStatsOptions = { ...options, operationType: operation };
    const records = await this.storage.query(mergedOptions);
    return this.aggregate(records, mergedOptions.groupBy);
  }

  private aggregate(records: ApiUsage[], groupBy?: 'hour' | 'day' | 'month'): UsageStats {
    if (records.length === 0) {
      return {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        averageLatencyMs: 0,
      };
    }

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let successfulCalls = 0;
    let failedCalls = 0;
    let totalLatencyMs = 0;
    let estimatedCostUsd = 0;

    const operationMap = new Map<
      OperationType,
      { calls: number; tokens: number; costUsd: number; totalLatencyMs: number }
    >();
    const modelMap = new Map<GeminiModel, { calls: number; tokens: number; costUsd: number }>();

    for (const record of records) {
      totalInputTokens += record.inputTokens;
      totalOutputTokens += record.outputTokens;
      totalLatencyMs += record.latencyMs;

      if (record.success) {
        successfulCalls++;
      } else {
        failedCalls++;
      }

      const cost = calculateCost(record.model, record.inputTokens, record.outputTokens);
      estimatedCostUsd += cost;

      // Aggregate by operation
      const opStats = operationMap.get(record.operationType) ?? {
        calls: 0,
        tokens: 0,
        costUsd: 0,
        totalLatencyMs: 0,
      };
      opStats.calls++;
      opStats.tokens += record.inputTokens + record.outputTokens;
      opStats.costUsd += cost;
      opStats.totalLatencyMs += record.latencyMs;
      operationMap.set(record.operationType, opStats);

      // Aggregate by model
      const mStats = modelMap.get(record.model) ?? { calls: 0, tokens: 0, costUsd: 0 };
      mStats.calls++;
      mStats.tokens += record.inputTokens + record.outputTokens;
      mStats.costUsd += cost;
      modelMap.set(record.model, mStats);
    }

    const totalCalls = records.length;

    const byOperation = Object.fromEntries(
      Array.from(operationMap.entries()).map(([op, stats]) => [
        op,
        {
          calls: stats.calls,
          tokens: stats.tokens,
          costUsd: stats.costUsd,
          avgLatencyMs: stats.totalLatencyMs / stats.calls,
        },
      ]),
    ) as Record<OperationType, OperationStats>;

    const byModel = Object.fromEntries(
      Array.from(modelMap.entries()).map(([model, stats]) => [model, stats]),
    ) as Record<GeminiModel, ModelStats>;

    const result: UsageStats = {
      totalCalls,
      successfulCalls,
      failedCalls,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      estimatedCostUsd,
      averageLatencyMs: totalLatencyMs / totalCalls,
      byOperation,
      byModel,
    };

    if (groupBy) {
      result.timeSeries = buildTimeSeries(records, groupBy);
    }

    return result;
  }
}
