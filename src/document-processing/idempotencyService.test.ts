/**
 * Unit tests for IdempotencyService.
 *
 * Validates: Requirements 6.4
 * @module document-processing/idempotencyService.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Document } from './types.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('./documentRepository.js', () => ({
  findDocumentByIdempotencyKey: vi.fn(),
  setDocumentIdempotencyKey: vi.fn(),
}));

import * as documentRepository from './documentRepository.js';
import {
  checkIdempotencyKey,
  generateIdempotencyKey,
  setIdempotencyKey,
} from './idempotencyService.js';

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
    status: 'ERROR',
    processingStartedAt: null,
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('IdempotencyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateIdempotencyKey', () => {
    it('should produce a deterministic key for the same inputs', () => {
      const key1 = generateIdempotencyKey('doc-001', 1);
      const key2 = generateIdempotencyKey('doc-001', 1);

      expect(key1).toBe(key2);
    });

    it('should produce a 64-character hex string (SHA-256)', () => {
      const key = generateIdempotencyKey('doc-001', 1);

      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different keys for different document IDs', () => {
      const key1 = generateIdempotencyKey('doc-001', 1);
      const key2 = generateIdempotencyKey('doc-002', 1);

      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different attempt numbers', () => {
      const key1 = generateIdempotencyKey('doc-001', 1);
      const key2 = generateIdempotencyKey('doc-001', 2);

      expect(key1).not.toBe(key2);
    });

    it('should produce different keys when both inputs differ', () => {
      const key1 = generateIdempotencyKey('doc-001', 1);
      const key2 = generateIdempotencyKey('doc-002', 3);

      expect(key1).not.toBe(key2);
    });
  });

  describe('checkIdempotencyKey', () => {
    it('should return true when a document with the key exists', async () => {
      const doc = makeDocument({ idempotencyKey: 'existing-key' });
      vi.mocked(documentRepository.findDocumentByIdempotencyKey).mockResolvedValue(doc);

      const exists = await checkIdempotencyKey('existing-key');

      expect(exists).toBe(true);
      expect(documentRepository.findDocumentByIdempotencyKey).toHaveBeenCalledWith('existing-key');
    });

    it('should return false when no document with the key exists', async () => {
      vi.mocked(documentRepository.findDocumentByIdempotencyKey).mockResolvedValue(null);

      const exists = await checkIdempotencyKey('nonexistent-key');

      expect(exists).toBe(false);
      expect(documentRepository.findDocumentByIdempotencyKey).toHaveBeenCalledWith(
        'nonexistent-key',
      );
    });
  });

  describe('setIdempotencyKey', () => {
    it('should delegate to the repository to set the key', async () => {
      const doc = makeDocument({ idempotencyKey: 'new-key' });
      vi.mocked(documentRepository.setDocumentIdempotencyKey).mockResolvedValue(doc);

      await setIdempotencyKey('doc-001', 'new-key');

      expect(documentRepository.setDocumentIdempotencyKey).toHaveBeenCalledWith(
        'doc-001',
        'new-key',
      );
    });
  });
});
