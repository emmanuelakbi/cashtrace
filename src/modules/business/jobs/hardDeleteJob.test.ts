/**
 * Unit tests for the hard delete batch job.
 *
 * All repository and audit service calls are mocked so these tests run
 * without a live PostgreSQL connection. Tests verify:
 * - All pending businesses are processed
 * - Audit event is logged BEFORE deletion
 * - Audit logs are deleted before the business record
 * - Individual failures do not stop the batch
 * - Correct summary counts are returned
 * - Empty pending list is handled gracefully
 *
 * @module modules/business/jobs/hardDeleteJob.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake Business object with sensible defaults. */
function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: 'biz-001',
    userId: 'user-001',
    name: 'Test Business',
    sector: BusinessSector.OTHER,
    currency: Currency.NGN,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: new Date('2024-01-01T00:00:00Z'),
    hardDeleteAt: new Date('2024-01-31T00:00:00Z'),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFindPendingHardDelete.mockReset();
  mockHardDelete.mockReset();
  mockLogEvent.mockReset();
  mockDeleteBusinessAuditLogs.mockReset();
});

describe('processHardDeletes', () => {
  it('should process all pending hard deletes', async () => {
    const businesses = [
      makeBusiness({ id: 'biz-001', userId: 'user-001' }),
      makeBusiness({ id: 'biz-002', userId: 'user-002' }),
      makeBusiness({ id: 'biz-003', userId: 'user-003' }),
    ];
    mockFindPendingHardDelete.mockResolvedValueOnce(businesses);
    mockLogEvent.mockResolvedValue({});
    mockDeleteBusinessAuditLogs.mockResolvedValue(0);
    mockHardDelete.mockResolvedValue(undefined);

    const result = await processHardDeletes();

    expect(result.processed).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockHardDelete).toHaveBeenCalledTimes(3);
  });

  it('should log BUSINESS_HARD_DELETED event before deletion', async () => {
    const business = makeBusiness();
    mockFindPendingHardDelete.mockResolvedValueOnce([business]);
    mockLogEvent.mockResolvedValue({});
    mockDeleteBusinessAuditLogs.mockResolvedValue(0);
    mockHardDelete.mockResolvedValue(undefined);

    await processHardDeletes();

    expect(mockLogEvent).toHaveBeenCalledWith({
      eventType: BusinessEventType.BUSINESS_HARD_DELETED,
      userId: business.userId,
      businessId: business.id,
      ipAddress: 'system',
      previousValues: {
        id: business.id,
        name: business.name,
        sector: business.sector,
        currency: business.currency,
      },
    });

    // logEvent must be called before deleteBusinessAuditLogs and hardDelete
    const logOrder = mockLogEvent.mock.invocationCallOrder[0]!;
    const deleteLogsOrder = mockDeleteBusinessAuditLogs.mock.invocationCallOrder[0]!;
    const hardDeleteOrder = mockHardDelete.mock.invocationCallOrder[0]!;
    expect(logOrder).toBeLessThan(deleteLogsOrder);
    expect(logOrder).toBeLessThan(hardDeleteOrder);
  });

  it('should delete audit logs before business record', async () => {
    const business = makeBusiness();
    mockFindPendingHardDelete.mockResolvedValueOnce([business]);
    mockLogEvent.mockResolvedValue({});
    mockDeleteBusinessAuditLogs.mockResolvedValue(3);
    mockHardDelete.mockResolvedValue(undefined);

    await processHardDeletes();

    expect(mockDeleteBusinessAuditLogs).toHaveBeenCalledWith(business.id);
    expect(mockHardDelete).toHaveBeenCalledWith(business.id);

    const deleteLogsOrder = mockDeleteBusinessAuditLogs.mock.invocationCallOrder[0]!;
    const hardDeleteOrder = mockHardDelete.mock.invocationCallOrder[0]!;
    expect(deleteLogsOrder).toBeLessThan(hardDeleteOrder);
  });

  it('should continue processing when one business fails', async () => {
    const businesses = [
      makeBusiness({ id: 'biz-ok-1', userId: 'user-1' }),
      makeBusiness({ id: 'biz-fail', userId: 'user-2' }),
      makeBusiness({ id: 'biz-ok-2', userId: 'user-3' }),
    ];
    mockFindPendingHardDelete.mockResolvedValueOnce(businesses);
    mockLogEvent.mockResolvedValue({});
    mockDeleteBusinessAuditLogs
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce(0);
    mockHardDelete.mockResolvedValue(undefined);

    const result = await processHardDeletes();

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe('DB connection lost');
  });

  it('should return correct summary with processed and failed counts', async () => {
    const businesses = [
      makeBusiness({ id: 'biz-1' }),
      makeBusiness({ id: 'biz-2' }),
      makeBusiness({ id: 'biz-3' }),
    ];
    mockFindPendingHardDelete.mockResolvedValueOnce(businesses);
    mockLogEvent
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Audit write failed'))
      .mockResolvedValueOnce({});
    mockDeleteBusinessAuditLogs.mockResolvedValue(0);
    mockHardDelete.mockResolvedValue(undefined);

    const result = await processHardDeletes();

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe('Audit write failed');
  });

  it('should handle empty pending list gracefully', async () => {
    mockFindPendingHardDelete.mockResolvedValueOnce([]);

    const result = await processHardDeletes();

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockLogEvent).not.toHaveBeenCalled();
    expect(mockDeleteBusinessAuditLogs).not.toHaveBeenCalled();
    expect(mockHardDelete).not.toHaveBeenCalled();
  });

  it('should handle audit log deletion failure gracefully', async () => {
    const business = makeBusiness();
    mockFindPendingHardDelete.mockResolvedValueOnce([business]);
    mockLogEvent.mockResolvedValue({});
    mockDeleteBusinessAuditLogs.mockRejectedValueOnce(new Error('Cascade failed'));

    const result = await processHardDeletes();

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe('Cascade failed');
    // hardDelete should NOT have been called since audit log deletion failed
    expect(mockHardDelete).not.toHaveBeenCalled();
  });
});
