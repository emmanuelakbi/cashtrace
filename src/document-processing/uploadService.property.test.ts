/**
 * Property-based tests for upload metadata completeness.
 *
 * **Property 15: Upload Metadata Completeness**
 * For any uploaded document, the following fields SHALL be populated:
 * id (valid UUID v4), businessId, userId, filename, originalFilename,
 * documentType, mimeType, fileSize, s3Key, s3Bucket, status (UPLOADED),
 * uploadedAt, and updatedAt.
 *
 * **Validates: Requirements 10.1, 10.4, 10.5**
 *
 * Tag: Feature: document-processing, Property 15: Upload Metadata Completeness
 *
 * @module document-processing/uploadService.property.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';

import { UploadService } from './uploadService.js';
import { sanitizeFilename } from './storageService.js';
import type { StorageService } from './storageService.js';
import type { CreateDocumentData, Document, DocumentType, UploadedFile } from './types.js';

// ─── UUID v4 regex ───────────────────────────────────────────────────────────

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Magic byte prefixes for valid file types ────────────────────────────────

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);

interface FileTypeSpec {
  magic: Buffer;
  mime: string;
  documentType: DocumentType;
  ext: string;
}

const FILE_TYPES: FileTypeSpec[] = [
  { magic: JPEG_MAGIC, mime: 'image/jpeg', documentType: 'RECEIPT_IMAGE', ext: 'jpg' },
  { magic: PNG_MAGIC, mime: 'image/png', documentType: 'RECEIPT_IMAGE', ext: 'png' },
  { magic: PDF_MAGIC, mime: 'application/pdf', documentType: 'BANK_STATEMENT', ext: 'pdf' },
];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Arbitrary that picks one of the binary file type specs (JPEG, PNG, PDF). */
const fileTypeSpecArb = fc.constantFrom(...FILE_TYPES);

/** Arbitrary for a safe filename component (alphanumeric + underscores). */
const safeFilenameArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
  {
    minLength: 1,
    maxLength: 30,
  },
);

/**
 * Arbitrary for a valid UploadedFile with correct magic bytes.
 * Generates binary files (JPEG, PNG, PDF) with random trailing content
 * and a file size within the 10MB limit.
 */
const validUploadedFileArb: fc.Arbitrary<{ file: UploadedFile; spec: FileTypeSpec }> = fc
  .tuple(fileTypeSpecArb, safeFilenameArb, fc.uint8Array({ minLength: 10, maxLength: 200 }))
  .map(([spec, name, extraBytes]) => {
    const buffer = Buffer.concat([spec.magic, Buffer.from(extraBytes)]);
    const filename = `${name}.${spec.ext}`;
    return {
      file: {
        buffer,
        originalname: filename,
        mimetype: spec.mime,
        size: buffer.length,
      },
      spec,
    };
  });

/**
 * Arbitrary for a valid CSV UploadedFile.
 * Generates a CSV with a header row and at least one data row.
 */
const validCsvFileArb: fc.Arbitrary<{ file: UploadedFile; spec: FileTypeSpec }> = fc
  .tuple(safeFilenameArb, fc.integer({ min: 2, max: 5 }), fc.integer({ min: 1, max: 5 }))
  .map(([name, cols, rows]) => {
    const header = Array.from({ length: cols }, (_, i) => `col${i}`).join(',');
    const dataRows = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, (_, i) => `val${i}`).join(','),
    );
    const content = [header, ...dataRows].join('\n');
    const buffer = Buffer.from(content, 'utf-8');
    const filename = `${name}.csv`;
    const csvSpec: FileTypeSpec = {
      magic: Buffer.alloc(0),
      mime: 'text/csv',
      documentType: 'POS_EXPORT',
      ext: 'csv',
    };
    return {
      file: {
        buffer,
        originalname: filename,
        mimetype: 'text/csv',
        size: buffer.length,
      },
      spec: csvSpec,
    };
  });

/** Combined arbitrary for any valid uploaded file (binary or CSV). */
const anyValidUploadedFileArb = fc.oneof(
  { weight: 3, arbitrary: validUploadedFileArb },
  { weight: 1, arbitrary: validCsvFileArb },
);

const uuidArb = fc.constant(null).map(() => uuidv4());

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('./documentRepository.js');

vi.mock('./processingQueue.js', () => ({
  createDocumentProcessingQueue: vi.fn().mockReturnValue({}),
  addDocumentProcessingJob: vi.fn().mockResolvedValue('job-id'),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const documentRepository = await import('./documentRepository.js');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 15: Upload Metadata Completeness', () => {
  let mockStorageService: StorageService;
  let uploadService: UploadService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorageService = {
      uploadFile: vi.fn().mockResolvedValue({
        key: 'mock-key',
        bucket: 'mock-bucket',
        etag: 'mock-etag',
        size: 100,
      }),
      uploadMultipart: vi.fn().mockResolvedValue({
        key: 'mock-key',
        bucket: 'mock-bucket',
        etag: 'mock-etag',
        size: 100,
      }),
      getPresignedUrl: vi.fn(),
      deleteFile: vi.fn(),
      fileExists: vi.fn(),
      getFile: vi.fn(),
    } as unknown as StorageService;

    /**
     * Mock createDocument to simulate the database returning a full Document.
     * The mock captures the CreateDocumentData passed in and returns a Document
     * with all fields populated, mirroring what PostgreSQL would return.
     */
    vi.mocked(documentRepository.createDocument).mockImplementation(
      async (data: CreateDocumentData): Promise<Document> => {
        const now = new Date();
        return {
          id: uuidv4(),
          businessId: data.businessId,
          userId: data.userId,
          filename: data.filename,
          originalFilename: data.originalFilename,
          documentType: data.documentType,
          mimeType: data.mimeType,
          fileSize: data.fileSize,
          s3Key: data.s3Key,
          s3Bucket: data.s3Bucket,
          status: 'UPLOADED',
          processingStartedAt: null,
          processingCompletedAt: null,
          processingDurationMs: null,
          transactionsExtracted: null,
          processingWarnings: [],
          processingErrors: [],
          idempotencyKey: null,
          uploadedAt: now,
          updatedAt: now,
        };
      },
    );

    uploadService = new UploadService(mockStorageService);
  });

  /**
   * **Validates: Requirements 10.1, 10.4, 10.5**
   *
   * For any valid upload (JPEG, PNG, PDF, CSV), the returned Document SHALL
   * have all required metadata fields populated with correct values.
   */
  it('should populate all required metadata fields for any valid file type', async () => {
    await fc.assert(
      fc.asyncProperty(
        anyValidUploadedFileArb,
        uuidArb,
        uuidArb,
        async ({ file, spec }, userId, businessId) => {
          const document = await uploadService.uploadFile(file, userId, businessId);

          // id: valid UUID v4
          expect(document.id).toMatch(UUID_V4_REGEX);

          // businessId and userId match inputs
          expect(document.businessId).toBe(businessId);
          expect(document.userId).toBe(userId);

          // filename is sanitized, originalFilename preserves the raw name
          expect(document.filename).toBe(sanitizeFilename(file.originalname));
          expect(document.originalFilename).toBe(file.originalname);

          // documentType matches the detected type
          expect(document.documentType).toBe(spec.documentType);

          // mimeType matches the detected MIME
          expect(document.mimeType).toBe(spec.mime);

          // fileSize matches the input file size
          expect(document.fileSize).toBe(file.size);

          // s3Key and s3Bucket are non-empty strings
          expect(typeof document.s3Key).toBe('string');
          expect(document.s3Key.length).toBeGreaterThan(0);
          expect(typeof document.s3Bucket).toBe('string');
          expect(document.s3Bucket.length).toBeGreaterThan(0);

          // status is UPLOADED
          expect(document.status).toBe('UPLOADED');

          // uploadedAt and updatedAt are Date instances
          expect(document.uploadedAt).toBeInstanceOf(Date);
          expect(document.updatedAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 10.1, 10.4**
   *
   * For any valid upload, the data passed to documentRepository.createDocument
   * SHALL contain all required fields with correct values derived from the input.
   */
  it('should pass correct metadata to the repository for any valid file', async () => {
    await fc.assert(
      fc.asyncProperty(
        anyValidUploadedFileArb,
        uuidArb,
        uuidArb,
        async ({ file, spec }, userId, businessId) => {
          await uploadService.uploadFile(file, userId, businessId);

          const lastCall = vi.mocked(documentRepository.createDocument).mock.lastCall;
          expect(lastCall).toBeDefined();

          const createData = lastCall![0];

          // All required CreateDocumentData fields are populated
          expect(createData.businessId).toBe(businessId);
          expect(createData.userId).toBe(userId);
          expect(createData.filename).toBe(sanitizeFilename(file.originalname));
          expect(createData.originalFilename).toBe(file.originalname);
          expect(createData.documentType).toBe(spec.documentType);
          expect(createData.mimeType).toBe(spec.mime);
          expect(createData.fileSize).toBe(file.size);
          expect(typeof createData.s3Key).toBe('string');
          expect(createData.s3Key.length).toBeGreaterThan(0);
          expect(typeof createData.s3Bucket).toBe('string');
          expect(createData.s3Bucket.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});

// ─── Property 18: Async Upload Response ──────────────────────────────────────

/**
 * **Property 18: Async Upload Response**
 *
 * For any document upload, the API SHALL return a success response with the
 * document in UPLOADED status before processing completes. The processing
 * SHALL occur asynchronously after the upload response is sent.
 *
 * We verify:
 * 1. The returned document has status === 'UPLOADED' (not PROCESSING or any other).
 * 2. `queueProcessingJob` is invoked (processing is scheduled) but does NOT
 *    block or mutate the returned document status.
 * 3. Batch uploads also return all documents with UPLOADED status.
 *
 * **Validates: Requirements 11.1, 11.4**
 *
 * Tag: Feature: document-processing, Property 18: Async Upload Response
 */
describe('Property 18: Async Upload Response', () => {
  let mockStorageService: StorageService;
  let uploadService: UploadService;
  let queueSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorageService = {
      uploadFile: vi.fn().mockResolvedValue({
        key: 'mock-key',
        bucket: 'mock-bucket',
        etag: 'mock-etag',
        size: 100,
      }),
      uploadMultipart: vi.fn().mockResolvedValue({
        key: 'mock-key',
        bucket: 'mock-bucket',
        etag: 'mock-etag',
        size: 100,
      }),
      getPresignedUrl: vi.fn(),
      deleteFile: vi.fn(),
      fileExists: vi.fn(),
      getFile: vi.fn(),
    } as unknown as StorageService;

    vi.mocked(documentRepository.createDocument).mockImplementation(
      async (data: CreateDocumentData): Promise<Document> => {
        const now = new Date();
        return {
          id: uuidv4(),
          businessId: data.businessId,
          userId: data.userId,
          filename: data.filename,
          originalFilename: data.originalFilename,
          documentType: data.documentType,
          mimeType: data.mimeType,
          fileSize: data.fileSize,
          s3Key: data.s3Key,
          s3Bucket: data.s3Bucket,
          status: 'UPLOADED',
          processingStartedAt: null,
          processingCompletedAt: null,
          processingDurationMs: null,
          transactionsExtracted: null,
          processingWarnings: [],
          processingErrors: [],
          idempotencyKey: null,
          uploadedAt: now,
          updatedAt: now,
        };
      },
    );

    uploadService = new UploadService(mockStorageService);

    // Spy on the protected queueProcessingJob method to verify it's called
    // but does not alter the returned document.
    queueSpy = vi.spyOn(
      uploadService as unknown as { queueProcessingJob: (id: string) => Promise<void> },
      'queueProcessingJob',
    );
  });

  /**
   * **Validates: Requirements 11.1, 11.4**
   *
   * For any valid single-file upload, the response SHALL have status UPLOADED
   * and queueProcessingJob SHALL have been called (async processing scheduled).
   */
  it('should return UPLOADED status immediately for any valid upload', async () => {
    await fc.assert(
      fc.asyncProperty(
        anyValidUploadedFileArb,
        uuidArb,
        uuidArb,
        async ({ file }, userId, businessId) => {
          const document = await uploadService.uploadFile(file, userId, businessId);

          // The response status MUST be UPLOADED — not PROCESSING or any later state
          expect(document.status).toBe('UPLOADED');

          // Processing fields must be null — processing has not started
          expect(document.processingStartedAt).toBeNull();
          expect(document.processingCompletedAt).toBeNull();
          expect(document.processingDurationMs).toBeNull();
          expect(document.transactionsExtracted).toBeNull();

          // queueProcessingJob was called (processing is scheduled asynchronously)
          expect(queueSpy).toHaveBeenCalledWith(document.id);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 11.1, 11.4**
   *
   * For any valid batch upload, every document in the response SHALL have
   * status UPLOADED and queueProcessingJob SHALL have been called for each.
   */
  it('should return UPLOADED status for every document in a batch upload', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(anyValidUploadedFileArb, { minLength: 1, maxLength: 5 }),
        uuidArb,
        uuidArb,
        async (fileEntries, userId, businessId) => {
          // Reset spy call count between fast-check iterations
          queueSpy.mockClear();

          const files = fileEntries.map((entry) => entry.file);
          const documents = await uploadService.uploadBatch(files, userId, businessId);

          expect(documents).toHaveLength(files.length);

          for (const doc of documents) {
            // Every document must be UPLOADED — none should be PROCESSING
            expect(doc.status).toBe('UPLOADED');

            // No processing metadata should be set yet
            expect(doc.processingStartedAt).toBeNull();
            expect(doc.processingCompletedAt).toBeNull();
            expect(doc.processingDurationMs).toBeNull();
            expect(doc.transactionsExtracted).toBeNull();
          }

          // queueProcessingJob should have been called once per document
          expect(queueSpy).toHaveBeenCalledTimes(files.length);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 11.1**
   *
   * Even when queueProcessingJob is slow (simulated delay), the returned
   * document status SHALL still be UPLOADED — the queue call does not block
   * the response status.
   */
  it('should return UPLOADED status even when queue job has latency', async () => {
    await fc.assert(
      fc.asyncProperty(
        anyValidUploadedFileArb,
        uuidArb,
        uuidArb,
        async ({ file }, userId, businessId) => {
          // Simulate a slow queue submission that still resolves
          queueSpy.mockImplementation(
            () => new Promise<void>((resolve) => setTimeout(resolve, 10)),
          );

          const document = await uploadService.uploadFile(file, userId, businessId);

          // Status is still UPLOADED regardless of queue latency
          expect(document.status).toBe('UPLOADED');
          expect(document.processingStartedAt).toBeNull();
          expect(queueSpy).toHaveBeenCalledWith(document.id);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});
