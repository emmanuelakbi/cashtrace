/**
 * Unit tests for the UserRepository module.
 *
 * All database calls are mocked via vi.mock so these tests run
 * without a live PostgreSQL connection. Tests verify:
 * - Correct SQL queries and parameters
 * - snake_case → camelCase row mapping
 * - Case-insensitive email handling
 * - Null handling for optional fields
 *
 * @module repositories/userRepository.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';
import { UserStatus } from '../types/index.js';

// ─── Mock the db module ──────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mock is set up
const { createUser, findByEmail, findById, updatePassword, updateLastLogin } =
  await import('./userRepository.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake users-table row with sensible defaults. */
function fakeUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    email: 'test@example.com',
    password_hash: '$2b$12$hashedpasswordvalue',
    email_verified: false,
    status: 'ACTIVE',
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
    last_login_at: null,
    ...overrides,
  };
}

/** Wrap rows in a pg-style QueryResult shape. */
function pgResult(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
});

describe('userRepository', () => {
  // ── createUser ───────────────────────────────────────────────────────────

  describe('createUser', () => {
    it('should insert a user with LOWER() email and return mapped User', async () => {
      const row = fakeUserRow({ email: 'test@example.com' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const user = await createUser('Test@Example.COM', '$2b$12$somehash');

      // Verify the SQL uses LOWER($1)
      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('LOWER($1)');
      expect(params).toEqual(['Test@Example.COM', '$2b$12$somehash']);

      // Verify camelCase mapping
      expect(user).toEqual({
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        emailVerified: row.email_verified,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastLoginAt: row.last_login_at,
        status: UserStatus.ACTIVE,
      });
    });

    it('should pass the password hash as the second parameter', async () => {
      const hash = '$2b$12$specificHashValue1234567890';
      mockQuery.mockResolvedValueOnce(pgResult([fakeUserRow({ password_hash: hash })]));

      const user = await createUser('user@test.com', hash);

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params![1]).toBe(hash);
      expect(user.passwordHash).toBe(hash);
    });
  });

  // ── findByEmail ──────────────────────────────────────────────────────────

  describe('findByEmail', () => {
    it('should use LOWER() for case-insensitive lookup', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([fakeUserRow()]));

      await findByEmail('User@Example.COM');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('LOWER(email) = LOWER($1)');
      expect(params).toEqual(['User@Example.COM']);
    });

    it('should return a mapped User when found', async () => {
      const row = fakeUserRow({
        email_verified: true,
        last_login_at: new Date('2024-06-01T12:00:00Z'),
        status: 'SUSPENDED',
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const user = await findByEmail('test@example.com');

      expect(user).not.toBeNull();
      expect(user!.emailVerified).toBe(true);
      expect(user!.lastLoginAt).toEqual(new Date('2024-06-01T12:00:00Z'));
      expect(user!.status).toBe(UserStatus.SUSPENDED);
    });

    it('should return null when no user is found', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const user = await findByEmail('nonexistent@example.com');

      expect(user).toBeNull();
    });
  });

  // ── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should query by id and return a mapped User', async () => {
      const row = fakeUserRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const user = await findById('a1b2c3d4-e5f6-7890-abcd-ef1234567890');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual(['a1b2c3d4-e5f6-7890-abcd-ef1234567890']);
      expect(user).not.toBeNull();
      expect(user!.id).toBe(row.id);
    });

    it('should return null when no user matches the id', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const user = await findById('00000000-0000-0000-0000-000000000000');

      expect(user).toBeNull();
    });
  });

  // ── updatePassword ───────────────────────────────────────────────────────

  describe('updatePassword', () => {
    it('should update password_hash and updated_at for the given user', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await updatePassword('user-uuid-123', '$2b$12$newHashValue');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SET password_hash = $2');
      expect(sql).toContain('updated_at = NOW()');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual(['user-uuid-123', '$2b$12$newHashValue']);
    });
  });

  // ── updateLastLogin ──────────────────────────────────────────────────────

  describe('updateLastLogin', () => {
    it('should update last_login_at to NOW() for the given user', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await updateLastLogin('user-uuid-456');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('last_login_at = NOW()');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual(['user-uuid-456']);
    });
  });

  // ── Row mapping edge cases ─────────────────────────────────────────────

  describe('row mapping', () => {
    it('should handle null password_hash (magic-link-only users)', async () => {
      const row = fakeUserRow({ password_hash: null });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const user = await findById('some-id');

      expect(user!.passwordHash).toBeNull();
    });

    it('should map all UserStatus enum values correctly', async () => {
      for (const status of [UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.DELETED]) {
        mockQuery.mockResolvedValueOnce(pgResult([fakeUserRow({ status })]));

        const user = await findById('some-id');

        expect(user!.status).toBe(status);
      }
    });
  });
});
