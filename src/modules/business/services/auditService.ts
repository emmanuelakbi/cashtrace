/**
 * Audit logging service for business operations.
 *
 * Provides append-only audit trail for all business events,
 * capturing previous and new values for update operations.
 * Supports NDPR compliance requirements for data traceability.
 *
 * @module modules/business/services/auditService
 */

import { v4 as uuidv4 } from 'uuid';

import { query } from '../../../utils/db.js';
import { BusinessAuditEvent, BusinessAuditLog, BusinessEventType } from '../types/index.js';

// ─── Row Mapping ─────────────────────────────────────────────────────────────

/** Raw row shape returned by PostgreSQL for the business_audit_logs table. */
export interface AuditLogRow {
  id: string;
  event_type: string;
  user_id: string;
  business_id: string;
  ip_address: string;
  user_agent: string | null;
  request_id: string;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: Date;
}

/**
 * Map a database row (snake_case) to a BusinessAuditLog domain object (camelCase).
 *
 * @param row - The raw database row
 * @returns The mapped BusinessAuditLog object
 */
export function mapRowToAuditLog(row: AuditLogRow): BusinessAuditLog {
  return {
    id: row.id,
    eventType: row.event_type as BusinessEventType,
    userId: row.user_id,
    businessId: row.business_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent ?? '',
    requestId: row.request_id,
    previousValues: row.previous_values,
    newValues: row.new_values,
    createdAt: row.created_at,
  };
}

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Log a business audit event to the database.
 *
 * Inserts a new row into business_audit_logs with the event details.
 * Auto-generates a requestId (correlation ID) if one is not provided.
 *
 * @param event - The audit event data including optional userAgent and requestId
 * @returns The created BusinessAuditLog entry
 */
export async function logEvent(
  event: BusinessAuditEvent & { userAgent?: string; requestId?: string },
): Promise<BusinessAuditLog> {
  const requestId = event.requestId ?? uuidv4();
  const userAgent = event.userAgent ?? '';

  const result = await query<AuditLogRow>(
    `INSERT INTO business_audit_logs
       (event_type, user_id, business_id, ip_address, user_agent, request_id, previous_values, new_values)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, event_type, user_id, business_id, ip_address, user_agent, request_id, previous_values, new_values, created_at`,
    [
      event.eventType,
      event.userId,
      event.businessId,
      event.ipAddress,
      userAgent,
      requestId,
      event.previousValues ? JSON.stringify(event.previousValues) : null,
      event.newValues ? JSON.stringify(event.newValues) : null,
    ],
  );

  return mapRowToAuditLog(result.rows[0]!);
}

/**
 * Retrieve the audit history for a specific business.
 *
 * Returns all audit log entries for the given business, ordered by most recent first.
 * Supports optional date range filtering via `from` and `to` parameters.
 *
 * @param businessId - UUID of the business to query
 * @param from - Optional start date (inclusive) for filtering
 * @param to - Optional end date (inclusive) for filtering
 * @returns Array of BusinessAuditLog entries
 */
export async function getBusinessAuditHistory(
  businessId: string,
  from?: Date,
  to?: Date,
): Promise<BusinessAuditLog[]> {
  const conditions = ['business_id = $1'];
  const params: unknown[] = [businessId];

  if (from) {
    params.push(from);
    conditions.push(`created_at >= $${params.length}`);
  }

  if (to) {
    params.push(to);
    conditions.push(`created_at <= $${params.length}`);
  }

  const sql = `SELECT id, event_type, user_id, business_id, ip_address, user_agent, request_id, previous_values, new_values, created_at
     FROM business_audit_logs
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`;

  const result = await query<AuditLogRow>(sql, params);
  return result.rows.map(mapRowToAuditLog);
}

/**
 * Retrieve the audit history for a specific user (NDPR access request).
 *
 * Returns all audit log entries associated with the given user,
 * ordered by most recent first.
 *
 * @param userId - UUID of the user to query
 * @returns Array of BusinessAuditLog entries
 */
export async function getUserAuditHistory(userId: string): Promise<BusinessAuditLog[]> {
  const result = await query<AuditLogRow>(
    `SELECT id, event_type, user_id, business_id, ip_address, user_agent, request_id, previous_values, new_values, created_at
     FROM business_audit_logs
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map(mapRowToAuditLog);
}

/**
 * Delete all audit logs for a specific business.
 *
 * Used during hard delete cascade to permanently remove audit trail
 * entries associated with a business.
 *
 * @param businessId - UUID of the business whose logs should be deleted
 * @returns The number of deleted rows
 */
export async function deleteBusinessAuditLogs(businessId: string): Promise<number> {
  const result = await query('DELETE FROM business_audit_logs WHERE business_id = $1', [
    businessId,
  ]);
  return result.rowCount ?? 0;
}
