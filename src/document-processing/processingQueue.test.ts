/**
 * Unit tests for the document processing queue configuration.
 *
 * Validates: Requirements 11.2
 * @module document-processing/processingQueue.test
 */

import { Queue } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addDocumentProcessingJob,
  createDocumentProcessingQueue,
  DEFAULT_BACKOFF_DELAY,
  DEFAULT_JOB_OPTIONS,
  DEFAULT_MAX_ATTEMPTS,
  getWorkerConnectionOptions,
  QUEUE_NAME,
  resolveRedisConnection,
} from './processingQueue.js';

// ─── Mock BullMQ ─────────────────────────────────────────────────────────────

vi.mock('bullmq', () => {
  const mockAdd = vi.fn().mockResolvedValue({ id: 'job-123' });
  const MockQueue = vi.fn().mockImplementation(() => ({
    add: mockAdd,
    close: vi.fn().mockResolvedValue(undefined),
  }));
  return { Queue: MockQueue };
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('processingQueue', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('resolveRedisConnection', () => {
    it('should return defaults when no config or env vars are set', () => {
      delete process.env['REDIS_URL'];
      delete process.env['REDIS_HOST'];
      delete process.env['REDIS_PORT'];
      delete process.env['REDIS_PASSWORD'];

      const config = resolveRedisConnection();

      expect(config).toEqual({
        host: 'localhost',
        port: 6379,
        password: undefined,
      });
    });

    it('should read from REDIS_HOST/PORT/PASSWORD env vars', () => {
      delete process.env['REDIS_URL'];
      process.env['REDIS_HOST'] = '10.0.0.5';
      process.env['REDIS_PORT'] = '6380';
      process.env['REDIS_PASSWORD'] = 's3cret';

      const config = resolveRedisConnection();

      expect(config).toEqual({
        host: '10.0.0.5',
        port: 6380,
        password: 's3cret',
      });
    });

    it('should parse REDIS_URL when provided', () => {
      process.env['REDIS_URL'] = 'redis://:mypass@redis.example.com:6381';

      const config = resolveRedisConnection();

      expect(config).toEqual({
        host: 'redis.example.com',
        port: 6381,
        password: 'mypass',
      });
    });

    it('should prefer REDIS_URL over individual env vars', () => {
      process.env['REDIS_URL'] = 'redis://url-host:6390';
      process.env['REDIS_HOST'] = 'env-host';
      process.env['REDIS_PORT'] = '9999';

      const config = resolveRedisConnection();

      expect(config.host).toBe('url-host');
      expect(config.port).toBe(6390);
    });

    it('should prefer explicit overrides over env vars', () => {
      process.env['REDIS_HOST'] = 'env-host';

      const config = resolveRedisConnection({ host: 'override-host', port: 7777 });

      expect(config.host).toBe('override-host');
      expect(config.port).toBe(7777);
    });

    it('should prefer explicit url override over REDIS_URL env var', () => {
      process.env['REDIS_URL'] = 'redis://env-url-host:6379';

      const config = resolveRedisConnection({ url: 'redis://override-url-host:6380' });

      expect(config.host).toBe('override-url-host');
      expect(config.port).toBe(6380);
    });

    it('should default port to 6379 when REDIS_URL has no port', () => {
      process.env['REDIS_URL'] = 'redis://redis.example.com';

      const config = resolveRedisConnection();

      expect(config.port).toBe(6379);
    });

    it('should handle REDIS_URL without password', () => {
      process.env['REDIS_URL'] = 'redis://redis.example.com:6379';

      const config = resolveRedisConnection();

      expect(config.password).toBeUndefined();
    });
  });

  describe('DEFAULT_JOB_OPTIONS', () => {
    it('should have 3 max attempts', () => {
      expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    });

    it('should use exponential backoff', () => {
      expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({
        type: 'exponential',
        delay: 1000,
      });
    });
  });

  describe('constants', () => {
    it('should export correct queue name', () => {
      expect(QUEUE_NAME).toBe('document-processing');
    });

    it('should export correct default max attempts', () => {
      expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
    });

    it('should export correct default backoff delay', () => {
      expect(DEFAULT_BACKOFF_DELAY).toBe(1000);
    });
  });

  describe('createDocumentProcessingQueue', () => {
    it('should create a Queue with the correct name and options', () => {
      delete process.env['REDIS_URL'];
      delete process.env['REDIS_HOST'];
      delete process.env['REDIS_PORT'];
      delete process.env['REDIS_PASSWORD'];

      const queue = createDocumentProcessingQueue();

      expect(queue).toBeDefined();
      expect(Queue).toHaveBeenCalledWith(QUEUE_NAME, {
        connection: { host: 'localhost', port: 6379, password: undefined },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
    });

    it('should pass custom redis config to the queue', () => {
      const queue = createDocumentProcessingQueue({ host: 'custom-host', port: 6390 });

      expect(queue).toBeDefined();
      expect(Queue).toHaveBeenCalledWith(QUEUE_NAME, {
        connection: { host: 'custom-host', port: 6390, password: undefined },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
    });
  });

  describe('addDocumentProcessingJob', () => {
    it('should add a job with the document ID', async () => {
      const mockQueue = createDocumentProcessingQueue();
      const documentId = '550e8400-e29b-41d4-a716-446655440000';

      const jobId = await addDocumentProcessingJob(mockQueue, documentId);

      expect(jobId).toBe('job-123');
      expect(mockQueue.add).toHaveBeenCalledWith(
        `process-${documentId}`,
        { documentId },
        DEFAULT_JOB_OPTIONS,
      );
    });

    it('should merge custom options with defaults', async () => {
      const mockQueue = createDocumentProcessingQueue();
      const documentId = 'abc-123';

      await addDocumentProcessingJob(mockQueue, documentId, { priority: 1 });

      expect(mockQueue.add).toHaveBeenCalledWith(
        `process-${documentId}`,
        { documentId },
        { ...DEFAULT_JOB_OPTIONS, priority: 1 },
      );
    });
  });

  describe('getWorkerConnectionOptions', () => {
    it('should return connection options for a worker', () => {
      delete process.env['REDIS_URL'];
      delete process.env['REDIS_HOST'];
      delete process.env['REDIS_PORT'];
      delete process.env['REDIS_PASSWORD'];

      const options = getWorkerConnectionOptions();

      expect(options).toEqual({
        host: 'localhost',
        port: 6379,
        password: undefined,
      });
    });

    it('should accept custom redis config', () => {
      const options = getWorkerConnectionOptions({ host: 'worker-host', port: 6391 });

      expect(options).toEqual({
        host: 'worker-host',
        port: 6391,
        password: undefined,
      });
    });
  });
});
