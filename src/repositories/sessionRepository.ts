/**
 * Session repository for database operations on the refresh_tokens table.
 *
 * Provides lower-level DB access functions for refresh token storage,
 * lookup, and revocation. The service layer (TokenService, SessionService)
 * uses these functions to implement higher-level session management logic.
 *
 * Handles snake_case ↔ camelCase mapping between the PostgreSQL schema
 * and TypeScript RefreshToken type.
 *
 * @module repositories/sessionRepository
 */

import { query } from '../utils/db.js';
import type { RefreshToken } from '../types/index.js';

// ─── Row Mapping ─────────────────────────────────────────────────────────────

/** Raw row shape returned by PostgreSQL for the refresh_tokens table. */
interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  device_fingerprint: string;
  expires_at: Date;
  created_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

/**
 * Map a database row (snake_case) to a RefreshToken domain object (camelCase).
 */
function mapRowToRefreshToken(row: RefreshTokenRow): RefreshToken {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    deviceFingerprint: row.device_fingerprint,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

// ─── Repository Functions ────────────────────────────────────────────────────

/**
 * Find a refresh token by its SHA-256 hash.
 *
 * Used during token refresh to look up the stored token record
 * and verify its validity.
 *
 * @param tokenHash - The SHA-256 hash of the raw refresh token
 * @returns The matching RefreshToken or null if not found
 */
export async function findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
  const result = await query<RefreshTokenRow>(
    `SELECT id, user_id, token_hash, device_fingerprint, expires_at, created_at, revoked_at, revoked_reason
     FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToRefreshToken(result.rows[0]!);
}

/**
 * Find all active (non-revoked, non-expired) refresh tokens for a user.
 *
 * A token is considered active when it has not been revoked (revoked_at IS NULL)
 * and its expiration time is in the future.
 *
 * @param userId - The UUID of the user
 * @returns Array of active RefreshToken records
 */
export async function findActiveByUserId(userId: string): Promise<RefreshToken[]> {
  const result = await query<RefreshTokenRow>(
    `SELECT id, user_id, token_hash, device_fingerprint, expires_at, created_at, revoked_at, revoked_reason
     FROM refresh_tokens
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()`,
    [userId],
  );

  return result.rows.map(mapRowToRefreshToken);
}

/**
 * Revoke a single refresh token by setting its revoked_at timestamp and reason.
 *
 * Only revokes the token if it has not already been revoked (revoked_at IS NULL).
 * This supports single-session logout (Requirement 6.1) and token rotation
 * (Requirement 4.4).
 *
 * @param tokenId - The UUID of the refresh token to revoke
 * @param reason - The reason for revocation (e.g. 'logout', 'rotation', 'device_mismatch')
 */
export async function revokeToken(tokenId: string, reason: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW(), revoked_reason = $2
     WHERE id = $1 AND revoked_at IS NULL`,
    [tokenId, reason],
  );
}

/**
 * Revoke all active refresh tokens for a user.
 *
 * Sets revoked_at and revoked_reason on every non-revoked token belonging
 * to the user. This supports logout-all (Requirement 6.2), device fingerprint
 * mismatch security (Requirement 4.6), and password reset session invalidation
 * (Requirement 5.5).
 *
 * @param userId - The UUID of the user whose tokens to revoke
 * @param reason - The reason for revocation (e.g. 'logout_all', 'password_reset', 'device_mismatch')
 */
export async function revokeAllForUser(userId: string, reason: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW(), revoked_reason = $2
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
}

/**
 * Insert a new refresh token record.
 *
 * Stores the token hash (not the raw token) along with the device fingerprint
 * for security validation. The raw token is never persisted.
 *
 * @param userId - The UUID of the user this token belongs to
 * @param tokenHash - The SHA-256 hash of the raw refresh token
 * @param deviceFingerprint - Hash of device characteristics for fingerprint validation
 * @param expiresAt - When the token expires (typically 7 days from creation)
 * @returns The newly created RefreshToken record
 */
export async function createToken(
  userId: string,
  tokenHash: string,
  deviceFingerprint: string,
  expiresAt: Date,
): Promise<RefreshToken> {
  const result = await query<RefreshTokenRow>(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_fingerprint, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, token_hash, device_fingerprint, expires_at, created_at, revoked_at, revoked_reason`,
    [userId, tokenHash, deviceFingerprint, expiresAt.toISOString()],
  );

  return mapRowToRefreshToken(result.rows[0]!);
}
