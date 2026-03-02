/**
 * Property-based tests for the hard delete batch job.
 *
 * Property 9: Hard Delete Cascade
 * For any business where the current time is past hardDeleteAt, the hard delete
 * process SHALL permanently remove the business record AND all associated audit
 * log entries from the database.
 *
 * **Validates: Requirements 5.3, 5.6**
 *
 * @module modules/business/jobs/hardDeleteJob.property.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

import { Business, BusinessEventType, BusinessSector, Currency } from '../types/index.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFindPendingHardDelete = vi.fn();
const mockHardDelete = vi.fn();

vi.mock('../repositories/businessRepository.js', () => ({
  findPendingHardDelete: (...args: unknown[]) => mockFindPendingHardDelete(...args),
  hardDelete: (...args: unknown[]) => mockHardDelete(...args),
}));

const mockLogEvent = vi.fn();
const mockDeleteBusinessAuditLogs = vi.fn();

vi.mock('../services/auditService.js', () => ({
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
  deleteBusinessAuditLogs: (...args: unknown[]) => mockDeleteBusinessAuditLogs(...args),
}));

// Import after mocks
const { processHardDeletes } = await import('./hardDeleteJob.js');

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const sectorArb = fc.constantFrom(...Object.values(BusinessSector));
const currencyArb = fc.constantFrom(...Object.values(Currency));

/**
 * Generate a Business with hardDeleteAt in the past (expired recovery window).
 * The deletedAt is always 30 days before hardDeleteAt.
 */
const expiredBusinessArb: fc.Arbitrary<Business> = fc
  .record({
    id: fc.uuid(),
    userId: fc.uuid(),
    name: fc.string({ minLength: 2, maxLength: 100 }).filter((s) => s.trim().length >= 2),
    sector: sectorArb,
    currency: currencyArb,
    /** Days in the past that hardDeleteAt occurred (1–365) */
    daysExpired: fc.integer({ min: 1, max: 365 }),
  })
  .map(({ id, userId, name, sector, currency, daysExpired }) => {
    const now = new Date();
    const hardDeleteAt = new Date(now.getTime() - daysExpired * 24 * 60 * 60 * 1000);
    const deletedAt = new Date(hardDeleteAt.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      id,
      userId,
      name,
      sector,
      currency,
      createdAt: new Date(deletedAt.getTime() - 90 * 24 * 60 * 60 * 1000),
      updatedAt: deletedAt,
      deletedAt,
      hardDeleteAt,
    };
  });

/** Generate an array of 1–5 expired businesses with unique IDs. */
const expiredBusinessesArb = fc
  .array(expiredBusinessArb, { minLength: 1, maxLength: 5 })
  .map((businesses) => {
    // Ensure unique IDs by appending index suffix
    return businesses.map((b, i) => ({
      ...b,
      id: `${b.id.slice(0, -2)}${String(i).padStart(2, '0')}`,
    }));
  });

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFindPendingHardDelete.mockReset();
  mockHardDelete.mockReset();
  mockLogEvent.mockReset();
  mockDeleteBusinessAuditLogs.mockReset();
});

describe('Property 9: Hard Delete Cascade', () => {
  it('should permanently remove all expired businesses and their audit logs', async () => {
    await fc.assert(
      fc.asyncProperty(expiredBusinessesArb, async (businesses) => {
        // Reset mocks for each iteration
        mockFindPendingHardDelete.mockReset();
        mockHardDelete.mockReset();
        mockLogEvent.mockReset();
        mockDeleteBusinessAuditLogs.mockReset();

        // Arrange
        mockFindPendingHardDelete.mockResolvedValueOnce(businesses);
        mockLogEvent.mockResolvedValue({});
        mockDeleteBusinessAuditLogs.mockResolvedValue(0);
        mockHardDelete.mockResolvedValue(undefined);

        // Act
        const result = await processHardDeletes();

        // Assert: every business was hard-deleted
        expect(mockHardDelete).toHaveBeenCalledTimes(businesses.length);
        for (const biz of businesses) {
          expect(mockHardDelete).toHaveBeenCalledWith(biz.id);
        }

        // Assert: audit logs deleted for every business
        expect(mockDeleteBusinessAuditLogs).toHaveBeenCalledTimes(businesses.length);
        for (const biz of businesses) {
          expect(mockDeleteBusinessAuditLogs).toHaveBeenCalledWith(biz.id);
        }

        // Assert: summary counts are correct
        expect(result.processed).toBe(businesses.length);
        expect(result.failed).toBe(0);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it('should log BUSINESS_HARD_DELETED event before removing each business', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(expiredBusinessArb, { minLength: 1, maxLength: 3 }).map((businesses) =>
          businesses.map((b, i) => ({
            ...b,
            id: `${b.id.slice(0, -2)}${String(i).padStart(2, '0')}`,
          })),
        ),
        async (businesses) => {
          // Reset mocks for each iteration
          mockFindPendingHardDelete.mockReset();
          mockHardDelete.mockReset();
          mockLogEvent.mockReset();
          mockDeleteBusinessAuditLogs.mockReset();

          // Arrange
          mockFindPendingHardDelete.mockResolvedValueOnce(businesses);
          mockLogEvent.mockResolvedValue({});
          mockDeleteBusinessAuditLogs.mockResolvedValue(0);
          mockHardDelete.mockResolvedValue(undefined);

          // Act
          await processHardDeletes();

          // Assert: logEvent called with BUSINESS_HARD_DELETED for each business
          expect(mockLogEvent).toHaveBeenCalledTimes(businesses.length);
          for (const biz of businesses) {
            expect(mockLogEvent).toHaveBeenCalledWith(
              expect.objectContaining({
                eventType: BusinessEventType.BUSINESS_HARD_DELETED,
                userId: biz.userId,
                businessId: biz.id,
              }),
            );
          }

          // Assert: for each business, logEvent was called before
          // deleteBusinessAuditLogs and hardDelete
          for (let i = 0; i < businesses.length; i++) {
            const logOrder = mockLogEvent.mock.invocationCallOrder[i]!;
            const deleteLogsOrder = mockDeleteBusinessAuditLogs.mock.invocationCallOrder[i]!;
            const hardDeleteOrder = mockHardDelete.mock.invocationCallOrder[i]!;

            expect(logOrder).toBeLessThan(deleteLogsOrder);
            expect(logOrder).toBeLessThan(hardDeleteOrder);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
