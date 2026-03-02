/**
 * BullMQ queue configuration for async document processing.
 *
 * Provides a document processing queue with Redis connection,
 * exponential backoff retry (3 attempts), and helper functions
 * for adding jobs and creating worker connections.
 *
 * Requirements: 11.2
 * @module document-processing/processingQueue
 */

import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';

// ─── Constants ───────────────────────────────────────────────────────────────

export const QUEUE_NAME = 'document-processing';

export const DEFAULT_MAX_ATTEMPTS = 3;

export const DEFAULT_BACKOFF_DELAY = 1000;

/** Default job options: 3 attempts with exponential backoff starting at 1s. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: DEFAULT_MAX_ATTEMPTS,
  backoff: {
    type: 'exponential',
    delay: DEFAULT_BACKOFF_DELAY,
  },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

// ─── Redis Connection ────────────────────────────────────────────────────────

export interface QueueRedisConfig {
  /** Redis server hostname. Defaults to REDIS_HOST env var or 'localhost'. */
  host?: string;
  /** Redis server port. Defaults to REDIS_PORT env var or 6379. */
  port?: number;
  /** Redis authentication password. Defaults to REDIS_PASSWORD env var. */
  password?: string;
  /** Full Redis URL (takes precedence over host/port/password). */
  url?: string;
}

/**
 * Resolve Redis connection options from explicit config, env vars, or defaults.
 *
 * Priority: explicit config > REDIS_URL > REDIS_HOST/PORT/PASSWORD > defaults.
 */
export function resolveRedisConnection(overrides: QueueRedisConfig = {}): ConnectionOptions {
  const redisUrl = overrides.url ?? process.env['REDIS_URL'];

  if (redisUrl) {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
    };
  }

  return {
    host: overrides.host ?? process.env['REDIS_HOST'] ?? 'localhost',
    port: overrides.port ?? parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
    password: overrides.password ?? process.env['REDIS_PASSWORD'] ?? undefined,
  };
}

// ─── Queue Factory ───────────────────────────────────────────────────────────

/**
 * Create a BullMQ Queue instance for document processing.
 *
 * @param redisConfig - Optional Redis connection overrides
 * @returns Configured BullMQ Queue
 */
export function createDocumentProcessingQueue(redisConfig?: QueueRedisConfig): Queue {
  const connection = resolveRedisConnection(redisConfig);

  return new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

// ─── Job Helpers ─────────────────────────────────────────────────────────────

export interface DocumentJobData {
  documentId: string;
}

/**
 * Add a document processing job to the queue.
 *
 * @param queue - The BullMQ Queue instance
 * @param documentId - The document ID to process
 * @param options - Optional job-level overrides
 * @returns The created BullMQ Job
 */
export async function addDocumentProcessingJob(
  queue: Queue,
  documentId: string,
  options?: Partial<JobsOptions>,
): Promise<string> {
  const jobData: DocumentJobData = { documentId };
  const jobName = `process-${documentId}`;

  const job = await queue.add(jobName, jobData, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
  });

  return job.id ?? documentId;
}

// ─── Worker Connection ───────────────────────────────────────────────────────

/**
 * Create connection options suitable for a BullMQ Worker.
 *
 * Workers need their own connection (BullMQ requirement — workers
 * cannot share the Queue's connection).
 *
 * @param redisConfig - Optional Redis connection overrides
 * @returns ConnectionOptions for use with `new Worker(...)`
 */
export function getWorkerConnectionOptions(redisConfig?: QueueRedisConfig): ConnectionOptions {
  return resolveRedisConnection(redisConfig);
}
