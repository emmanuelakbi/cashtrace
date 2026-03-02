import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AuditChanges } from './types.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockUuid = '00000000-0000-4000-a000-000000000001';
vi.mock('uuid', () => ({ v4: (): string => mockUuid }));

const mockQuery = vi.fn();
vi.mock('../utils/db.js', () => ({ query: mockQuery }));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAuditRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: mockUuid,
    transaction_id: 'txn-1',
    user_id: 'user-1',
    action: 'CREATE',
    changes: [],
    ip_address: '127.0.0.1',
    user_agent: null,
    created_at: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('auditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Lazy import so mocks are in place
  async function loadModule(): Promise<typeof import('./auditService.js')> {
    return import('./auditService.js');
  }

  describe('logCreate', () => {
    it('should insert a CREATE audit record and return mapped result', async () => {
      const row = makeAuditRow();
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      const { logCreate } = await loadModule();
      const result = await logCreate('txn-1', 'user-1', '127.0.0.1');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO transaction_audits');
      expect(params).toEqual([mockUuid, 'txn-1', 'user-1', 'CREATE', '[]', '127.0.0.1', null]);

      expect(result).toEqual({
        id: mockUuid,
        transactionId: 'txn-1',
        userId: 'user-1',
        action: 'CREATE',
        changes: [],
        ipAddress: '127.0.0.1',
        userAgent: null,
        createdAt: new Date('2024-01-15T10:00:00Z'),
      });
    });

    it('should pass userAgent when provided', async () => {
      const row = makeAuditRow({ user_agent: 'Mozilla/5.0' });
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      const { logCreate } = await loadModule();
      await logCreate('txn-1', 'user-1', '127.0.0.1', 'Mozilla/5.0');

      const params = (mockQuery.mock.calls[0] as [string, unknown[]])[1];
      expect(params?.[6]).toBe('Mozilla/5.0');
    });
  });

  describe('logUpdate', () => {
    it('should insert an UPDATE audit record with changes', async () => {
      const changes: AuditChanges[] = [
        { field: 'description', previousValue: 'Old desc', newValue: 'New desc' },
        { field: 'notes', previousValue: null, newValue: 'Added note' },
      ];
      const row = makeAuditRow({ action: 'UPDATE', changes });
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      const { logUpdate } = await loadModule();
      const result = await logUpdate('txn-1', 'user-1', changes, '10.0.0.1');

      const params = (mockQuery.mock.calls[0] as [string, unknown[]])[1];
      expect(params?.[3]).toBe('UPDATE');
      expect(params?.[4]).toBe(JSON.stringify(changes));
      expect(result.action).toBe('UPDATE');
      expect(result.changes).toEqual(changes);
    });
  });

  describe('logDelete', () => {
    it('should insert a DELETE audit record', async () => {
      const row = makeAuditRow({ action: 'DELETE' });
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      const { logDelete } = await loadModule();
      const result = await logDelete('txn-1', 'user-1', '192.168.1.1');

      const params = (mockQuery.mock.calls[0] as [string, unknown[]])[1];
      expect(params?.[3]).toBe('DELETE');
      expect(params?.[4]).toBe('[]');
      expect(result.action).toBe('DELETE');
    });
  });

  describe('logCategoryChange', () => {
    it('should insert a CATEGORIZE audit record with category changes', async () => {
      const expectedChanges: AuditChanges[] = [
        { field: 'category', previousValue: 'MISCELLANEOUS_EXPENSES', newValue: 'RENT_UTILITIES' },
      ];
      const row = makeAuditRow({ action: 'CATEGORIZE', changes: expectedChanges });
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      const { logCategoryChange } = await loadModule();
      const result = await logCategoryChange(
        'txn-1',
        'user-1',
        'MISCELLANEOUS_EXPENSES',
        'RENT_UTILITIES',
        '10.0.0.1',
      );

      const params = (mockQuery.mock.calls[0] as [string, unknown[]])[1];
      expect(params?.[3]).toBe('CATEGORIZE');
      expect(params?.[4]).toBe(JSON.stringify(expectedChanges));
      expect(result.action).toBe('CATEGORIZE');
      expect(result.changes).toEqual(expectedChanges);
    });
  });

  describe('logDuplicateResolve', () => {
    it('should insert a DUPLICATE_RESOLVE audit record with pair and action info', async () => {
      const expectedChanges: AuditChanges[] = [
        { field: 'duplicatePairId', previousValue: null, newValue: 'pair-1' },
        { field: 'resolutionAction', previousValue: null, newValue: 'KEEP_FIRST' },
      ];
      const row = makeAuditRow({ action: 'DUPLICATE_RESOLVE', changes: expectedChanges });
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      const { logDuplicateResolve } = await loadModule();
      const result = await logDuplicateResolve(
        'txn-1',
        'user-1',
        'pair-1',
        'KEEP_FIRST',
        '10.0.0.1',
        'TestAgent/1.0',
      );

      const params = (mockQuery.mock.calls[0] as [string, unknown[]])[1];
      expect(params?.[3]).toBe('DUPLICATE_RESOLVE');
      expect(params?.[4]).toBe(JSON.stringify(expectedChanges));
      expect(params?.[6]).toBe('TestAgent/1.0');
      expect(result.action).toBe('DUPLICATE_RESOLVE');
      expect(result.changes).toEqual(expectedChanges);
    });
  });

  describe('getAuditHistory', () => {
    it('should return audit records ordered by created_at DESC', async () => {
      const rows = [
        makeAuditRow({
          id: 'audit-2',
          action: 'UPDATE',
          changes: [{ field: 'description', previousValue: 'Old', newValue: 'New' }],
          created_at: new Date('2024-01-16T10:00:00Z'),
        }),
        makeAuditRow({
          id: 'audit-1',
          action: 'CREATE',
          created_at: new Date('2024-01-15T10:00:00Z'),
        }),
      ];
      mockQuery.mockResolvedValueOnce({ rows });

      const { getAuditHistory } = await loadModule();
      const result = await getAuditHistory('txn-1');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('FROM transaction_audits');
      expect(sql).toContain('WHERE transaction_id = $1');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(params).toEqual(['txn-1']);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'audit-2',
        transactionId: 'txn-1',
        userId: 'user-1',
        action: 'UPDATE',
        changes: [{ field: 'description', previousValue: 'Old', newValue: 'New' }],
        ipAddress: '127.0.0.1',
        userAgent: null,
        createdAt: new Date('2024-01-16T10:00:00Z'),
      });
      expect(result[1]?.action).toBe('CREATE');
    });

    it('should return an empty array when no audit records exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getAuditHistory } = await loadModule();
      const result = await getAuditHistory('txn-nonexistent');

      expect(result).toEqual([]);
      expect(mockQuery).toHaveBeenCalledOnce();
    });
  });

  describe('error handling', () => {
    it('should throw when the insert returns no rows', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { logCreate } = await loadModule();
      await expect(logCreate('txn-1', 'user-1', '127.0.0.1')).rejects.toThrow(
        'Failed to create audit record',
      );
    });
  });
});
