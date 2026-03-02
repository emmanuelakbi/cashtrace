/**
 * Property-based tests for processing metadata completeness.
 *
 * **Property 16: Processing Metadata Completeness**
 * For any document that has completed processing (status PARSED, PARTIAL, or ERROR),
 * the ProcessingResult SHALL have processingTimeMs as a non-negative number.
 * For any successful processing (PARSED or PARTIAL), transactionsExtracted SHALL be
 * a non-negative integer. For any ProcessingResult with warnings, the status SHALL be
 * PARTIAL. For any ProcessingResult without warnings, the status SHALL be PARSED.
 *
 * **Validates: Requirements 10.2, 10.3**
 *
 * Tag: Feature: document-processing, Property 16: Processing Metadata Completeness
 *
 * @module document-processing/processingService.property.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import type { Document, ExtractionResult, ExtractedTransaction } from './types.js';

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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Arbitrary for document types. */
const documentTypeArb = fc.constantFrom(
  'RECEIPT_IMAGE' as const,
  'BANK_STATEMENT' as const,
  'POS_EXPORT' as const,
);

/** Arbitrary for a non-negative integer transaction count. */
const transactionCountArb = fc.integer({ min: 0, max: 100 });

/** Arbitrary for warnings array (non-empty means PARTIAL status). */
const warningsArb = fc.array(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), {
    minLength: 1,
    maxLength: 30,
  }),
  { minLength: 0, maxLength: 5 },
);

/** Arbitrary for errors array. */
const errorsArb = fc.array(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), {
    minLength: 1,
    maxLength: 30,
  }),
  { minLength: 0, maxLength: 5 },
);

/** Arbitrary for confidence score. */
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });

/**
 * Arbitrary that generates an ExtractionResult with a given number of
 * transactions, warnings, errors, and confidence.
 */
const extractionResultArb: fc.Arbitrary<ExtractionResult> = fc
  .tuple(transactionCountArb, warningsArb, errorsArb, confidenceArb)
  .map(([txCount, warnings, errors, confidence]) => {
    const transactions: ExtractedTransaction[] = Array.from({ length: txCount }, (_, i) => ({
      date: new Date('2024-01-15'),
      description: `Transaction ${i}`,
      amount: (i + 1) * 1000,
      type: 'debit' as const,
      metadata: {},
    }));

    return {
      transactions,
      warnings,
      errors,
      confidence,
    };
  });

// ─── Mock Factories ──────────────────────────────────────────────────────────

function makeStorageService(): StorageService {
  return {
    getFile: vi.fn<(key: string) => Promise<Buffer>>().mockResolvedValue(Buffer.from('file-data')),
  } as unknown as StorageService;
}

function makeExtractorWithResult(result: ExtractionResult): DocumentExtractor {
  return {
    extract: vi.fn().mockResolvedValue(result),
  };
}

function makeDeps(extractionResult: ExtractionResult): ProcessingServiceDeps {
  const extractor = makeExtractorWithResult(extractionResult);
  return {
    storageService: makeStorageService(),
    receiptExtractor: extractor,
    bankStatementExtractor: extractor,
    posExportExtractor: extractor,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 16: Processing Metadata Completeness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 10.2, 10.3**
   *
   * For any completed processing (PARSED or PARTIAL), the ProcessingResult SHALL
   * have processingTimeMs as a non-negative number.
   */
  it('should have non-negative processingTimeMs for any completed processing', async () => {
    await fc.assert(
      fc.asyncProperty(documentTypeArb, extractionResultArb, async (docType, extraction) => {
        const doc = makeDocument({ documentType: docType });
        vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

        const deps = makeDeps(extraction);
        const service = new ProcessingService(deps);

        const result = await service.processDocument('doc-001');

        expect(typeof result.processingTimeMs).toBe('number');
        expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 10.2, 10.3**
   *
   * For any successful processing (PARSED or PARTIAL), transactionsExtracted
   * SHALL be a non-negative integer.
   */
  it('should have non-negative transactionsExtracted for any successful processing', async () => {
    await fc.assert(
      fc.asyncProperty(documentTypeArb, extractionResultArb, async (docType, extraction) => {
        const doc = makeDocument({ documentType: docType });
        vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

        const deps = makeDeps(extraction);
        const service = new ProcessingService(deps);

        const result = await service.processDocument('doc-001');

        // Status is PARSED or PARTIAL (not ERROR — errors are thrown)
        expect(['PARSED', 'PARTIAL']).toContain(result.status);

        // transactionsExtracted is a non-negative integer
        expect(Number.isInteger(result.transactionsExtracted)).toBe(true);
        expect(result.transactionsExtracted).toBeGreaterThanOrEqual(0);

        // transactionsExtracted matches the actual extraction count
        expect(result.transactionsExtracted).toBe(extraction.transactions.length);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 10.2, 10.3**
   *
   * For any ProcessingResult, the status SHALL be one of PARSED or PARTIAL
   * (not ERROR — errors are thrown as exceptions, not returned as results).
   */
  it('should return only PARSED or PARTIAL status (never ERROR) for successful processing', async () => {
    await fc.assert(
      fc.asyncProperty(documentTypeArb, extractionResultArb, async (docType, extraction) => {
        const doc = makeDocument({ documentType: docType });
        vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

        const deps = makeDeps(extraction);
        const service = new ProcessingService(deps);

        const result = await service.processDocument('doc-001');

        expect(result.status === 'PARSED' || result.status === 'PARTIAL').toBe(true);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 10.2, 10.3**
   *
   * For any ProcessingResult with warnings, the status SHALL be PARTIAL.
   * For any ProcessingResult without warnings, the status SHALL be PARSED.
   */
  it('should set status to PARTIAL when warnings exist, PARSED otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(documentTypeArb, extractionResultArb, async (docType, extraction) => {
        const doc = makeDocument({ documentType: docType });
        vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

        const deps = makeDeps(extraction);
        const service = new ProcessingService(deps);

        const result = await service.processDocument('doc-001');

        if (extraction.warnings.length > 0) {
          expect(result.status).toBe('PARTIAL');
        } else {
          expect(result.status).toBe('PARSED');
        }
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 10.2, 10.3**
   *
   * For any completed processing, the result SHALL contain all required
   * metadata fields: success, status, transactionsExtracted, warnings,
   * errors, and processingTimeMs — all with correct types.
   */
  it('should populate all ProcessingResult fields with correct types', async () => {
    await fc.assert(
      fc.asyncProperty(documentTypeArb, extractionResultArb, async (docType, extraction) => {
        const doc = makeDocument({ documentType: docType });
        vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

        const deps = makeDeps(extraction);
        const service = new ProcessingService(deps);

        const result = await service.processDocument('doc-001');

        // All fields are present and correctly typed
        expect(typeof result.success).toBe('boolean');
        expect(typeof result.status).toBe('string');
        expect(typeof result.transactionsExtracted).toBe('number');
        expect(Array.isArray(result.warnings)).toBe(true);
        expect(Array.isArray(result.errors)).toBe(true);
        expect(typeof result.processingTimeMs).toBe('number');

        // Warnings and errors are forwarded from extraction
        expect(result.warnings).toEqual(extraction.warnings);
        expect(result.errors).toEqual(extraction.errors);
      }),
      { numRuns: 100, verbose: true },
    );
  });
});
