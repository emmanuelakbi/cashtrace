/**
 * Property-based tests for Audit Trail Completeness
 *
 * **Property 23: Audit Trail Completeness**
 * For any audit operation (create, update, delete, category change, duplicate resolve):
 * 1. The returned audit record always has the correct action type
 * 2. The returned audit record always has the correct transactionId and userId
 * 3. logUpdate always includes the provided changes array
 * 4. logCategoryChange always includes a change entry for the 'category' field
 *    with correct previous/new values
 * 5. logDuplicateResolve always includes change entries for 'duplicatePairId'
 *    and 'resolutionAction'
 * 6. logCreate and logDelete always have empty changes arrays
 *
 * **Validates: Requirements 3.4, 4.5, 10.4, 11.3**
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import type { AuditAction, AuditChanges } from './types.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

let generatedUuid = '00000000-0000-4000-a000-000000000001';
vi.mock('uuid', () => ({
  v4: (): string => generatedUuid,
}));

const mockQuery = vi.fn();
vi.mock('../utils/db.js', () => ({ query: mockQuery }));

// ─── Generators ──────────────────────────────────────────────────────────────

const uuidArb = fc.uuid();

const ipArb = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

const userAgentArb = fc.option(fc.stringOf(fc.char(), { minLength: 1, maxLength: 50 }), {
  nil: undefined,
});

const categoryArb = fc.constantFrom(
  'INVENTORY_STOCK',
  'RENT_UTILITIES',
  'SALARIES_WAGES',
  'TRANSPORTATION_LOGISTICS',
  'MARKETING_ADVERTISING',
  'PROFESSIONAL_SERVICES',
  'EQUIPMENT_MAINTENANCE',
  'BANK_CHARGES_FEES',
  'TAXES_LEVIES',
  'MISCELLANEOUS_EXPENSES',
  'PRODUCT_SALES',
  'SERVICE_REVENUE',
  'OTHER_INCOME',
);

const auditChangeArb = fc.record({
  field: fc.stringOf(fc.char(), { minLength: 1, maxLength: 30 }),
  previousValue: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
  newValue: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
});

const changesArrayArb = fc.array(auditChangeArb, { minLength: 1, maxLength: 5 });

const duplicateActionArb = fc.constantFrom('KEEP_FIRST', 'KEEP_SECOND', 'NOT_DUPLICATE');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAuditRow(
  id: string,
  transactionId: string,
  userId: string,
  action: AuditAction,
  changes: AuditChanges[],
  ipAddress: string,
  userAgent: string | null,
): Record<string, unknown> {
  return {
    id,
    transaction_id: transactionId,
    user_id: userId,
    action,
    changes,
    ip_address: ipAddress,
    user_agent: userAgent,
    created_at: new Date(),
  };
}

async function loadModule(): Promise<typeof import('./auditService.js')> {
  return import('./auditService.js');
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 23: Audit Trail Completeness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logCreate produces a CREATE audit with correct transactionId, userId, and empty changes', async () => {
    const { logCreate } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        ipArb,
        userAgentArb,
        async (transactionId, userId, ip, userAgent) => {
          const row = makeAuditRow(
            generatedUuid,
            transactionId,
            userId,
            'CREATE',
            [],
            ip,
            userAgent ?? null,
          );
          mockQuery.mockResolvedValueOnce({ rows: [row] });

          const result = await logCreate(transactionId, userId, ip, userAgent);

          expect(result.action).toBe('CREATE');
          expect(result.transactionId).toBe(transactionId);
          expect(result.userId).toBe(userId);
          expect(result.ipAddress).toBe(ip);
          expect(result.changes).toEqual([]);
          expect(result.createdAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('logDelete produces a DELETE audit with correct transactionId, userId, and empty changes', async () => {
    const { logDelete } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        ipArb,
        userAgentArb,
        async (transactionId, userId, ip, userAgent) => {
          const row = makeAuditRow(
            generatedUuid,
            transactionId,
            userId,
            'DELETE',
            [],
            ip,
            userAgent ?? null,
          );
          mockQuery.mockResolvedValueOnce({ rows: [row] });

          const result = await logDelete(transactionId, userId, ip, userAgent);

          expect(result.action).toBe('DELETE');
          expect(result.transactionId).toBe(transactionId);
          expect(result.userId).toBe(userId);
          expect(result.ipAddress).toBe(ip);
          expect(result.changes).toEqual([]);
          expect(result.createdAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('logUpdate produces an UPDATE audit that preserves the provided changes with previous/new values', async () => {
    const { logUpdate } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        changesArrayArb,
        ipArb,
        userAgentArb,
        async (transactionId, userId, changes, ip, userAgent) => {
          const row = makeAuditRow(
            generatedUuid,
            transactionId,
            userId,
            'UPDATE',
            changes,
            ip,
            userAgent ?? null,
          );
          mockQuery.mockResolvedValueOnce({ rows: [row] });

          const result = await logUpdate(transactionId, userId, changes, ip, userAgent);

          expect(result.action).toBe('UPDATE');
          expect(result.transactionId).toBe(transactionId);
          expect(result.userId).toBe(userId);
          expect(result.changes).toEqual(changes);
          expect(result.changes.length).toBeGreaterThanOrEqual(1);
          for (const change of result.changes) {
            expect(change).toHaveProperty('field');
            expect(change).toHaveProperty('previousValue');
            expect(change).toHaveProperty('newValue');
          }
          expect(result.createdAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('logCategoryChange produces a CATEGORIZE audit with a category change entry containing previous/new values', async () => {
    const { logCategoryChange } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        categoryArb,
        categoryArb,
        ipArb,
        userAgentArb,
        async (transactionId, userId, prevCategory, newCategory, ip, userAgent) => {
          const expectedChanges: AuditChanges[] = [
            { field: 'category', previousValue: prevCategory, newValue: newCategory },
          ];
          const row = makeAuditRow(
            generatedUuid,
            transactionId,
            userId,
            'CATEGORIZE',
            expectedChanges,
            ip,
            userAgent ?? null,
          );
          mockQuery.mockResolvedValueOnce({ rows: [row] });

          const result = await logCategoryChange(
            transactionId,
            userId,
            prevCategory,
            newCategory,
            ip,
            userAgent,
          );

          expect(result.action).toBe('CATEGORIZE');
          expect(result.transactionId).toBe(transactionId);
          expect(result.userId).toBe(userId);
          expect(result.changes).toHaveLength(1);
          const categoryChange = result.changes[0]!;
          expect(categoryChange.field).toBe('category');
          expect(categoryChange.previousValue).toBe(prevCategory);
          expect(categoryChange.newValue).toBe(newCategory);
          expect(result.createdAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('logDuplicateResolve produces a DUPLICATE_RESOLVE audit with duplicatePairId and resolutionAction entries', async () => {
    const { logDuplicateResolve } = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        uuidArb,
        duplicateActionArb,
        ipArb,
        userAgentArb,
        async (transactionId, userId, pairId, action, ip, userAgent) => {
          const expectedChanges: AuditChanges[] = [
            { field: 'duplicatePairId', previousValue: null, newValue: pairId },
            { field: 'resolutionAction', previousValue: null, newValue: action },
          ];
          const row = makeAuditRow(
            generatedUuid,
            transactionId,
            userId,
            'DUPLICATE_RESOLVE',
            expectedChanges,
            ip,
            userAgent ?? null,
          );
          mockQuery.mockResolvedValueOnce({ rows: [row] });

          const result = await logDuplicateResolve(
            transactionId,
            userId,
            pairId,
            action,
            ip,
            userAgent,
          );

          expect(result.action).toBe('DUPLICATE_RESOLVE');
          expect(result.transactionId).toBe(transactionId);
          expect(result.userId).toBe(userId);
          expect(result.changes).toHaveLength(2);

          const pairChange = result.changes.find((c) => c.field === 'duplicatePairId');
          expect(pairChange).toBeDefined();
          expect(pairChange!.previousValue).toBeNull();
          expect(pairChange!.newValue).toBe(pairId);

          const actionChange = result.changes.find((c) => c.field === 'resolutionAction');
          expect(actionChange).toBeDefined();
          expect(actionChange!.previousValue).toBeNull();
          expect(actionChange!.newValue).toBe(action);

          expect(result.createdAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('every mutation operation passes the correct SQL parameters to the database', async () => {
    const mod = await loadModule();

    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        ipArb,
        userAgentArb,
        fc.constantFrom(
          'CREATE',
          'UPDATE',
          'DELETE',
          'CATEGORIZE',
          'DUPLICATE_RESOLVE',
        ) as fc.Arbitrary<AuditAction>,
        async (transactionId, userId, ip, userAgent, action) => {
          const row = makeAuditRow(
            generatedUuid,
            transactionId,
            userId,
            action,
            [],
            ip,
            userAgent ?? null,
          );
          mockQuery.mockResolvedValueOnce({ rows: [row] });

          switch (action) {
            case 'CREATE':
              await mod.logCreate(transactionId, userId, ip, userAgent);
              break;
            case 'UPDATE':
              await mod.logUpdate(transactionId, userId, [], ip, userAgent);
              break;
            case 'DELETE':
              await mod.logDelete(transactionId, userId, ip, userAgent);
              break;
            case 'CATEGORIZE':
              await mod.logCategoryChange(
                transactionId,
                userId,
                'RENT_UTILITIES',
                'SALARIES_WAGES',
                ip,
                userAgent,
              );
              break;
            case 'DUPLICATE_RESOLVE':
              await mod.logDuplicateResolve(
                transactionId,
                userId,
                'pair-id',
                'KEEP_FIRST',
                ip,
                userAgent,
              );
              break;
          }

          expect(mockQuery).toHaveBeenCalledOnce();
          const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
          expect(sql).toContain('INSERT INTO transaction_audits');
          expect(params![1]).toBe(transactionId);
          expect(params![2]).toBe(userId);
          expect(params![3]).toBe(action);
          expect(params![5]).toBe(ip);
          expect(params![6]).toBe(userAgent ?? null);

          mockQuery.mockClear();
        },
      ),
      { numRuns: 100 },
    );
  });
});
