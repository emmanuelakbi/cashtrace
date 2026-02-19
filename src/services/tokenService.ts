/**
 * Token service for the authentication module.
 *
 * Provides JWT access token generation and validation, refresh token
 * generation with SHA-256 hashing and database persistence, and
 * helper utilities for JWT secret management.
 *
 * Access tokens expire after 15 minutes (Requirement 4.2).
 * Refresh tokens expire after 7 days (Requirement 4.1) and are
 * stored as SHA-256 hashes in the `refresh_tokens` table with
 * device fingerprint association (Requirement 4.5).
 *
 * @module services/tokenService
 */

import { randomBytes, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query } from '../utils/db.js';
import type { TokenPair, TokenPayload, MagicTokenPayload } from '../types/index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Access token expiration: 15 minutes in seconds.
 * Per Requirement 4.2: issue session tokens with a 15-minute expiration period.
 */
export const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;

/**
 * Refresh token expiration: 7 days in milliseconds.
 * Per Requirement 4.1: issue refresh tokens with a 7-day expiration period.
 */
export const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Magic link token expiration: 15 minutes in milliseconds.
 * Per Requirement 3.2: set expiration to 15 minutes from creation.
 */
export const MAGIC_TOKEN_EXPIRY_MS = 15 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Retrieve the JWT signing secret from the `JWT_SECRET` environment variable.
 *
 * @throws {Error} If `JWT_SECRET` is not set or is empty.
 * @returns The JWT secret string.
 */
export function getJwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

/**
 * Compute the SHA-256 hex digest of a raw token string.
 *
 * Used to hash refresh tokens before storing them in the database.
 * Only the hash is persisted — the raw token is returned to the caller.
 *
 * @param token - The raw token string to hash
 * @returns The lowercase hex-encoded SHA-256 digest (64 characters)
 */
export function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ─── Access Token ────────────────────────────────────────────────────────────

/**
 * Generate a signed JWT access token for the given user.
 *
 * The token payload includes `userId` and `type` claims. The token
 * is signed with the HS256 algorithm and expires after 15 minutes.
 *
 * @param userId - The UUID of the authenticated user
 * @returns An object containing the signed JWT string and its expiration date
 */
export function generateAccessToken(userId: string): {
  accessToken: string;
  accessTokenExpiresAt: Date;
} {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TOKEN_EXPIRY_SECONDS;

  const payload = {
    userId,
    type: 'access',
  };

  const accessToken = jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
  });

  return {
    accessToken,
    accessTokenExpiresAt: new Date(exp * 1000),
  };
}

// ─── Refresh Token ───────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure refresh token, store its SHA-256
 * hash in the `refresh_tokens` table, and return the raw token.
 *
 * The raw token is a 64-character hex string (32 random bytes).
 * Only the SHA-256 hash is persisted in the database alongside the
 * user ID, device fingerprint, and expiration timestamp.
 *
 * Per Requirement 4.1: 7-day expiration.
 * Per Requirement 4.5: stored with device fingerprint association.
 *
 * @param userId - The UUID of the authenticated user
 * @param deviceFingerprint - A hash identifying the user's device
 * @returns An object containing the raw refresh token and its expiration date
 */
export async function generateRefreshToken(
  userId: string,
  deviceFingerprint: string,
): Promise<{
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}> {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_fingerprint, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, deviceFingerprint, expiresAt.toISOString()],
  );

  return {
    refreshToken: rawToken,
    refreshTokenExpiresAt: expiresAt,
  };
}

// ─── Token Pair ──────────────────────────────────────────────────────────────

/**
 * Generate a complete token pair (access + refresh) for the given user.
 *
 * Combines {@link generateAccessToken} and {@link generateRefreshToken}
 * into a single call that returns a {@link TokenPair}.
 *
 * @param userId - The UUID of the authenticated user
 * @param deviceFingerprint - A hash identifying the user's device
 * @returns A promise that resolves to a TokenPair
 */
export async function generateTokenPair(
  userId: string,
  deviceFingerprint: string,
): Promise<TokenPair> {
  const { accessToken, accessTokenExpiresAt } = generateAccessToken(userId);
  const { refreshToken, refreshTokenExpiresAt } = await generateRefreshToken(
    userId,
    deviceFingerprint,
  );

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a JWT access token and return its payload if valid.
 *
 * Verifies the token's signature using the JWT secret and checks
 * that it has not expired. Returns the decoded {@link TokenPayload}
 * on success, or `null` if the token is invalid, expired, or
 * malformed.
 *
 * @param token - The JWT access token string to validate
 * @returns A promise that resolves to the TokenPayload or null
 */
export async function validateAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    });

    if (typeof decoded === 'string' || !decoded) {
      return null;
    }

    const payload = decoded as Record<string, unknown>;

    // Ensure the token is an access token
    if (payload['type'] !== 'access') {
      return null;
    }

    const userId = payload['userId'];
    if (typeof userId !== 'string') {
      return null;
    }

    return {
      userId,
      email: typeof payload['email'] === 'string' ? payload['email'] : '',
      iat: typeof payload['iat'] === 'number' ? payload['iat'] : 0,
      exp: typeof payload['exp'] === 'number' ? payload['exp'] : 0,
    };
  } catch {
    // Token is invalid, expired, or malformed
    return null;
  }
}

// ─── Refresh Token Rotation ──────────────────────────────────────────────────

/**
 * Refresh an existing token pair using a valid refresh token.
 *
 * Performs the following steps:
 * 1. Hash the incoming refresh token with SHA-256
 * 2. Look up the hash in the `refresh_tokens` table
 * 3. Verify the token is not expired and not revoked
 * 4. Verify the device fingerprint matches the stored one
 *    - If mismatch: revoke ALL tokens for the user (Requirement 4.6)
 * 5. Revoke the old refresh token (rotation — Requirement 4.4)
 * 6. Generate and return a new token pair
 *
 * @param refreshToken - The raw refresh token string from the client
 * @param deviceFingerprint - The device fingerprint from the current request
 * @returns A new TokenPair if the refresh token is valid
 * @throws {Error} With descriptive code when the token is invalid, expired,
 *   revoked, not found, or used from a mismatched device
 */
export async function refreshTokens(
  refreshToken: string,
  deviceFingerprint: string,
): Promise<TokenPair> {
  const tokenHash = sha256(refreshToken);

  // Look up the refresh token by its hash
  const result = await query<{
    id: string;
    user_id: string;
    device_fingerprint: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT id, user_id, device_fingerprint, expires_at, revoked_at
     FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  );

  if (result.rows.length === 0) {
    throw new Error('AUTH_TOKEN_INVALID');
  }

  const storedToken = result.rows[0]!;

  // Check if the token has been revoked
  if (storedToken.revoked_at !== null) {
    throw new Error('AUTH_TOKEN_INVALID');
  }

  // Check if the token has expired
  const now = new Date();
  if (new Date(storedToken.expires_at) <= now) {
    throw new Error('AUTH_TOKEN_EXPIRED');
  }

  // Check device fingerprint match (Requirement 4.6)
  if (storedToken.device_fingerprint !== deviceFingerprint) {
    // Suspicious activity: revoke ALL tokens for this user
    await revokeAllUserTokens(storedToken.user_id);
    throw new Error('AUTH_DEVICE_MISMATCH');
  }

  // Revoke the old refresh token (rotation — Requirement 4.4)
  await revokeRefreshToken(storedToken.id);

  // Generate and return a new token pair
  return generateTokenPair(storedToken.user_id, deviceFingerprint);
}

// ─── Token Revocation ────────────────────────────────────────────────────────

/**
 * Revoke a single refresh token by its database ID.
 *
 * Sets `revoked_at` to the current timestamp and `revoked_reason` to
 * `'rotation'`, marking the token as no longer valid.
 *
 * @param tokenId - The UUID primary key of the refresh token row
 */
export async function revokeRefreshToken(tokenId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW(), revoked_reason = 'rotation'
     WHERE id = $1 AND revoked_at IS NULL`,
    [tokenId],
  );
}

/**
 * Revoke all active refresh tokens for a given user.
 *
 * Used when a device fingerprint mismatch is detected (Requirement 4.6),
 * during logout-all operations (Requirement 6.2), or after a password
 * reset (Requirement 5.5).
 *
 * @param userId - The UUID of the user whose tokens should be revoked
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW(), revoked_reason = 'revoked_all'
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

// ─── Magic Link Tokens ───────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure magic link token for the given user.
 *
 * Creates a 32-byte random token, stores its SHA-256 hash in the
 * `magic_link_tokens` table with a 15-minute expiration, and returns
 * the raw token string.
 *
 * Per Requirement 3.1: generate a cryptographically secure token.
 * Per Requirement 3.2: set expiration to 15 minutes from creation.
 *
 * @param userId - The UUID of the user requesting a magic link
 * @returns The raw hex-encoded token string (64 characters)
 */
export async function generateMagicToken(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + MAGIC_TOKEN_EXPIRY_MS);

  await query(
    `INSERT INTO magic_link_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt.toISOString()],
  );

  return rawToken;
}

/**
 * Validate a magic link token and return its payload if valid.
 *
 * Hashes the raw token with SHA-256, looks it up in the
 * `magic_link_tokens` table, and verifies that:
 * 1. The token exists
 * 2. The token has not expired (`expires_at > NOW()`)
 * 3. The token has not been used (`used_at IS NULL`)
 *
 * Per Requirement 3.5: single-use enforcement (used_at must be NULL).
 * Per Requirement 3.2: 15-minute expiration check.
 *
 * @param token - The raw magic link token string
 * @returns The MagicTokenPayload if valid, or null if invalid/expired/used
 */
export async function validateMagicToken(token: string): Promise<MagicTokenPayload | null> {
  const tokenHash = sha256(token);

  const result = await query<{
    id: string;
    user_id: string;
    expires_at: Date;
    used_at: Date | null;
  }>(
    `SELECT id, user_id, expires_at, used_at
     FROM magic_link_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;

  // Check if the token has already been used (Requirement 3.5)
  if (row.used_at !== null) {
    return null;
  }

  // Check if the token has expired (Requirement 3.2)
  const now = new Date();
  if (new Date(row.expires_at) <= now) {
    return null;
  }

  return {
    userId: row.user_id,
    tokenId: row.id,
  };
}

/**
 * Invalidate a magic link token by marking it as used.
 *
 * Sets `used_at` to the current timestamp for the token matching
 * the SHA-256 hash of the provided raw token. This enforces
 * single-use semantics — once invalidated, the token cannot be
 * validated again.
 *
 * Per Requirement 3.5: invalidate immediately to prevent reuse.
 *
 * @param token - The raw magic link token string to invalidate
 */
export async function invalidateMagicToken(token: string): Promise<void> {
  const tokenHash = sha256(token);

  await query(
    `UPDATE magic_link_tokens
     SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL`,
    [tokenHash],
  );
}
