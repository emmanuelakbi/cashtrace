/**
 * Unit tests for the ConsentRepository module.
 *
 * All database calls are mocked via vi.mock so these tests run
 * without a live PostgreSQL connection. Tests verify:
 * - Correct SQL queries and parameters
 * - snake_case → camelCase row mapping
 * - Null handling for optional fields (revokedAt)
 * - Consent creation with version tracking
 * - User consent lookup with ordering
 * - Consent revocation with idempotent guard
 *
 * @module repositories/consentRepository.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';

// ─── Mock the db module ──────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mock is set up
const { createConsent, findByUserId, revokeConsent } = await import('./consentRepository.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake consent_records row with sensible defaults. */
function fakeConsentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'consent-uuid-1234-5678-abcd-ef01234567',
    user_id: 'usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee',
    consent_type: 'TERMS_OF_SERVICE',
    consent_version: '1.0',
    ip_address: '192.168.1.1',
    user_agent: 'Mozilla/5.0 (Linux; Android 10)',
    granted_at: new Date('2024-07-15T10:00:00Z'),
    revoked_at: null,
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

describe('consentRepository', () => {
  // ── createConsent ──────────────────────────────────────────────────────

  describe('createConsent', () => {
    it('should insert a consent record and return the mapped ConsentRecord', async () => {
      const row = fakeConsentRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const record = await createConsent(
        'usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee',
        'TERMS_OF_SERVICE' as import('../types/index.js').ConsentType,
        '1.0',
        '192.168.1.1',
        'Mozilla/5.0 (Linux; Android 10)',
      );

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO consent_records');
      expect(sql).toContain('RETURNING');
      expect(params).toEqual([
        'usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee',
        'TERMS_OF_SERVICE',
        '1.0',
        '192.168.1.1',
        'Mozilla/5.0 (Linux; Android 10)',
      ]);

      // Verify camelCase mapping
      expect(record).toEqual({
        id: row.id,
        userId: row.user_id,
        consentType: row.consent_type,
        consentVersion: row.consent_version,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        grantedAt: row.granted_at,
        revokedAt: null,
      });
    });

    it('should pass all consent types correctly', async () => {
      const types = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'DATA_PROCESSING'] as const;

      for (const consentType of types) {
        mockQuery.mockReset();
        const row = fakeConsentRow({ consent_type: consentType });
        mockQuery.mockResolvedValueOnce(pgResult([row]));

        const record = await createConsent(
          'usr-id',
          consentType as import('../types/index.js').ConsentType,
          '2.0',
          '10.0.0.1',
          'TestAgent',
        );

        const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
        expect(params![1]).toBe(consentType);
        expect(record.consentType).toBe(consentType);
      }
    });

    it('should include all columns in the RETURNING clause', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([fakeConsentRow()]));

      await createConsent(
        'usr-id',
        'TERMS_OF_SERVICE' as import('../types/index.js').ConsentType,
        '1.0',
        '127.0.0.1',
        'Agent',
      );

      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('id');
      expect(sql).toContain('user_id');
      expect(sql).toContain('consent_type');
      expect(sql).toContain('consent_version');
      expect(sql).toContain('ip_address');
      expect(sql).toContain('user_agent');
      expect(sql).toContain('granted_at');
      expect(sql).toContain('revoked_at');
    });

    it('should track consent version for NDPR compliance', async () => {
      const row = fakeConsentRow({ consent_version: '3.1' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const record = await createConsent(
        'usr-id',
        'PRIVACY_POLICY' as import('../types/index.js').ConsentType,
        '3.1',
        '10.0.0.1',
        'Agent',
      );

      const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(params![2]).toBe('3.1');
      expect(record.consentVersion).toBe('3.1');
    });
  });

  // ── findByUserId ───────────────────────────────────────────────────────

  describe('findByUserId', () => {
    it('should query by user_id and order by granted_at DESC', async () => {
      const row = fakeConsentRow();
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      await findByUserId('usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE user_id = $1');
      expect(sql).toContain('ORDER BY granted_at DESC');
      expect(params).toEqual(['usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee']);
    });

    it('should return mapped ConsentRecord array for multiple records', async () => {
      const row1 = fakeConsentRow({
        id: 'consent-1',
        consent_type: 'TERMS_OF_SERVICE',
        granted_at: new Date('2024-07-15T10:00:00Z'),
      });
      const row2 = fakeConsentRow({
        id: 'consent-2',
        consent_type: 'PRIVACY_POLICY',
        granted_at: new Date('2024-07-15T10:01:00Z'),
      });
      mockQuery.mockResolvedValueOnce(pgResult([row2, row1]));

      const records = await findByUserId('usr-uuid-aaaa-bbbb-cccc-ddddeeeeeeee');

      expect(records).toHaveLength(2);
      expect(records[0]!.id).toBe('consent-2');
      expect(records[0]!.consentType).toBe('PRIVACY_POLICY');
      expect(records[1]!.id).toBe('consent-1');
      expect(records[1]!.consentType).toBe('TERMS_OF_SERVICE');
    });

    it('should return an empty array when no consent records exist', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      const records = await findByUserId('usr-uuid-no-consents');

      expect(records).toEqual([]);
    });

    it('should include both active and revoked consent records', async () => {
      const activeRow = fakeConsentRow({ id: 'active-consent', revoked_at: null });
      const revokedRow = fakeConsentRow({
        id: 'revoked-consent',
        revoked_at: new Date('2024-07-20T08:00:00Z'),
      });
      mockQuery.mockResolvedValueOnce(pgResult([activeRow, revokedRow]));

      const records = await findByUserId('usr-uuid-aaaa');

      expect(records).toHaveLength(2);
      expect(records[0]!.revokedAt).toBeNull();
      expect(records[1]!.revokedAt).toEqual(new Date('2024-07-20T08:00:00Z'));
    });
  });

  // ── revokeConsent ──────────────────────────────────────────────────────

  describe('revokeConsent', () => {
    it('should update revoked_at for the given consent record', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await revokeConsent('consent-uuid-1234');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE consent_records');
      expect(sql).toContain('SET revoked_at = NOW()');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual(['consent-uuid-1234']);
    });

    it('should only revoke non-revoked records (idempotent guard)', async () => {
      mockQuery.mockResolvedValueOnce(pgResult([]));

      await revokeConsent('consent-already-revoked');

      const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('AND revoked_at IS NULL');
    });
  });

  // ── Row mapping edge cases ─────────────────────────────────────────────

  describe('row mapping', () => {
    it('should handle null revokedAt for active consent records', async () => {
      const row = fakeConsentRow({ revoked_at: null });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const records = await findByUserId('usr-id');

      expect(records[0]!.revokedAt).toBeNull();
    });

    it('should handle populated revokedAt for revoked consent records', async () => {
      const revokedAt = new Date('2024-08-01T12:00:00Z');
      const row = fakeConsentRow({ revoked_at: revokedAt });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const records = await findByUserId('usr-id');

      expect(records[0]!.revokedAt).toEqual(revokedAt);
    });

    it('should correctly map all Date fields', async () => {
      const grantedAt = new Date('2024-07-25T12:00:00Z');
      const revokedAt = new Date('2024-08-01T00:00:00Z');
      const row = fakeConsentRow({ granted_at: grantedAt, revoked_at: revokedAt });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const records = await findByUserId('usr-id');

      expect(records[0]!.grantedAt).toEqual(grantedAt);
      expect(records[0]!.revokedAt).toEqual(revokedAt);
    });

    it('should map consent_type string to ConsentType enum value', async () => {
      const row = fakeConsentRow({ consent_type: 'DATA_PROCESSING' });
      mockQuery.mockResolvedValueOnce(pgResult([row]));

      const records = await findByUserId('usr-id');

      expect(records[0]!.consentType).toBe('DATA_PROCESSING');
    });
  });
});
