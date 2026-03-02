/**
 * Unit tests for the AuditService module.
 *
 * All database calls are mocked via vi.mock so these tests run
 * without a live PostgreSQL connection. Tests verify:
 * - Correct SQL queries and parameters
 * - snake_case → camelCase row mapping
 * - Auto-generation of requestId when not provided
 * - Handling of previousValues and newValues for update events
 * - Handling of optional userAgent field
 *
 * @module modules/business/services/auditService.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';

import { BusinessEventType } from '../types/index.js';

// ─── Mock the db module ──────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// ─── Mock uuid to control requestId generation ──────────────────────────────

const MOCK_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

vi.mock('uuid', () => ({
  v4: () => MOCK_UUID,
}));

// Import after mocks are set up
const {
  logEvent,
  mapRowToAuditLog,
  getBusinessAuditHistory,
  getUserAuditHistory,
  deleteBusinessAuditLogs,
} = await import('./auditService.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake business_audit_logs row with sensible defaults. */
function fakeAuditLogRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    event_type: 'BUSINESS_CREATED',
    user_id: 'u1b2c3d4-e5f6-7890-abcd-ef1234567890',
    business_id: 'b1b2c3d4-e5f6-7890-abcd-ef1234567890',
    ip_address: '192.168.1.1',
    user_agent: 'Mozilla/5.0',
    request_id: 'r1b2c3d4-e5f6-7890-abcd-ef1234567890',
    previous_values: null,
    new_values: { name: 'Test Business' },
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
});

describe('auditService', () => {
  // ── mapRowToAuditLog ───────────────────────────────────────────────────

  describe('mapRowToAuditLog', () => {
    it('should map snake_case row to camelCase BusinessAuditLog', () => {
      const row = fakeAuditLogRow();
      const log = mapRowToAuditLog(row);

      expect(log).toEqual({
        id: row.id,
        eventType: BusinessEventType.BUSINESS_CREATED,
        userId: row.user_id,
        businessId: row.business_id,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        requestId: row.request_id,
        previousValues: null,
        newValues: { name: 'Test Business' },
        createdAt: row.created_at,
      });
    });

    it('should map null user_agent to empty string', () => {
      const row = fakeAuditLogRow({ user_agent: null });
      const log = mapRowToAuditLog(row);

      expect(log.userAgent).toBe('');
    });

    it('should preserve previousValues and newValues for update events', () => {
      const previousValues = { name: 'Old Name', sector: 'OTHER' };
      const newValues = { name: 'New Name', sector: 'RETAIL_TRADING' };
      const row = fakeAuditLogRow({
        event_type: 'BUSINESS_UPDATED',
        previous_values: previousValues,
        new_values: newValues,
      });

      const log = mapRowToAuditLog(row);

      expect(log.eventType).toBe(BusinessEventType.BUSINESS_UPDATED);
      expect(log.previousValues).toEqual(previousValues);
      expect(log.newValues).toEqual(newValues);
    });

    it('should map all event types correctly', () => {
      for (const eventType of Object.values(BusinessEventType)) {
        const row = fakeAuditLogRow({ event_type: eventType });
        const log = mapRowToAuditLog(row);
        expect(log.eventType).toBe(eventType);
      }
    });
  });

  // ── logEvent ───────────────────────────────────────────────────────────

  describe('logEvent', () => {
    it('should insert an audit log and return mapped result', async () => {
      const row = fakeAuditLogRow({ request_id: 'custom-request-id' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const log = await logEvent({
        eventType: BusinessEventType.BUSINESS_CREATED,
        userId: 'u1b2c3d4-e5f6-7890-abcd-ef1234567890',
        businessId: 'b1b2c3d4-e5f6-7890-abcd-ef1234567890',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        requestId: 'custom-request-id',
        newValues: { name: 'Test Business' },
      });

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO business_audit_logs');
      expect(sql).toContain('RETURNING');
      expect(params).toEqual([
        BusinessEventType.BUSINESS_CREATED,
        'u1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'b1b2c3d4-e5f6-7890-abcd-ef1234567890',
        '192.168.1.1',
        'Mozilla/5.0',
        'custom-request-id',
        null,
        JSON.stringify({ name: 'Test Business' }),
      ]);
      expect(log.eventType).toBe(BusinessEventType.BUSINESS_CREATED);
      expect(log.requestId).toBe('custom-request-id');
    });

    it('should auto-generate requestId when not provided', async () => {
      const row = fakeAuditLogRow({ request_id: MOCK_UUID });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await logEvent({
        eventType: BusinessEventType.BUSINESS_CREATED,
        userId: 'user-id',
        businessId: 'business-id',
        ipAddress: '10.0.0.1',
      });

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params![5]).toBe(MOCK_UUID);
    });

    it('should default userAgent to empty string when not provided', async () => {
      const row = fakeAuditLogRow({ user_agent: '' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await logEvent({
        eventType: BusinessEventType.BUSINESS_SOFT_DELETED,
        userId: 'user-id',
        businessId: 'business-id',
        ipAddress: '10.0.0.1',
      });

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params![4]).toBe('');
    });

    it('should serialize previousValues and newValues as JSON', async () => {
      const previousValues = { name: 'Old Name' };
      const newValues = { name: 'New Name' };
      const row = fakeAuditLogRow({
        event_type: 'BUSINESS_UPDATED',
        previous_values: previousValues,
        new_values: newValues,
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await logEvent({
        eventType: BusinessEventType.BUSINESS_UPDATED,
        userId: 'user-id',
        businessId: 'business-id',
        ipAddress: '10.0.0.1',
        previousValues,
        newValues,
      });

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params![6]).toBe(JSON.stringify(previousValues));
      expect(params![7]).toBe(JSON.stringify(newValues));
    });

    it('should pass null for previousValues and newValues when not provided', async () => {
      const row = fakeAuditLogRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await logEvent({
        eventType: BusinessEventType.BUSINESS_EXPORTED,
        userId: 'user-id',
        businessId: 'business-id',
        ipAddress: '10.0.0.1',
      });

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params![6]).toBeNull();
      expect(params![7]).toBeNull();
    });

    it('should use provided requestId over auto-generated one', async () => {
      const row = fakeAuditLogRow({ request_id: 'my-custom-id' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await logEvent({
        eventType: BusinessEventType.BUSINESS_RESTORED,
        userId: 'user-id',
        businessId: 'business-id',
        ipAddress: '10.0.0.1',
        requestId: 'my-custom-id',
      });

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params![5]).toBe('my-custom-id');
    });
  });

  // ── getBusinessAuditHistory ────────────────────────────────────────────

  describe('getBusinessAuditHistory', () => {
    it('should query by business_id and return mapped logs', async () => {
      const rows = [
        fakeAuditLogRow({ created_at: new Date('2024-01-16T10:00:00Z') }),
        fakeAuditLogRow({ created_at: new Date('2024-01-15T10:00:00Z') }),
      ];
      mockQuery.mockResolvedValueOnce(pgResult(rows));

      const logs = await getBusinessAuditHistory('b1b2c3d4-e5f6-7890-abcd-ef1234567890');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('business_id = $1');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(params).toEqual(['b1b2c3d4-e5f6-7890-abcd-ef1234567890']);
      expect(logs).toHaveLength(2);
      expect(logs[0]!.businessId).toBe('b1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    it('should return empty array when no logs exist', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const logs = await getBusinessAuditHistory('no-logs-business');

      expect(logs).toEqual([]);
    });

    it('should add from date filter when provided', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));
      const from = new Date('2024-01-01T00:00:00Z');

      await getBusinessAuditHistory('biz-id', from);

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('created_at >= $2');
      expect(params).toEqual(['biz-id', from]);
    });

    it('should add to date filter when provided', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));
      const to = new Date('2024-12-31T23:59:59Z');

      await getBusinessAuditHistory('biz-id', undefined, to);

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('created_at <= $2');
      expect(params).toEqual(['biz-id', to]);
    });

    it('should add both from and to date filters when provided', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));
      const from = new Date('2024-01-01T00:00:00Z');
      const to = new Date('2024-06-30T23:59:59Z');

      await getBusinessAuditHistory('biz-id', from, to);

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('created_at >= $2');
      expect(sql).toContain('created_at <= $3');
      expect(params).toEqual(['biz-id', from, to]);
    });
  });

  // ── getUserAuditHistory ────────────────────────────────────────────────

  describe('getUserAuditHistory', () => {
    it('should query by user_id and return mapped logs', async () => {
      const rows = [fakeAuditLogRow()];
      mockQuery.mockResolvedValueOnce(pgResult(rows));

      const logs = await getUserAuditHistory('u1b2c3d4-e5f6-7890-abcd-ef1234567890');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('user_id = $1');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(params).toEqual(['u1b2c3d4-e5f6-7890-abcd-ef1234567890']);
      expect(logs).toHaveLength(1);
      expect(logs[0]!.userId).toBe('u1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    it('should return empty array when no logs exist for user', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const logs = await getUserAuditHistory('unknown-user');

      expect(logs).toEqual([]);
    });
  });

  // ── deleteBusinessAuditLogs ────────────────────────────────────────────

  describe('deleteBusinessAuditLogs', () => {
    it('should delete logs by business_id and return count', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 5,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      const count = await deleteBusinessAuditLogs('b1b2c3d4-e5f6-7890-abcd-ef1234567890');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM business_audit_logs');
      expect(sql).toContain('business_id = $1');
      expect(params).toEqual(['b1b2c3d4-e5f6-7890-abcd-ef1234567890']);
      expect(count).toBe(5);
    });

    it('should return 0 when no logs exist for business', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      const count = await deleteBusinessAuditLogs('no-logs-business');

      expect(count).toBe(0);
    });

    it('should return 0 when rowCount is null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: null,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      const count = await deleteBusinessAuditLogs('some-business');

      expect(count).toBe(0);
    });
  });
});
