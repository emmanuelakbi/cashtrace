/**
 * User repository for database operations on the users table.
 *
 * Provides CRUD operations for user records with case-insensitive
 * email lookups and snake_case ↔ camelCase mapping between the
 * PostgreSQL schema and TypeScript types.
 *
 * @module repositories/userRepository
 */

import { query } from '../utils/db.js';
import { User, UserStatus } from '../types/index.js';

// ─── Row Mapping ─────────────────────────────────────────────────────────────

/** Raw row shape returned by PostgreSQL for the users table. */
interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  email_verified: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

/**
 * Map a database row (snake_case) to a User domain object (camelCase).
 */
function mapRowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    emailVerified: row.email_verified,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    status: row.status as UserStatus,
  };
}

// ─── Repository Functions ────────────────────────────────────────────────────

/**
 * Create a new user with the given email and password hash.
 *
 * The email is stored in lowercase to enforce case-insensitive uniqueness.
 * The user is created with default status ACTIVE and email_verified = false.
 *
 * @param email - The user's email address (will be lowercased)
 * @param passwordHash - The bcrypt hash of the user's password
 * @returns The newly created User record
 */
export async function createUser(email: string, passwordHash: string): Promise<User> {
  const result = await query<UserRow>(
    `INSERT INTO users (email, password_hash)
     VALUES (LOWER($1), $2)
     RETURNING id, email, password_hash, email_verified, status, created_at, updated_at, last_login_at`,
    [email, passwordHash],
  );

  return mapRowToUser(result.rows[0]!);
}

/**
 * Find a user by email address (case-insensitive).
 *
 * Uses LOWER() on both the stored email and the input to ensure
 * case-insensitive matching regardless of how the email was stored.
 *
 * @param email - The email address to search for
 * @returns The matching User or null if not found
 */
export async function findByEmail(email: string): Promise<User | null> {
  const result = await query<UserRow>(
    `SELECT id, email, password_hash, email_verified, status, created_at, updated_at, last_login_at
     FROM users
     WHERE LOWER(email) = LOWER($1)`,
    [email],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToUser(result.rows[0]!);
}

/**
 * Find a user by their UUID.
 *
 * @param id - The user's UUID
 * @returns The matching User or null if not found
 */
export async function findById(id: string): Promise<User | null> {
  const result = await query<UserRow>(
    `SELECT id, email, password_hash, email_verified, status, created_at, updated_at, last_login_at
     FROM users
     WHERE id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToUser(result.rows[0]!);
}

/**
 * Update a user's password hash and set updated_at to now.
 *
 * @param userId - The UUID of the user whose password to update
 * @param newPasswordHash - The new bcrypt password hash
 */
export async function updatePassword(userId: string, newPasswordHash: string): Promise<void> {
  await query(
    `UPDATE users
     SET password_hash = $2, updated_at = NOW()
     WHERE id = $1`,
    [userId, newPasswordHash],
  );
}

/**
 * Update a user's last_login_at timestamp to now.
 *
 * @param userId - The UUID of the user who just logged in
 */
export async function updateLastLogin(userId: string): Promise<void> {
  await query(
    `UPDATE users
     SET last_login_at = NOW()
     WHERE id = $1`,
    [userId],
  );
}
