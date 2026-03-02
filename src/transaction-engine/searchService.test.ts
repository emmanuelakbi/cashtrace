/**
 * Unit tests for the SearchService module.
 *
 * All database calls are mocked via vi.mock so these tests run
 * without a live PostgreSQL connection. Tests verify:
 * - buildSearchVector produces correct tsvector SQL
 * - search builds correct queries with filters
 * - search handles empty/special-character queries
 * - rankResults scores and sorts correctly
 * - Partial word matching via prefix search
 *
 * @module transaction-engine/searchService.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';

// ─── Mock the db module ──────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mock is set up
const { buildSearchVector, search, rankResults } = await import('./searchService.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pgResult(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

function fakeSearchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'txn-uuid-1',
    business_id: 'biz-uuid-1',
    source_document_id: 'doc-uuid-1',
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
    raw_metadata: {},
    search_vector: null,
    created_at: new Date('2024-07-15T10:00:00Z'),
    updated_at: new Date('2024-07-15T10:00:00Z'),
    deleted_at: null,
    rank: 0.5,
    matched_fields: ['description'],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
});

// ── buildSearchVector ────────────────────────────────────────────────────────

describe('buildSearchVector', () => {
  it('should produce weighted tsvector SQL for description and counterparty', () => {
    const result = buildSearchVector('Office supplies', 'Shoprite');
    expect(result).toContain("to_tsvector('english', 'Office supplies')");
    expect(result).toContain("'A'");
    expect(result).toContain("to_tsvector('english', 'Shoprite')");
    expect(result).toContain("'B'");
  });

  it('should handle null counterparty', () => {
    const result = buildSearchVector('Fuel purchase', null);
    expect(result).toContain("to_tsvector('english', 'Fuel purchase')");
    expect(result).toContain("to_tsvector('english', '')");
  });

  it('should escape single quotes in description', () => {
    const result = buildSearchVector("Ade's shop", null);
    expect(result).toContain("Ade''s shop");
  });

  it('should escape single quotes in counterparty', () => {
    const result = buildSearchVector('Purchase', "O'Brien");
    expect(result).toContain("O''Brien");
  });
});

// ── search ───────────────────────────────────────────────────────────────────

describe('search', () => {
  it('should return empty results for empty query', async () => {
    const result = await search('', 'biz-1');
    expect(result.transactions).toEqual([]);
    expect(result.total).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should return empty results for query with only special characters', async () => {
    const result = await search('!@#$%^&*()', 'biz-1');
    expect(result.transactions).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should execute search with correct tsquery using prefix matching', async () => {
    mockQuery
      .mockResolvedValueOnce(pgResult([{ count: '1' }]))
      .mockResolvedValueOnce(pgResult([fakeSearchRow()]));

    await search('shoprite', 'biz-uuid-1');

    // Count query
    const countCall = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(countCall[1]).toContain('biz-uuid-1');
    expect(countCall[1]).toContain('shoprite:*');

    // Data query
    const dataCall = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(dataCall[0]).toContain('ts_rank_cd');
    expect(dataCall[0]).toContain("to_tsquery('english'");
    expect(dataCall[0]).toContain('ORDER BY rank DESC');
  });

  it('should combine multiple search terms with AND operator', async () => {
    mockQuery.mockResolvedValueOnce(pgResult([{ count: '0' }])).mockResolvedValueOnce(pgResult([]));

    await search('office supplies', 'biz-1');

    const countCall = mockQuery.mock.calls[0] as [string, unknown[]];
    // Should have "office:* & supplies:*"
    expect(countCall[1]).toContain('office:* & supplies:*');
  });

  it('should apply date range filters', async () => {
    mockQuery.mockResolvedValueOnce(pgResult([{ count: '0' }])).mockResolvedValueOnce(pgResult([]));

    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-12-31');

    await search('test', 'biz-1', { startDate, endDate });

    const countCall = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(countCall[0]).toContain('transaction_date >=');
    expect(countCall[0]).toContain('transaction_date <=');
    expect(countCall[1]).toContain(startDate.toISOString());
    expect(countCall[1]).toContain(endDate.toISOString());
  });

  it('should apply category filter', async () => {
    mockQuery.mockResolvedValueOnce(pgResult([{ count: '0' }])).mockResolvedValueOnce(pgResult([]));

    await search('test', 'biz-1', { category: 'RENT_UTILITIES' });

    const countCall = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(countCall[0]).toContain('category =');
    expect(countCall[1]).toContain('RENT_UTILITIES');
  });

  it('should apply transactionType filter', async () => {
    mockQuery.mockResolvedValueOnce(pgResult([{ count: '0' }])).mockResolvedValueOnce(pgResult([]));

    await search('test', 'biz-1', { transactionType: 'OUTFLOW' });

    const countCall = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(countCall[0]).toContain('transaction_type =');
    expect(countCall[1]).toContain('OUTFLOW');
  });

  it('should map search rows to RankedTransaction objects', async () => {
    const row = fakeSearchRow({ rank: 0.75, matched_fields: ['description', 'counterparty'] });
    mockQuery
      .mockResolvedValueOnce(pgResult([{ count: '1' }]))
      .mockResolvedValueOnce(pgResult([row]));

    const result = await search('shoprite', 'biz-uuid-1');

    expect(result.transactions).toHaveLength(1);
    const txn = result.transactions[0]!;
    expect(txn.id).toBe('txn-uuid-1');
    expect(txn.businessId).toBe('biz-uuid-1');
    expect(txn.relevanceScore).toBe(0.75);
    expect(txn.matchedFields).toEqual(['description', 'counterparty']);
    expect(txn.description).toBe('Office supplies from Shoprite');
  });

  it('should calculate pagination correctly', async () => {
    mockQuery
      .mockResolvedValueOnce(pgResult([{ count: '45' }]))
      .mockResolvedValueOnce(pgResult([]));

    const result = await search('test', 'biz-1', { page: 2, pageSize: 10 });

    expect(result.total).toBe(45);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(5);
  });

  it('should clamp pageSize to MAX_PAGE_SIZE', async () => {
    mockQuery.mockResolvedValueOnce(pgResult([{ count: '0' }])).mockResolvedValueOnce(pgResult([]));

    const result = await search('test', 'biz-1', { pageSize: 500 });
    expect(result.pageSize).toBe(100);
  });

  it('should always filter by businessId and exclude soft-deleted', async () => {
    mockQuery.mockResolvedValueOnce(pgResult([{ count: '0' }])).mockResolvedValueOnce(pgResult([]));

    await search('test', 'biz-123');

    const countCall = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(countCall[0]).toContain('business_id =');
    expect(countCall[0]).toContain('deleted_at IS NULL');
    expect(countCall[1]![0]).toBe('biz-123');
  });

  it('should handle string amount_kobo from pg bigint', async () => {
    const row = fakeSearchRow({ amount_kobo: '9999999999' });
    mockQuery
      .mockResolvedValueOnce(pgResult([{ count: '1' }]))
      .mockResolvedValueOnce(pgResult([row]));

    const result = await search('test', 'biz-1');
    expect(result.transactions[0]!.amountKobo).toBe(9999999999);
  });
});

// ── rankResults ──────────────────────────────────────────────────────────────

describe('rankResults', () => {
  const baseTransaction = {
    id: 'txn-1',
    businessId: 'biz-1',
    sourceDocumentId: null,
    sourceType: 'RECEIPT' as const,
    transactionType: 'OUTFLOW' as const,
    transactionDate: new Date('2024-07-15'),
    amountKobo: 100000,
    reference: null,
    category: 'MISCELLANEOUS_EXPENSES' as const,
    categorySource: 'AUTO' as const,
    categoryConfidence: 50,
    originalCategory: null,
    isPersonal: false,
    isDuplicate: false,
    duplicateOfId: null,
    notes: null,
    rawMetadata: {},
    searchVector: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  it('should score description matches higher than counterparty matches', () => {
    const transactions = [
      {
        ...baseTransaction,
        id: 'txn-cp',
        description: 'General expense',
        counterparty: 'Shoprite',
      },
      { ...baseTransaction, id: 'txn-desc', description: 'Shoprite purchase', counterparty: null },
    ];

    const ranked = rankResults(transactions, 'shoprite');

    // Description match gets weight 2, counterparty gets weight 1
    expect(ranked[0]!.id).toBe('txn-desc');
    expect(ranked[0]!.relevanceScore).toBeGreaterThan(ranked[1]!.relevanceScore);
  });

  it('should include both fields when both match', () => {
    const transactions = [
      { ...baseTransaction, description: 'Shoprite groceries', counterparty: 'Shoprite Lagos' },
    ];

    const ranked = rankResults(transactions, 'shoprite');
    expect(ranked[0]!.matchedFields).toContain('description');
    expect(ranked[0]!.matchedFields).toContain('counterparty');
  });

  it('should return zero score for non-matching transactions', () => {
    const transactions = [
      { ...baseTransaction, description: 'Fuel purchase', counterparty: 'Total' },
    ];

    const ranked = rankResults(transactions, 'shoprite');
    expect(ranked[0]!.relevanceScore).toBe(0);
    expect(ranked[0]!.matchedFields).toEqual([]);
  });

  it('should handle empty query', () => {
    const transactions = [{ ...baseTransaction, description: 'Test', counterparty: null }];

    const ranked = rankResults(transactions, '');
    expect(ranked[0]!.relevanceScore).toBe(0);
    expect(ranked[0]!.matchedFields).toEqual([]);
  });

  it('should sort results by relevance descending', () => {
    const transactions = [
      { ...baseTransaction, id: 'no-match', description: 'Unrelated', counterparty: null },
      {
        ...baseTransaction,
        id: 'both-match',
        description: 'Shoprite fuel',
        counterparty: 'Shoprite',
      },
      {
        ...baseTransaction,
        id: 'desc-match',
        description: 'Shoprite purchase',
        counterparty: null,
      },
    ];

    const ranked = rankResults(transactions, 'shoprite');
    expect(ranked[0]!.id).toBe('both-match');
    expect(ranked[1]!.id).toBe('desc-match');
    expect(ranked[2]!.id).toBe('no-match');
  });
});
