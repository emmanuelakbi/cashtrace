/**
 * Transaction repository for database operations on the transactions table.
 *
 * Provides functional (exported functions, not classes) database access for
 * transaction CRUD operations. Uses parameterized queries via the shared
 * pg Pool to prevent SQL injection.
 *
 * Handles snake_case ↔ camelCase mapping between the PostgreSQL schema
 * and TypeScript Transaction type.
 *
 * @module transaction-engine/transactionRepository
 */

import { getPool, query } from '../utils/db.js';
import type {
  Transaction,
  TransactionCategory,
  TransactionType,
  SourceType,
  CategorySource,
  TransactionFilters,
  PaginationInfo,
  TransactionUpdates,
} from './types.js';

// ─── Row Mapping ─────────────────────────────────────────────────────────────

/** Raw row shape returned by PostgreSQL for the transactions table. */
interface TransactionRow {
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
}

/** All columns selected in queries (excluding search_vector for reads). */
const SELECT_COLUMNS = `
  id, business_id, source_document_id, source_type, transaction_type,
  transaction_date, description, amount_kobo, counterparty, reference,
  category, category_source, category_confidence, original_category,
  is_personal, is_duplicate, duplicate_of_id,
  notes, raw_metadata, search_vector,
  created_at, updated_at, deleted_at
`;

/**
 * Map a database row (snake_case) to a Transaction domain object (camelCase).
 */
function mapRowToTransaction(row: TransactionRow): Transaction {
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
  };
}

// ─── Create Data Interface ───────────────────────────────────────────────────

/** Data required to create a new transaction (excludes auto-generated fields). */
export interface CreateTransactionData {
  businessId: string;
  sourceDocumentId: string | null;
  sourceType: SourceType;
  transactionType: TransactionType;
  transactionDate: Date;
  description: string;
  amountKobo: number;
  counterparty: string | null;
  reference: string | null;
  category: TransactionCategory;
  categorySource: CategorySource;
  categoryConfidence: number | null;
  originalCategory: TransactionCategory | null;
  isPersonal: boolean;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  notes: string | null;
  rawMetadata: Record<string, unknown>;
}

// ─── Repository Functions ────────────────────────────────────────────────────

/**
 * Insert a single transaction and return the created record.
 *
 * @param data - All required fields for the new transaction
 * @returns The newly created Transaction
 */
export async function create(data: CreateTransactionData): Promise<Transaction> {
  const result = await query<TransactionRow>(
    `INSERT INTO transactions (
      business_id, source_document_id, source_type, transaction_type,
      transaction_date, description, amount_kobo, counterparty, reference,
      category, category_source, category_confidence, original_category,
      is_personal, is_duplicate, duplicate_of_id,
      notes, raw_metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
    )
    RETURNING ${SELECT_COLUMNS}`,
    [
      data.businessId,
      data.sourceDocumentId,
      data.sourceType,
      data.transactionType,
      data.transactionDate.toISOString(),
      data.description,
      data.amountKobo,
      data.counterparty,
      data.reference,
      data.category,
      data.categorySource,
      data.categoryConfidence,
      data.originalCategory,
      data.isPersonal,
      data.isDuplicate,
      data.duplicateOfId,
      data.notes,
      JSON.stringify(data.rawMetadata),
    ],
  );

  return mapRowToTransaction(result.rows[0]!);
}

/**
 * Get a transaction by ID, excluding soft-deleted records.
 *
 * @param id - The UUID of the transaction
 * @returns The matching Transaction or null if not found / soft-deleted
 */
export async function findById(id: string): Promise<Transaction | null> {
  const result = await query<TransactionRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM transactions
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToTransaction(result.rows[0]!);
}

/**
 * List all transactions for a business, excluding soft-deleted,
 * ordered by transaction_date DESC.
 *
 * @param businessId - The UUID of the business
 * @returns Array of Transaction records
 */
export async function findByBusinessId(businessId: string): Promise<Transaction[]> {
  const result = await query<TransactionRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM transactions
     WHERE business_id = $1 AND deleted_at IS NULL
     ORDER BY transaction_date DESC`,
    [businessId],
  );

  return result.rows.map(mapRowToTransaction);
}

/**
 * Update allowed fields on a transaction. Only fields that are provided
 * (not undefined) are updated. Sets updated_at to NOW().
 *
 * @param id - The UUID of the transaction to update
 * @param updates - The fields to update
 * @returns The updated Transaction or null if not found / soft-deleted
 */
export async function update(id: string, updates: TransactionUpdates): Promise<Transaction | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (updates.description !== undefined) {
    setClauses.push(`description = $${paramIndex}`);
    params.push(updates.description);
    paramIndex++;
  }

  if (updates.transactionDate !== undefined) {
    setClauses.push(`transaction_date = $${paramIndex}`);
    params.push(updates.transactionDate.toISOString());
    paramIndex++;
  }

  if (updates.category !== undefined) {
    setClauses.push(`category = $${paramIndex}`);
    params.push(updates.category);
    paramIndex++;
  }

  if (updates.categorySource !== undefined) {
    setClauses.push(`category_source = $${paramIndex}`);
    params.push(updates.categorySource);
    paramIndex++;
  }

  if (updates.isPersonal !== undefined) {
    setClauses.push(`is_personal = $${paramIndex}`);
    params.push(updates.isPersonal);
    paramIndex++;
  }

  if (updates.notes !== undefined) {
    setClauses.push(`notes = $${paramIndex}`);
    params.push(updates.notes);
    paramIndex++;
  }

  if (setClauses.length === 0) {
    return findById(id);
  }

  setClauses.push('updated_at = NOW()');
  params.push(id);

  const result = await query<TransactionRow>(
    `UPDATE transactions
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND deleted_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    params,
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToTransaction(result.rows[0]!);
}

/**
 * Soft-delete a transaction by setting deleted_at to NOW().
 *
 * @param id - The UUID of the transaction to soft-delete
 * @returns The updated Transaction or null if not found / already deleted
 */
export async function softDelete(id: string): Promise<Transaction | null> {
  const result = await query<TransactionRow>(
    `UPDATE transactions
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToTransaction(result.rows[0]!);
}

/**
 * Insert multiple transactions atomically within a database transaction.
 *
 * Uses BEGIN/COMMIT/ROLLBACK to ensure all-or-nothing semantics.
 * If any single insert fails the entire batch is rolled back.
 *
 * Returns an empty array when given an empty input list.
 *
 * @param transactions - Array of transaction data to insert
 * @returns All created Transaction records
 */
export async function bulkCreate(transactions: CreateTransactionData[]): Promise<Transaction[]> {
  if (transactions.length === 0) {
    return [];
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const created: Transaction[] = [];

    for (const data of transactions) {
      const result = await client.query<TransactionRow>(
        `INSERT INTO transactions (
          business_id, source_document_id, source_type, transaction_type,
          transaction_date, description, amount_kobo, counterparty, reference,
          category, category_source, category_confidence, original_category,
          is_personal, is_duplicate, duplicate_of_id,
          notes, raw_metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
        RETURNING ${SELECT_COLUMNS}`,
        [
          data.businessId,
          data.sourceDocumentId,
          data.sourceType,
          data.transactionType,
          data.transactionDate.toISOString(),
          data.description,
          data.amountKobo,
          data.counterparty,
          data.reference,
          data.category,
          data.categorySource,
          data.categoryConfidence,
          data.originalCategory,
          data.isPersonal,
          data.isDuplicate,
          data.duplicateOfId,
          data.notes,
          JSON.stringify(data.rawMetadata),
        ],
      );

      created.push(mapRowToTransaction(result.rows[0]!));
    }

    await client.query('COMMIT');

    return created;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ─── Sort Column Mapping ─────────────────────────────────────────────────────

const SORT_COLUMN_MAP: Record<TransactionFilters['sortBy'], string> = {
  transactionDate: 'transaction_date',
  amount: 'amount_kobo',
  createdAt: 'created_at',
};

/** Maximum allowed page size. */
const MAX_PAGE_SIZE = 100;

/** Default page size when none is provided or value is invalid. */
const DEFAULT_PAGE_SIZE = 20;

// ─── Filtering & Pagination ──────────────────────────────────────────────────

/**
 * Find transactions for a business with dynamic filtering, sorting, and
 * offset-based pagination.
 *
 * Builds a parameterized WHERE clause from the provided filters. Only
 * filters whose values are defined are included. Always enforces
 * `business_id` and `deleted_at IS NULL`.
 *
 * @param businessId - The UUID of the owning business
 * @param filters    - Filter, sort, and pagination options
 * @returns Matching transactions and pagination metadata
 */
export async function findWithFilters(
  businessId: string,
  filters: TransactionFilters,
): Promise<{ transactions: Transaction[]; pagination: PaginationInfo }> {
  // ── Clamp page size ──────────────────────────────────────────────────
  const pageSize = Math.min(Math.max(1, filters.pageSize || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const page = Math.max(1, filters.page || 1);

  // ── Build WHERE clause ───────────────────────────────────────────────
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Always required
  conditions.push(`business_id = $${paramIndex}`);
  params.push(businessId);
  paramIndex++;

  conditions.push('deleted_at IS NULL');

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

  if (filters.minAmount !== undefined) {
    conditions.push(`amount_kobo >= $${paramIndex}`);
    params.push(filters.minAmount);
    paramIndex++;
  }

  if (filters.maxAmount !== undefined) {
    conditions.push(`amount_kobo <= $${paramIndex}`);
    params.push(filters.maxAmount);
    paramIndex++;
  }

  if (filters.category !== undefined) {
    conditions.push(`category = $${paramIndex}`);
    params.push(filters.category);
    paramIndex++;
  }

  if (filters.sourceType !== undefined) {
    conditions.push(`source_type = $${paramIndex}`);
    params.push(filters.sourceType);
    paramIndex++;
  }

  if (filters.transactionType !== undefined) {
    conditions.push(`transaction_type = $${paramIndex}`);
    params.push(filters.transactionType);
    paramIndex++;
  }

  if (filters.isPersonal !== undefined) {
    conditions.push(`is_personal = $${paramIndex}`);
    params.push(filters.isPersonal);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // ── Count total matching rows ────────────────────────────────────────
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM transactions ${whereClause}`,
    params,
  );
  const total = parseInt(countResult.rows[0]!.count, 10);

  // ── Sort ─────────────────────────────────────────────────────────────
  const sortColumn = SORT_COLUMN_MAP[filters.sortBy] ?? 'transaction_date';
  const sortDirection = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';

  // ── Fetch page ───────────────────────────────────────────────────────
  const offset = (page - 1) * pageSize;

  const dataResult = await query<TransactionRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM transactions
     ${whereClause}
     ORDER BY ${sortColumn} ${sortDirection}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, pageSize, offset],
  );

  const transactions = dataResult.rows.map(mapRowToTransaction);

  // ── Build pagination info ────────────────────────────────────────────
  const totalPages = Math.ceil(total / pageSize);
  const pagination: PaginationInfo = {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };

  return { transactions, pagination };
}
