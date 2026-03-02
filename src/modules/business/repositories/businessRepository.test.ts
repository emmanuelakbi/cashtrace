/**
 * Unit tests for the BusinessRepository module.
 *
 * All database calls are mocked via vi.mock so these tests run
 * without a live PostgreSQL connection. Tests verify:
 * - Correct SQL queries and parameters
 * - snake_case → camelCase row mapping
 * - Soft delete filtering behavior
 * - Dynamic SET clause construction for updates
 *
 * @module modules/business/repositories/businessRepository.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';
import { BusinessSector, Currency } from '../types/index.js';

// ─── Mock the db module ──────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mock is set up
const {
  create,
  findByUserId,
  findByUserIdIncludeDeleted,
  findById,
  update,
  mapRowToBusiness,
  softDelete,
  restore,
  hardDelete,
  findPendingHardDelete,
} = await import('./businessRepository.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake businesses-table row with sensible defaults. */
function fakeBusinessRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1b2c3d4-e5f6-7890-abcd-ef1234567890',
    user_id: 'u1b2c3d4-e5f6-7890-abcd-ef1234567890',
    name: 'Test Business',
    sector: 'OTHER',
    currency: 'NGN',
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
    deleted_at: null,
    hard_delete_at: null,
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

describe('businessRepository', () => {
  // ── mapRowToBusiness ─────────────────────────────────────────────────────

  describe('mapRowToBusiness', () => {
    it('should map snake_case row to camelCase Business object', () => {
      const row = fakeBusinessRow();
      const business = mapRowToBusiness(row);

      expect(business).toEqual({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        sector: BusinessSector.OTHER,
        currency: Currency.NGN,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: null,
        hardDeleteAt: null,
      });
    });

    it('should map soft-deleted row with timestamps', () => {
      const deletedAt = new Date('2024-06-01T12:00:00Z');
      const hardDeleteAt = new Date('2024-07-01T12:00:00Z');
      const row = fakeBusinessRow({
        deleted_at: deletedAt,
        hard_delete_at: hardDeleteAt,
      });

      const business = mapRowToBusiness(row);

      expect(business.deletedAt).toEqual(deletedAt);
      expect(business.hardDeleteAt).toEqual(hardDeleteAt);
    });

    it('should map all sector enum values correctly', () => {
      for (const sector of Object.values(BusinessSector)) {
        const row = fakeBusinessRow({ sector });
        const business = mapRowToBusiness(row);
        expect(business.sector).toBe(sector);
      }
    });

    it('should map all currency enum values correctly', () => {
      for (const currency of Object.values(Currency)) {
        const row = fakeBusinessRow({ currency });
        const business = mapRowToBusiness(row);
        expect(business.currency).toBe(currency);
      }
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should insert a business with defaults and return mapped Business', async () => {
      const row = fakeBusinessRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const business = await create('u1b2c3d4-e5f6-7890-abcd-ef1234567890', {
        name: 'Test Business',
      });

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO businesses');
      expect(params).toEqual([
        'u1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'Test Business',
        BusinessSector.OTHER,
        Currency.NGN,
      ]);
      expect(business.name).toBe('Test Business');
      expect(business.sector).toBe(BusinessSector.OTHER);
      expect(business.currency).toBe(Currency.NGN);
    });

    it('should use provided sector instead of default', async () => {
      const row = fakeBusinessRow({ sector: 'RETAIL_TRADING' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const business = await create('user-id', {
        name: 'My Shop',
        sector: BusinessSector.RETAIL_TRADING,
      });

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params![2]).toBe(BusinessSector.RETAIL_TRADING);
      expect(business.sector).toBe(BusinessSector.RETAIL_TRADING);
    });
  });

  // ── findByUserId ─────────────────────────────────────────────────────────

  describe('findByUserId', () => {
    it('should query with deleted_at IS NULL filter', async () => {
      const row = fakeBusinessRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await findByUserId('user-id');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE user_id = $1');
      expect(sql).toContain('deleted_at IS NULL');
      expect(params).toEqual(['user-id']);
    });

    it('should return mapped Business when found', async () => {
      const row = fakeBusinessRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const business = await findByUserId('user-id');

      expect(business).not.toBeNull();
      expect(business!.userId).toBe(row.user_id);
    });

    it('should return null when no business found', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const business = await findByUserId('nonexistent-user');

      expect(business).toBeNull();
    });
  });

  // ── findByUserIdIncludeDeleted ───────────────────────────────────────────

  describe('findByUserIdIncludeDeleted', () => {
    it('should query without deleted_at filter', async () => {
      const row = fakeBusinessRow({
        deleted_at: new Date(),
        hard_delete_at: new Date(),
      });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await findByUserIdIncludeDeleted('user-id');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE user_id = $1');
      expect(sql).not.toContain('deleted_at IS NULL');
      expect(params).toEqual(['user-id']);
    });

    it('should return soft-deleted business', async () => {
      const deletedAt = new Date('2024-06-01T12:00:00Z');
      const row = fakeBusinessRow({ deleted_at: deletedAt });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const business = await findByUserIdIncludeDeleted('user-id');

      expect(business).not.toBeNull();
      expect(business!.deletedAt).toEqual(deletedAt);
    });

    it('should return null when no business found', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const business = await findByUserIdIncludeDeleted('nonexistent-user');

      expect(business).toBeNull();
    });
  });

  // ── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should query by id with deleted_at IS NULL filter', async () => {
      const row = fakeBusinessRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await findById('business-id');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE id = $1');
      expect(sql).toContain('deleted_at IS NULL');
      expect(params).toEqual(['business-id']);
    });

    it('should return mapped Business when found', async () => {
      const row = fakeBusinessRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const business = await findById('business-id');

      expect(business).not.toBeNull();
      expect(business!.id).toBe(row.id);
    });

    it('should return null when no business matches', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const business = await findById('nonexistent-id');

      expect(business).toBeNull();
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should build SET clause for name only', async () => {
      const row = fakeBusinessRow({ name: 'Updated Name' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await update('business-id', { name: 'Updated Name' });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('name = $1');
      expect(sql).toContain('updated_at = NOW()');
      expect(sql).toContain('deleted_at IS NULL');
      expect(params).toEqual(['Updated Name', 'business-id']);
    });

    it('should build SET clause for sector only', async () => {
      const row = fakeBusinessRow({ sector: 'MANUFACTURING' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await update('business-id', { sector: BusinessSector.MANUFACTURING });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('sector = $1');
      expect(sql).toContain('updated_at = NOW()');
      expect(params).toEqual([BusinessSector.MANUFACTURING, 'business-id']);
    });

    it('should build SET clause for both name and sector', async () => {
      const row = fakeBusinessRow({ name: 'New Name', sector: 'RETAIL_TRADING' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await update('business-id', {
        name: 'New Name',
        sector: BusinessSector.RETAIL_TRADING,
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('name = $1');
      expect(sql).toContain('sector = $2');
      expect(sql).toContain('updated_at = NOW()');
      expect(params).toEqual(['New Name', BusinessSector.RETAIL_TRADING, 'business-id']);
    });

    it('should throw when business not found', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await expect(update('nonexistent-id', { name: 'Test' })).rejects.toThrow(
        'Business not found: nonexistent-id',
      );
    });
  });

  // ── softDelete ───────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('should update deleted_at and hard_delete_at for a non-deleted business', async () => {
      mockQuery.mockResolvedValueOnce({ ...pgResult([]), rowCount: 1 });

      await softDelete('business-id');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE businesses');
      expect(sql).toContain('deleted_at = NOW()');
      expect(sql).toContain("hard_delete_at = NOW() + INTERVAL '30 days'");
      expect(sql).toContain('updated_at = NOW()');
      expect(sql).toContain('WHERE id = $1 AND deleted_at IS NULL');
      expect(params).toEqual(['business-id']);
    });

    it('should throw when business not found or already deleted', async () => {
      mockQuery.mockResolvedValueOnce({ ...pgResult([]), rowCount: 0 });

      await expect(softDelete('nonexistent-id')).rejects.toThrow(
        'Business not found or already deleted: nonexistent-id',
      );
    });
  });

  // ── restore ──────────────────────────────────────────────────────────────

  describe('restore', () => {
    it('should clear deleted_at and hard_delete_at and return restored business', async () => {
      const row = fakeBusinessRow({ deleted_at: null, hard_delete_at: null });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const business = await restore('business-id');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE businesses');
      expect(sql).toContain('deleted_at = NULL');
      expect(sql).toContain('hard_delete_at = NULL');
      expect(sql).toContain('updated_at = NOW()');
      expect(sql).toContain('WHERE id = $1 AND deleted_at IS NOT NULL');
      expect(sql).toContain('RETURNING');
      expect(params).toEqual(['business-id']);
      expect(business.deletedAt).toBeNull();
      expect(business.hardDeleteAt).toBeNull();
    });

    it('should throw when business not found or not deleted', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await expect(restore('nonexistent-id')).rejects.toThrow(
        'Business not found or not deleted: nonexistent-id',
      );
    });
  });

  // ── hardDelete ───────────────────────────────────────────────────────────

  describe('hardDelete', () => {
    it('should execute DELETE query with the business id', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await hardDelete('business-id');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM businesses');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual(['business-id']);
    });
  });

  // ── findPendingHardDelete ────────────────────────────────────────────────

  describe('findPendingHardDelete', () => {
    it('should return businesses where hard_delete_at has passed', async () => {
      const pastDate = new Date('2024-01-01T00:00:00Z');
      const row1 = fakeBusinessRow({
        id: 'biz-1',
        deleted_at: pastDate,
        hard_delete_at: pastDate,
      });
      const row2 = fakeBusinessRow({
        id: 'biz-2',
        deleted_at: pastDate,
        hard_delete_at: pastDate,
      });
      mockQuery.mockResolvedValueOnce(pgResult([row1, row2]));

      const businesses = await findPendingHardDelete();

      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('hard_delete_at IS NOT NULL');
      expect(sql).toContain('hard_delete_at <= NOW()');
      expect(businesses).toHaveLength(2);
      expect(businesses[0]!.id).toBe('biz-1');
      expect(businesses[1]!.id).toBe('biz-2');
    });

    it('should return empty array when no businesses are pending hard delete', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const businesses = await findPendingHardDelete();

      expect(businesses).toEqual([]);
    });
  });
});
