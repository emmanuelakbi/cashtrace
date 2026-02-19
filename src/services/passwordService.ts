/**
 * Password service for the authentication module.
 *
 * Provides password hashing using bcrypt with cost factor 12,
 * password verification against stored hashes, and password
 * strength validation delegated to the password validator utility.
 *
 * @module services/passwordService
 */

import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import { validatePassword } from '../utils/validators/passwordValidator.js';
import { query } from '../utils/db.js';
import type { ValidationResult, ResetTokenPayload } from '../types/index.js';

/**
 * Expiration time for password reset tokens: 1 hour in milliseconds.
 * Per requirement 5.2: set expiration to 1 hour from creation.
 */
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Bcrypt cost factor (number of salt rounds).
 * Cost factor 12 provides a good balance between security and performance.
 * Per requirement 1.4: hash the password using bcrypt with cost factor 12.
 */
const BCRYPT_COST_FACTOR = 12;

/**
 * Hash a plaintext password using bcrypt with cost factor 12.
 *
 * Generates a unique salt for each hash, ensuring that identical
 * passwords produce different hashes. The resulting hash string
 * includes the algorithm identifier, cost factor, salt, and hash.
 *
 * @param plaintext - The plaintext password to hash
 * @returns A promise that resolves to the bcrypt hash string
 *
 * @example
 * ```typescript
 * const hash = await hashPassword('mySecurePass1');
 * // '$2b$12$...' (60-character bcrypt hash)
 * ```
 */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = await bcrypt.genSalt(BCRYPT_COST_FACTOR);
  return bcrypt.hash(plaintext, salt);
}

/**
 * Verify a plaintext password against a stored bcrypt hash.
 *
 * Uses bcrypt's constant-time comparison to prevent timing attacks.
 * Returns true if the plaintext matches the hash, false otherwise.
 *
 * @param plaintext - The plaintext password to verify
 * @param hash - The stored bcrypt hash to verify against
 * @returns A promise that resolves to true if the password matches, false otherwise
 *
 * @example
 * ```typescript
 * const hash = await hashPassword('mySecurePass1');
 * const isValid = await verifyPassword('mySecurePass1', hash); // true
 * const isInvalid = await verifyPassword('wrongPassword1', hash); // false
 * ```
 */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * Validate password strength against the module's requirements.
 *
 * Delegates to the password validator utility which checks:
 * - Minimum 8 characters in length
 * - At least 1 numeric digit
 *
 * @param password - The password string to validate
 * @returns A ValidationResult indicating whether the password meets requirements
 *
 * @example
 * ```typescript
 * const result = validatePasswordStrength('securePass1');
 * // { valid: true, errors: [] }
 *
 * const weak = validatePasswordStrength('short');
 * // { valid: false, errors: ['Password must be at least 8 characters', 'Password must contain at least 1 number'] }
 * ```
 */
export function validatePasswordStrength(password: string): ValidationResult {
  return validatePassword(password);
}

/**
 * Compute the SHA-256 hex digest of a raw token string.
 *
 * Used internally to hash tokens before storing or looking them up
 * in the database. Only the hash is persisted — the raw token is
 * returned to the caller and never stored.
 *
 * @param token - The raw token string to hash
 * @returns The lowercase hex-encoded SHA-256 digest (64 characters)
 */
function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a cryptographically secure password reset token.
 *
 * Creates a 32-byte random token, stores its SHA-256 hash in the
 * `password_reset_tokens` table with a 1-hour expiration, and
 * returns the raw hex-encoded token to the caller.
 *
 * The raw token is never stored — only its hash. The caller should
 * include the raw token in the reset link sent to the user's email.
 *
 * Per requirement 5.1: generate a secure reset token.
 * Per requirement 5.2: set expiration to 1 hour from creation.
 *
 * @param userId - The UUID of the user requesting the password reset
 * @returns A promise that resolves to the raw hex-encoded reset token
 *
 * @example
 * ```typescript
 * const rawToken = await generateResetToken('550e8400-e29b-41d4-a716-446655440000');
 * // rawToken is a 64-char hex string to include in the reset URL
 * ```
 */
export async function generateResetToken(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt.toISOString()],
  );

  return rawToken;
}

/**
 * Validate a password reset token and return its payload if valid.
 *
 * Hashes the provided raw token with SHA-256, looks it up in the
 * `password_reset_tokens` table, and checks that:
 * 1. A matching row exists
 * 2. The token has not expired (`expires_at > NOW()`)
 * 3. The token has not already been used (`used_at IS NULL`)
 *
 * If all checks pass, returns a {@link ResetTokenPayload} containing
 * the `userId` and `tokenId`. Otherwise returns `null`.
 *
 * Per requirement 5.1: validate the reset token.
 * Per requirement 5.2: enforce 1-hour expiration.
 *
 * @param token - The raw hex-encoded reset token from the user's reset link
 * @returns A promise that resolves to the payload or null if invalid/expired/used
 *
 * @example
 * ```typescript
 * const payload = await validateResetToken(rawToken);
 * if (payload) {
 *   // Token is valid — proceed with password reset
 *   console.log(payload.userId, payload.tokenId);
 * }
 * ```
 */
export async function validateResetToken(token: string): Promise<ResetTokenPayload | null> {
  const tokenHash = sha256(token);

  const result = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id
     FROM password_reset_tokens
     WHERE token_hash = $1
       AND expires_at > NOW()
       AND used_at IS NULL`,
    [tokenHash],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0]!;
  return {
    userId: row.user_id,
    tokenId: row.id,
  };
}
