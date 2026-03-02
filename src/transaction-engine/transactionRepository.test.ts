/**
 * Unit tests for the TransactionRepository module.
 *
 * All database calls are mocked via vi.mock so these tests run
 * without a live PostgreSQL connection. Tests verify:
 * - Correct SQL queries and parameters
 * - snake_case → camelCase row mapping
 * - Null handling for optional fields
 * - Soft delete exclusion
 * - Dynamic update query building
 *
 * @module transaction-engine/transactionRepository.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';

// ─── Mock the db module ──────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  getPool: () => ({
    connect: () => mockConnect(),
  }),
}));

// Import after mock is set up
const { create, findById, findByBusinessId, update, softDelete, bulkCreate, findWithFilters } =
  await import('./transactionRepository.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake transactions row with sensible defaults. */
function fakeTransactionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'txn-uuid-1234-5678-abcd-ef0123456789',
    business_id: 'biz-uuid-aaaa-bbbb-cccc-ddddeeeeeeee',
    source_document_id: 'doc-uuid-1111-2222-3333-444455556666',
    source_type: 'RECEIPT',
    transaction_type: 'OUTFLOW',
    transaction_date: new Date('2024-07-15T00:00:00Z'),
    description: 'Office supplies from Shoprite',
    amount_kobo: 150000,
    counterparty: 'Shoprite',
    reference: 'REF-001',
    category: 'MISCELLANEOUS_EXPENSES',
    category_source: 'AUTO',
    category_confidence: 65,
    original_category: 'MISCELLANEOUS_EXPENSES',
    is_personal: false,
    is_duplicate: false,
    duplicate_of_id: null,
    notes: null,
    raw_metadata: { source: 'receipt-scan' },
    search_vector: null,
    created_at: new Date('2024-07-15T10:00:00Z'),
    updated_at: new Date('2024-07-15T10:00:00Z'),
    deleted_at: null,
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
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  mockConnect.mockReset();
  mockConnect.mockResolvedValue({
    query: (...args: unknown[]) => mockClientQuery(...args),
    release: () => mockClientRelease(),
  });
});

describe('transactionRepository', () => {
  // ── create ─────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should insert a transaction and return the mapped record', async () => {
      const row = fakeTransactionRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const txn = await create({
        businessId: 'biz-uuid-aaaa-bbbb-cccc-ddddeeeeeeee',
        sourceDocumentId: 'doc-uuid-1111-2222-3333-444455556666',
        sourceType: 'RECEIPT',
        transactionType: 'OUTFLOW',
        transactionDate: new Date('2024-07-15T00:00:00Z'),
        description: 'Office supplies from Shoprite',
        amountKobo: 150000,
        counterparty: 'Shoprite',
        reference: 'REF-001',
        category: 'MISCELLANEOUS_EXPENSES',
        categorySource: 'AUTO',
        categoryConfidence: 65,
        originalCategory: 'MISCELLANEOUS_EXPENSES',
        isPersonal: false,
        isDuplicate: false,
        duplicateOfId: null,
        notes: null,
        rawMetadata: { source: 'receipt-scan' },
      });

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO transactions');
      expect(sql).toContain('RETURNING');
      expect(params).toHaveLength(18);
      expect(params![0]).toBe('biz-uuid-aaaa-bbbb-cccc-ddddeeeeeeee');
      expect(params![6]).toBe(150000);

      // Verify camelCase mapping
      expect(txn.id).toBe(row.id);
      expect(txn.businessId).toBe(row.business_id);
      expect(txn.sourceDocumentId).toBe(row.source_document_id);
      expect(txn.sourceType).toBe('RECEIPT');
      expect(txn.transactionType).toBe('OUTFLOW');
      expect(txn.amountKobo).toBe(150000);
      expect(txn.counterparty).toBe('Shoprite');
      expect(txn.isPersonal).toBe(false);
      expect(txn.deletedAt).toBeNull();
    });

    it('should handle null optional fields', async () => {
      const row = fakeTransactionRow({
        source_document_id: null,
        counterparty: null,
        reference: null,
        category_confidence: null,
        original_category: null,
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const txn = await create({
        businessId: 'biz-id',
        sourceDocumentId: null,
        sourceType: 'MANUAL',
        transactionType: 'INFLOW',
        transactionDate: new Date('2024-07-15T00:00:00Z'),
        description: 'Manual entry',
        amountKobo: 50000,
        counterparty: null,
        reference: null,
        category: 'OTHER_INCOME',
        categorySource: 'MANUAL',
        categoryConfidence: null,
        originalCategory: null,
        isPersonal: false,
        isDuplicate: false,
        duplicateOfId: null,
        notes: null,
        rawMetadata: {},
      });

      expect(txn.sourceDocumentId).toBeNull();
      expect(txn.counterparty).toBeNull();
      expect(txn.reference).toBeNull();
      expect(txn.categoryConfidence).toBeNull();
      expect(txn.originalCategory).toBeNull();
    });

    it('should serialize rawMetadata as JSON string', async () => {
      const row = fakeTransactionRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await create({
        businessId: 'biz-id',
        sourceDocumentId: null,
        sourceType: 'RECEIPT',
        transactionType: 'OUTFLOW',
        transactionDate: new Date(),
        description: 'Test',
        amountKobo: 1000,
        counterparty: null,
        reference: null,
        category: 'MISCELLANEOUS_EXPENSES',
        categorySource: 'AUTO',
        categoryConfidence: 50,
        originalCategory: 'MISCELLANEOUS_EXPENSES',
        isPersonal: false,
        isDuplicate: false,
        duplicateOfId: null,
        notes: null,
        rawMetadata: { key: 'value' },
      });

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params![17]).toBe('{"key":"value"}');
    });

    it('should convert amountKobo from bigint string to number', async () => {
      const row = fakeTransactionRow({ amount_kobo: '9999999999' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const txn = await create({
        businessId: 'biz-id',
        sourceDocumentId: null,
        sourceType: 'RECEIPT',
        transactionType: 'OUTFLOW',
        transactionDate: new Date(),
        description: 'Large amount',
        amountKobo: 9999999999,
        counterparty: null,
        reference: null,
        category: 'MISCELLANEOUS_EXPENSES',
        categorySource: 'AUTO',
        categoryConfidence: 50,
        originalCategory: null,
        isPersonal: false,
        isDuplicate: false,
        duplicateOfId: null,
        notes: null,
        rawMetadata: {},
      });

      expect(txn.amountKobo).toBe(9999999999);
      expect(typeof txn.amountKobo).toBe('number');
    });
  });

  // ── findById ───────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should query by id excluding soft-deleted and return mapped Transaction', async () => {
      const row = fakeTransactionRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const txn = await findById('txn-uuid-1234-5678-abcd-ef0123456789');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE id = $1');
      expect(sql).toContain('deleted_at IS NULL');
      expect(params).toEqual(['txn-uuid-1234-5678-abcd-ef0123456789']);

      expect(txn).not.toBeNull();
      expect(txn!.id).toBe('txn-uuid-1234-5678-abcd-ef0123456789');
      expect(txn!.businessId).toBe('biz-uuid-aaaa-bbbb-cccc-ddddeeeeeeee');
    });

    it('should return null when no transaction matches', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const txn = await findById('nonexistent-id');

      expect(txn).toBeNull();
    });

    it('should return null for soft-deleted transactions (handled by WHERE clause)', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const txn = await findById('deleted-txn-id');

      expect(txn).toBeNull();
      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('deleted_at IS NULL');
    });
  });

  // ── findByBusinessId ───────────────────────────────────────────────────

  describe('findByBusinessId', () => {
    it('should query by business_id, exclude soft-deleted, and order by date DESC', async () => {
      const row1 = fakeTransactionRow({
        id: 'txn-1',
        transaction_date: new Date('2024-07-20'),
      });
      const row2 = fakeTransactionRow({
        id: 'txn-2',
        transaction_date: new Date('2024-07-15'),
      });
      mockQuery.mockResolvedValueOnce(pgResult([row1, row2]));

      const txns = await findByBusinessId('biz-uuid-aaaa-bbbb-cccc-ddddeeeeeeee');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE business_id = $1');
      expect(sql).toContain('deleted_at IS NULL');
      expect(sql).toContain('ORDER BY transaction_date DESC');
      expect(params).toEqual(['biz-uuid-aaaa-bbbb-cccc-ddddeeeeeeee']);

      expect(txns).toHaveLength(2);
      expect(txns[0]!.id).toBe('txn-1');
      expect(txns[1]!.id).toBe('txn-2');
    });

    it('should return empty array when no transactions exist for business', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const txns = await findByBusinessId('biz-no-txns');

      expect(txns).toEqual([]);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update only provided fields and set updated_at', async () => {
      const row = fakeTransactionRow({
        description: 'Updated description',
        updated_at: new Date('2024-07-16T10:00:00Z'),
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const txn = await update('txn-uuid-1234', { description: 'Updated description' });

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE transactions');
      expect(sql).toContain('description = $1');
      expect(sql).toContain('updated_at = NOW()');
      expect(sql).toContain('deleted_at IS NULL');
      expect(sql).toContain('RETURNING');
      expect(params).toEqual(['Updated description', 'txn-uuid-1234']);

      expect(txn).not.toBeNull();
      expect(txn!.description).toBe('Updated description');
    });

    it('should update multiple fields at once', async () => {
      const row = fakeTransactionRow({
        description: 'New desc',
        is_personal: true,
        notes: 'Some notes',
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await update('txn-uuid-1234', {
        description: 'New desc',
        isPersonal: true,
        notes: 'Some notes',
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('description = $1');
      expect(sql).toContain('is_personal = $2');
      expect(sql).toContain('notes = $3');
      expect(params).toEqual(['New desc', true, 'Some notes', 'txn-uuid-1234']);
    });

    it('should update category field', async () => {
      const row = fakeTransactionRow({ category: 'RENT_UTILITIES' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await update('txn-uuid-1234', { category: 'RENT_UTILITIES' });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('category = $1');
      expect(params).toEqual(['RENT_UTILITIES', 'txn-uuid-1234']);
    });

    it('should update transactionDate field', async () => {
      const newDate = new Date('2024-08-01T00:00:00Z');
      const row = fakeTransactionRow({ transaction_date: newDate });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await update('txn-uuid-1234', { transactionDate: newDate });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('transaction_date = $1');
      expect(params).toEqual([newDate.toISOString(), 'txn-uuid-1234']);
    });

    it('should return current record when no fields are provided', async () => {
      const row = fakeTransactionRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const txn = await update('txn-uuid-1234', {});

      // Should call findById instead of UPDATE
      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SELECT');
      expect(sql).not.toContain('UPDATE');
      expect(txn).not.toBeNull();
    });

    it('should return null when transaction not found', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const txn = await update('nonexistent-id', { description: 'test' });

      expect(txn).toBeNull();
    });
  });

  // ── softDelete ─────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('should set deleted_at and updated_at to NOW()', async () => {
      const deletedAt = new Date('2024-07-16T12:00:00Z');
      const row = fakeTransactionRow({
        deleted_at: deletedAt,
        updated_at: deletedAt,
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const txn = await softDelete('txn-uuid-1234');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE transactions');
      expect(sql).toContain('deleted_at = NOW()');
      expect(sql).toContain('updated_at = NOW()');
      expect(sql).toContain('WHERE id = $1');
      expect(sql).toContain('deleted_at IS NULL');
      expect(sql).toContain('RETURNING');
      expect(params).toEqual(['txn-uuid-1234']);

      expect(txn).not.toBeNull();
      expect(txn!.deletedAt).toEqual(deletedAt);
    });

    it('should return null when transaction not found or already deleted', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const txn = await softDelete('nonexistent-or-deleted-id');

      expect(txn).toBeNull();
    });
  });

  // ── bulkCreate ───────────────────────────────────────────────────────

  describe('bulkCreate', () => {
    /** Helper to build a minimal CreateTransactionData object. */
    function makeCreateData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        businessId: 'biz-uuid-aaaa-bbbb-cccc-ddddeeeeeeee',
        sourceDocumentId: 'doc-uuid-1111-2222-3333-444455556666',
        sourceType: 'RECEIPT',
        transactionType: 'OUTFLOW',
        transactionDate: new Date('2024-07-15T00:00:00Z'),
        description: 'Office supplies',
        amountKobo: 150000,
        counterparty: 'Shoprite',
        reference: 'REF-001',
        category: 'MISCELLANEOUS_EXPENSES',
        categorySource: 'AUTO',
        categoryConfidence: 65,
        originalCategory: 'MISCELLANEOUS_EXPENSES',
        isPersonal: false,
        isDuplicate: false,
        duplicateOfId: null,
        notes: null,
        rawMetadata: {},
        ...overrides,
      };
    }

    it('should return empty array for empty input without touching the database', async () => {
      const result = await bulkCreate([]);

      expect(result).toEqual([]);
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('should insert all transactions within a BEGIN/COMMIT block', async () => {
      const row1 = fakeTransactionRow({ id: 'txn-1', description: 'Item A' });
      const row2 = fakeTransactionRow({ id: 'txn-2', description: 'Item B' });

      // BEGIN, INSERT #1, INSERT #2, COMMIT
      mockClientQuery
        .mockResolvedValueOnce(pgResult([])) // BEGIN
        .mockResolvedValueOnce(pgResult([row1])) // INSERT 1
        .mockResolvedValueOnce(pgResult([row2])) // INSERT 2
        .mockResolvedValueOnce(pgResult([])); // COMMIT

      const data1 = makeCreateData({ description: 'Item A' });
      const data2 = makeCreateData({ description: 'Item B' });

      const txns = await bulkCreate([data1, data2] as never);

      expect(mockConnect).toHaveBeenCalledOnce();
      expect(mockClientQuery).toHaveBeenCalledTimes(4);

      // Verify BEGIN and COMMIT
      expect(mockClientQuery.mock.calls[0]![0]).toBe('BEGIN');
      expect(mockClientQuery.mock.calls[3]![0]).toBe('COMMIT');

      // Verify INSERT SQL
      const [sql1] = mockClientQuery.mock.calls[1] as [string, unknown[]];
      expect(sql1).toContain('INSERT INTO transactions');
      expect(sql1).toContain('RETURNING');

      const [sql2] = mockClientQuery.mock.calls[2] as [string, unknown[]];
      expect(sql2).toContain('INSERT INTO transactions');

      expect(txns).toHaveLength(2);
      expect(txns[0]!.id).toBe('txn-1');
      expect(txns[1]!.id).toBe('txn-2');

      // Client should be released
      expect(mockClientRelease).toHaveBeenCalledOnce();
    });

    it('should ROLLBACK and re-throw when an insert fails', async () => {
      const row1 = fakeTransactionRow({ id: 'txn-1' });
      const insertError = new Error('duplicate key violation');

      mockClientQuery
        .mockResolvedValueOnce(pgResult([])) // BEGIN
        .mockResolvedValueOnce(pgResult([row1])) // INSERT 1 OK
        .mockRejectedValueOnce(insertError) // INSERT 2 FAILS
        .mockResolvedValueOnce(pgResult([])); // ROLLBACK

      const data1 = makeCreateData({ description: 'OK' });
      const data2 = makeCreateData({ description: 'Bad' });

      await expect(bulkCreate([data1, data2] as never)).rejects.toThrow('duplicate key violation');

      // Should have called ROLLBACK, not COMMIT
      const calls = mockClientQuery.mock.calls.map((c) => c[0]);
      expect(calls[0]).toBe('BEGIN');
      expect(calls[3]).toBe('ROLLBACK');
      expect(calls).not.toContain('COMMIT');

      // Client must still be released
      expect(mockClientRelease).toHaveBeenCalledOnce();
    });

    it('should release the client even when ROLLBACK itself fails', async () => {
      mockClientQuery
        .mockResolvedValueOnce(pgResult([])) // BEGIN
        .mockRejectedValueOnce(new Error('insert error')) // INSERT fails
        .mockRejectedValueOnce(new Error('rollback error')); // ROLLBACK fails

      const data = makeCreateData();

      // When ROLLBACK throws, that error propagates from the catch block
      await expect(bulkCreate([data] as never)).rejects.toThrow('rollback error');

      // Critical: client must still be released via the finally block
      expect(mockClientRelease).toHaveBeenCalledOnce();
    });

    it('should pass correct parameters for each insert', async () => {
      const row = fakeTransactionRow();

      mockClientQuery
        .mockResolvedValueOnce(pgResult([])) // BEGIN
        .mockResolvedValueOnce(pgResult([row])) // INSERT
        .mockResolvedValueOnce(pgResult([])); // COMMIT

      const data = makeCreateData({
        businessId: 'biz-123',
        amountKobo: 500000,
        rawMetadata: { key: 'val' },
      });

      await bulkCreate([data] as never);

      const [, params] = mockClientQuery.mock.calls[1] as [string, unknown[]];
      expect(params![0]).toBe('biz-123');
      expect(params![6]).toBe(500000);
      expect(params![17]).toBe('{"key":"val"}');
    });

    it('should correctly map returned rows to Transaction objects', async () => {
      const row = fakeTransactionRow({
        id: 'bulk-txn-1',
        amount_kobo: '750000',
        counterparty: 'GTBank',
      });

      mockClientQuery
        .mockResolvedValueOnce(pgResult([])) // BEGIN
        .mockResolvedValueOnce(pgResult([row])) // INSERT
        .mockResolvedValueOnce(pgResult([])); // COMMIT

      const data = makeCreateData();
      const txns = await bulkCreate([data] as never);

      expect(txns).toHaveLength(1);
      expect(txns[0]!.id).toBe('bulk-txn-1');
      expect(txns[0]!.amountKobo).toBe(750000);
      expect(typeof txns[0]!.amountKobo).toBe('number');
      expect(txns[0]!.counterparty).toBe('GTBank');
    });
  });

  // ── findWithFilters ──────────────────────────────────────────────────

  describe('findWithFilters', () => {
    /** Default minimal filters with required pagination fields. */
    const defaultFilters = {
      page: 1,
      pageSize: 20,
      sortBy: 'transactionDate' as const,
      sortOrder: 'desc' as const,
    };

    /** Helper: mock COUNT then SELECT queries. */
    function mockCountAndSelect(total: number, rows: Record<string, unknown>[]): void {
      mockQuery
        .mockResolvedValueOnce(pgResult([{ count: String(total) }]))
        .mockResolvedValueOnce(pgResult(rows));
    }

    it('should build WHERE with business_id and deleted_at IS NULL', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', defaultFilters);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('business_id = $1');
      expect(countSql).toContain('deleted_at IS NULL');
      expect(countParams![0]).toBe('biz-123');

      const [selectSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(selectSql).toContain('business_id = $1');
      expect(selectSql).toContain('deleted_at IS NULL');
    });

    it('should default sort to transaction_date DESC', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', defaultFilters);

      const [selectSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(selectSql).toContain('ORDER BY transaction_date DESC');
    });

    it('should support sorting by amount ASC', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', {
        ...defaultFilters,
        sortBy: 'amount',
        sortOrder: 'asc',
      });

      const [selectSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(selectSql).toContain('ORDER BY amount_kobo ASC');
    });

    it('should support sorting by createdAt', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', {
        ...defaultFilters,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      const [selectSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(selectSql).toContain('ORDER BY created_at DESC');
    });

    it('should apply date range filters', async () => {
      mockCountAndSelect(0, []);

      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-12-31T23:59:59Z');

      await findWithFilters('biz-123', {
        ...defaultFilters,
        startDate,
        endDate,
      });

      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('transaction_date >= $2');
      expect(countSql).toContain('transaction_date <= $3');
      expect(countParams![1]).toBe(startDate.toISOString());
      expect(countParams![2]).toBe(endDate.toISOString());
    });

    it('should apply amount range filters', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', {
        ...defaultFilters,
        minAmount: 10000,
        maxAmount: 500000,
      });

      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('amount_kobo >= $2');
      expect(countSql).toContain('amount_kobo <= $3');
      expect(countParams![1]).toBe(10000);
      expect(countParams![2]).toBe(500000);
    });

    it('should apply category filter', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', {
        ...defaultFilters,
        category: 'RENT_UTILITIES',
      });

      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('category = $2');
      expect(countParams![1]).toBe('RENT_UTILITIES');
    });

    it('should apply sourceType filter', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', {
        ...defaultFilters,
        sourceType: 'BANK_STATEMENT',
      });

      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('source_type = $2');
      expect(countParams![1]).toBe('BANK_STATEMENT');
    });

    it('should apply transactionType filter', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', {
        ...defaultFilters,
        transactionType: 'INFLOW',
      });

      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('transaction_type = $2');
      expect(countParams![1]).toBe('INFLOW');
    });

    it('should apply isPersonal filter', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', {
        ...defaultFilters,
        isPersonal: true,
      });

      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('is_personal = $2');
      expect(countParams![1]).toBe(true);
    });

    it('should combine multiple filters', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', {
        ...defaultFilters,
        startDate: new Date('2024-01-01'),
        category: 'SALARIES_WAGES',
        transactionType: 'OUTFLOW',
        isPersonal: false,
      });

      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(countSql).toContain('transaction_date >= $2');
      expect(countSql).toContain('category = $3');
      expect(countSql).toContain('transaction_type = $4');
      expect(countSql).toContain('is_personal = $5');
      expect(countParams).toHaveLength(5);
    });

    it('should compute correct pagination info', async () => {
      const row = fakeTransactionRow();
      mockCountAndSelect(45, [row]);

      const result = await findWithFilters('biz-123', {
        ...defaultFilters,
        page: 2,
        pageSize: 20,
      });

      expect(result.pagination).toEqual({
        page: 2,
        pageSize: 20,
        total: 45,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
    });

    it('should set hasNext false on last page', async () => {
      mockCountAndSelect(20, []);

      const result = await findWithFilters('biz-123', {
        ...defaultFilters,
        page: 1,
        pageSize: 20,
      });

      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrevious).toBe(false);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should clamp pageSize to max 100', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', {
        ...defaultFilters,
        pageSize: 500,
      });

      const [, selectParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      // LIMIT param should be 100 (clamped)
      const limitParam = selectParams![selectParams!.length - 2];
      expect(limitParam).toBe(100);
    });

    it('should default pageSize to 20 when 0 or negative', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', {
        ...defaultFilters,
        pageSize: 0,
      });

      const [, selectParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      const limitParam = selectParams![selectParams!.length - 2];
      expect(limitParam).toBe(20);
    });

    it('should calculate correct OFFSET for pagination', async () => {
      mockCountAndSelect(100, []);

      await findWithFilters('biz-123', {
        ...defaultFilters,
        page: 3,
        pageSize: 10,
      });

      const [, selectParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      // OFFSET = (3 - 1) * 10 = 20
      const offsetParam = selectParams![selectParams!.length - 1];
      expect(offsetParam).toBe(20);
    });

    it('should map returned rows to Transaction objects', async () => {
      const row = fakeTransactionRow({ id: 'filtered-txn-1' });
      mockCountAndSelect(1, [row]);

      const result = await findWithFilters('biz-123', defaultFilters);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.id).toBe('filtered-txn-1');
      expect(result.transactions[0]!.businessId).toBe('biz-uuid-aaaa-bbbb-cccc-ddddeeeeeeee');
    });

    it('should return empty transactions with zero total', async () => {
      mockCountAndSelect(0, []);

      const result = await findWithFilters('biz-123', defaultFilters);

      expect(result.transactions).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrevious).toBe(false);
    });

    it('should use LIMIT and OFFSET in the SELECT query', async () => {
      mockCountAndSelect(0, []);

      await findWithFilters('biz-123', defaultFilters);

      const [selectSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(selectSql).toContain('LIMIT');
      expect(selectSql).toContain('OFFSET');
    });
  });

  // ── Row mapping edge cases ─────────────────────────────────────────────

  describe('row mapping', () => {
    it('should map all fields correctly from snake_case to camelCase', async () => {
      const row = fakeTransactionRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const txn = await findById('txn-uuid-1234-5678-abcd-ef0123456789');

      expect(txn).toEqual({
        id: 'txn-uuid-1234-5678-abcd-ef0123456789',
        businessId: 'biz-uuid-aaaa-bbbb-cccc-ddddeeeeeeee',
        sourceDocumentId: 'doc-uuid-1111-2222-3333-444455556666',
        sourceType: 'RECEIPT',
        transactionType: 'OUTFLOW',
        transactionDate: new Date('2024-07-15T00:00:00Z'),
        description: 'Office supplies from Shoprite',
        amountKobo: 150000,
        counterparty: 'Shoprite',
        reference: 'REF-001',
        category: 'MISCELLANEOUS_EXPENSES',
        categorySource: 'AUTO',
        categoryConfidence: 65,
        originalCategory: 'MISCELLANEOUS_EXPENSES',
        isPersonal: false,
        isDuplicate: false,
        duplicateOfId: null,
        notes: null,
        rawMetadata: { source: 'receipt-scan' },
        searchVector: null,
        createdAt: new Date('2024-07-15T10:00:00Z'),
        updatedAt: new Date('2024-07-15T10:00:00Z'),
        deletedAt: null,
      });
    });

    it('should handle amount_kobo returned as string (BIGINT)', async () => {
      const row = fakeTransactionRow({ amount_kobo: '250000' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const txn = await findById('some-id');

      expect(txn!.amountKobo).toBe(250000);
      expect(typeof txn!.amountKobo).toBe('number');
    });

    it('should handle amount_kobo returned as number', async () => {
      const row = fakeTransactionRow({ amount_kobo: 250000 });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const txn = await findById('some-id');

      expect(txn!.amountKobo).toBe(250000);
      expect(typeof txn!.amountKobo).toBe('number');
    });
  });
});
