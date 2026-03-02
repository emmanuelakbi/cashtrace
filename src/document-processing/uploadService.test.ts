import { describe, expect, it, vi } from 'vitest';

import { DocumentError } from './documentService.js';
import type { StorageService } from './storageService.js';
import type { Document, UploadedFile } from './types.js';
import { DOC_ERROR_CODES } from './types.js';
import { UploadService } from './uploadService.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('./documentRepository.js', () => ({
  createDocument: vi.fn(),
}));

vi.mock('./processingQueue.js', () => ({
  createDocumentProcessingQueue: vi.fn().mockReturnValue({}),
  addDocumentProcessingJob: vi.fn().mockResolvedValue('job-id'),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

import * as documentRepository from './documentRepository.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

function makeFile(overrides: Partial<UploadedFile> = {}): UploadedFile {
  const body = Buffer.alloc(1000, 0x00);
  const buffer = Buffer.concat([JPEG_HEADER, body]);
  return {
    buffer,
    originalname: 'receipt.jpg',
    mimetype: 'image/jpeg',
    size: buffer.length,
    ...overrides,
  };
}

function makeStorageService(overrides: Partial<StorageService> = {}): StorageService {
  return {
    uploadFile: vi.fn().mockResolvedValue({
      key: 'documents/biz-1/RECEIPT_IMAGE/2024/01/test-uuid-1234_receipt.jpg',
      bucket: 'test-bucket',
      etag: 'abc123',
      size: 1004,
    }),
    uploadMultipart: vi.fn().mockResolvedValue({
      key: 'documents/biz-1/RECEIPT_IMAGE/2024/01/test-uuid-1234_receipt.jpg',
      bucket: 'test-bucket',
      etag: 'abc123',
      size: 6_000_000,
    }),
    ...overrides,
  } as unknown as StorageService;
}

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'test-uuid-1234',
    businessId: 'biz-1',
    userId: 'user-1',
    filename: 'receipt.jpg',
    originalFilename: 'receipt.jpg',
    documentType: 'RECEIPT_IMAGE',
    mimeType: 'image/jpeg',
    fileSize: 1004,
    s3Key: 'documents/biz-1/RECEIPT_IMAGE/2024/01/test-uuid-1234_receipt.jpg',
    s3Bucket: 'test-bucket',
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('UploadService', () => {
  describe('uploadFile', () => {
    it('should upload a valid JPEG file and return document with UPLOADED status', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const file = makeFile();
      const doc = makeDocument();

      vi.mocked(documentRepository.createDocument).mockResolvedValue(doc);

      const result = await service.uploadFile(file, 'user-1', 'biz-1');

      expect(result.status).toBe('UPLOADED');
      expect(result.id).toBe('test-uuid-1234');
      expect(result.businessId).toBe('biz-1');
      expect(result.userId).toBe('user-1');
    });

    it('should upload a valid PNG file', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const body = Buffer.alloc(500, 0x00);
      const buffer = Buffer.concat([PNG_HEADER, body]);
      const file = makeFile({ buffer, originalname: 'photo.png', size: buffer.length });
      const doc = makeDocument({ documentType: 'RECEIPT_IMAGE', mimeType: 'image/png' });

      vi.mocked(documentRepository.createDocument).mockResolvedValue(doc);

      const result = await service.uploadFile(file, 'user-1', 'biz-1');

      expect(result.documentType).toBe('RECEIPT_IMAGE');
    });

    it('should upload a valid PDF file', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const body = Buffer.alloc(500, 0x00);
      const buffer = Buffer.concat([PDF_HEADER, body]);
      const file = makeFile({
        buffer,
        originalname: 'statement.pdf',
        mimetype: 'application/pdf',
        size: buffer.length,
      });
      const doc = makeDocument({ documentType: 'BANK_STATEMENT', mimeType: 'application/pdf' });

      vi.mocked(documentRepository.createDocument).mockResolvedValue(doc);

      const result = await service.uploadFile(file, 'user-1', 'biz-1');

      expect(result.documentType).toBe('BANK_STATEMENT');
    });

    it('should upload a valid CSV file', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const csvContent = 'date,amount,description\n2024-01-01,5000,Sale\n2024-01-02,3000,Refund';
      const buffer = Buffer.from(csvContent, 'utf-8');
      const file = makeFile({
        buffer,
        originalname: 'export.csv',
        mimetype: 'text/csv',
        size: buffer.length,
      });
      const doc = makeDocument({ documentType: 'POS_EXPORT', mimeType: 'text/csv' });

      vi.mocked(documentRepository.createDocument).mockResolvedValue(doc);

      const result = await service.uploadFile(file, 'user-1', 'biz-1');

      expect(result.documentType).toBe('POS_EXPORT');
    });

    it('should reject an invalid file type', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const buffer = Buffer.alloc(500, 0xab);
      const file = makeFile({ buffer, originalname: 'data.bin', size: buffer.length });

      await expect(service.uploadFile(file, 'user-1', 'biz-1')).rejects.toThrow(DocumentError);
      await expect(service.uploadFile(file, 'user-1', 'biz-1')).rejects.toMatchObject({
        code: DOC_ERROR_CODES.INVALID_FILE_TYPE,
      });
    });

    it('should reject a file exceeding 10MB', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const file = makeFile({ size: 11_000_000 });

      await expect(service.uploadFile(file, 'user-1', 'biz-1')).rejects.toThrow(DocumentError);
      await expect(service.uploadFile(file, 'user-1', 'biz-1')).rejects.toMatchObject({
        code: DOC_ERROR_CODES.FILE_TOO_LARGE,
      });
    });

    it('should use multipart upload for files > 5MB', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const body = Buffer.alloc(6_000_000, 0x00);
      const buffer = Buffer.concat([JPEG_HEADER, body]);
      const file = makeFile({ buffer, size: buffer.length });
      const doc = makeDocument({ fileSize: buffer.length });

      vi.mocked(documentRepository.createDocument).mockResolvedValue(doc);

      await service.uploadFile(file, 'user-1', 'biz-1');

      expect(storage.uploadMultipart).toHaveBeenCalled();
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('should use single-part upload for files <= 5MB', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const file = makeFile();
      const doc = makeDocument();

      vi.mocked(documentRepository.createDocument).mockResolvedValue(doc);

      await service.uploadFile(file, 'user-1', 'biz-1');

      expect(storage.uploadFile).toHaveBeenCalled();
      expect(storage.uploadMultipart).not.toHaveBeenCalled();
    });

    it('should pass correct data to documentRepository.createDocument', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const file = makeFile();
      const doc = makeDocument();

      vi.mocked(documentRepository.createDocument).mockResolvedValue(doc);

      await service.uploadFile(file, 'user-1', 'biz-1');

      expect(documentRepository.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: 'biz-1',
          userId: 'user-1',
          filename: 'receipt.jpg',
          originalFilename: 'receipt.jpg',
          documentType: 'RECEIPT_IMAGE',
          mimeType: 'image/jpeg',
        }),
      );
    });

    it('should reject an empty buffer', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const file = makeFile({ buffer: Buffer.alloc(0), size: 0 });

      await expect(service.uploadFile(file, 'user-1', 'biz-1')).rejects.toThrow(DocumentError);
    });
  });

  describe('uploadBatch', () => {
    it('should upload multiple files and return all documents', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const file1 = makeFile({ originalname: 'receipt1.jpg' });
      const file2 = makeFile({ originalname: 'receipt2.jpg' });
      const doc1 = makeDocument({ id: 'doc-1', filename: 'receipt1.jpg' });
      const doc2 = makeDocument({ id: 'doc-2', filename: 'receipt2.jpg' });

      vi.mocked(documentRepository.createDocument)
        .mockResolvedValueOnce(doc1)
        .mockResolvedValueOnce(doc2);

      const results = await service.uploadBatch([file1, file2], 'user-1', 'biz-1');

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe('doc-1');
      expect(results[1]?.id).toBe('doc-2');
    });

    it('should reject batch exceeding 50MB total', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const files = Array.from({ length: 6 }, (_, i) =>
        makeFile({ originalname: `file${i}.jpg`, size: 9_000_000 }),
      );

      await expect(service.uploadBatch(files, 'user-1', 'biz-1')).rejects.toThrow(DocumentError);
      await expect(service.uploadBatch(files, 'user-1', 'biz-1')).rejects.toMatchObject({
        code: DOC_ERROR_CODES.BATCH_TOO_LARGE,
      });
    });

    it('should reject batch if any individual file has invalid type', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const validFile = makeFile();
      const invalidFile = makeFile({
        buffer: Buffer.alloc(500, 0xab),
        originalname: 'bad.bin',
        size: 500,
      });
      const doc = makeDocument();

      vi.mocked(documentRepository.createDocument).mockResolvedValue(doc);

      await expect(
        service.uploadBatch([validFile, invalidFile], 'user-1', 'biz-1'),
      ).rejects.toThrow(DocumentError);
    });

    it('should upload a batch with mixed valid file types', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);

      const jpegBody = Buffer.alloc(200, 0x00);
      const jpegFile = makeFile({
        buffer: Buffer.concat([JPEG_HEADER, jpegBody]),
        originalname: 'receipt.jpg',
        size: JPEG_HEADER.length + jpegBody.length,
      });

      const pdfBody = Buffer.alloc(200, 0x00);
      const pdfFile = makeFile({
        buffer: Buffer.concat([PDF_HEADER, pdfBody]),
        originalname: 'statement.pdf',
        mimetype: 'application/pdf',
        size: PDF_HEADER.length + pdfBody.length,
      });

      const doc1 = makeDocument({ id: 'doc-1', documentType: 'RECEIPT_IMAGE' });
      const doc2 = makeDocument({ id: 'doc-2', documentType: 'BANK_STATEMENT' });

      vi.mocked(documentRepository.createDocument)
        .mockResolvedValueOnce(doc1)
        .mockResolvedValueOnce(doc2);

      const results = await service.uploadBatch([jpegFile, pdfFile], 'user-1', 'biz-1');

      expect(results).toHaveLength(2);
      expect(results[0]?.documentType).toBe('RECEIPT_IMAGE');
      expect(results[1]?.documentType).toBe('BANK_STATEMENT');
    });

    it('should reject batch if an individual file exceeds 10MB', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      const smallFile = makeFile({ size: 1_000_000 });
      const oversizedFile = makeFile({ size: 11_000_000, originalname: 'big.jpg' });
      const doc = makeDocument();

      vi.mocked(documentRepository.createDocument).mockResolvedValue(doc);

      await expect(
        service.uploadBatch([smallFile, oversizedFile], 'user-1', 'biz-1'),
      ).rejects.toThrow(DocumentError);
      await expect(
        service.uploadBatch([smallFile, oversizedFile], 'user-1', 'biz-1'),
      ).rejects.toMatchObject({
        code: DOC_ERROR_CODES.FILE_TOO_LARGE,
      });
    });

    it('should accept batch exactly at 50MB total', async () => {
      const storage = makeStorageService();
      const service = new UploadService(storage);
      // 5 files × 10MB each = 50MB exactly (at the limit)
      const files = Array.from({ length: 5 }, (_, i) =>
        makeFile({ originalname: `file${i}.jpg`, size: 10_000_000 }),
      );
      const docs = files.map((_, i) => makeDocument({ id: `doc-${i}` }));

      docs.forEach((doc, i) => {
        vi.mocked(documentRepository.createDocument).mockResolvedValueOnce(doc);
      });

      const results = await service.uploadBatch(files, 'user-1', 'biz-1');

      expect(results).toHaveLength(5);
    });
  });
});
