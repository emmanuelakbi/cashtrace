/**
 * Unit tests for ProcessingService.
 *
 * Validates: Requirements 10.2, 10.3, 11.3
 * @module document-processing/processingService.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Document, ExtractionResult, ProcessingResult } from './types.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('./documentRepository.js', () => ({
  findDocumentById: vi.fn(),
}));

import * as documentRepository from './documentRepository.js';
import {
  ProcessingService,
  type DocumentExtractor,
  type ProcessingServiceDeps,
} from './processingService.js';
import type { StorageService } from './storageService.js';

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
    fileSize: 2048,
    s3Key: 'documents/biz-001/RECEIPT_IMAGE/2024/01/doc-001_receipt.jpg',
    s3Bucket: 'cashtrace-docs',
    status: 'PROCESSING',
    processingStartedAt: new Date('2024-01-15T10:00:00Z'),
    processingCompletedAt: null,
    processingDurationMs: null,
    transactionsExtracted: null,
    processingWarnings: [],
    processingErrors: [],
    idempotencyKey: null,
    uploadedAt: new Date('2024-01-15T09:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeExtractionResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    transactions: [
      {
        date: new Date('2024-01-15'),
        description: 'Purchase at Shop ABC',
        amount: 5000,
        type: 'debit',
        metadata: {},
      },
    ],
    warnings: [],
    errors: [],
    confidence: 0.95,
    ...overrides,
  };
}

function makeExtractor(overrides: Partial<DocumentExtractor> = {}): DocumentExtractor {
  return {
    extract: vi.fn<DocumentExtractor['extract']>().mockResolvedValue(makeExtractionResult()),
    ...overrides,
  };
}

function makeStorageService(): StorageService {
  return {
    getFile: vi.fn<(key: string) => Promise<Buffer>>().mockResolvedValue(Buffer.from('file-data')),
  } as unknown as StorageService;
}

function makeDeps(overrides: Partial<ProcessingServiceDeps> = {}): ProcessingServiceDeps {
  return {
    storageService: makeStorageService(),
    receiptExtractor: makeExtractor(),
    bankStatementExtractor: makeExtractor(),
    posExportExtractor: makeExtractor(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ProcessingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processDocument', () => {
    it('should process a receipt image successfully with PARSED status', async () => {
      const doc = makeDocument({ documentType: 'RECEIPT_IMAGE' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      const deps = makeDeps();
      const service = new ProcessingService(deps);

      const result = await service.processDocument('doc-001');

      expect(result.success).toBe(true);
      expect(result.status).toBe('PARSED');
      expect(result.transactionsExtracted).toBe(1);
      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);

      expect(documentRepository.findDocumentById).toHaveBeenCalledWith('doc-001');
      expect(deps.storageService.getFile).toHaveBeenCalledWith(doc.s3Key);
      expect(deps.receiptExtractor.extract).toHaveBeenCalledWith(expect.any(Buffer), doc);
    });

    it('should process a bank statement successfully with PARSED status', async () => {
      const doc = makeDocument({
        documentType: 'BANK_STATEMENT',
        s3Key: 'documents/biz-001/BANK_STATEMENT/2024/01/doc-001_statement.pdf',
        mimeType: 'application/pdf',
      });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      const bankExtractor = makeExtractor({
        extract: vi.fn<DocumentExtractor['extract']>().mockResolvedValue(
          makeExtractionResult({
            transactions: [
              {
                date: new Date('2024-01-10'),
                description: 'Transfer from GTBank',
                amount: 150000,
                type: 'credit',
                metadata: {},
              },
              {
                date: new Date('2024-01-12'),
                description: 'POS Payment',
                amount: 3500,
                type: 'debit',
                metadata: {},
              },
            ],
          }),
        ),
      });

      const deps = makeDeps({ bankStatementExtractor: bankExtractor });
      const service = new ProcessingService(deps);

      const result = await service.processDocument('doc-001');

      expect(result.success).toBe(true);
      expect(result.status).toBe('PARSED');
      expect(result.transactionsExtracted).toBe(2);
      expect(bankExtractor.extract).toHaveBeenCalledWith(expect.any(Buffer), doc);
      // Receipt extractor should NOT have been called
      expect(deps.receiptExtractor.extract).not.toHaveBeenCalled();
    });

    it('should process a POS export successfully with PARSED status', async () => {
      const doc = makeDocument({
        documentType: 'POS_EXPORT',
        s3Key: 'documents/biz-001/POS_EXPORT/2024/01/doc-001_export.csv',
        mimeType: 'text/csv',
      });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      const deps = makeDeps();
      const service = new ProcessingService(deps);

      const result = await service.processDocument('doc-001');

      expect(result.success).toBe(true);
      expect(result.status).toBe('PARSED');
      expect(deps.posExportExtractor.extract).toHaveBeenCalledWith(expect.any(Buffer), doc);
      expect(deps.receiptExtractor.extract).not.toHaveBeenCalled();
      expect(deps.bankStatementExtractor.extract).not.toHaveBeenCalled();
    });

    it('should return PARTIAL status when extraction has warnings', async () => {
      const doc = makeDocument({ documentType: 'RECEIPT_IMAGE' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      const receiptExtractor = makeExtractor({
        extract: vi.fn<DocumentExtractor['extract']>().mockResolvedValue(
          makeExtractionResult({
            transactions: [
              {
                date: new Date('2024-01-15'),
                description: 'Partial item',
                amount: 1000,
                type: 'debit',
                metadata: {},
              },
            ],
            warnings: ['Low confidence on amount field', 'Date format ambiguous'],
          }),
        ),
      });

      const deps = makeDeps({ receiptExtractor });
      const service = new ProcessingService(deps);

      const result = await service.processDocument('doc-001');

      expect(result.success).toBe(true);
      expect(result.status).toBe('PARTIAL');
      expect(result.transactionsExtracted).toBe(1);
      expect(result.warnings).toEqual(['Low confidence on amount field', 'Date format ambiguous']);
    });

    it('should re-throw when extraction fails', async () => {
      const doc = makeDocument({ documentType: 'RECEIPT_IMAGE' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      const receiptExtractor = makeExtractor({
        extract: vi.fn().mockRejectedValue(new Error('Gemini AI unavailable')),
      });

      const deps = makeDeps({ receiptExtractor });
      const service = new ProcessingService(deps);

      await expect(service.processDocument('doc-001')).rejects.toThrow('Gemini AI unavailable');
    });

    it('should throw when document is not found', async () => {
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(null);

      const deps = makeDeps();
      const service = new ProcessingService(deps);

      await expect(service.processDocument('missing-doc')).rejects.toThrow(
        'Document not found: missing-doc',
      );

      expect(deps.storageService.getFile).not.toHaveBeenCalled();
    });

    it('should route to correct extractor by document type', async () => {
      const deps = makeDeps();
      const service = new ProcessingService(deps);

      // Test RECEIPT_IMAGE routing
      const receiptDoc = makeDocument({ id: 'r1', documentType: 'RECEIPT_IMAGE' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(receiptDoc);
      await service.processDocument('r1');
      expect(deps.receiptExtractor.extract).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Test BANK_STATEMENT routing
      const bankDoc = makeDocument({ id: 'b1', documentType: 'BANK_STATEMENT' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(bankDoc);
      await service.processDocument('b1');
      expect(deps.bankStatementExtractor.extract).toHaveBeenCalledTimes(1);
      expect(deps.receiptExtractor.extract).not.toHaveBeenCalled();

      vi.clearAllMocks();

      // Test POS_EXPORT routing
      const posDoc = makeDocument({ id: 'p1', documentType: 'POS_EXPORT' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(posDoc);
      await service.processDocument('p1');
      expect(deps.posExportExtractor.extract).toHaveBeenCalledTimes(1);
      expect(deps.receiptExtractor.extract).not.toHaveBeenCalled();
      expect(deps.bankStatementExtractor.extract).not.toHaveBeenCalled();
    });

    it('should include processingTimeMs in the result', async () => {
      const doc = makeDocument({ documentType: 'RECEIPT_IMAGE' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      const deps = makeDeps();
      const service = new ProcessingService(deps);

      const result = await service.processDocument('doc-001');

      expect(typeof result.processingTimeMs).toBe('number');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});
