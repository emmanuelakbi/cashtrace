import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Transaction } from './types.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  getPool: () => ({
    connect: () =>
      Promise.resolve({
        query: (...args: unknown[]) => mockClientQuery(...args),
        release: () => mockClientRelease(),
      }),
  }),
}));

const MOCK_UUID = 'pair-uuid-0001';
vi.mock('uuid', () => ({
  v4: () => MOCK_UUID,
}));

// Import after mocks are set up
const {
  calculateDateProximity,
  calculateDescriptionSimilarity,
  calculateSimilarity,
  checkAmountMatch,
  detectDuplicates,
  getUnresolvedDuplicates,
  levenshteinDistance,
  markAsReviewed,
  resolveDuplicate,
} = await import('./duplicateDetectionService.js');

// ---------------------------------------------------------------------------
// Helper: build a minimal Transaction for testing
// ---------------------------------------------------------------------------

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-1',
    businessId: 'biz-1',
    sourceDocumentId: null,
    sourceType: 'MANUAL',
    transactionType: 'OUTFLOW',
    transactionDate: new Date('2024-06-15'),
    description: 'Office supplies purchase',
    amountKobo: 500_000,
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
    searchVector: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkAmountMatch
// ---------------------------------------------------------------------------

describe('checkAmountMatch', () => {
  it('returns true when amounts are equal', () => {
    const t1 = makeTransaction({ amountKobo: 100_000 });
    const t2 = makeTransaction({ amountKobo: 100_000 });
    expect(checkAmountMatch(t1, t2)).toBe(true);
  });

  it('returns false when amounts differ', () => {
    const t1 = makeTransaction({ amountKobo: 100_000 });
    const t2 = makeTransaction({ amountKobo: 100_001 });
    expect(checkAmountMatch(t1, t2)).toBe(false);
  });

  it('returns true for zero amounts', () => {
    const t1 = makeTransaction({ amountKobo: 0 });
    const t2 = makeTransaction({ amountKobo: 0 });
    expect(checkAmountMatch(t1, t2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calculateDateProximity
// ---------------------------------------------------------------------------

describe('calculateDateProximity', () => {
  it('returns 0 for the same date', () => {
    const t1 = makeTransaction({ transactionDate: new Date('2024-06-15') });
    const t2 = makeTransaction({ transactionDate: new Date('2024-06-15') });
    expect(calculateDateProximity(t1, t2)).toBe(0);
  });

  it('returns 1 for consecutive days', () => {
    const t1 = makeTransaction({ transactionDate: new Date('2024-06-15') });
    const t2 = makeTransaction({ transactionDate: new Date('2024-06-16') });
    expect(calculateDateProximity(t1, t2)).toBe(1);
  });

  it('returns 3 for dates 3 days apart', () => {
    const t1 = makeTransaction({ transactionDate: new Date('2024-06-15') });
    const t2 = makeTransaction({ transactionDate: new Date('2024-06-18') });
    expect(calculateDateProximity(t1, t2)).toBe(3);
  });

  it('is symmetric (order does not matter)', () => {
    const t1 = makeTransaction({ transactionDate: new Date('2024-06-10') });
    const t2 = makeTransaction({ transactionDate: new Date('2024-06-15') });
    expect(calculateDateProximity(t1, t2)).toBe(calculateDateProximity(t2, t1));
  });

  it('handles large gaps', () => {
    const t1 = makeTransaction({ transactionDate: new Date('2024-01-01') });
    const t2 = makeTransaction({ transactionDate: new Date('2024-12-31') });
    expect(calculateDateProximity(t1, t2)).toBe(365); // Jan 1 → Dec 31 = 365 days
  });
});

// ---------------------------------------------------------------------------
// levenshteinDistance
// ---------------------------------------------------------------------------

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('returns length of other string when one is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('computes single substitution', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('computes single insertion', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('computes single deletion', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('handles completely different strings', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });

  it('handles real-world descriptions', () => {
    const d = levenshteinDistance('Office supplies purchase', 'Office supplies buy');
    // "purchase" (8 chars) vs "buy" (3 chars) → several edits
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// calculateDescriptionSimilarity
// ---------------------------------------------------------------------------

describe('calculateDescriptionSimilarity', () => {
  it('returns 100 for identical strings', () => {
    expect(calculateDescriptionSimilarity('hello', 'hello')).toBe(100);
  });

  it('returns 100 for two empty strings', () => {
    expect(calculateDescriptionSimilarity('', '')).toBe(100);
  });

  it('is case-insensitive', () => {
    expect(calculateDescriptionSimilarity('Hello', 'hello')).toBe(100);
  });

  it('returns a value between 0 and 100', () => {
    const score = calculateDescriptionSimilarity('abc', 'xyz');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// calculateSimilarity
// ---------------------------------------------------------------------------

describe('calculateSimilarity', () => {
  it('returns high score for identical transactions', () => {
    const t1 = makeTransaction();
    const t2 = makeTransaction({ id: 'txn-2' });
    const score = calculateSimilarity(t1, t2);
    expect(score.overall).toBe(100);
    expect(score.amountMatch).toBe(true);
    expect(score.dateProximity).toBe(0);
    expect(score.descriptionSimilarity).toBe(100);
  });

  it('returns 0 amount score when amounts differ', () => {
    const t1 = makeTransaction({ amountKobo: 100_000 });
    const t2 = makeTransaction({ id: 'txn-2', amountKobo: 200_000 });
    const score = calculateSimilarity(t1, t2);
    expect(score.amountMatch).toBe(false);
    // Without amount match, max is 60 (30 date + 30 desc)
    expect(score.overall).toBeLessThanOrEqual(60);
  });

  it('returns 0 date score when dates are more than 3 days apart', () => {
    const t1 = makeTransaction({ transactionDate: new Date('2024-01-01') });
    const t2 = makeTransaction({ id: 'txn-2', transactionDate: new Date('2024-01-10') });
    const score = calculateSimilarity(t1, t2);
    expect(score.dateProximity).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// detectDuplicates (database-backed)
// ---------------------------------------------------------------------------

describe('detectDuplicates', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
  });

  it('returns empty array when no transaction IDs are provided', async () => {
    const result = await detectDuplicates([], 'biz-1');
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns empty array when no candidates are found', async () => {
    // 1st call: fetch the new transactions by IDs
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'txn-new',
          business_id: 'biz-1',
          source_document_id: null,
          source_type: 'MANUAL',
          transaction_type: 'OUTFLOW',
          transaction_date: new Date('2024-06-15'),
          description: 'Office supplies purchase',
          amount_kobo: 500_000,
          counterparty: null,
          reference: null,
          category: 'MISCELLANEOUS_EXPENSES',
          category_source: 'AUTO',
          category_confidence: 50,
          original_category: null,
          is_personal: false,
          is_duplicate: false,
          duplicate_of_id: null,
          notes: null,
          raw_metadata: {},
          search_vector: null,
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        },
      ],
    });

    // 2nd call: findCandidates — no matches
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await detectDuplicates(['txn-new'], 'biz-1');
    expect(result).toEqual([]);
  });

  it('creates a DuplicatePair and flags both transactions when a match is found', async () => {
    const now = new Date();

    // 1st call: fetch the new transaction
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'txn-new',
          business_id: 'biz-1',
          source_document_id: null,
          source_type: 'MANUAL',
          transaction_type: 'OUTFLOW',
          transaction_date: new Date('2024-06-15'),
          description: 'Office supplies purchase',
          amount_kobo: 500_000,
          counterparty: null,
          reference: null,
          category: 'MISCELLANEOUS_EXPENSES',
          category_source: 'AUTO',
          category_confidence: 50,
          original_category: null,
          is_personal: false,
          is_duplicate: false,
          duplicate_of_id: null,
          notes: null,
          raw_metadata: {},
          search_vector: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      ],
    });

    // 2nd call: findCandidates — one match with identical description
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'txn-existing',
          transaction_date: new Date('2024-06-15'),
          description: 'Office supplies purchase',
          amount_kobo: 500_000,
        },
      ],
    });

    // 3rd call: duplicatePairExists — no existing pair
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    // 4th call: createDuplicatePair INSERT
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: MOCK_UUID,
          business_id: 'biz-1',
          transaction1_id: 'txn-new',
          transaction2_id: 'txn-existing',
          similarity_score: 100,
          amount_match: true,
          date_proximity: 0,
          description_similarity: 100,
          status: 'PENDING',
          resolved_by: null,
          resolved_at: null,
          kept_transaction_id: null,
          created_at: now,
          updated_at: now,
        },
      ],
    });

    // 5th call: flagAsDuplicate for txn-new
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    // 6th call: flagAsDuplicate for txn-existing
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await detectDuplicates(['txn-new'], 'biz-1');

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(MOCK_UUID);
    expect(result[0]!.transaction1Id).toBe('txn-new');
    expect(result[0]!.transaction2Id).toBe('txn-existing');
    expect(result[0]!.status).toBe('PENDING');

    // Verify flagAsDuplicate was called for both transactions
    const flagCalls = mockQuery.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' && (call[0] as string).includes('is_duplicate = TRUE'),
    );
    expect(flagCalls).toHaveLength(2);
  });

  it('skips candidates with description similarity <= 70%', async () => {
    const now = new Date();

    // 1st call: fetch the new transaction
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'txn-new',
          business_id: 'biz-1',
          source_document_id: null,
          source_type: 'MANUAL',
          transaction_type: 'OUTFLOW',
          transaction_date: new Date('2024-06-15'),
          description: 'Office supplies purchase from vendor ABC',
          amount_kobo: 500_000,
          counterparty: null,
          reference: null,
          category: 'MISCELLANEOUS_EXPENSES',
          category_source: 'AUTO',
          category_confidence: 50,
          original_category: null,
          is_personal: false,
          is_duplicate: false,
          duplicate_of_id: null,
          notes: null,
          raw_metadata: {},
          search_vector: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      ],
    });

    // 2nd call: findCandidates — one match but very different description
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'txn-existing',
          transaction_date: new Date('2024-06-15'),
          description: 'Completely unrelated payment for something else entirely',
          amount_kobo: 500_000,
        },
      ],
    });

    const result = await detectDuplicates(['txn-new'], 'biz-1');
    expect(result).toEqual([]);
  });

  it('skips candidates when a duplicate pair already exists', async () => {
    const now = new Date();

    // 1st call: fetch the new transaction
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'txn-new',
          business_id: 'biz-1',
          source_document_id: null,
          source_type: 'MANUAL',
          transaction_type: 'OUTFLOW',
          transaction_date: new Date('2024-06-15'),
          description: 'Office supplies purchase',
          amount_kobo: 500_000,
          counterparty: null,
          reference: null,
          category: 'MISCELLANEOUS_EXPENSES',
          category_source: 'AUTO',
          category_confidence: 50,
          original_category: null,
          is_personal: false,
          is_duplicate: false,
          duplicate_of_id: null,
          notes: null,
          raw_metadata: {},
          search_vector: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      ],
    });

    // 2nd call: findCandidates — one match
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'txn-existing',
          transaction_date: new Date('2024-06-15'),
          description: 'Office supplies purchase',
          amount_kobo: 500_000,
        },
      ],
    });

    // 3rd call: duplicatePairExists — pair already exists
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '1' }] });

    const result = await detectDuplicates(['txn-new'], 'biz-1');
    expect(result).toEqual([]);
  });

  it('does not create duplicate pairs for the same pair twice in one batch', async () => {
    const now = new Date();

    // 1st call: fetch both new transactions
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'txn-a',
          business_id: 'biz-1',
          source_document_id: null,
          source_type: 'MANUAL',
          transaction_type: 'OUTFLOW',
          transaction_date: new Date('2024-06-15'),
          description: 'Office supplies purchase',
          amount_kobo: 500_000,
          counterparty: null,
          reference: null,
          category: 'MISCELLANEOUS_EXPENSES',
          category_source: 'AUTO',
          category_confidence: 50,
          original_category: null,
          is_personal: false,
          is_duplicate: false,
          duplicate_of_id: null,
          notes: null,
          raw_metadata: {},
          search_vector: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
        {
          id: 'txn-b',
          business_id: 'biz-1',
          source_document_id: null,
          source_type: 'MANUAL',
          transaction_type: 'OUTFLOW',
          transaction_date: new Date('2024-06-15'),
          description: 'Office supplies purchase',
          amount_kobo: 500_000,
          counterparty: null,
          reference: null,
          category: 'MISCELLANEOUS_EXPENSES',
          category_source: 'AUTO',
          category_confidence: 50,
          original_category: null,
          is_personal: false,
          is_duplicate: false,
          duplicate_of_id: null,
          notes: null,
          raw_metadata: {},
          search_vector: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      ],
    });

    // 2nd call: findCandidates for txn-a — finds txn-b
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'txn-b',
          transaction_date: new Date('2024-06-15'),
          description: 'Office supplies purchase',
          amount_kobo: 500_000,
        },
      ],
    });

    // 3rd call: duplicatePairExists for txn-a/txn-b — no
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    // 4th call: createDuplicatePair
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: MOCK_UUID,
          business_id: 'biz-1',
          transaction1_id: 'txn-a',
          transaction2_id: 'txn-b',
          similarity_score: 100,
          amount_match: true,
          date_proximity: 0,
          description_similarity: 100,
          status: 'PENDING',
          resolved_by: null,
          resolved_at: null,
          kept_transaction_id: null,
          created_at: now,
          updated_at: now,
        },
      ],
    });

    // 5th & 6th calls: flagAsDuplicate for txn-a and txn-b
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    // 7th call: findCandidates for txn-b — finds txn-a
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'txn-a',
          transaction_date: new Date('2024-06-15'),
          description: 'Office supplies purchase',
          amount_kobo: 500_000,
        },
      ],
    });

    // The pair txn-a:txn-b is already in processedPairs, so no more DB calls needed

    const result = await detectDuplicates(['txn-a', 'txn-b'], 'biz-1');

    // Only one pair should be created
    expect(result).toHaveLength(1);
    expect(result[0]!.transaction1Id).toBe('txn-a');
    expect(result[0]!.transaction2Id).toBe('txn-b');
  });
});

// ---------------------------------------------------------------------------
// getUnresolvedDuplicates
// ---------------------------------------------------------------------------

describe('getUnresolvedDuplicates', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
  });

  it('returns mapped DuplicatePair records for PENDING pairs', async () => {
    const now = new Date();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'pair-1',
          business_id: 'biz-1',
          transaction1_id: 'txn-1',
          transaction2_id: 'txn-2',
          similarity_score: 85,
          amount_match: true,
          date_proximity: 1,
          description_similarity: 80,
          status: 'PENDING',
          resolved_by: null,
          resolved_at: null,
          kept_transaction_id: null,
          created_at: now,
          updated_at: now,
        },
      ],
    });

    const result = await getUnresolvedDuplicates('biz-1');

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('pair-1');
    expect(result[0]!.businessId).toBe('biz-1');
    expect(result[0]!.transaction1Id).toBe('txn-1');
    expect(result[0]!.transaction2Id).toBe('txn-2');
    expect(result[0]!.similarityScore).toBe(85);
    expect(result[0]!.status).toBe('PENDING');

    // Verify the query filters by business_id and PENDING status
    expect(mockQuery).toHaveBeenCalledOnce();
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("status = 'PENDING'");
    expect(sql).toContain('business_id = $1');
  });

  it('returns empty array when no pending pairs exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getUnresolvedDuplicates('biz-1');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// markAsReviewed
// ---------------------------------------------------------------------------

describe('markAsReviewed', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
  });

  it('updates pair to REVIEWED and clears isDuplicate flags when no other pending pairs', async () => {
    const now = new Date();

    // 1st call: UPDATE duplicate_pairs RETURNING *
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'pair-1',
          business_id: 'biz-1',
          transaction1_id: 'txn-1',
          transaction2_id: 'txn-2',
          similarity_score: 85,
          amount_match: true,
          date_proximity: 1,
          description_similarity: 80,
          status: 'REVIEWED',
          resolved_by: 'user-1',
          resolved_at: now,
          kept_transaction_id: null,
          created_at: now,
          updated_at: now,
        },
      ],
    });

    // 2nd call: COUNT pending pairs for txn-1 → 0
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
    // 3rd call: UPDATE transactions SET is_duplicate = FALSE for txn-1
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    // 4th call: COUNT pending pairs for txn-2 → 0
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
    // 5th call: UPDATE transactions SET is_duplicate = FALSE for txn-2
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await markAsReviewed('pair-1', 'user-1');

    // Verify the pair was updated
    const updateSql = mockQuery.mock.calls[0]![0] as string;
    expect(updateSql).toContain("status = 'REVIEWED'");
    expect(updateSql).toContain('resolved_by');

    // Verify isDuplicate was cleared on both transactions
    const clearCalls = mockQuery.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' && (call[0] as string).includes('is_duplicate = FALSE'),
    );
    expect(clearCalls).toHaveLength(2);
  });

  it('does not clear isDuplicate flag when other pending pairs exist', async () => {
    const now = new Date();

    // 1st call: UPDATE duplicate_pairs RETURNING *
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'pair-1',
          business_id: 'biz-1',
          transaction1_id: 'txn-1',
          transaction2_id: 'txn-2',
          similarity_score: 85,
          amount_match: true,
          date_proximity: 1,
          description_similarity: 80,
          status: 'REVIEWED',
          resolved_by: 'user-1',
          resolved_at: now,
          kept_transaction_id: null,
          created_at: now,
          updated_at: now,
        },
      ],
    });

    // 2nd call: COUNT pending pairs for txn-1 → 1 (still has another pending pair)
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '1' }] });

    // 3rd call: COUNT pending pairs for txn-2 → 0
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
    // 4th call: UPDATE transactions SET is_duplicate = FALSE for txn-2
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await markAsReviewed('pair-1', 'user-1');

    // Only txn-2 should have its flag cleared
    const clearCalls = mockQuery.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' && (call[0] as string).includes('is_duplicate = FALSE'),
    );
    expect(clearCalls).toHaveLength(1);
  });

  it('does nothing when pair is not found or not PENDING', async () => {
    // UPDATE returns no rows (pair doesn't exist or already resolved)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await markAsReviewed('nonexistent-pair', 'user-1');

    // Only the UPDATE call should have been made
    expect(mockQuery).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// resolveDuplicate
// ---------------------------------------------------------------------------

describe('resolveDuplicate', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
  });

  it('soft-deletes the discarded transaction and links to the kept one', async () => {
    const now = new Date();

    // 1st client call: BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    // 2nd client call: UPDATE duplicate_pairs RETURNING *
    mockClientQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'pair-1',
          business_id: 'biz-1',
          transaction1_id: 'txn-1',
          transaction2_id: 'txn-2',
          similarity_score: 90,
          amount_match: true,
          date_proximity: 0,
          description_similarity: 90,
          status: 'RESOLVED',
          resolved_by: 'user-1',
          resolved_at: now,
          kept_transaction_id: 'txn-1',
          created_at: now,
          updated_at: now,
        },
      ],
    });

    // 3rd client call: UPDATE transactions (soft-delete txn-2)
    mockClientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    // 4th client call: COMMIT
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    await resolveDuplicate('pair-1', 'txn-1', 'user-1');

    // Verify BEGIN
    expect(mockClientQuery.mock.calls[0]![0]).toBe('BEGIN');

    // Verify pair was updated to RESOLVED with kept_transaction_id
    const pairSql = mockClientQuery.mock.calls[1]![0] as string;
    expect(pairSql).toContain("status = 'RESOLVED'");
    expect(pairSql).toContain('kept_transaction_id');

    // Verify the discarded transaction (txn-2) was soft-deleted and linked
    const deleteSql = mockClientQuery.mock.calls[2]![0] as string;
    expect(deleteSql).toContain('deleted_at = NOW()');
    expect(deleteSql).toContain('duplicate_of_id');
    const deleteParams = mockClientQuery.mock.calls[2]![1] as string[];
    expect(deleteParams[0]).toBe('txn-2'); // discarded
    expect(deleteParams[1]).toBe('txn-1'); // kept

    // Verify COMMIT
    expect(mockClientQuery.mock.calls[3]![0]).toBe('COMMIT');

    // Verify client was released
    expect(mockClientRelease).toHaveBeenCalledOnce();
  });

  it('keeps transaction2 and discards transaction1 when keepTransactionId is transaction2', async () => {
    const now = new Date();

    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'pair-1',
          business_id: 'biz-1',
          transaction1_id: 'txn-1',
          transaction2_id: 'txn-2',
          similarity_score: 90,
          amount_match: true,
          date_proximity: 0,
          description_similarity: 90,
          status: 'RESOLVED',
          resolved_by: 'user-1',
          resolved_at: now,
          kept_transaction_id: 'txn-2',
          created_at: now,
          updated_at: now,
        },
      ],
    });
    mockClientQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // soft-delete txn-1
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT

    await resolveDuplicate('pair-1', 'txn-2', 'user-1');

    // Verify txn-1 was discarded (soft-deleted)
    const deleteParams = mockClientQuery.mock.calls[2]![1] as string[];
    expect(deleteParams[0]).toBe('txn-1'); // discarded
    expect(deleteParams[1]).toBe('txn-2'); // kept
  });

  it('does nothing when pair is not found or not PENDING', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE returns no rows
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await resolveDuplicate('nonexistent-pair', 'txn-1', 'user-1');

    expect(mockClientQuery.mock.calls[2]![0]).toBe('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledOnce();
  });

  it('rolls back and re-throws on error', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockRejectedValueOnce(new Error('DB error')); // UPDATE fails
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(resolveDuplicate('pair-1', 'txn-1', 'user-1')).rejects.toThrow('DB error');

    expect(mockClientQuery.mock.calls[2]![0]).toBe('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledOnce();
  });
});
