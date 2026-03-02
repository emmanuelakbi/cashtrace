/**
 * Transaction service providing core business logic for transaction management.
 *
 * Coordinates between the transaction repository, business-management module,
 * and other transaction-engine services (normalization, categorization, audit,
 * duplicate detection) to implement ownership verification, CRUD operations,
 * and bulk processing.
 *
 * @module transaction-engine/transactionService
 */

import { getBusinessByUserId } from '../modules/business/services/businessService.js';
import { query } from '../utils/db.js';

import {
  getAuditHistory,
  logCategoryChange,
  logCreate,
  logDelete,
  logUpdate,
} from './auditService.js';
import { categorize, validateCategory } from './categorizationService.js';
import { detectDuplicates } from './duplicateDetectionService.js';
import { normalize, normalizeBatch } from './normalizationService.js';
import {
  bulkCreate as bulkCreateInRepo,
  create as createInRepo,
  findById,
  findWithFilters,
  softDelete,
  update as updateInRepo,
} from './transactionRepository.js';
import type {
  AuditChanges,
  BulkCreateResult,
  PaginationInfo,
  RawExtractedTransaction,
  SourceType,
  Transaction,
  TransactionFilters,
  TransactionUpdates,
} from './types.js';
import {
  TransactionForbiddenError,
  TransactionInvalidCategoryError,
  TransactionNotFoundError,
} from './types.js';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Verify that a user's business owns the given transaction.
 *
 * Looks up the transaction by ID and the user's business, then checks that
 * the transaction's businessId matches the user's business ID.
 *
 * Returns false if the transaction is not found, the user has no business,
 * or the businessId does not match.
 *
 * Validates: Requirements 3.5, 7.5, 10.5, 11.5
 */
export async function verifyOwnership(transactionId: string, userId: string): Promise<boolean> {
  const [transaction, business] = await Promise.all([
    findById(transactionId),
    getBusinessByUserId(userId),
  ]);

  if (!transaction || !business) {
    return false;
  }

  return transaction.businessId === business.id;
}

/**
 * Create a single transaction from raw extracted data.
 *
 * 1. Normalizes the raw transaction (date, amount → kobo, type, counterparty)
 * 2. Categorizes using keyword matching
 * 3. Persists via the transaction repository
 * 4. Runs duplicate detection against existing transactions
 * 5. Logs the creation in the audit trail
 *
 * The isPersonal flag defaults to false for all new transactions.
 *
 * Validates: Requirements 1.1, 2.1, 4.2
 */
export async function createTransaction(
  raw: RawExtractedTransaction,
  businessId: string,
  sourceType: SourceType,
  sourceDocumentId: string | null,
  userId: string,
  ipAddress: string,
  userAgent?: string | null,
): Promise<Transaction> {
  // 1. Normalize
  const normalized = normalize(raw, sourceType);

  // 2. Categorize
  const { category, confidence, source: categorySource } = categorize(normalized);

  // 3. Save
  const transaction = await createInRepo({
    businessId,
    sourceDocumentId,
    sourceType,
    transactionType: normalized.transactionType,
    transactionDate: normalized.transactionDate,
    description: normalized.description,
    amountKobo: normalized.amountKobo,
    counterparty: normalized.counterparty,
    reference: normalized.reference,
    category,
    categorySource,
    categoryConfidence: confidence,
    originalCategory: category,
    isPersonal: false,
    isDuplicate: false,
    duplicateOfId: null,
    notes: null,
    rawMetadata: normalized.rawMetadata,
  });

  // 4. Detect duplicates (fire-and-forget style — results stored in DB)
  await detectDuplicates([transaction.id], businessId);

  // 5. Audit trail
  await logCreate(transaction.id, userId, ipAddress, userAgent);

  return transaction;
}

/**
 * Create multiple transactions from raw extracted data in a single atomic batch.
 *
 * 1. Normalizes all transactions via normalizeBatch
 * 2. Categorizes each normalized transaction
 * 3. Builds CreateTransactionData[] for the repository
 * 4. Persists all via bulkCreateInRepo (atomic DB transaction)
 * 5. Runs duplicate detection on all new transaction IDs
 * 6. Logs creation audit for each transaction
 *
 * If any transaction fails validation during normalization or categorization,
 * the entire batch is rejected (Req 8.6).
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.6
 */
export async function bulkCreate(
  rawTransactions: RawExtractedTransaction[],
  businessId: string,
  sourceType: SourceType,
  sourceDocumentId: string,
  userId: string,
  ipAddress: string,
  userAgent?: string | null,
): Promise<BulkCreateResult> {
  // 1. Normalize all transactions (throws on invalid data → rejects entire batch)
  const normalized = normalizeBatch(rawTransactions, sourceType);

  // 2. Categorize each and build repository data
  const createDataArray = normalized.map((norm) => {
    const { category, confidence, source: categorySource } = categorize(norm);

    return {
      businessId,
      sourceDocumentId,
      sourceType,
      transactionType: norm.transactionType,
      transactionDate: norm.transactionDate,
      description: norm.description,
      amountKobo: norm.amountKobo,
      counterparty: norm.counterparty,
      reference: norm.reference,
      category,
      categorySource,
      categoryConfidence: confidence,
      originalCategory: category,
      isPersonal: false,
      isDuplicate: false,
      duplicateOfId: null,
      notes: null,
      rawMetadata: norm.rawMetadata,
    };
  });

  // 3. Persist atomically (repository wraps in a DB transaction)
  const transactions = await bulkCreateInRepo(createDataArray);

  // 4. Detect duplicates across all new transactions
  const duplicatePairs = await detectDuplicates(
    transactions.map((t) => t.id),
    businessId,
  );

  // 5. Log creation audit for each transaction
  await Promise.all(transactions.map((t) => logCreate(t.id, userId, ipAddress, userAgent)));

  return {
    created: transactions.length,
    transactions,
    duplicatesDetected: duplicatePairs.length,
  };
}

/**
 * Retrieve a single transaction by ID with ownership verification.
 *
 * 1. Fetches the transaction from the repository (throws TXN_NOT_FOUND if missing)
 * 2. Verifies the user's business owns the transaction (throws TXN_FORBIDDEN if not)
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.5, 7.6
 */
export async function getTransactionById(
  transactionId: string,
  userId: string,
): Promise<Transaction> {
  const [transaction, business] = await Promise.all([
    findById(transactionId),
    getBusinessByUserId(userId),
  ]);

  if (!transaction) {
    throw new TransactionNotFoundError();
  }

  if (!business || transaction.businessId !== business.id) {
    throw new TransactionForbiddenError();
  }

  return transaction;
}

/**
 * List transactions for a business with filtering and pagination.
 *
 * Delegates to the repository's findWithFilters which handles date range,
 * amount range, category, source type, transaction type, isPersonal filters,
 * sorting, and offset-based pagination.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 */
export async function listTransactions(
  businessId: string,
  filters: TransactionFilters,
): Promise<{ transactions: Transaction[]; pagination: PaginationInfo }> {
  return findWithFilters(businessId, filters);
}

/**
 * Update allowed fields on an existing transaction.
 *
 * 1. Verifies the user's business owns the transaction (403 if not)
 * 2. Fetches the current transaction (404 if not found)
 * 3. If category is changing, validates it and sets categorySource to MANUAL
 * 4. Builds the update payload (only allowed fields)
 * 5. Persists via the repository
 * 6. Logs all changes (and category change separately) in the audit trail
 *
 * Immutable fields (amount, sourceType, sourceDocumentId, transactionType)
 * are never included in the update payload.
 *
 * Validates: Requirements 3.2, 3.3, 11.1, 11.2, 11.3, 11.4
 */
export async function updateTransaction(
  transactionId: string,
  userId: string,
  updates: TransactionUpdates,
  ipAddress: string,
  userAgent?: string | null,
): Promise<Transaction> {
  // 1. Ownership check
  const isOwner = await verifyOwnership(transactionId, userId);
  if (!isOwner) {
    throw new TransactionForbiddenError();
  }

  // 2. Fetch current transaction
  const current = await findById(transactionId);
  if (!current) {
    throw new TransactionNotFoundError();
  }

  // 3. Build the repo update payload (only allowed fields)
  const repoUpdates: TransactionUpdates = {};

  if (updates.description !== undefined) {
    repoUpdates.description = updates.description;
  }
  if (updates.transactionDate !== undefined) {
    repoUpdates.transactionDate = updates.transactionDate;
  }
  if (updates.isPersonal !== undefined) {
    repoUpdates.isPersonal = updates.isPersonal;
  }
  if (updates.notes !== undefined) {
    repoUpdates.notes = updates.notes;
  }

  // 4. Handle category change
  if (updates.category !== undefined && updates.category !== current.category) {
    const isValid = validateCategory(updates.category, current.transactionType);
    if (!isValid) {
      throw new TransactionInvalidCategoryError(updates.category, current.transactionType);
    }

    repoUpdates.category = updates.category;
    repoUpdates.categorySource = 'MANUAL';

    // Log category change separately in audit trail
    await logCategoryChange(
      transactionId,
      userId,
      current.category,
      updates.category,
      ipAddress,
      userAgent,
    );
  }

  // 5. Persist updates
  const updated = await updateInRepo(transactionId, repoUpdates);
  if (!updated) {
    throw new TransactionNotFoundError();
  }

  // 6. Build audit changes for all modified fields
  const auditChanges: AuditChanges[] = [];

  if (updates.description !== undefined && updates.description !== current.description) {
    auditChanges.push({
      field: 'description',
      previousValue: current.description,
      newValue: updates.description,
    });
  }
  if (
    updates.transactionDate !== undefined &&
    updates.transactionDate.getTime() !== current.transactionDate.getTime()
  ) {
    auditChanges.push({
      field: 'transactionDate',
      previousValue: current.transactionDate.toISOString(),
      newValue: updates.transactionDate.toISOString(),
    });
  }
  if (updates.isPersonal !== undefined && updates.isPersonal !== current.isPersonal) {
    auditChanges.push({
      field: 'isPersonal',
      previousValue: current.isPersonal,
      newValue: updates.isPersonal,
    });
  }
  if (updates.notes !== undefined && updates.notes !== current.notes) {
    auditChanges.push({
      field: 'notes',
      previousValue: current.notes,
      newValue: updates.notes,
    });
  }

  if (auditChanges.length > 0) {
    await logUpdate(transactionId, userId, auditChanges, ipAddress, userAgent);
  }

  return updated;
}

/**
 * Soft-delete a transaction with ownership verification and audit logging.
 *
 * 1. Verifies the user's business owns the transaction (403 if not)
 * 2. Calls softDelete on the repository (404 if not found)
 * 3. Logs the deletion in the audit trail
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4
 */
export async function deleteTransaction(
  transactionId: string,
  userId: string,
  ipAddress: string,
  userAgent?: string | null,
): Promise<void> {
  // 1. Ownership check
  const isOwner = await verifyOwnership(transactionId, userId);
  if (!isOwner) {
    throw new TransactionForbiddenError();
  }

  // 2. Soft delete
  const deleted = await softDelete(transactionId);
  if (!deleted) {
    throw new TransactionNotFoundError();
  }

  // 3. Audit trail
  await logDelete(transactionId, userId, ipAddress, userAgent);
}

/**
 * Calculate business totals excluding personal and soft-deleted transactions.
 *
 * Uses a SQL SUM() aggregate query grouped by transaction type to produce
 * totalInflow, totalOutflow, and netCashflow (inflow - outflow).
 * All amounts are in kobo.
 *
 * Validates: Requirements 4.1, 4.3, 4.4
 */
export async function calculateBusinessTotals(
  businessId: string,
): Promise<{ totalInflow: number; totalOutflow: number; netCashflow: number }> {
  const result = await query<{ transaction_type: string; total: string }>(
    `SELECT transaction_type, COALESCE(SUM(amount_kobo), 0) AS total
     FROM transactions
     WHERE business_id = $1 AND is_personal = false AND deleted_at IS NULL
     GROUP BY transaction_type`,
    [businessId],
  );

  let totalInflow = 0;
  let totalOutflow = 0;

  for (const row of result.rows) {
    if (row.transaction_type === 'INFLOW') {
      totalInflow = Number(row.total);
    } else {
      totalOutflow = Number(row.total);
    }
  }

  return {
    totalInflow,
    totalOutflow,
    netCashflow: totalInflow - totalOutflow,
  };
}
