// ============================================================================
// Transaction Engine Module — Duplicate Detection Service
// ============================================================================

import { v4 as uuidv4 } from 'uuid';

import { getPool, query } from '../utils/db.js';

import type { DuplicatePair, SimilarityScore, Transaction } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum description similarity (0–100) to flag as potential duplicate. */
const DESCRIPTION_SIMILARITY_THRESHOLD = 70;

/** Maximum number of days apart for two transactions to be considered duplicates. */
const DATE_PROXIMITY_THRESHOLD_DAYS = 3;

// ─── Row Mapping ─────────────────────────────────────────────────────────────

/** Raw row shape returned by PostgreSQL for the duplicate_pairs table. */
interface DuplicatePairRow {
  id: string;
  business_id: string;
  transaction1_id: string;
  transaction2_id: string;
  similarity_score: number;
  amount_match: boolean;
  date_proximity: number;
  description_similarity: number;
  status: 'PENDING' | 'REVIEWED' | 'RESOLVED';
  resolved_by: string | null;
  resolved_at: Date | null;
  kept_transaction_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Raw row shape for candidate transactions fetched during detection. */
interface CandidateRow {
  id: string;
  transaction_date: Date;
  description: string;
  amount_kobo: string | number;
}

function mapRowToDuplicatePair(row: DuplicatePairRow): DuplicatePair {
  return {
    id: row.id,
    businessId: row.business_id,
    transaction1Id: row.transaction1_id,
    transaction2Id: row.transaction2_id,
    similarityScore: row.similarity_score,
    amountMatch: row.amount_match,
    dateProximity: row.date_proximity,
    descriptionSimilarity: row.description_similarity,
    status: row.status,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    keptTransactionId: row.kept_transaction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Check whether two transactions have exactly the same amount in kobo.
 *
 * @param t1 - First transaction
 * @param t2 - Second transaction
 * @returns true if amounts are equal
 */
export function checkAmountMatch(t1: Transaction, t2: Transaction): boolean {
  return t1.amountKobo === t2.amountKobo;
}

/**
 * Calculate the number of calendar days between two transaction dates.
 * Always returns a non-negative value.
 *
 * @param t1 - First transaction
 * @param t2 - Second transaction
 * @returns Number of days apart (>= 0)
 */
export function calculateDateProximity(t1: Transaction, t2: Transaction): number {
  const MS_PER_DAY = 86_400_000;
  const d1 = t1.transactionDate.getTime();
  const d2 = t2.transactionDate.getTime();
  return Math.round(Math.abs(d1 - d2) / MS_PER_DAY);
}

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * Uses the classic dynamic-programming matrix approach with O(m×n) time
 * and O(min(m,n)) space (single-row optimisation).
 *
 * @param a - First string
 * @param b - Second string
 * @returns The minimum number of single-character edits
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Keep the shorter string in `b` so the working row is as small as possible.
  if (a.length < b.length) {
    [a, b] = [b, a];
  }

  const bLen = b.length;
  let prev = Array.from({ length: bLen + 1 }, (_, i) => i);
  let curr = Array.from<number>({ length: bLen + 1 });

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1, // deletion
        (curr[j - 1] ?? 0) + 1, // insertion
        (prev[j - 1] ?? 0) + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[bLen] ?? 0;
}

/**
 * Calculate the similarity between two strings using the Levenshtein distance,
 * normalised to a 0–100 score where 100 means identical.
 *
 * Both strings are compared case-insensitively after trimming.
 * If both strings are empty the similarity is 100.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Similarity score 0–100 (integer)
 */
export function calculateDescriptionSimilarity(a: string, b: string): number {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();

  if (normA.length === 0 && normB.length === 0) return 100;

  const maxLen = Math.max(normA.length, normB.length);
  const distance = levenshteinDistance(normA, normB);

  return Math.round(((maxLen - distance) / maxLen) * 100);
}

/**
 * Compute an overall similarity score between two transactions.
 *
 * The overall score is a weighted combination:
 *   - Amount match:              40 points (exact match required)
 *   - Date proximity:            30 points (0 days = 30, 3 days = 0, linear)
 *   - Description similarity:    30 points (proportional to 0–100 score)
 *
 * @param t1 - First transaction
 * @param t2 - Second transaction
 * @returns SimilarityScore with overall (0–100), amountMatch, dateProximity, descriptionSimilarity
 */
export function calculateSimilarity(t1: Transaction, t2: Transaction): SimilarityScore {
  const amountMatch = checkAmountMatch(t1, t2);
  const dateProximity = calculateDateProximity(t1, t2);
  const descriptionSimilarity = calculateDescriptionSimilarity(t1.description, t2.description);

  // Weighted scoring
  const amountScore = amountMatch ? 40 : 0;
  const dateScore = dateProximity <= 3 ? Math.round(30 * (1 - dateProximity / 3)) : 0;
  const descScore = Math.round((descriptionSimilarity / 100) * 30);

  const overall = amountScore + dateScore + descScore;

  return {
    overall,
    amountMatch,
    dateProximity,
    descriptionSimilarity,
  };
}

// ============================================================================
// Database-backed duplicate detection
// ============================================================================

/**
 * Find candidate transactions that could be duplicates of a given transaction.
 *
 * Candidates must:
 *   - Belong to the same business
 *   - Have the exact same amount
 *   - Have a transaction date within ±3 days
 *   - Not be soft-deleted
 *   - Not be the transaction itself
 *
 * @param transaction - The transaction to find candidates for
 * @returns Array of candidate rows (id, date, description, amount)
 */
async function findCandidates(transaction: Transaction): Promise<CandidateRow[]> {
  const result = await query<CandidateRow>(
    `SELECT id, transaction_date, description, amount_kobo
     FROM transactions
     WHERE business_id = $1
       AND amount_kobo = $2
       AND transaction_date BETWEEN ($3::date - INTERVAL '3 days') AND ($3::date + INTERVAL '3 days')
       AND id != $4
       AND deleted_at IS NULL`,
    [transaction.businessId, transaction.amountKobo, transaction.transactionDate, transaction.id],
  );

  return result.rows;
}

/**
 * Check whether a duplicate pair already exists for two transaction IDs
 * (in either order).
 */
async function duplicatePairExists(txnId1: string, txnId2: string): Promise<boolean> {
  const result = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM duplicate_pairs
     WHERE (transaction1_id = $1 AND transaction2_id = $2)
        OR (transaction1_id = $2 AND transaction2_id = $1)`,
    [txnId1, txnId2],
  );

  return Number(result.rows[0]?.cnt ?? '0') > 0;
}

/**
 * Create a DuplicatePair record in the database.
 */
async function createDuplicatePair(
  businessId: string,
  txnId1: string,
  txnId2: string,
  similarity: SimilarityScore,
): Promise<DuplicatePair> {
  const id = uuidv4();
  const result = await query<DuplicatePairRow>(
    `INSERT INTO duplicate_pairs (
       id, business_id, transaction1_id, transaction2_id,
       similarity_score, amount_match, date_proximity, description_similarity,
       status, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', NOW(), NOW())
     RETURNING *`,
    [
      id,
      businessId,
      txnId1,
      txnId2,
      similarity.overall,
      similarity.amountMatch,
      similarity.dateProximity,
      similarity.descriptionSimilarity,
    ],
  );

  return mapRowToDuplicatePair(result.rows[0]!);
}

/**
 * Flag a transaction as a duplicate by setting is_duplicate = true.
 */
async function flagAsDuplicate(transactionId: string): Promise<void> {
  await query(
    `UPDATE transactions
     SET is_duplicate = TRUE, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [transactionId],
  );
}

/**
 * Detect potential duplicates for a set of newly created transactions.
 *
 * For each transaction ID provided, the function:
 *   1. Fetches the transaction from the database
 *   2. Queries for candidate matches (same amount, within 3 days, same business)
 *   3. Calculates description similarity for each candidate
 *   4. If similarity > 70%, creates a DuplicatePair record and flags both
 *      transactions as duplicates
 *
 * Duplicate pairs are only created once per unique pair of transactions.
 *
 * @param transactionIds - IDs of newly created transactions to check
 * @param businessId     - The business these transactions belong to
 * @returns Array of DuplicatePair records created
 *
 * @see Requirements 9.1, 9.2, 9.6
 */
export async function detectDuplicates(
  transactionIds: string[],
  businessId: string,
): Promise<DuplicatePair[]> {
  if (transactionIds.length === 0) {
    return [];
  }

  // Fetch the full transactions for the given IDs
  const placeholders = transactionIds.map((_, i) => `$${i + 1}`).join(', ');
  const txnResult = await query<{
    id: string;
    business_id: string;
    source_document_id: string | null;
    source_type: Transaction['sourceType'];
    transaction_type: Transaction['transactionType'];
    transaction_date: Date;
    description: string;
    amount_kobo: string | number;
    counterparty: string | null;
    reference: string | null;
    category: Transaction['category'];
    category_source: Transaction['categorySource'];
    category_confidence: number | null;
    original_category: Transaction['category'] | null;
    is_personal: boolean;
    is_duplicate: boolean;
    duplicate_of_id: string | null;
    notes: string | null;
    raw_metadata: Record<string, unknown>;
    search_vector: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
  }>(
    `SELECT id, business_id, source_document_id, source_type, transaction_type,
            transaction_date, description, amount_kobo, counterparty, reference,
            category, category_source, category_confidence, original_category,
            is_personal, is_duplicate, duplicate_of_id,
            notes, raw_metadata, search_vector,
            created_at, updated_at, deleted_at
     FROM transactions
     WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    transactionIds,
  );

  const transactions: Transaction[] = txnResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    sourceDocumentId: row.source_document_id,
    sourceType: row.source_type,
    transactionType: row.transaction_type,
    transactionDate: row.transaction_date,
    description: row.description,
    amountKobo: typeof row.amount_kobo === 'string' ? Number(row.amount_kobo) : row.amount_kobo,
    counterparty: row.counterparty,
    reference: row.reference,
    category: row.category,
    categorySource: row.category_source,
    categoryConfidence: row.category_confidence,
    originalCategory: row.original_category,
    isPersonal: row.is_personal,
    isDuplicate: row.is_duplicate,
    duplicateOfId: row.duplicate_of_id,
    notes: row.notes,
    rawMetadata: row.raw_metadata,
    searchVector: row.search_vector,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }));

  const newTxnIdSet = new Set(transactionIds);
  const createdPairs: DuplicatePair[] = [];

  // Track pairs we've already processed in this run to avoid duplicates
  const processedPairs = new Set<string>();

  for (const txn of transactions) {
    const candidates = await findCandidates(txn);

    for (const candidate of candidates) {
      // Build a canonical key so we don't create the same pair twice
      const pairKey =
        txn.id < candidate.id ? `${txn.id}:${candidate.id}` : `${candidate.id}:${txn.id}`;

      if (processedPairs.has(pairKey)) {
        continue;
      }
      processedPairs.add(pairKey);

      // Skip if both are new transactions and we'll process the other one later
      // (the second transaction's iteration will also find this candidate)
      // We still need to check — but the processedPairs set handles dedup.

      const descSimilarity = calculateDescriptionSimilarity(txn.description, candidate.description);

      if (descSimilarity <= DESCRIPTION_SIMILARITY_THRESHOLD) {
        continue;
      }

      // Check if this pair already exists in the database
      const exists = await duplicatePairExists(txn.id, candidate.id);
      if (exists) {
        continue;
      }

      // Build a minimal Transaction-like object for the candidate to compute full similarity
      const candidateTxn: Transaction = {
        id: candidate.id,
        businessId: txn.businessId,
        sourceDocumentId: null,
        sourceType: txn.sourceType,
        transactionType: txn.transactionType,
        transactionDate: candidate.transaction_date,
        description: candidate.description,
        amountKobo:
          typeof candidate.amount_kobo === 'string'
            ? Number(candidate.amount_kobo)
            : candidate.amount_kobo,
        counterparty: null,
        reference: null,
        category: txn.category,
        categorySource: 'AUTO',
        categoryConfidence: null,
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

      const similarity = calculateSimilarity(txn, candidateTxn);

      // Create the duplicate pair record
      const pair = await createDuplicatePair(businessId, txn.id, candidate.id, similarity);
      createdPairs.push(pair);

      // Flag both transactions as duplicates
      await flagAsDuplicate(txn.id);
      await flagAsDuplicate(candidate.id);
    }
  }

  return createdPairs;
}

// ============================================================================
// Duplicate resolution
// ============================================================================

/**
 * Retrieve all unresolved (PENDING) duplicate pairs for a given business.
 *
 * @param businessId - The business whose pending duplicates to list
 * @returns Array of DuplicatePair records with status = PENDING
 *
 * @see Requirement 9.3
 */
export async function getUnresolvedDuplicates(businessId: string): Promise<DuplicatePair[]> {
  const result = await query<DuplicatePairRow>(
    `SELECT *
     FROM duplicate_pairs
     WHERE business_id = $1
       AND status = 'PENDING'
     ORDER BY created_at DESC`,
    [businessId],
  );

  return result.rows.map(mapRowToDuplicatePair);
}

/**
 * Mark a duplicate pair as reviewed (i.e. the user confirmed they are NOT duplicates).
 *
 * Updates the pair status to REVIEWED and records who resolved it and when.
 * Clears the isDuplicate flag on both transactions if they have no other
 * PENDING duplicate pairs.
 *
 * @param duplicatePairId - The duplicate pair to mark as reviewed
 * @param userId          - The user performing the review
 *
 * @see Requirement 9.4
 */
export async function markAsReviewed(duplicatePairId: string, userId: string): Promise<void> {
  const pairResult = await query<DuplicatePairRow>(
    `UPDATE duplicate_pairs
     SET status = 'REVIEWED',
         resolved_by = $2,
         resolved_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND status = 'PENDING'
     RETURNING *`,
    [duplicatePairId, userId],
  );

  const pair = pairResult.rows[0];
  if (!pair) {
    return;
  }

  // Clear isDuplicate flag on each transaction if it has no other PENDING pairs
  await clearDuplicateFlagIfNoPendingPairs(pair.transaction1_id);
  await clearDuplicateFlagIfNoPendingPairs(pair.transaction2_id);
}

/**
 * Resolve a confirmed duplicate by soft-deleting one transaction and linking
 * it to the retained one.
 *
 * The pair status is set to RESOLVED and the kept transaction ID is recorded.
 * The discarded transaction is soft-deleted (deleted_at set) and its
 * duplicate_of_id is pointed at the kept transaction.
 *
 * @param duplicatePairId   - The duplicate pair to resolve
 * @param keepTransactionId - The transaction to keep (the other is soft-deleted)
 * @param userId            - The user performing the resolution
 *
 * @see Requirement 9.5
 */
export async function resolveDuplicate(
  duplicatePairId: string,
  keepTransactionId: string,
  userId: string,
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Fetch and update the pair in one step
    const pairResult = await client.query<DuplicatePairRow>(
      `UPDATE duplicate_pairs
       SET status = 'RESOLVED',
           resolved_by = $2,
           resolved_at = NOW(),
           kept_transaction_id = $3,
           updated_at = NOW()
       WHERE id = $1 AND status = 'PENDING'
       RETURNING *`,
      [duplicatePairId, userId, keepTransactionId],
    );

    const pair = pairResult.rows[0];
    if (!pair) {
      await client.query('ROLLBACK');
      return;
    }

    // Determine which transaction to discard
    const discardId =
      pair.transaction1_id === keepTransactionId ? pair.transaction2_id : pair.transaction1_id;

    // Soft-delete the discarded transaction and link to the kept one
    await client.query(
      `UPDATE transactions
       SET deleted_at = NOW(),
           duplicate_of_id = $2,
           updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [discardId, keepTransactionId],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Clear the isDuplicate flag on a transaction if it has no remaining PENDING
 * duplicate pairs (as either transaction1 or transaction2).
 */
async function clearDuplicateFlagIfNoPendingPairs(transactionId: string): Promise<void> {
  const pending = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM duplicate_pairs
     WHERE (transaction1_id = $1 OR transaction2_id = $1)
       AND status = 'PENDING'`,
    [transactionId],
  );

  if (Number(pending.rows[0]?.cnt ?? '0') === 0) {
    await query(
      `UPDATE transactions
       SET is_duplicate = FALSE, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [transactionId],
    );
  }
}
