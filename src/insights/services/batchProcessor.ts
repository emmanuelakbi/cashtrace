/**
 * Batch Processor for the Insights Engine.
 *
 * Splits business IDs into configurable batches and processes them
 * sequentially to control system load. Each business is processed
 * independently so a single failure does not affect the rest.
 *
 * **Validates: Requirement 10.6**
 *
 * @module insights/services/batchProcessor
 */

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_BATCH_SIZE = 50;

const DEFAULT_DELAY_BETWEEN_BATCHES_MS = 100;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for batch processing behavior. */
export interface BatchConfig {
  batchSize: number;
  delayBetweenBatchesMs: number;
}

/** Aggregated result of a full batch processing run. */
export interface BatchResult {
  totalBusinesses: number;
  processedCount: number;
  failedCount: number;
  insightsGenerated: number;
  errors: Array<{ businessId: string; error: string }>;
  durationMs: number;
}

/**
 * A function that processes a single business and returns the number
 * of insights generated.
 */
export type BusinessProcessor = (businessId: string) => Promise<number>;

// ─── BatchProcessor ──────────────────────────────────────────────────────────

/**
 * Processes businesses in configurable batches to minimize system load.
 *
 * - Batches are executed sequentially with an optional delay between them.
 * - Within each batch, businesses are processed sequentially.
 * - Per-business errors are isolated and recorded without halting the run.
 */
export class BatchProcessor {
  private readonly config: BatchConfig;

  constructor(config?: Partial<BatchConfig>) {
    this.config = {
      batchSize: config?.batchSize ?? DEFAULT_BATCH_SIZE,
      delayBetweenBatchesMs: config?.delayBetweenBatchesMs ?? DEFAULT_DELAY_BETWEEN_BATCHES_MS,
    };
  }

  /**
   * Split an array of items into chunks of the given size.
   *
   * @param items - Items to split
   * @param batchSize - Maximum items per chunk (defaults to configured batch size)
   * @returns Array of chunks
   */
  splitIntoBatches(items: string[], batchSize?: number): string[][] {
    const size = batchSize ?? this.config.batchSize;

    if (items.length === 0) {
      return [];
    }

    const batches: string[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }

  /**
   * Process all business IDs through the given processor in sequential batches.
   *
   * Each business is wrapped in a try/catch so a single failure does not
   * prevent the remaining businesses from being processed.
   *
   * @param businessIds - IDs of businesses to process
   * @param processor - Async function that processes one business and returns insight count
   * @returns Aggregated batch result
   */
  async processBatch(businessIds: string[], processor: BusinessProcessor): Promise<BatchResult> {
    const startTime = Date.now();

    const result: BatchResult = {
      totalBusinesses: businessIds.length,
      processedCount: 0,
      failedCount: 0,
      insightsGenerated: 0,
      errors: [],
      durationMs: 0,
    };

    if (businessIds.length === 0) {
      result.durationMs = Date.now() - startTime;
      return result;
    }

    const batches = this.splitIntoBatches(businessIds);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      for (const businessId of batch) {
        try {
          const insightCount = await processor(businessId);
          result.processedCount++;
          result.insightsGenerated += insightCount;
        } catch (err: unknown) {
          result.failedCount++;
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push({ businessId, error: message });
        }
      }

      // Delay between batches (skip after the last batch)
      if (batchIndex < batches.length - 1 && this.config.delayBetweenBatchesMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.delayBetweenBatchesMs));
      }
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }
}
