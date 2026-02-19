/**
 * Session service for the authentication module.
 *
 * Manages user sessions by coordinating token generation, device
 * fingerprint validation, and session lifecycle operations. Each
 * session maps to a refresh token stored in the database with an
 * associated device fingerprint.
 *
 * Key responsibilities:
 * - Create sessions with device fingerprint association (Requirement 4.5)
 * - Validate device fingerprints and invalidate all sessions on mismatch (Requirement 4.6)
 * - Retrieve, invalidate, and bulk-invalidate user sessions
 *
 * @module services/sessionService
 */

import { generateTokenPair, sha256 } from './tokenService.js';
import { query } from '../utils/db.js';
import * as sessionRepo from '../repositories/sessionRepository.js';
import type { DeviceInfo, Session, TokenPair } from '../types/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Map a RefreshToken record from the repository to a Session domain object.
 *
 * The Session type is a simplified view of a refresh token record,
 * exposing only the fields relevant to session management.
 *
 * @param token - The RefreshToken record from the repository
 * @returns A Session object
 */
function toSession(token: {
  id: string;
  userId: string;
  deviceFingerprint: string;
  createdAt: Date;
  expiresAt: Date;
}): Session {
  return {
    id: token.id,
    userId: token.userId,
    deviceFingerprint: token.deviceFingerprint,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
  };
}

/**
 * Find a refresh token by its database ID.
 *
 * The session repository doesn't expose a findById function, so this
 * helper performs a direct query to look up a token by its primary key.
 *
 * @param tokenId - The UUID of the refresh token
 * @returns The token record or null if not found
 */
async function findTokenById(tokenId: string): Promise<{
  id: string;
  userId: string;
  deviceFingerprint: string;
  revokedAt: Date | null;
} | null> {
  const result = await query<{
    id: string;
    user_id: string;
    device_fingerprint: string;
    revoked_at: Date | null;
  }>(
    `SELECT id, user_id, device_fingerprint, revoked_at
     FROM refresh_tokens
     WHERE id = $1`,
    [tokenId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;
  return {
    id: row.id,
    userId: row.user_id,
    deviceFingerprint: row.device_fingerprint,
    revokedAt: row.revoked_at,
  };
}

// ─── Session Management ──────────────────────────────────────────────────────

/**
 * Create a new session for a user with device fingerprint association.
 *
 * Generates a token pair (access + refresh), stores the refresh token
 * hash in the database with the device fingerprint, and returns a
 * Session object representing the new session.
 *
 * Per Requirement 4.5: store refresh tokens securely with device
 * fingerprint association.
 *
 * @param userId - The UUID of the authenticated user
 * @param deviceInfo - Device information including fingerprint, user agent, and IP
 * @returns A promise resolving to an object containing the Session and the TokenPair
 */
export async function createSession(
  userId: string,
  deviceInfo: DeviceInfo,
): Promise<{ session: Session; tokenPair: TokenPair }> {
  const tokenPair = await generateTokenPair(userId, deviceInfo.fingerprint);

  // The refresh token was already stored by generateTokenPair via generateRefreshToken.
  // Look it up by its hash to get the full record for the Session object.
  const tokenHash = sha256(tokenPair.refreshToken);
  const storedToken = await sessionRepo.findByTokenHash(tokenHash);

  if (!storedToken) {
    throw new Error('INTERNAL_ERROR: Failed to retrieve newly created session');
  }

  return {
    session: toSession(storedToken),
    tokenPair,
  };
}

/**
 * Get all active sessions for a user.
 *
 * Returns sessions backed by active (non-revoked, non-expired) refresh
 * tokens. Each session includes the device fingerprint, creation time,
 * and expiration time.
 *
 * @param userId - The UUID of the user
 * @returns A promise resolving to an array of active Session objects
 */
export async function getUserSessions(userId: string): Promise<Session[]> {
  const tokens = await sessionRepo.findActiveByUserId(userId);
  return tokens.map(toSession);
}

/**
 * Invalidate a single session by revoking its refresh token.
 *
 * Marks the refresh token associated with the session as revoked
 * with reason 'logout'. This supports single-session logout
 * (Requirement 6.1).
 *
 * @param sessionId - The UUID of the session (refresh token ID) to invalidate
 */
export async function invalidateSession(sessionId: string): Promise<void> {
  await sessionRepo.revokeToken(sessionId, 'logout');
}

/**
 * Invalidate all sessions for a user.
 *
 * Revokes all active refresh tokens for the user with reason
 * 'logout_all'. This supports logout-all operations (Requirement 6.2),
 * password reset session invalidation (Requirement 5.5), and device
 * fingerprint mismatch security (Requirement 4.6).
 *
 * @param userId - The UUID of the user whose sessions to invalidate
 */
export async function invalidateAllUserSessions(userId: string): Promise<void> {
  await sessionRepo.revokeAllForUser(userId, 'logout_all');
}

/**
 * Invalidate all sessions for a user due to a password reset.
 *
 * Revokes all active refresh tokens for the user with reason
 * 'password_reset'. This is distinct from 'logout_all' to maintain
 * a clear audit trail showing that sessions were invalidated as a
 * security measure following a password change, not a voluntary
 * logout-all action.
 *
 * Per Requirement 5.5: when password is reset, the Auth_System SHALL
 * invalidate all existing sessions for that user.
 *
 * @param userId - The UUID of the user whose sessions to invalidate
 */
export async function invalidateSessionsForPasswordReset(userId: string): Promise<void> {
  await sessionRepo.revokeAllForUser(userId, 'password_reset');
}

/**
 * Validate that a session's device fingerprint matches the provided fingerprint.
 *
 * Looks up the session (refresh token) by ID and compares its stored
 * device fingerprint with the provided one. If the fingerprints do not
 * match, ALL sessions for the user are invalidated as a security measure.
 *
 * Per Requirement 4.6: when a refresh token is used from a different
 * device fingerprint, invalidate all tokens for that user.
 *
 * @param sessionId - The UUID of the session (refresh token ID) to validate
 * @param fingerprint - The device fingerprint from the current request
 * @returns A promise resolving to true if fingerprints match, false if mismatch
 *   (in which case all user sessions have been invalidated)
 * @throws {Error} With code 'AUTH_SESSION_INVALID' if the session is not found
 */
export async function validateDeviceFingerprint(
  sessionId: string,
  fingerprint: string,
): Promise<boolean> {
  const token = await findTokenById(sessionId);

  if (!token) {
    throw new Error('AUTH_SESSION_INVALID');
  }

  if (token.deviceFingerprint === fingerprint) {
    return true;
  }

  // Device fingerprint mismatch — invalidate ALL sessions for this user
  // Per Requirement 4.6
  await sessionRepo.revokeAllForUser(token.userId, 'device_mismatch');
  return false;
}
