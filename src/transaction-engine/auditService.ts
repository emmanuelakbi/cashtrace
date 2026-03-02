/**
 * Audit service for recording transaction changes in the audit trail.
 *
 * Provides functional (exported functions, not classes) audit logging for
 * transaction operations: creation, updates, deletions, category changes,
 * and duplicate resolution. Each function inserts a record into the
 * transaction_audits table and returns the created audit entry.
 *
 * Handles snake_case ↔ camelCase mapping between the PostgreSQL schema
 * and TypeScript TransactionAudit type.
 *
 * @module transaction-engine/auditService
 */

import { v4 as uuidv4 } from 'uuid';

import { query } from '../utils/db.js';

import type { AuditAction, AuditChanges, TransactionAudit } from './types.js';

// ─── Row Mapping ─────────────────────────────────────────────────────────────

/** Raw row shape returned by PostgreSQL for the transaction_audits table. */
interface AuditRow {
  id: string;
  transaction_id: string;
  user_id: string;
  action: AuditAction;
  changes: AuditChanges[];
  ip_address: string;
  user_agent: string | null;
  created_at: Date;
}

/** Map a database row (snake_case) to a TransactionAudit domain object (camelCase). */
function mapRowToAudit(row: AuditRow): TransactionAudit {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    userId: row.user_id,
    action: row.action,
    changes: row.changes,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const INSERT_SQL = `
  INSERT INTO transaction_audits (id, transaction_id, user_id, action, changes, ip_address, user_agent)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING id, transaction_id, user_id, action, changes, ip_address, user_agent, created_at
`;

async function insertAudit(
  transactionId: string,
  userId: string,
  action: AuditAction,
  changes: AuditChanges[],
  ipAddress: string,
  userAgent?: string | null,
): Promise<TransactionAudit> {
  const id = uuidv4();
  const result = await query<AuditRow>(INSERT_SQL, [
    id,
    transactionId,
    userId,
    action,
    JSON.stringify(changes),
    ipAddress,
    userAgent ?? null,
  ]);
  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to create audit record');
  }
  return mapRowToAudit(row);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a transaction creation in the audit trail.
 *
 * Validates: Requirements 11.3
 */
export async function logCreate(
  transactionId: string,
  userId: string,
  ipAddress: string,
  userAgent?: string | null,
): Promise<TransactionAudit> {
  return insertAudit(transactionId, userId, 'CREATE', [], ipAddress, userAgent);
}

/**
 * Record a transaction update with previous and new values.
 *
 * Validates: Requirements 11.3
 */
export async function logUpdate(
  transactionId: string,
  userId: string,
  changes: AuditChanges[],
  ipAddress: string,
  userAgent?: string | null,
): Promise<TransactionAudit> {
  return insertAudit(transactionId, userId, 'UPDATE', changes, ipAddress, userAgent);
}

/**
 * Record a transaction soft deletion in the audit trail.
 *
 * Validates: Requirements 10.4
 */
export async function logDelete(
  transactionId: string,
  userId: string,
  ipAddress: string,
  userAgent?: string | null,
): Promise<TransactionAudit> {
  return insertAudit(transactionId, userId, 'DELETE', [], ipAddress, userAgent);
}

/**
 * Record a category change in the audit trail.
 *
 * Validates: Requirements 3.4, 4.5
 */
export async function logCategoryChange(
  transactionId: string,
  userId: string,
  previousCategory: string,
  newCategory: string,
  ipAddress: string,
  userAgent?: string | null,
): Promise<TransactionAudit> {
  const changes: AuditChanges[] = [
    { field: 'category', previousValue: previousCategory, newValue: newCategory },
  ];
  return insertAudit(transactionId, userId, 'CATEGORIZE', changes, ipAddress, userAgent);
}

/**
 * Record a duplicate resolution in the audit trail.
 *
 * Validates: Requirements 11.3
 */
export async function logDuplicateResolve(
  transactionId: string,
  userId: string,
  duplicatePairId: string,
  action: string,
  ipAddress: string,
  userAgent?: string | null,
): Promise<TransactionAudit> {
  const changes: AuditChanges[] = [
    { field: 'duplicatePairId', previousValue: null, newValue: duplicatePairId },
    { field: 'resolutionAction', previousValue: null, newValue: action },
  ];
  return insertAudit(transactionId, userId, 'DUPLICATE_RESOLVE', changes, ipAddress, userAgent);
}

/**
 * Retrieve the full audit history for a transaction, ordered by most recent first.
 *
 * Validates: Requirements 7.4
 */
export async function getAuditHistory(transactionId: string): Promise<TransactionAudit[]> {
  const result = await query<AuditRow>(
    `SELECT id, transaction_id, user_id, action, changes, ip_address, user_agent, created_at
     FROM transaction_audits
     WHERE transaction_id = $1
     ORDER BY created_at DESC`,
    [transactionId],
  );
  return result.rows.map(mapRowToAudit);
}
