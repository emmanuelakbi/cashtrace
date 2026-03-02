/**
 * Unit tests for the ProcessingWorker.
 *
 * Validates: Requirements 5.3, 5.4, 5.5, 5.6
 * @module document-processing/processingWorker.test
 */

import { Worker, type Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Document, ProcessingResult } from './types.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('bullmq', () => {
  const MockWorker = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }));
  return { Worker: MockWorker };
});

vi.mock('./documentRepository.js', () => ({
  findDocumentById: vi.fn(),
  updateDocumentStatus: vi.fn(),
}));

vi.mock('./statusMachine.js', () => ({
  validateTransition: vi.fn(),
}));

vi.mock('./processingQueue.js', () => ({
  QUEUE_NAME: 'document-processing',
  getWorkerConnectionOptions: vi.fn().mockReturnValue({
    host: 'localhost',
    port: 6379,
    password: undefined,
  }),
}));

import * as documentRepository from './documentRepository.js';
import { getWorkerConnectionOptions, QUEUE_NAME } from './processingQueue.js';
import {
  createProcessingWorker,
  processJob,
  type ProcessingServiceInterface,
} from './processingWorker.js';
import { validateTransition } from './statusMachine.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-001',
    businessId: 'biz-001',
    userId: 'user-001',
    filename: 'receipt_doc-001.jpg',
    originalFilename: 'receipt.jpg',
    documentType: 'RECEIPT_IMAGE',
    mimeType: 'image/jpeg',
    fileSize: 1024,
    s3Key: 'documents/biz-001/RECEIPT_IMAGE/2024/01/doc-001_receipt.jpg',
    s3Bucket: 'cashtrace-docs',
    status: 'UPLOADED',
    processingStartedAt: null,
    processingCompletedAt: null,
    processingDurationMs: null,
    transactionsExtracted: null,
    processingWarnings: [],
    processingErrors: [],
    idempotencyKey: null,
    uploadedAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeJob(documentId: string): Job<{ documentId: string }> {
  return { data: { documentId } } as Job<{ documentId: string }>;
}

function makeProcessingService(
  overrides: Partial<ProcessingServiceInterface> = {},
): ProcessingServiceInterface {
  return {
    processDocument: vi.fn<(id: string) => Promise<ProcessingResult>>().mockResolvedValue({
      success: true,
      status: 'PARSED',
      transactionsExtracted: 5,
      warnings: [],
      errors: [],
      processingTimeMs: 1200,
    }),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('processingWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processJob', () => {
    it('should transition UPLOADED → PROCESSING → PARSED on success', async () => {
      const doc = makeDocument({ status: 'UPLOADED' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);
      vi.mocked(documentRepository.updateDocumentStatus).mockResolvedValue(doc);
      const service = makeProcessingService();

      const result = await processJob(makeJob('doc-001'), service);

      expect(result.documentId).toBe('doc-001');
      expect(result.status).toBe('PARSED');
      expect(result.processingDurationMs).toBeGreaterThanOrEqual(0);

      // Verify transition validation was called
      expect(validateTransition).toHaveBeenCalledWith('UPLOADED', 'PROCESSING');

      // Verify status updated to PROCESSING first
      expect(documentRepository.updateDocumentStatus).toHaveBeenCalledWith(
        'doc-001',
        'PROCESSING',
        expect.objectContaining({ processingStartedAt: expect.any(Date) }),
      );

      // Verify final status update to PARSED
      expect(documentRepository.updateDocumentStatus).toHaveBeenCalledWith(
        'doc-001',
        'PARSED',
        expect.objectContaining({
          processingCompletedAt: expect.any(Date),
          processingDurationMs: expect.any(Number),
          transactionsExtracted: 5,
          processingWarnings: [],
          processingErrors: [],
        }),
      );

      expect(service.processDocument).toHaveBeenCalledWith('doc-001');
    });

    it('should set status to PARTIAL when result status is PARTIAL', async () => {
      const doc = makeDocument({ status: 'UPLOADED' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);
      vi.mocked(documentRepository.updateDocumentStatus).mockResolvedValue(doc);

      const service = makeProcessingService({
        processDocument: vi.fn<(id: string) => Promise<ProcessingResult>>().mockResolvedValue({
          success: true,
          status: 'PARTIAL',
          transactionsExtracted: 2,
          warnings: ['Some rows could not be parsed'],
          errors: [],
          processingTimeMs: 800,
        }),
      });

      const result = await processJob(makeJob('doc-001'), service);

      expect(result.status).toBe('PARTIAL');

      expect(documentRepository.updateDocumentStatus).toHaveBeenCalledWith(
        'doc-001',
        'PARTIAL',
        expect.objectContaining({
          transactionsExtracted: 2,
          processingWarnings: ['Some rows could not be parsed'],
        }),
      );
    });

    it('should set status to ERROR when processing throws', async () => {
      const doc = makeDocument({ status: 'UPLOADED' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);
      vi.mocked(documentRepository.updateDocumentStatus).mockResolvedValue(doc);

      const service = makeProcessingService({
        processDocument: vi.fn().mockRejectedValue(new Error('Gemini AI unavailable')),
      });

      await expect(processJob(makeJob('doc-001'), service)).rejects.toThrow(
        'Gemini AI unavailable',
      );

      expect(documentRepository.updateDocumentStatus).toHaveBeenCalledWith(
        'doc-001',
        'ERROR',
        expect.objectContaining({
          processingCompletedAt: expect.any(Date),
          processingDurationMs: expect.any(Number),
          processingErrors: ['Gemini AI unavailable'],
        }),
      );
    });

    it('should throw when document is not found', async () => {
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(null);
      const service = makeProcessingService();

      await expect(processJob(makeJob('missing-doc'), service)).rejects.toThrow(
        'Document not found: missing-doc',
      );

      expect(documentRepository.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('should throw when status transition is invalid', async () => {
      const doc = makeDocument({ status: 'PARSED' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);
      vi.mocked(validateTransition).mockImplementationOnce(() => {
        throw new Error('Invalid status transition from PARSED to PROCESSING');
      });

      const service = makeProcessingService();

      await expect(processJob(makeJob('doc-001'), service)).rejects.toThrow(
        'Invalid status transition from PARSED to PROCESSING',
      );

      expect(documentRepository.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('should handle ERROR → PROCESSING retry flow', async () => {
      const doc = makeDocument({ status: 'ERROR' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);
      vi.mocked(documentRepository.updateDocumentStatus).mockResolvedValue(doc);
      const service = makeProcessingService();

      const result = await processJob(makeJob('doc-001'), service);

      expect(validateTransition).toHaveBeenCalledWith('ERROR', 'PROCESSING');
      expect(result.status).toBe('PARSED');
    });

    it('should record processingDurationMs as non-negative', async () => {
      const doc = makeDocument({ status: 'UPLOADED' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);
      vi.mocked(documentRepository.updateDocumentStatus).mockResolvedValue(doc);
      const service = makeProcessingService();

      const result = await processJob(makeJob('doc-001'), service);

      expect(result.processingDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should stringify non-Error thrown values in error metadata', async () => {
      const doc = makeDocument({ status: 'UPLOADED' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);
      vi.mocked(documentRepository.updateDocumentStatus).mockResolvedValue(doc);

      const service = makeProcessingService({
        processDocument: vi.fn().mockRejectedValue('string error'),
      });

      await expect(processJob(makeJob('doc-001'), service)).rejects.toBe('string error');

      expect(documentRepository.updateDocumentStatus).toHaveBeenCalledWith(
        'doc-001',
        'ERROR',
        expect.objectContaining({
          processingErrors: ['string error'],
        }),
      );
    });
  });

  describe('createProcessingWorker', () => {
    it('should create a BullMQ Worker with correct queue name', () => {
      const service = makeProcessingService();

      const worker = createProcessingWorker({ processingService: service });

      expect(worker).toBeDefined();
      expect(Worker).toHaveBeenCalledWith(
        QUEUE_NAME,
        expect.any(Function),
        expect.objectContaining({
          connection: { host: 'localhost', port: 6379, password: undefined },
          concurrency: 1,
        }),
      );
    });

    it('should pass custom redis config', () => {
      const service = makeProcessingService();

      createProcessingWorker({
        processingService: service,
        redisConfig: { host: 'redis-host', port: 6380 },
      });

      expect(getWorkerConnectionOptions).toHaveBeenCalledWith({
        host: 'redis-host',
        port: 6380,
      });
    });

    it('should use custom concurrency', () => {
      const service = makeProcessingService();

      createProcessingWorker({
        processingService: service,
        concurrency: 5,
      });

      expect(Worker).toHaveBeenCalledWith(
        QUEUE_NAME,
        expect.any(Function),
        expect.objectContaining({ concurrency: 5 }),
      );
    });
  });
});
