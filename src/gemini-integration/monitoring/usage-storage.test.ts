import { describe, it, expect, beforeEach } from 'vitest';

import type { ApiUsage, UsageStatsOptions } from './usage-storage.js';
import { InMemoryUsageStorage } from './usage-storage.js';

function makeUsage(overrides?: Partial<ApiUsage>): ApiUsage {
  return {
    operationType: 'receipt_extraction',
    model: 'gemini-2.0-flash',
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 200,
    success: true,
    timestamp: new Date('2024-06-15T10:00:00Z'),
    ...overrides,
  };
}

describe('InMemoryUsageStorage', () => {
  let storage: InMemoryUsageStorage;

  beforeEach(() => {
    storage = new InMemoryUsageStorage();
  });

  describe('store', () => {
    it('stores a usage record', async () => {
      await storage.store(makeUsage());
      expect(storage.getRecordCount()).toBe(1);
    });

    it('stores multiple records', async () => {
      await storage.store(makeUsage());
      await storage.store(makeUsage({ operationType: 'insight_generation' }));
      expect(storage.getRecordCount()).toBe(2);
    });

    it('stores a defensive copy of the record', async () => {
      const usage = makeUsage();
      await storage.store(usage);
      usage.inputTokens = 9999;
      const records = await storage.query();
      expect(records[0]?.inputTokens).toBe(100);
    });
  });

  describe('query', () => {
    it('returns all records when no options provided', async () => {
      await storage.store(makeUsage());
      await storage.store(makeUsage({ operationType: 'insight_generation' }));
      const results = await storage.query();
      expect(results).toHaveLength(2);
    });

    it('returns empty array when no records exist', async () => {
      const results = await storage.query();
      expect(results).toHaveLength(0);
    });

    it('filters by startDate', async () => {
      await storage.store(makeUsage({ timestamp: new Date('2024-06-01T00:00:00Z') }));
      await storage.store(makeUsage({ timestamp: new Date('2024-06-15T00:00:00Z') }));
      await storage.store(makeUsage({ timestamp: new Date('2024-06-30T00:00:00Z') }));

      const options: UsageStatsOptions = { startDate: new Date('2024-06-10T00:00:00Z') };
      const results = await storage.query(options);
      expect(results).toHaveLength(2);
    });

    it('filters by endDate', async () => {
      await storage.store(makeUsage({ timestamp: new Date('2024-06-01T00:00:00Z') }));
      await storage.store(makeUsage({ timestamp: new Date('2024-06-15T00:00:00Z') }));
      await storage.store(makeUsage({ timestamp: new Date('2024-06-30T00:00:00Z') }));

      const options: UsageStatsOptions = { endDate: new Date('2024-06-20T00:00:00Z') };
      const results = await storage.query(options);
      expect(results).toHaveLength(2);
    });

    it('filters by operationType', async () => {
      await storage.store(makeUsage({ operationType: 'receipt_extraction' }));
      await storage.store(makeUsage({ operationType: 'insight_generation' }));
      await storage.store(makeUsage({ operationType: 'receipt_extraction' }));

      const options: UsageStatsOptions = { operationType: 'receipt_extraction' };
      const results = await storage.query(options);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.operationType === 'receipt_extraction')).toBe(true);
    });

    it('filters by model', async () => {
      await storage.store(makeUsage({ model: 'gemini-2.0-flash' }));
      await storage.store(makeUsage({ model: 'gemini-2.0-pro' }));
      await storage.store(makeUsage({ model: 'gemini-2.0-flash' }));

      const options: UsageStatsOptions = { model: 'gemini-2.0-pro' };
      const results = await storage.query(options);
      expect(results).toHaveLength(1);
      expect(results[0]?.model).toBe('gemini-2.0-pro');
    });

    it('combines multiple filters', async () => {
      await storage.store(
        makeUsage({
          operationType: 'receipt_extraction',
          model: 'gemini-2.0-flash',
          timestamp: new Date('2024-06-15T00:00:00Z'),
        }),
      );
      await storage.store(
        makeUsage({
          operationType: 'insight_generation',
          model: 'gemini-2.0-flash',
          timestamp: new Date('2024-06-15T00:00:00Z'),
        }),
      );
      await storage.store(
        makeUsage({
          operationType: 'receipt_extraction',
          model: 'gemini-2.0-pro',
          timestamp: new Date('2024-06-01T00:00:00Z'),
        }),
      );

      const options: UsageStatsOptions = {
        operationType: 'receipt_extraction',
        model: 'gemini-2.0-flash',
        startDate: new Date('2024-06-10T00:00:00Z'),
      };
      const results = await storage.query(options);
      expect(results).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('removes all records', async () => {
      await storage.store(makeUsage());
      await storage.store(makeUsage());
      storage.clear();
      expect(storage.getRecordCount()).toBe(0);
      const results = await storage.query();
      expect(results).toHaveLength(0);
    });
  });
});
