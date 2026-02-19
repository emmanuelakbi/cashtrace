/**
 * Unit tests for the AuditRepository module.
 *
 * All database calls are mocked via vi.mock so these tests run
 * without a live PostgreSQL connection. Tests verify:
 * - Correct SQL queries and parameters
 * - snake_case → camelCase row mapping
 * - Metadata encryption and decryption
 * - Query by user for NDPR compliance
 * - Query by security event filter
 * - Null handling for optional fields
 *
 * @module repositories/auditRepository.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { QueryResult } from 'pg';
import { AuthEventType } from '../types/index.js';

// ─── Mock the db module ──────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mock is set up
const { createAuditLog, findByUserId, findByFilter, encryptMetadata, decryptMetadata } =
  await import('./auditRepository.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake audit_logs-table row with sensible defaults. */
function fakeAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    event_type: 'LOGIN_PASSWORD',
    user_id: 'u1b2c3d4-e5f6-7890-abcd-ef1234567890',
    ip_address: '192.168.1.1',
    user_agent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
    request_id: 'req-12345678-abcd-1234-efgh-123456789012',
    success: true,
    error_code: null,
    metadata: JSON.stringify({ browser: 'Chrome' }),
    created_at: new Date('2024-01-15T10:00:00Z'),
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
  // Ensure no encryption key is set by default (plain JSON mode)
  delete process.env['AUDIT_ENCRYPTION_KEY'];
});

afterEach(() => {
  delete process.env['AUDIT_ENCRYPTION_KEY'];
});

describe('auditRepository', () => {
  // ── createAuditLog ─────────────────────────────────────────────────────

  describe('createAuditLog', () => {
    it('should insert an audit log and return mapped AuditLog', async () => {
      const row = fakeAuditRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const log = await createAuditLog({
        eventType: AuthEventType.LOGIN_PASSWORD,
        userId: 'u1b2c3d4-e5f6-7890-abcd-ef1234567890',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
        requestId: 'req-12345678-abcd-1234-efgh-123456789012',
        success: true,
        metadata: { browser: 'Chrome' },
      });

      // Verify the SQL INSERT
      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(sql).toContain('RETURNING');
      expect(params![0]).toBe(AuthEventType.LOGIN_PASSWORD);
      expect(params![1]).toBe('u1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(params![2]).toBe('192.168.1.1');
      expect(params![5]).toBe(true);
      expect(params![6]).toBeNull(); // errorCode defaults to null

      // Verify camelCase mapping
      expect(log).toEqual({
        id: row.id,
        eventType: AuthEventType.LOGIN_PASSWORD,
        userId: row.user_id,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        requestId: row.request_id,
        success: true,
        errorCode: null,
        metadata: { browser: 'Chrome' },
        createdAt: row.created_at,
      });
    });

    it('should handle null userId for failed attempts on unknown emails', async () => {
      const row = fakeAuditRow({
        user_id: null,
        success: false,
        error_code: 'AUTH_INVALID_CREDENTIALS',
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const log = await createAuditLog({
        eventType: AuthEventType.LOGIN_PASSWORD,
        userId: null,
        ipAddress: '10.0.0.1',
        userAgent: 'TestAgent',
        requestId: 'req-test',
        success: false,
        errorCode: 'AUTH_INVALID_CREDENTIALS',
      });

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params![1]).toBeNull();
      expect(params![6]).toBe('AUTH_INVALID_CREDENTIALS');

      expect(log.userId).toBeNull();
      expect(log.success).toBe(false);
      expect(log.errorCode).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('should default metadata to empty object when not provided', async () => {
      const row = fakeAuditRow({ metadata: JSON.stringify({}) });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await createAuditLog({
        eventType: AuthEventType.SIGNUP,
        userId: 'user-123',
        ipAddress: '10.0.0.1',
        userAgent: 'TestAgent',
        requestId: 'req-test',
        success: true,
      });

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      // metadata param should be the JSON string of an empty object
      expect(params![7]).toBe(JSON.stringify({}));
    });

    it('should store metadata as plain JSON when no encryption key is set', async () => {
      const metadata = { action: 'login', device: 'mobile' };
      const row = fakeAuditRow({ metadata: JSON.stringify(metadata) });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await createAuditLog({
        eventType: AuthEventType.LOGIN_PASSWORD,
        userId: 'user-123',
        ipAddress: '10.0.0.1',
        userAgent: 'TestAgent',
        requestId: 'req-test',
        success: true,
        metadata,
      });

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      // Should be plain JSON since no encryption key
      expect(params![7]).toBe(JSON.stringify(metadata));
    });

    it('should encrypt metadata when AUDIT_ENCRYPTION_KEY is set', async () => {
      // 32-byte key as hex (64 hex chars)
      const key = 'a'.repeat(64);
      process.env['AUDIT_ENCRYPTION_KEY'] = key;

      const metadata = { action: 'login', device: 'mobile' };

      // Capture the encrypted metadata that createAuditLog will pass to the DB,
      // then return it in the mock row so mapRowToAuditLog can decrypt it.
      let capturedEncryptedMetadata: string | undefined;
      mockQuery.mockImplementationOnce((_sql: string, params?: unknown[]) => {
        capturedEncryptedMetadata = params?.[7] as string;
        const row = fakeAuditRow({ metadata: capturedEncryptedMetadata });
        return Promise.resolve(pgResult([row]));
      });

      const log = await createAuditLog({
        eventType: AuthEventType.LOGIN_PASSWORD,
        userId: 'user-123',
        ipAddress: '10.0.0.1',
        userAgent: 'TestAgent',
        requestId: 'req-test',
        success: true,
        metadata,
      });

      // Encrypted metadata should NOT be plain JSON
      expect(capturedEncryptedMetadata).not.toBe(JSON.stringify(metadata));
      // Should be a hex string (IV + ciphertext)
      expect(/^[0-9a-f]+$/i.test(capturedEncryptedMetadata!)).toBe(true);

      // The returned AuditLog should have the decrypted metadata
      expect(log.metadata).toEqual(metadata);
    });

    it('should pass all event types correctly', async () => {
      for (const eventType of Object.values(AuthEventType)) {
        mockQuery.mockResolvedValueOnce(pgResult([fakeAuditRow({ event_type: eventType })]));

        const log = await createAuditLog({
          eventType,
          userId: 'user-123',
          ipAddress: '10.0.0.1',
          userAgent: 'TestAgent',
          requestId: 'req-test',
          success: true,
        });

        expect(log.eventType).toBe(eventType);
      }
    });
  });

  // ── findByUserId ───────────────────────────────────────────────────────

  describe('findByUserId', () => {
    it('should query by user_id and date range and return mapped AuditLogs', async () => {
      const rows = [
        fakeAuditRow({ created_at: new Date('2024-01-15T12:00:00Z') }),
        fakeAuditRow({
          id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
          event_type: 'LOGOUT',
          created_at: new Date('2024-01-15T08:00:00Z'),
          metadata: JSON.stringify({ reason: 'user_initiated' }),
        }),
      ];
      mockQuery.mockResolvedValueOnce(pgResult(rows));

      const from = new Date('2024-01-01T00:00:00Z');
      const to = new Date('2024-01-31T23:59:59Z');
      const logs = await findByUserId('u1b2c3d4-e5f6-7890-abcd-ef1234567890', from, to);

      // Verify SQL
      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE user_id = $1');
      expect(sql).toContain('created_at >= $2');
      expect(sql).toContain('created_at <= $3');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(params![0]).toBe('u1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(params![1]).toBe(from.toISOString());
      expect(params![2]).toBe(to.toISOString());

      // Verify results
      expect(logs).toHaveLength(2);
      expect(logs[0]!.eventType).toBe(AuthEventType.LOGIN_PASSWORD);
      expect(logs[1]!.eventType).toBe(AuthEventType.LOGOUT);
      expect(logs[1]!.metadata).toEqual({ reason: 'user_initiated' });
    });

    it('should return empty array when no logs found', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const logs = await findByUserId(
        'nonexistent-user',
        new Date('2024-01-01'),
        new Date('2024-12-31'),
      );

      expect(logs).toEqual([]);
    });
  });

  // ── findByFilter ───────────────────────────────────────────────────────

  describe('findByFilter', () => {
    it('should query with only date range when no optional filters provided', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([fakeAuditRow()]));

      const from = new Date('2024-01-01T00:00:00Z');
      const to = new Date('2024-01-31T23:59:59Z');
      await findByFilter({ from, to });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('created_at >= $1');
      expect(sql).toContain('created_at <= $2');
      expect(params).toEqual([from.toISOString(), to.toISOString()]);
    });

    it('should add event_type filter when provided', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await findByFilter({
        from: new Date('2024-01-01'),
        to: new Date('2024-01-31'),
        eventType: AuthEventType.RATE_LIMIT_EXCEEDED,
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('event_type = $3');
      expect(params![2]).toBe(AuthEventType.RATE_LIMIT_EXCEEDED);
    });

    it('should add user_id filter when provided', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await findByFilter({
        from: new Date('2024-01-01'),
        to: new Date('2024-01-31'),
        userId: 'user-abc',
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('user_id = $3');
      expect(params![2]).toBe('user-abc');
    });

    it('should add ip_address filter when provided', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await findByFilter({
        from: new Date('2024-01-01'),
        to: new Date('2024-01-31'),
        ipAddress: '192.168.1.100',
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ip_address = $3');
      expect(params![2]).toBe('192.168.1.100');
    });

    it('should add success filter when provided', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await findByFilter({
        from: new Date('2024-01-01'),
        to: new Date('2024-01-31'),
        success: false,
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('success = $3');
      expect(params![2]).toBe(false);
    });

    it('should combine all filters with correct parameter indices', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await findByFilter({
        from: new Date('2024-01-01'),
        to: new Date('2024-01-31'),
        eventType: AuthEventType.LOGIN_PASSWORD,
        userId: 'user-xyz',
        ipAddress: '10.0.0.1',
        success: false,
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('event_type = $3');
      expect(sql).toContain('user_id = $4');
      expect(sql).toContain('ip_address = $5');
      expect(sql).toContain('success = $6');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(params).toHaveLength(6);
      expect(params![2]).toBe(AuthEventType.LOGIN_PASSWORD);
      expect(params![3]).toBe('user-xyz');
      expect(params![4]).toBe('10.0.0.1');
      expect(params![5]).toBe(false);
    });

    it('should return mapped AuditLog objects', async () => {
      const row = fakeAuditRow({
        event_type: 'RATE_LIMIT_EXCEEDED',
        success: false,
        error_code: 'AUTH_RATE_LIMITED',
        metadata: JSON.stringify({ attempts: 6 }),
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const logs = await findByFilter({
        from: new Date('2024-01-01'),
        to: new Date('2024-01-31'),
      });

      expect(logs).toHaveLength(1);
      expect(logs[0]!.eventType).toBe(AuthEventType.RATE_LIMIT_EXCEEDED);
      expect(logs[0]!.success).toBe(false);
      expect(logs[0]!.errorCode).toBe('AUTH_RATE_LIMITED');
      expect(logs[0]!.metadata).toEqual({ attempts: 6 });
    });
  });

  // ── Encryption / Decryption ────────────────────────────────────────────

  describe('encryptMetadata / decryptMetadata', () => {
    it('should round-trip metadata through encrypt/decrypt with encryption key', () => {
      const key = 'b'.repeat(64); // 32-byte key as hex
      process.env['AUDIT_ENCRYPTION_KEY'] = key;

      const metadata = { action: 'login', count: 42, nested: { foo: 'bar' } };
      const encrypted = encryptMetadata(metadata);
      const decrypted = decryptMetadata(encrypted);

      expect(decrypted).toEqual(metadata);
    });

    it('should produce different ciphertext for the same input (random IV)', () => {
      const key = 'c'.repeat(64);
      process.env['AUDIT_ENCRYPTION_KEY'] = key;

      const metadata = { test: 'data' };
      const encrypted1 = encryptMetadata(metadata);
      const encrypted2 = encryptMetadata(metadata);

      // Different IVs should produce different ciphertext
      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same value
      expect(decryptMetadata(encrypted1)).toEqual(metadata);
      expect(decryptMetadata(encrypted2)).toEqual(metadata);
    });

    it('should store plain JSON when no encryption key is set', () => {
      delete process.env['AUDIT_ENCRYPTION_KEY'];

      const metadata = { plain: true };
      const result = encryptMetadata(metadata);

      expect(result).toBe(JSON.stringify(metadata));
    });

    it('should decrypt plain JSON when no encryption key is set', () => {
      delete process.env['AUDIT_ENCRYPTION_KEY'];

      const metadata = { plain: true };
      const result = decryptMetadata(JSON.stringify(metadata));

      expect(result).toEqual(metadata);
    });

    it('should handle empty metadata object', () => {
      const key = 'd'.repeat(64);
      process.env['AUDIT_ENCRYPTION_KEY'] = key;

      const encrypted = encryptMetadata({});
      const decrypted = decryptMetadata(encrypted);

      expect(decrypted).toEqual({});
    });
  });

  // ── Row mapping edge cases ─────────────────────────────────────────────

  describe('row mapping', () => {
    it('should handle null metadata', async () => {
      const row = fakeAuditRow({ metadata: null });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const logs = await findByUserId(
        'u1b2c3d4-e5f6-7890-abcd-ef1234567890',
        new Date('2024-01-01'),
        new Date('2024-12-31'),
      );

      expect(logs[0]!.metadata).toEqual({});
    });

    it('should handle Buffer metadata (PostgreSQL BYTEA)', async () => {
      const metadata = { fromBuffer: true };
      const row = fakeAuditRow({ metadata: Buffer.from(JSON.stringify(metadata), 'utf8') });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const logs = await findByUserId(
        'u1b2c3d4-e5f6-7890-abcd-ef1234567890',
        new Date('2024-01-01'),
        new Date('2024-12-31'),
      );

      expect(logs[0]!.metadata).toEqual(metadata);
    });

    it('should map all AuthEventType enum values correctly', async () => {
      for (const eventType of Object.values(AuthEventType)) {
        mockQuery.mockResolvedValueOnce(pgResult([fakeAuditRow({ event_type: eventType })]));

        const logs = await findByUserId(
          'u1b2c3d4-e5f6-7890-abcd-ef1234567890',
          new Date('2024-01-01'),
          new Date('2024-12-31'),
        );

        expect(logs[0]!.eventType).toBe(eventType);
      }
    });

    it('should handle null error_code', async () => {
      const row = fakeAuditRow({ error_code: null });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const logs = await findByUserId('user-123', new Date('2024-01-01'), new Date('2024-12-31'));

      expect(logs[0]!.errorCode).toBeNull();
    });

    it('should handle non-null error_code', async () => {
      const row = fakeAuditRow({ error_code: 'AUTH_INVALID_CREDENTIALS' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const logs = await findByUserId('user-123', new Date('2024-01-01'), new Date('2024-12-31'));

      expect(logs[0]!.errorCode).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });
});
