/**
 * Unit tests for the DocumentRepository module.
 *
 * All database calls are mocked via vi.mock so these tests run
 * without a live PostgreSQL connection. Tests verify:
 * - Correct SQL queries and parameters
 * - snake_case → camelCase row mapping
 * - Pagination logic
 * - Filter construction
 * - Null/empty handling
 *
 * @module document-processing/documentRepository.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';

import type { DocumentStatus, DocumentType } from './types.js';

// ─── Mock the db module ──────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mock is set up
const {
  mapRowToDocument,
  createDocument,
  findDocumentById,
  findDocumentsByBusinessId,
  updateDocumentStatus,
  deleteDocument,
  countDocumentsByBusinessId,
} = await import('./documentRepository.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake documents-table row with sensible defaults. */
function fakeDocumentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'doc-uuid-1234',
    business_id: 'biz-uuid-5678',
    user_id: 'user-uuid-9012',
    filename: 'receipt_abc123.jpg',
    original_filename: 'my-receipt.jpg',
    document_type: 'RECEIPT_IMAGE',
    mime_type: 'image/jpeg',
    file_size: 2048000,
    s3_key: 'documents/biz-uuid-5678/RECEIPT_IMAGE/2024/01/doc-uuid-1234_receipt.jpg',
    s3_bucket: 'cashtrace-docs',
    status: 'UPLOADED',
    processing_started_at: null,
    processing_completed_at: null,
    processing_duration_ms: null,
    transactions_extracted: null,
    processing_warnings: [],
    processing_errors: [],
    idempotency_key: null,
    uploaded_at: new Date('2024-06-15T10:00:00Z'),
    updated_at: new Date('2024-06-15T10:00:00Z'),
    ...overrides,
  };
}

/** Wrap rows in a pg-style QueryResult shape. */
function pgResult(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
});

describe('documentRepository', () => {
  // ── mapRowToDocument ─────────────────────────────────────────────────────

  describe('mapRowToDocument', () => {
    it('should map all snake_case columns to camelCase properties', () => {
      const row = fakeDocumentRow();
      const doc = mapRowToDocument(row as never);

      expect(doc).toEqual({
        id: 'doc-uuid-1234',
        businessId: 'biz-uuid-5678',
        userId: 'user-uuid-9012',
        filename: 'receipt_abc123.jpg',
        originalFilename: 'my-receipt.jpg',
        documentType: 'RECEIPT_IMAGE',
        mimeType: 'image/jpeg',
        fileSize: 2048000,
        s3Key: 'documents/biz-uuid-5678/RECEIPT_IMAGE/2024/01/doc-uuid-1234_receipt.jpg',
        s3Bucket: 'cashtrace-docs',
        status: 'UPLOADED',
        processingStartedAt: null,
        processingCompletedAt: null,
        processingDurationMs: null,
        transactionsExtracted: null,
        processingWarnings: [],
        processingErrors: [],
        idempotencyKey: null,
        uploadedAt: new Date('2024-06-15T10:00:00Z'),
        updatedAt: new Date('2024-06-15T10:00:00Z'),
      });
    });

    it('should map processing metadata when populated', () => {
      const row = fakeDocumentRow({
        status: 'PARSED',
        processing_started_at: new Date('2024-06-15T10:01:00Z'),
        processing_completed_at: new Date('2024-06-15T10:01:05Z'),
        processing_duration_ms: 5000,
        transactions_extracted: 12,
        processing_warnings: ['Low confidence on line 3'],
        processing_errors: [],
        idempotency_key: 'idem-key-abc',
      });

      const doc = mapRowToDocument(row as never);

      expect(doc.status).toBe('PARSED');
      expect(doc.processingStartedAt).toEqual(new Date('2024-06-15T10:01:00Z'));
      expect(doc.processingCompletedAt).toEqual(new Date('2024-06-15T10:01:05Z'));
      expect(doc.processingDurationMs).toBe(5000);
      expect(doc.transactionsExtracted).toBe(12);
      expect(doc.processingWarnings).toEqual(['Low confidence on line 3']);
      expect(doc.idempotencyKey).toBe('idem-key-abc');
    });

    it('should default processing_warnings and processing_errors to empty arrays when null', () => {
      const row = fakeDocumentRow({
        processing_warnings: null,
        processing_errors: null,
      });

      const doc = mapRowToDocument(row as never);

      expect(doc.processingWarnings).toEqual([]);
      expect(doc.processingErrors).toEqual([]);
    });
  });

  // ── createDocument ───────────────────────────────────────────────────────

  describe('createDocument', () => {
    it('should insert a document and return the mapped result', async () => {
      const row = fakeDocumentRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const doc = await createDocument({
        businessId: 'biz-uuid-5678',
        userId: 'user-uuid-9012',
        filename: 'receipt_abc123.jpg',
        originalFilename: 'my-receipt.jpg',
        documentType: 'RECEIPT_IMAGE',
        mimeType: 'image/jpeg',
        fileSize: 2048000,
        s3Key: 'documents/biz-uuid-5678/RECEIPT_IMAGE/2024/01/doc-uuid-1234_receipt.jpg',
        s3Bucket: 'cashtrace-docs',
      });

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO documents');
      expect(sql).toContain('RETURNING');
      expect(params).toEqual([
        'biz-uuid-5678',
        'user-uuid-9012',
        'receipt_abc123.jpg',
        'my-receipt.jpg',
        'RECEIPT_IMAGE',
        'image/jpeg',
        2048000,
        'documents/biz-uuid-5678/RECEIPT_IMAGE/2024/01/doc-uuid-1234_receipt.jpg',
        'cashtrace-docs',
      ]);
      expect(doc.id).toBe('doc-uuid-1234');
      expect(doc.status).toBe('UPLOADED');
    });
  });

  // ── findDocumentById ─────────────────────────────────────────────────────

  describe('findDocumentById', () => {
    it('should return a mapped Document when found', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([fakeDocumentRow()]));

      const doc = await findDocumentById('doc-uuid-1234');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual(['doc-uuid-1234']);
      expect(doc).not.toBeNull();
      expect(doc!.id).toBe('doc-uuid-1234');
    });

    it('should return null when not found', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const doc = await findDocumentById('nonexistent-id');

      expect(doc).toBeNull();
    });
  });

  // ── findDocumentsByBusinessId ────────────────────────────────────────────

  describe('findDocumentsByBusinessId', () => {
    it('should query with pagination and default sort', async () => {
      // First call: count query
      mockQuery.mockResolvedValueOnce(pgResult([{ count: '2' }]));
      // Second call: select query
      mockQuery.mockResolvedValueOnce(
        pgResult([fakeDocumentRow(), fakeDocumentRow({ id: 'doc-2' })]),
      );

      const result = await findDocumentsByBusinessId('biz-uuid-5678', {
        page: 1,
        pageSize: 20,
        sortBy: 'uploadedAt',
        sortOrder: 'desc',
      });

      expect(mockQuery).toHaveBeenCalledTimes(2);

      // Verify the select query
      const [selectSql, selectParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(selectSql).toContain('ORDER BY uploaded_at DESC');
      expect(selectSql).toContain('LIMIT');
      expect(selectSql).toContain('OFFSET');
      expect(selectParams).toContain('biz-uuid-5678');

      expect(result.documents).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('should apply status filter when provided', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([{ count: '1' }]));
      mockQuery.mockResolvedValueOnce(pgResult([fakeDocumentRow({ status: 'PARSED' })]));

      await findDocumentsByBusinessId('biz-uuid-5678', {
        page: 1,
        pageSize: 10,
        sortBy: 'uploadedAt',
        sortOrder: 'desc',
        status: 'PARSED' as DocumentStatus,
      });

      // Verify count query includes status filter
      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('status = $2');
      expect(countParams).toContain('PARSED');

      // Verify select query includes status filter
      const [selectSql, selectParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(selectSql).toContain('status = $2');
      expect(selectParams).toContain('PARSED');
    });

    it('should apply type filter when provided', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([{ count: '0' }]));
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await findDocumentsByBusinessId('biz-uuid-5678', {
        page: 1,
        pageSize: 10,
        sortBy: 'uploadedAt',
        sortOrder: 'desc',
        type: 'BANK_STATEMENT' as DocumentType,
      });

      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('document_type = $2');
      expect(countParams).toContain('BANK_STATEMENT');
    });

    it('should calculate correct offset for page 2', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([{ count: '25' }]));
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const result = await findDocumentsByBusinessId('biz-uuid-5678', {
        page: 2,
        pageSize: 10,
        sortBy: 'uploadedAt',
        sortOrder: 'desc',
      });

      const [, selectParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      // params: [businessId, pageSize, offset]
      expect(selectParams).toContain(10); // pageSize
      expect(selectParams).toContain(10); // offset = (2-1) * 10

      expect(result.totalPages).toBe(3); // ceil(25/10)
    });

    it('should support ascending sort order', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([{ count: '0' }]));
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await findDocumentsByBusinessId('biz-uuid-5678', {
        page: 1,
        pageSize: 10,
        sortBy: 'filename',
        sortOrder: 'asc',
      });

      const [selectSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(selectSql).toContain('ORDER BY filename ASC');
    });
  });

  // ── updateDocumentStatus ─────────────────────────────────────────────────

  describe('updateDocumentStatus', () => {
    it('should update status only when no metadata provided', async () => {
      const row = fakeDocumentRow({ status: 'PROCESSING' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const doc = await updateDocumentStatus('doc-uuid-1234', 'PROCESSING');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SET status = $2');
      expect(sql).toContain('updated_at = NOW()');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual(['doc-uuid-1234', 'PROCESSING']);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe('PROCESSING');
    });

    it('should update status with processing metadata', async () => {
      const startedAt = new Date('2024-06-15T10:01:00Z');
      const completedAt = new Date('2024-06-15T10:01:05Z');
      const row = fakeDocumentRow({
        status: 'PARSED',
        processing_started_at: startedAt,
        processing_completed_at: completedAt,
        processing_duration_ms: 5000,
        transactions_extracted: 8,
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const doc = await updateDocumentStatus('doc-uuid-1234', 'PARSED', {
        processingStartedAt: startedAt,
        processingCompletedAt: completedAt,
        processingDurationMs: 5000,
        transactionsExtracted: 8,
        processingWarnings: [],
        processingErrors: [],
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('processing_started_at');
      expect(sql).toContain('processing_completed_at');
      expect(sql).toContain('processing_duration_ms');
      expect(sql).toContain('transactions_extracted');
      expect(params).toContain(startedAt);
      expect(params).toContain(completedAt);
      expect(params).toContain(5000);
      expect(params).toContain(8);
      expect(doc!.transactionsExtracted).toBe(8);
    });

    it('should return null when document not found', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const doc = await updateDocumentStatus('nonexistent-id', 'PROCESSING');

      expect(doc).toBeNull();
    });
  });

  // ── deleteDocument ───────────────────────────────────────────────────────

  describe('deleteDocument', () => {
    it('should return true when a row is deleted', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await deleteDocument('doc-uuid-1234');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM documents');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual(['doc-uuid-1234']);
      expect(result).toBe(true);
    });

    it('should return false when no row is deleted', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const result = await deleteDocument('nonexistent-id');

      expect(result).toBe(false);
    });
  });

  // ── countDocumentsByBusinessId ───────────────────────────────────────────

  describe('countDocumentsByBusinessId', () => {
    it('should count all documents for a business without filters', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([{ count: '15' }]));

      const count = await countDocumentsByBusinessId('biz-uuid-5678');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SELECT COUNT(*)');
      expect(sql).toContain('business_id = $1');
      expect(params).toEqual(['biz-uuid-5678']);
      expect(count).toBe(15);
    });

    it('should apply status filter', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([{ count: '3' }]));

      const count = await countDocumentsByBusinessId('biz-uuid-5678', {
        status: 'ERROR' as DocumentStatus,
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('status = $2');
      expect(params).toEqual(['biz-uuid-5678', 'ERROR']);
      expect(count).toBe(3);
    });

    it('should apply both status and type filters', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([{ count: '1' }]));

      const count = await countDocumentsByBusinessId('biz-uuid-5678', {
        status: 'PARSED' as DocumentStatus,
        type: 'POS_EXPORT' as DocumentType,
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('status = $2');
      expect(sql).toContain('document_type = $3');
      expect(params).toEqual(['biz-uuid-5678', 'PARSED', 'POS_EXPORT']);
      expect(count).toBe(1);
    });
  });
});
