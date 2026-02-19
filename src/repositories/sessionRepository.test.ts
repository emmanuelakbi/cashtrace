/**
 * Unit tests for the SessionRepository module.
 *
 * All database calls are mocked via vi.mock so these tests run
 * without a live PostgreSQL connection. Tests verify:
 * - Correct SQL queries and parameters
 * - snake_case → camelCase row mapping
 * - Null handling for optional fields (revokedAt, revokedReason)
 * - Active token filtering (non-revoked, non-expired)
 * - Single and bulk revocation
 *
 * @module repositories/sessionRepository.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';

// ─── Mock the db module ──────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mock is set up
const { findByTokenHash, findActiveByUserId, revokeToken, revokeAllForUser, createToken } =
  await import('./sessionRepository.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake refresh_tokens row with sensible defaults. */
function fakeTokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-uuid-1234-5678-abcd-ef0123456789',
    user_id: 'usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee',
    token_hash: 'a'.repeat(64),
    device_fingerprint: 'b'.repeat(64),
    expires_at: new Date('2024-07-22T10:00:00Z'),
    created_at: new Date('2024-07-15T10:00:00Z'),
    revoked_at: null,
    revoked_reason: null,
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

describe('sessionRepository', () => {
  // ── findByTokenHash ────────────────────────────────────────────────────

  describe('findByTokenHash', () => {
    it('should query by token_hash and return a mapped RefreshToken', async () => {
      const row = fakeTokenRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const token = await findByTokenHash('a'.repeat(64));

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE token_hash = $1');
      expect(params).toEqual(['a'.repeat(64)]);

      // Verify camelCase mapping
      expect(token).toEqual({
        id: row.id,
        userId: row.user_id,
        tokenHash: row.token_hash,
        deviceFingerprint: row.device_fingerprint,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        revokedAt: null,
        revokedReason: null,
      });
    });

    it('should return null when no token matches the hash', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const token = await findByTokenHash('nonexistent_hash');

      expect(token).toBeNull();
    });

    it('should map revoked token fields correctly', async () => {
      const revokedAt = new Date('2024-07-16T08:00:00Z');
      const row = fakeTokenRow({
        revoked_at: revokedAt,
        revoked_reason: 'rotation',
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const token = await findByTokenHash('a'.repeat(64));

      expect(token).not.toBeNull();
      expect(token!.revokedAt).toEqual(revokedAt);
      expect(token!.revokedReason).toBe('rotation');
    });
  });

  // ── findActiveByUserId ─────────────────────────────────────────────────

  describe('findActiveByUserId', () => {
    it('should filter by user_id, non-revoked, and non-expired', async () => {
      const row = fakeTokenRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await findActiveByUserId('usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE user_id = $1');
      expect(sql).toContain('revoked_at IS NULL');
      expect(sql).toContain('expires_at > NOW()');
      expect(params).toEqual(['usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee']);
    });

    it('should return mapped RefreshToken array for multiple active tokens', async () => {
      const row1 = fakeTokenRow({ id: 'tok-1', device_fingerprint: 'fp1'.padEnd(64, '0') });
      const row2 = fakeTokenRow({ id: 'tok-2', device_fingerprint: 'fp2'.padEnd(64, '0') });
      mockQuery.mockResolvedValueOnce(pgResult([row1, row2]));

      const tokens = await findActiveByUserId('usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee');

      expect(tokens).toHaveLength(2);
      expect(tokens[0]!.id).toBe('tok-1');
      expect(tokens[0]!.deviceFingerprint).toBe('fp1'.padEnd(64, '0'));
      expect(tokens[1]!.id).toBe('tok-2');
      expect(tokens[1]!.deviceFingerprint).toBe('fp2'.padEnd(64, '0'));
    });

    it('should return an empty array when no active tokens exist', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const tokens = await findActiveByUserId('usr-uuid-no-tokens');

      expect(tokens).toEqual([]);
    });
  });

  // ── revokeToken ────────────────────────────────────────────────────────

  describe('revokeToken', () => {
    it('should update revoked_at and revoked_reason for the given token', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await revokeToken('tok-uuid-1234', 'logout');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SET revoked_at = NOW()');
      expect(sql).toContain('revoked_reason = $2');
      expect(sql).toContain('WHERE id = $1');
      expect(sql).toContain('revoked_at IS NULL');
      expect(params).toEqual(['tok-uuid-1234', 'logout']);
    });

    it('should only revoke non-revoked tokens (idempotent guard)', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await revokeToken('tok-already-revoked', 'rotation');

      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('AND revoked_at IS NULL');
    });

    it('should pass the reason string through to the database', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await revokeToken('tok-uuid', 'device_mismatch');

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual(['tok-uuid', 'device_mismatch']);
    });
  });

  // ── revokeAllForUser ───────────────────────────────────────────────────

  describe('revokeAllForUser', () => {
    it('should revoke all non-revoked tokens for the given user', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await revokeAllForUser('usr-uuid-aaaa', 'logout_all');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SET revoked_at = NOW()');
      expect(sql).toContain('revoked_reason = $2');
      expect(sql).toContain('WHERE user_id = $1');
      expect(sql).toContain('revoked_at IS NULL');
      expect(params).toEqual(['usr-uuid-aaaa', 'logout_all']);
    });

    it('should pass the reason for bulk revocation', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await revokeAllForUser('usr-uuid-bbbb', 'password_reset');

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual(['usr-uuid-bbbb', 'password_reset']);
    });
  });

  // ── createToken ────────────────────────────────────────────────────────

  describe('createToken', () => {
    it('should insert a token and return the mapped RefreshToken', async () => {
      const expiresAt = new Date('2024-07-22T10:00:00Z');
      const row = fakeTokenRow({ expires_at: expiresAt });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const token = await createToken(
        'usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee',
        'a'.repeat(64),
        'b'.repeat(64),
        expiresAt,
      );

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO refresh_tokens');
      expect(sql).toContain('RETURNING');
      expect(params).toEqual([
        'usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee',
        'a'.repeat(64),
        'b'.repeat(64),
        expiresAt.toISOString(),
      ]);

      // Verify camelCase mapping of returned record
      expect(token).toEqual({
        id: row.id,
        userId: row.user_id,
        tokenHash: row.token_hash,
        deviceFingerprint: row.device_fingerprint,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        revokedAt: null,
        revokedReason: null,
      });
    });

    it('should pass expiresAt as ISO string to the database', async () => {
      const expiresAt = new Date('2025-01-01T00:00:00Z');
      mockQuery.mockResolvedValueOnce(pgResult([fakeTokenRow({ expires_at: expiresAt })]));

      await createToken('usr-id', 'hash', 'fp', expiresAt);

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params![3]).toBe('2025-01-01T00:00:00.000Z');
    });

    it('should include all columns in the RETURNING clause', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([fakeTokenRow()]));

      await createToken('usr-id', 'hash', 'fp', new Date());

      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('id');
      expect(sql).toContain('user_id');
      expect(sql).toContain('token_hash');
      expect(sql).toContain('device_fingerprint');
      expect(sql).toContain('expires_at');
      expect(sql).toContain('created_at');
      expect(sql).toContain('revoked_at');
      expect(sql).toContain('revoked_reason');
    });
  });

  // ── Row mapping edge cases ─────────────────────────────────────────────

  describe('row mapping', () => {
    it('should handle null revokedAt and revokedReason for active tokens', async () => {
      const row = fakeTokenRow({ revoked_at: null, revoked_reason: null });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const token = await findByTokenHash('somehash');

      expect(token!.revokedAt).toBeNull();
      expect(token!.revokedReason).toBeNull();
    });

    it('should handle populated revokedAt and revokedReason for revoked tokens', async () => {
      const revokedAt = new Date('2024-07-18T15:30:00Z');
      const row = fakeTokenRow({
        revoked_at: revokedAt,
        revoked_reason: 'logout_all',
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const token = await findByTokenHash('somehash');

      expect(token!.revokedAt).toEqual(revokedAt);
      expect(token!.revokedReason).toBe('logout_all');
    });

    it('should correctly map all Date fields', async () => {
      const expiresAt = new Date('2024-08-01T00:00:00Z');
      const createdAt = new Date('2024-07-25T12:00:00Z');
      const row = fakeTokenRow({ expires_at: expiresAt, created_at: createdAt });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const token = await findByTokenHash('somehash');

      expect(token!.expiresAt).toEqual(expiresAt);
      expect(token!.createdAt).toEqual(createdAt);
    });
  });
});
