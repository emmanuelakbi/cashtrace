/**
 * Unit tests for DocumentService.
 *
 * Tests business logic including ownership verification, CRUD operations,
 * pagination delegation, and proper error handling with DOC_ERROR_CODES.
 *
 * @module document-processing/documentService.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as documentRepository from './documentRepository.js';
import { DocumentError, DocumentService } from './documentService.js';
import type { CreateDocumentData, Document, ListOptions, PaginatedDocuments } from './types.js';
import { DOC_ERROR_CODES } from './types.js';

vi.mock('./documentRepository.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    businessId: 'biz-1',
    userId: 'user-1',
    filename: 'receipt_abc123.jpg',
    originalFilename: 'receipt.jpg',
    documentType: 'RECEIPT_IMAGE',
    mimeType: 'image/jpeg',
    fileSize: 204800,
    s3Key: 'documents/biz-1/RECEIPT_IMAGE/2024/01/doc-1_receipt.jpg',
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DocumentService', () => {
  let service: DocumentService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new DocumentService();
  });

  describe('createDocument', () => {
    it('should delegate to repository and return the created document', async () => {
      const data: CreateDocumentData = {
        businessId: 'biz-1',
        userId: 'user-1',
        filename: 'receipt_abc.jpg',
        originalFilename: 'receipt.jpg',
        documentType: 'RECEIPT_IMAGE',
        mimeType: 'image/jpeg',
        fileSize: 204800,
        s3Key: 'documents/biz-1/RECEIPT_IMAGE/2024/01/doc-1_receipt.jpg',
        s3Bucket: 'cashtrace-docs',
      };
      const expected = makeDocument();
      vi.mocked(documentRepository.createDocument).mockResolvedValue(expected);

      const result = await service.createDocument(data);

      expect(documentRepository.createDocument).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });
  });

  describe('getDocumentById', () => {
    it('should return the document when ownership matches', async () => {
      const doc = makeDocument();
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      const result = await service.getDocumentById('doc-1', 'biz-1');

      expect(result).toEqual(doc);
    });

    it('should throw DOC_NOT_FOUND when document does not exist', async () => {
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(null);

      await expect(service.getDocumentById('nonexistent', 'biz-1')).rejects.toThrow(DocumentError);
      await expect(service.getDocumentById('nonexistent', 'biz-1')).rejects.toMatchObject({
        code: DOC_ERROR_CODES.NOT_FOUND,
      });
    });

    it('should throw DOC_FORBIDDEN when business does not own the document', async () => {
      const doc = makeDocument({ businessId: 'biz-1' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      await expect(service.getDocumentById('doc-1', 'biz-other')).rejects.toThrow(DocumentError);
      await expect(service.getDocumentById('doc-1', 'biz-other')).rejects.toMatchObject({
        code: DOC_ERROR_CODES.FORBIDDEN,
      });
    });
  });

  describe('listDocuments', () => {
    it('should delegate to repository with options and return paginated results', async () => {
      const options: ListOptions = {
        page: 1,
        pageSize: 20,
        sortBy: 'uploadedAt',
        sortOrder: 'desc',
      };
      const expected: PaginatedDocuments = {
        documents: [makeDocument()],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      };
      vi.mocked(documentRepository.findDocumentsByBusinessId).mockResolvedValue(expected);

      const result = await service.listDocuments('biz-1', options);

      expect(documentRepository.findDocumentsByBusinessId).toHaveBeenCalledWith('biz-1', options);
      expect(result).toEqual(expected);
    });

    it('should pass status and type filters through to repository', async () => {
      const options: ListOptions = {
        page: 1,
        pageSize: 10,
        sortBy: 'uploadedAt',
        sortOrder: 'desc',
        status: 'PARSED',
        type: 'BANK_STATEMENT',
      };
      const expected: PaginatedDocuments = {
        documents: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      };
      vi.mocked(documentRepository.findDocumentsByBusinessId).mockResolvedValue(expected);

      const result = await service.listDocuments('biz-1', options);

      expect(documentRepository.findDocumentsByBusinessId).toHaveBeenCalledWith('biz-1', options);
      expect(result).toEqual(expected);
    });
  });

  describe('updateStatus', () => {
    it('should update status and return the updated document', async () => {
      const updated = makeDocument({ status: 'PROCESSING' });
      vi.mocked(documentRepository.updateDocumentStatus).mockResolvedValue(updated);

      const result = await service.updateStatus('doc-1', 'PROCESSING');

      expect(documentRepository.updateDocumentStatus).toHaveBeenCalledWith(
        'doc-1',
        'PROCESSING',
        undefined,
      );
      expect(result.status).toBe('PROCESSING');
    });

    it('should pass processing metadata to repository', async () => {
      const metadata = {
        processingStartedAt: new Date(),
        transactionsExtracted: 5,
      };
      const updated = makeDocument({ status: 'PARSED', transactionsExtracted: 5 });
      vi.mocked(documentRepository.updateDocumentStatus).mockResolvedValue(updated);

      const result = await service.updateStatus('doc-1', 'PARSED', metadata);

      expect(documentRepository.updateDocumentStatus).toHaveBeenCalledWith(
        'doc-1',
        'PARSED',
        metadata,
      );
      expect(result.transactionsExtracted).toBe(5);
    });

    it('should throw DOC_NOT_FOUND when document does not exist', async () => {
      vi.mocked(documentRepository.updateDocumentStatus).mockResolvedValue(null);

      await expect(service.updateStatus('nonexistent', 'PROCESSING')).rejects.toThrow(
        DocumentError,
      );
      await expect(service.updateStatus('nonexistent', 'PROCESSING')).rejects.toMatchObject({
        code: DOC_ERROR_CODES.NOT_FOUND,
      });
    });
  });

  describe('deleteDocument', () => {
    it('should delete the document when ownership matches', async () => {
      const doc = makeDocument({ businessId: 'biz-1' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);
      vi.mocked(documentRepository.deleteDocument).mockResolvedValue(true);

      await service.deleteDocument('doc-1', 'biz-1');

      expect(documentRepository.deleteDocument).toHaveBeenCalledWith('doc-1');
    });

    it('should throw DOC_NOT_FOUND when document does not exist', async () => {
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(null);

      await expect(service.deleteDocument('nonexistent', 'biz-1')).rejects.toThrow(DocumentError);
      await expect(service.deleteDocument('nonexistent', 'biz-1')).rejects.toMatchObject({
        code: DOC_ERROR_CODES.NOT_FOUND,
      });
    });

    it('should throw DOC_FORBIDDEN when business does not own the document', async () => {
      const doc = makeDocument({ businessId: 'biz-1' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      await expect(service.deleteDocument('doc-1', 'biz-other')).rejects.toThrow(DocumentError);
      await expect(service.deleteDocument('doc-1', 'biz-other')).rejects.toMatchObject({
        code: DOC_ERROR_CODES.FORBIDDEN,
      });
    });

    it('should not call deleteDocument when ownership check fails', async () => {
      const doc = makeDocument({ businessId: 'biz-1' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      await expect(service.deleteDocument('doc-1', 'biz-other')).rejects.toThrow();

      expect(documentRepository.deleteDocument).not.toHaveBeenCalled();
    });
  });

  describe('verifyOwnership', () => {
    it('should return true when document belongs to the business', async () => {
      const doc = makeDocument({ businessId: 'biz-1' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      const result = await service.verifyOwnership('doc-1', 'biz-1');

      expect(result).toBe(true);
    });

    it('should return false when document belongs to a different business', async () => {
      const doc = makeDocument({ businessId: 'biz-1' });
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(doc);

      const result = await service.verifyOwnership('doc-1', 'biz-other');

      expect(result).toBe(false);
    });

    it('should return false when document does not exist', async () => {
      vi.mocked(documentRepository.findDocumentById).mockResolvedValue(null);

      const result = await service.verifyOwnership('nonexistent', 'biz-1');

      expect(result).toBe(false);
    });
  });

  describe('DocumentError', () => {
    it('should have the correct name, code, and message', () => {
      const error = new DocumentError(DOC_ERROR_CODES.NOT_FOUND, 'Document not found');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DocumentError);
      expect(error.name).toBe('DocumentError');
      expect(error.code).toBe('DOC_NOT_FOUND');
      expect(error.message).toBe('Document not found');
    });
  });
});
