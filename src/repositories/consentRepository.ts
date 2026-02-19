/**
 * Consent repository for database operations on the consent_records table.
 *
 * Provides functions for creating, querying, and revoking consent records
 * to support NDPR compliance. Handles snake_case ↔ camelCase mapping
 * between the PostgreSQL schema and TypeScript ConsentRecord type.
 *
 * @module repositories/consentRepository
 */

import { query } from '../utils/db.js';
import type { ConsentRecord } from '../types/index.js';
import { ConsentType } from '../types/index.js';

// ─── Row Mapping ─────────────────────────────────────────────────────────────

/** Raw row shape returned by PostgreSQL for the consent_records table. */
interface ConsentRecordRow {
  id: string;
  user_id: string;
  consent_type: string;
  consent_version: string;
  ip_address: string;
  user_agent: string;
  granted_at: Date;
  revoked_at: Date | null;
}

/**
 * Map a database row (snake_case) to a ConsentRecord domain object (camelCase).
 */
function mapRowToConsentRecord(row: ConsentRecordRow): ConsentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    consentType: row.consent_type as ConsentType,
    consentVersion: row.consent_version,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
  };
}

// ─── Repository Functions ────────────────────────────────────────────────────

/**
 * Create a new consent record.
 *
 * Records the user's consent to a specific type of agreement (terms of service,
 * privacy policy, or data processing) along with the version consented to and
 * the request context (IP address and user agent) for NDPR compliance.
 *
 * @param userId - The UUID of the user granting consent
 * @param consentType - The type of consent being granted
 * @param consentVersion - The version of the terms being consented to
 * @param ipAddress - The IP address of the user at the time of consent
 * @param userAgent - The user agent string of the user's browser/device
 * @returns The newly created ConsentRecord
 */
export async function createConsent(
  userId: string,
  consentType: ConsentType,
  consentVersion: string,
  ipAddress: string,
  userAgent: string,
): Promise<ConsentRecord> {
  const result = await query<ConsentRecordRow>(
    `INSERT INTO consent_records (user_id, consent_type, consent_version, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, consent_type, consent_version, ip_address, user_agent, granted_at, revoked_at`,
    [userId, consentType, consentVersion, ipAddress, userAgent],
  );

  return mapRowToConsentRecord(result.rows[0]!);
}

/**
 * Find all consent records for a user.
 *
 * Returns all consent records (both active and revoked) for the given user,
 * ordered by granted_at descending so the most recent consents appear first.
 * This supports NDPR data access requests (Requirement 8.5).
 *
 * @param userId - The UUID of the user
 * @returns Array of ConsentRecord objects for the user
 */
export async function findByUserId(userId: string): Promise<ConsentRecord[]> {
  const result = await query<ConsentRecordRow>(
    `SELECT id, user_id, consent_type, consent_version, ip_address, user_agent, granted_at, revoked_at
     FROM consent_records
     WHERE user_id = $1
     ORDER BY granted_at DESC`,
    [userId],
  );

  return result.rows.map(mapRowToConsentRecord);
}

/**
 * Revoke a consent record by setting its revoked_at timestamp.
 *
 * Only revokes the consent if it has not already been revoked (revoked_at IS NULL).
 * This is idempotent — calling it on an already-revoked record is a no-op.
 *
 * @param consentId - The UUID of the consent record to revoke
 */
export async function revokeConsent(consentId: string): Promise<void> {
  await query(
    `UPDATE consent_records
     SET revoked_at = NOW()
     WHERE id = $1 AND revoked_at IS NULL`,
    [consentId],
  );
}
