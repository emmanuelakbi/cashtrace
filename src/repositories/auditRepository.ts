/**
 * Audit repository for database operations on the audit_logs table.
 *
 * Provides functions for creating and querying audit log entries to support
 * security monitoring and NDPR compliance. Handles snake_case ↔ camelCase
 * mapping between the PostgreSQL schema and TypeScript AuditLog type.
 *
 * Metadata is encrypted at rest using AES-256-CBC when the AUDIT_ENCRYPTION_KEY
 * environment variable is set. If no key is configured, metadata is stored as
 * plain JSON.
 *
 * @module repositories/auditRepository
 */

import crypto from 'node:crypto';
import { query } from '../utils/db.js';
import type { AuditLog, SecurityEventFilter } from '../types/index.js';
import { AuthEventType } from '../types/index.js';

// ─── Encryption Helpers ──────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Get the AES-256 encryption key from the environment.
 * Returns null if no key is configured, meaning metadata will be stored as plain JSON.
 */
function getEncryptionKey(): Buffer | null {
  const keyHex = process.env['AUDIT_ENCRYPTION_KEY'];
  if (!keyHex) {
    return null;
  }
  // Key must be 32 bytes (64 hex characters) for AES-256
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a metadata object to a hex string using AES-256-CBC.
 * The IV is prepended to the ciphertext so it can be extracted during decryption.
 *
 * @param metadata - The metadata object to encrypt
 * @returns Hex-encoded string of IV + ciphertext
 */
export function encryptMetadata(metadata: Record<string, unknown>): string {
  const key = getEncryptionKey();
  const json = JSON.stringify(metadata);

  if (!key) {
    // No encryption key configured — store as plain JSON
    return json;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);

  // Prepend IV to ciphertext so we can extract it during decryption
  return Buffer.concat([iv, encrypted]).toString('hex');
}

/**
 * Decrypt a hex string back to a metadata object.
 * Extracts the IV from the first 16 bytes of the decoded buffer.
 *
 * @param data - Hex-encoded string of IV + ciphertext, or plain JSON if unencrypted
 * @returns The decrypted metadata object
 */
export function decryptMetadata(data: string): Record<string, unknown> {
  const key = getEncryptionKey();

  if (!key) {
    // No encryption key — data is plain JSON
    return JSON.parse(data) as Record<string, unknown>;
  }

  const buffer = Buffer.from(data, 'hex');
  const iv = buffer.subarray(0, IV_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(decrypted.toString('utf8')) as Record<string, unknown>;
}

// ─── Row Mapping ─────────────────────────────────────────────────────────────

/** Raw row shape returned by PostgreSQL for the audit_logs table. */
interface AuditLogRow {
  id: string;
  event_type: string;
  user_id: string | null;
  ip_address: string;
  user_agent: string;
  request_id: string;
  success: boolean;
  error_code: string | null;
  metadata: Buffer | string | null;
  created_at: Date;
}

/**
 * Map a database row (snake_case) to an AuditLog domain object (camelCase).
 * Decrypts the metadata field if present.
 */
function mapRowToAuditLog(row: AuditLogRow): AuditLog {
  let metadata: Record<string, unknown> = {};

  if (row.metadata !== null && row.metadata !== undefined) {
    // PostgreSQL BYTEA columns may come back as Buffer or string depending on driver config
    const metadataStr =
      row.metadata instanceof Buffer ? row.metadata.toString('utf8') : String(row.metadata);
    metadata = decryptMetadata(metadataStr);
  }

  return {
    id: row.id,
    eventType: row.event_type as AuthEventType,
    userId: row.user_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    requestId: row.request_id,
    success: row.success,
    errorCode: row.error_code,
    metadata,
    createdAt: row.created_at,
  };
}

// ─── Repository Functions ────────────────────────────────────────────────────

/**
 * Create a new audit log entry.
 *
 * Records an authentication event with all relevant context for security
 * monitoring and NDPR compliance. The metadata field is encrypted at rest
 * using AES-256-CBC when an encryption key is configured.
 *
 * @param event - The audit log data to persist
 * @returns The newly created AuditLog record
 *
 * _Requirements: 8.2_
 */
export async function createAuditLog(event: {
  eventType: AuthEventType;
  userId: string | null;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  success: boolean;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<AuditLog> {
  const encryptedMetadata = encryptMetadata(event.metadata ?? {});

  const result = await query<AuditLogRow>(
    `INSERT INTO audit_logs (event_type, user_id, ip_address, user_agent, request_id, success, error_code, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, event_type, user_id, ip_address, user_agent, request_id, success, error_code, metadata, created_at`,
    [
      event.eventType,
      event.userId,
      event.ipAddress,
      event.userAgent,
      event.requestId,
      event.success,
      event.errorCode ?? null,
      encryptedMetadata,
    ],
  );

  return mapRowToAuditLog(result.rows[0]!);
}

/**
 * Find audit logs by user ID within a date range.
 *
 * Returns all audit log entries for the given user between the specified
 * dates, ordered by created_at descending (most recent first). This
 * supports NDPR data access requests (Requirement 8.5).
 *
 * @param userId - The UUID of the user
 * @param from - Start of the date range (inclusive)
 * @param to - End of the date range (inclusive)
 * @returns Array of AuditLog records for the user within the date range
 *
 * _Requirements: 8.5_
 */
export async function findByUserId(userId: string, from: Date, to: Date): Promise<AuditLog[]> {
  const result = await query<AuditLogRow>(
    `SELECT id, event_type, user_id, ip_address, user_agent, request_id, success, error_code, metadata, created_at
     FROM audit_logs
     WHERE user_id = $1
       AND created_at >= $2
       AND created_at <= $3
     ORDER BY created_at DESC`,
    [userId, from.toISOString(), to.toISOString()],
  );

  return result.rows.map(mapRowToAuditLog);
}

/**
 * Find audit logs matching a security event filter.
 *
 * Supports filtering by event type, user ID, IP address, success status,
 * and date range. All filter fields except `from` and `to` are optional.
 * Results are ordered by created_at descending.
 *
 * @param filter - The filter criteria for querying audit logs
 * @returns Array of matching AuditLog records
 */
export async function findByFilter(filter: SecurityEventFilter): Promise<AuditLog[]> {
  const conditions: string[] = ['created_at >= $1', 'created_at <= $2'];
  const params: unknown[] = [filter.from.toISOString(), filter.to.toISOString()];
  let paramIndex = 3;

  if (filter.eventType !== undefined) {
    conditions.push(`event_type = $${paramIndex}`);
    params.push(filter.eventType);
    paramIndex += 1;
  }

  if (filter.userId !== undefined) {
    conditions.push(`user_id = $${paramIndex}`);
    params.push(filter.userId);
    paramIndex += 1;
  }

  if (filter.ipAddress !== undefined) {
    conditions.push(`ip_address = $${paramIndex}`);
    params.push(filter.ipAddress);
    paramIndex += 1;
  }

  if (filter.success !== undefined) {
    conditions.push(`success = $${paramIndex}`);
    params.push(filter.success);
    paramIndex += 1;
  }

  const whereClause = conditions.join(' AND ');

  const result = await query<AuditLogRow>(
    `SELECT id, event_type, user_id, ip_address, user_agent, request_id, success, error_code, metadata, created_at
     FROM audit_logs
     WHERE ${whereClause}
     ORDER BY created_at DESC`,
    params,
  );

  return result.rows.map(mapRowToAuditLog);
}
