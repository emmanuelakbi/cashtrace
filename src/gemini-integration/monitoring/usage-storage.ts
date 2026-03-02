// Gemini Integration - Usage Storage
// Provides storage backends for API usage records

import type { GeminiModel } from '../types/index.js';

export type OperationType =
  | 'receipt_extraction'
  | 'bank_statement_extraction'
  | 'pos_export_extraction'
  | 'insight_generation';

export interface ApiUsage {
  operationType: OperationType;
  model: GeminiModel;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  timestamp: Date;
}

export interface UsageStatsOptions {
  startDate?: Date;
  endDate?: Date;
  operationType?: OperationType;
  model?: GeminiModel;
  groupBy?: 'hour' | 'day' | 'month';
}

export interface UsageStorage {
  store(usage: ApiUsage): Promise<void>;
  query(options?: UsageStatsOptions): Promise<ApiUsage[]>;
}

export class InMemoryUsageStorage implements UsageStorage {
  private records: ApiUsage[] = [];

  async store(usage: ApiUsage): Promise<void> {
    this.records.push({ ...usage });
  }

  async query(options?: UsageStatsOptions): Promise<ApiUsage[]> {
    let filtered = [...this.records];

    if (!options) {
      return filtered;
    }

    if (options.startDate) {
      filtered = filtered.filter((r) => r.timestamp >= options.startDate!);
    }

    if (options.endDate) {
      filtered = filtered.filter((r) => r.timestamp <= options.endDate!);
    }

    if (options.operationType) {
      filtered = filtered.filter((r) => r.operationType === options.operationType);
    }

    if (options.model) {
      filtered = filtered.filter((r) => r.model === options.model);
    }

    return filtered;
  }

  getRecordCount(): number {
    return this.records.length;
  }

  clear(): void {
    this.records = [];
  }
}
