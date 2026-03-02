/**
 * Property-based tests for the single business per user constraint.
 *
 * **Property 4: Single Business Per User Constraint**
 * For any user who already has a business profile, attempting to create another
 * business SHALL fail with a validation error, and the user SHALL still have
 * exactly one business.
 *
 * **Validates: Requirements 1.3, 9.1, 9.3**
 *
 * Tag: Feature: business-management, Property 4: Single Business Per User Constraint
 *
 * @module modules/business/repositories/businessRepository.property.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

import { BusinessSector, Currency } from '../types/index.js';
import { BusinessRow } from './businessRepository.js';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

let mockQuery: (...args: unknown[]) => unknown;

vi.mock('../../../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate valid UUIDs for user IDs. */
const userIdArb = fc.uuid();

/** Generate valid business names (trimmed length 2-100). */
const validBusinessNameArb = fc
  .string({ minLength: 2, maxLength: 100 })
  .filter((s) => s.trim().length >= 2 && s.trim().length <= 100);

/** Generate a valid sector value. */
const sectorArb = fc.constantFrom(...Object.values(BusinessSector));

/**
 * Build a fake BusinessRow as PostgreSQL would return it.
 */
function makeFakeRow(userId: string, name: string, sector: BusinessSector): BusinessRow {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    name,
    sector,
    currency: Currency.NGN,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hard_delete_at: null,
  };
}

describe('Property 4: Single Business Per User Constraint', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /**
   * **Validates: Requirements 1.3, 9.1, 9.3**
   *
   * For any userId and valid business name, calling create twice with the same
   * userId should succeed on the first call and fail on the second call with a
   * PostgreSQL unique constraint violation (error code 23505).
   */
  it('should reject a second business creation for the same user with unique constraint error', async () => {
    const { create } = await import('./businessRepository.js');

    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validBusinessNameArb,
        validBusinessNameArb,
        sectorArb,
        async (userId, firstName, secondName, sector) => {
          const fakeRow = makeFakeRow(userId, firstName, sector);
          let callCount = 0;

          mockQuery = (): unknown => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({ rows: [fakeRow], rowCount: 1 });
            }
            // Second INSERT triggers unique constraint violation
            const dbError = Object.assign(
              new Error('duplicate key value violates unique constraint "businesses_user_id_key"'),
              { code: '23505', constraint: 'businesses_user_id_key' },
            );
            return Promise.reject(dbError);
          };

          // First creation succeeds
          const business = await create(userId, { name: firstName, sector });
          expect(business.userId).toBe(userId);
          expect(business.name).toBe(firstName);

          // Second creation fails with unique constraint violation
          await expect(create(userId, { name: secondName, sector })).rejects.toThrow(
            /duplicate key value violates unique constraint/,
          );
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 1.3, 9.1, 9.3**
   *
   * For any userId, after a successful create, querying findByUserId should
   * return exactly that one business — the user still has exactly one business.
   */
  it('should return exactly one business per user after creation', async () => {
    const { create, findByUserId } = await import('./businessRepository.js');

    await fc.assert(
      fc.asyncProperty(userIdArb, validBusinessNameArb, sectorArb, async (userId, name, sector) => {
        const fakeRow = makeFakeRow(userId, name, sector);

        mockQuery = (sql: unknown): unknown => {
          const sqlStr = String(sql);
          if (sqlStr.includes('INSERT INTO')) {
            return Promise.resolve({ rows: [fakeRow], rowCount: 1 });
          }
          if (sqlStr.includes('SELECT')) {
            // findByUserId returns the single created business
            return Promise.resolve({ rows: [fakeRow], rowCount: 1 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        };

        // Create the business
        const created = await create(userId, { name, sector });

        // Retrieve by userId — should return exactly that business
        const found = await findByUserId(userId);
        expect(found).not.toBeNull();
        expect(found!.id).toBe(created.id);
        expect(found!.userId).toBe(userId);
        expect(found!.name).toBe(name);
        expect(found!.sector).toBe(sector);
        expect(found!.currency).toBe(Currency.NGN);
      }),
      { numRuns: 100, verbose: true },
    );
  });
});
