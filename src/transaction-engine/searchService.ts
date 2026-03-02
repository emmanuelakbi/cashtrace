/**
 * Search service for full-text search across transactions.
 *
 * Uses PostgreSQL native full-text search with tsvector/tsquery.
 * The database has a trigger that auto-updates the search_vector column
 * on transactions with weighted vectors: description (weight 'A'),
 * counterparty (weight 'B'). A GIN index on search_vector ensures
 * efficient lookups.
 *
 * Supports partial word matching via prefix search (:* suffix in tsquery).
 *
 * @module transaction-engine/searchService
 */

import { query } from '../utils/db.js';
import type {
  RankedTransaction,
  SearchResult,
  Transaction,
  TransactionCategory,
  TransactionType,
  CategorySource,
  SourceType,
} from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ─── Row Types ───────────────────────────────────────────────────────────────

/** Row shape returned by the search query, including the relevance rank. */
interface SearchRow {
  id: string;
  business_id: string;
  source_document_id: string | null;
  source_type: SourceType;
  transaction_type: TransactionType;
  transaction_date: Date;
  description: string;
  amount_kobo: string | number;
  counterparty: string | null;
  reference: string | null;
  category: TransactionCategory;
  category_source: CategorySource;
  category_confidence: number | null;
  original_category: TransactionCategory | null;
  is_personal: boolean;
  is_duplicate: boolean;
  duplicate_of_id: string | null;
  notes: string | null;
  raw_metadata: Record<string, unknown>;
  search_vector: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  rank: number;
  matched_fields: string[];
}

// ─── Row Mapping ─────────────────────────────────────────────────────────────

function mapSearchRowToRankedTransaction(row: SearchRow): RankedTransaction {
  return {
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
    relevanceScore: row.rank,
    matchedFields: row.matched_fields,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Sanitise a raw search query for use in a tsquery.
 *
 * Strips characters that are special in tsquery syntax, splits on
 * whitespace, and appends the `:*` prefix-match operator to each
 * lexeme so partial words are matched.
 */
function sanitiseQuery(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
  if (cleaned.length === 0) return '';

  const terms = cleaned.split(/\s+/).filter((t) => t.length > 0);
  return terms.map((t) => `${t}:*`).join(' & ');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a tsvector string from description and counterparty.
 *
 * This mirrors the database trigger logic so callers can preview
 * the search vector that PostgreSQL will generate. Description
 * receives weight 'A' and counterparty receives weight 'B'.
 */
export function buildSearchVector(description: string, counterparty: string | null): string {
  const descVector = `setweight(to_tsvector('english', '${description.replace(/'/g, "''")}'), 'A')`;
  const cpVector = counterparty
    ? `setweight(to_tsvector('english', '${counterparty.replace(/'/g, "''")}'), 'B')`
    : `setweight(to_tsvector('english', ''), 'B')`;
  return `${descVector} || ${cpVector}`;
}

/** Optional filters that can be combined with a text search. */
export interface SearchFilters {
  startDate?: Date;
  endDate?: Date;
  category?: TransactionCategory;
  transactionType?: TransactionType;
  page?: number;
  pageSize?: number;
}

/**
 * Execute a full-text search against the transactions table.
 *
 * Uses PostgreSQL `to_tsquery` with prefix matching (`:*`) so partial
 * words are supported. Results are ranked by `ts_rank_cd` which
 * considers both cover density and weight.
 *
 * Only non-deleted transactions belonging to the given business are
 * returned. Additional filters (date range, category, type) can be
 * applied on top of the text search.
 */
export async function search(
  searchQuery: string,
  businessId: string,
  filters: SearchFilters = {},
): Promise<SearchResult> {
  const tsQuery = sanitiseQuery(searchQuery);

  // If the query is empty after sanitisation, return empty results
  if (tsQuery.length === 0) {
    return {
      transactions: [],
      total: 0,
      page: 1,
      pageSize: filters.pageSize ?? DEFAULT_PAGE_SIZE,
      totalPages: 0,
    };
  }

  const pageSize = Math.min(Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const page = Math.max(1, filters.page ?? 1);

  // ── Build WHERE clause ─────────────────────────────────────────────
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Business scoping
  conditions.push(`business_id = $${paramIndex}`);
  params.push(businessId);
  paramIndex++;

  // Exclude soft-deleted
  conditions.push('deleted_at IS NULL');

  // Full-text search condition
  conditions.push(`search_vector @@ to_tsquery('english', $${paramIndex})`);
  params.push(tsQuery);
  const tsQueryParamIndex = paramIndex;
  paramIndex++;

  // Optional filters
  if (filters.startDate !== undefined) {
    conditions.push(`transaction_date >= $${paramIndex}`);
    params.push(filters.startDate.toISOString());
    paramIndex++;
  }

  if (filters.endDate !== undefined) {
    conditions.push(`transaction_date <= $${paramIndex}`);
    params.push(filters.endDate.toISOString());
    paramIndex++;
  }

  if (filters.category !== undefined) {
    conditions.push(`category = $${paramIndex}`);
    params.push(filters.category);
    paramIndex++;
  }

  if (filters.transactionType !== undefined) {
    conditions.push(`transaction_type = $${paramIndex}`);
    params.push(filters.transactionType);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // ── Count total matches ────────────────────────────────────────────
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM transactions ${whereClause}`,
    params,
  );
  const total = parseInt(countResult.rows[0]!.count, 10);

  // ── Fetch ranked results ───────────────────────────────────────────
  const offset = (page - 1) * pageSize;

  const dataResult = await query<SearchRow>(
    `SELECT
       id, business_id, source_document_id, source_type, transaction_type,
       transaction_date, description, amount_kobo, counterparty, reference,
       category, category_source, category_confidence, original_category,
       is_personal, is_duplicate, duplicate_of_id,
       notes, raw_metadata, search_vector,
       created_at, updated_at, deleted_at,
       ts_rank_cd(search_vector, to_tsquery('english', $${tsQueryParamIndex})) AS rank,
       ARRAY_REMOVE(ARRAY[
         CASE WHEN to_tsvector('english', COALESCE(description, '')) @@ to_tsquery('english', $${tsQueryParamIndex})
              THEN 'description' END,
         CASE WHEN to_tsvector('english', COALESCE(counterparty, '')) @@ to_tsquery('english', $${tsQueryParamIndex})
              THEN 'counterparty' END
       ], NULL) AS matched_fields
     FROM transactions
     ${whereClause}
     ORDER BY rank DESC, transaction_date DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, pageSize, offset],
  );

  const transactions = dataResult.rows.map(mapSearchRowToRankedTransaction);

  const totalPages = Math.ceil(total / pageSize);

  return {
    transactions,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Rank an array of transactions by relevance to a search query.
 *
 * This is a client-side ranking utility that can be used when results
 * have already been fetched (e.g. from cache). It scores each
 * transaction based on term occurrence in description (weight 2) and
 * counterparty (weight 1), then sorts descending by score.
 */
export function rankResults(results: Transaction[], searchQuery: string): RankedTransaction[] {
  const terms = searchQuery
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (terms.length === 0) {
    return results.map((t) => ({ ...t, relevanceScore: 0, matchedFields: [] }));
  }

  return results
    .map((t) => {
      const descLower = t.description.toLowerCase();
      const cpLower = (t.counterparty ?? '').toLowerCase();
      let score = 0;
      const matchedFields: string[] = [];

      let descMatched = false;
      let cpMatched = false;

      for (const term of terms) {
        if (descLower.includes(term)) {
          score += 2;
          descMatched = true;
        }
        if (cpLower.includes(term)) {
          score += 1;
          cpMatched = true;
        }
      }

      if (descMatched) matchedFields.push('description');
      if (cpMatched) matchedFields.push('counterparty');

      return { ...t, relevanceScore: score, matchedFields };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}
