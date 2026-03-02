import { describe, expect, it } from 'vitest';

import { BatchProcessor, DEFAULT_BATCH_SIZE } from './batchProcessor.js';
import type { BusinessProcessor } from './batchProcessor.js';

describe('BatchProcessor', () => {
  // ── splitIntoBatches ─────────────────────────────────────────────────

  describe('splitIntoBatches', () => {
    it('splits items into correct chunk sizes', () => {
      const processor = new BatchProcessor({ batchSize: 3 });
      const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

      const batches = processor.splitIntoBatches(items);

      expect(batches).toEqual([['a', 'b', 'c'], ['d', 'e', 'f'], ['g']]);
    });

    it('handles empty array', () => {
      const processor = new BatchProcessor();
      const batches = processor.splitIntoBatches([]);

      expect(batches).toEqual([]);
    });

    it('handles array smaller than batch size', () => {
      const processor = new BatchProcessor({ batchSize: 10 });
      const items = ['a', 'b', 'c'];

      const batches = processor.splitIntoBatches(items);

      expect(batches).toEqual([['a', 'b', 'c']]);
    });

    it('handles array exactly equal to batch size', () => {
      const processor = new BatchProcessor({ batchSize: 3 });
      const items = ['a', 'b', 'c'];

      const batches = processor.splitIntoBatches(items);

      expect(batches).toEqual([['a', 'b', 'c']]);
    });

    it('respects custom batchSize parameter override', () => {
      const processor = new BatchProcessor({ batchSize: 10 });
      const items = ['a', 'b', 'c', 'd', 'e'];

      const batches = processor.splitIntoBatches(items, 2);

      expect(batches).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    });

    it('uses DEFAULT_BATCH_SIZE when no config provided', () => {
      const processor = new BatchProcessor();
      const items = Array.from({ length: DEFAULT_BATCH_SIZE + 1 }, (_, i) => `biz-${i}`);

      const batches = processor.splitIntoBatches(items);

      expect(batches).toHaveLength(2);
      expect(batches[0]).toHaveLength(DEFAULT_BATCH_SIZE);
      expect(batches[1]).toHaveLength(1);
    });
  });

  // ── processBatch ───────────────────────────────────────────────────────

  describe('processBatch', () => {
    it('processes all businesses successfully', async () => {
      const processor = new BatchProcessor({ batchSize: 2, delayBetweenBatchesMs: 0 });
      const mockProcessor: BusinessProcessor = async () => 3;

      const result = await processor.processBatch(['biz-1', 'biz-2', 'biz-3'], mockProcessor);

      expect(result.totalBusinesses).toBe(3);
      expect(result.processedCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.insightsGenerated).toBe(9);
      expect(result.errors).toEqual([]);
    });

    it('isolates errors — one failure does not stop others', async () => {
      const processor = new BatchProcessor({ batchSize: 5, delayBetweenBatchesMs: 0 });
      const mockProcessor: BusinessProcessor = async (id) => {
        if (id === 'biz-2') {
          throw new Error('DB connection lost');
        }
        return 2;
      };

      const result = await processor.processBatch(['biz-1', 'biz-2', 'biz-3'], mockProcessor);

      expect(result.processedCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.insightsGenerated).toBe(4);
      expect(result.errors).toEqual([{ businessId: 'biz-2', error: 'DB connection lost' }]);
    });

    it('aggregates results correctly across batches', async () => {
      const processor = new BatchProcessor({ batchSize: 2, delayBetweenBatchesMs: 0 });
      let callCount = 0;
      const mockProcessor: BusinessProcessor = async () => {
        callCount++;
        return callCount; // returns 1, 2, 3, 4
      };

      const result = await processor.processBatch(
        ['biz-1', 'biz-2', 'biz-3', 'biz-4'],
        mockProcessor,
      );

      expect(result.totalBusinesses).toBe(4);
      expect(result.processedCount).toBe(4);
      expect(result.failedCount).toBe(0);
      expect(result.insightsGenerated).toBe(1 + 2 + 3 + 4);
      expect(result.errors).toEqual([]);
    });

    it('handles empty business list', async () => {
      const processor = new BatchProcessor({ batchSize: 10, delayBetweenBatchesMs: 0 });
      const mockProcessor: BusinessProcessor = async () => 1;

      const result = await processor.processBatch([], mockProcessor);

      expect(result.totalBusinesses).toBe(0);
      expect(result.processedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.insightsGenerated).toBe(0);
      expect(result.errors).toEqual([]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('tracks duration', async () => {
      const processor = new BatchProcessor({ batchSize: 10, delayBetweenBatchesMs: 0 });
      const mockProcessor: BusinessProcessor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 1;
      };

      const result = await processor.processBatch(['biz-1', 'biz-2'], mockProcessor);

      expect(result.durationMs).toBeGreaterThanOrEqual(10);
    });

    it('respects batch size configuration', async () => {
      const callOrder: string[] = [];
      const processor = new BatchProcessor({ batchSize: 2, delayBetweenBatchesMs: 0 });
      const mockProcessor: BusinessProcessor = async (id) => {
        callOrder.push(id);
        return 1;
      };

      await processor.processBatch(['biz-1', 'biz-2', 'biz-3', 'biz-4', 'biz-5'], mockProcessor);

      // All businesses should be processed in order
      expect(callOrder).toEqual(['biz-1', 'biz-2', 'biz-3', 'biz-4', 'biz-5']);
    });

    it('handles non-Error thrown values', async () => {
      const processor = new BatchProcessor({ batchSize: 5, delayBetweenBatchesMs: 0 });
      const mockProcessor: BusinessProcessor = async (id) => {
        if (id === 'biz-1') {
          throw 'string error'; // eslint-disable-line no-throw-literal
        }
        return 1;
      };

      const result = await processor.processBatch(['biz-1', 'biz-2'], mockProcessor);

      expect(result.failedCount).toBe(1);
      expect(result.errors[0].error).toBe('string error');
      expect(result.processedCount).toBe(1);
    });

    it('adds delay between batches', async () => {
      const delayMs = 50;
      const processor = new BatchProcessor({ batchSize: 1, delayBetweenBatchesMs: delayMs });
      const mockProcessor: BusinessProcessor = async () => 1;

      const result = await processor.processBatch(['biz-1', 'biz-2', 'biz-3'], mockProcessor);

      // 3 items in batches of 1 = 3 batches, 2 delays between them
      // Duration should be at least 2 * delayMs
      expect(result.durationMs).toBeGreaterThanOrEqual(delayMs * 2 - 10); // small tolerance
    });
  });
});
