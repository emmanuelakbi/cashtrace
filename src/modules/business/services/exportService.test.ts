/**
 * Unit tests for the export service.
 *
 * @module modules/business/services/exportService.test
 * @see Requirements 6.1, 6.2, 6.3, 6.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  type Business,
  type BusinessAuditLog,
  BUSINESS_ERROR_CODES,
  BusinessEventType,
  BusinessSector,
  Currency,
} from '../types/index.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../repositories/businessRepository.js', () => ({
  findByUserIdIncludeDeleted: vi.fn(),
}));

vi.mock('./auditService.js', () => ({
  getBusinessAuditHistory: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock('./businessService.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./businessService.js')>();
  return { BusinessError: original.BusinessError };
});

import * as businessRepository from '../repositories/businessRepository.js';
import * as auditService from './auditService.js';
import { BusinessError } from './businessService.js';
import { generateExport } from './exportService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_BUSINESS_ID = '22222222-2222-2222-2222-222222222222';

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: TEST_BUSINESS_ID,
    userId: TEST_USER_ID,
    name: 'Test Business',
    sector: BusinessSector.RETAIL_TRADING,
    currency: Currency.NGN,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    deletedAt: null,
    hardDeleteAt: null,
    ...overrides,
  };
}

function makeAuditLog(overrides: Partial<BusinessAuditLog> = {}): BusinessAuditLog {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    eventType: BusinessEventType.BUSINESS_CREATED,
    userId: TEST_USER_ID,
    businessId: TEST_BUSINESS_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    requestId: 'req-123',
    previousValues: null,
    newValues: { name: 'Test Business' },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

const defaultContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'test-agent',
  requestId: 'req-export-1',
};

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('generateExport', () => {
  it('should generate export for an active business', async () => {
    const business = makeBusiness();
    const auditLogs = [makeAuditLog()];

    vi.mocked(businessRepository.findByUserIdIncludeDeleted).mockResolvedValue(business);
    vi.mocked(auditService.getBusinessAuditHistory).mockResolvedValue(auditLogs);
    vi.mocked(auditService.logEvent).mockResolvedValue(
      makeAuditLog({
        eventType: BusinessEventType.BUSINESS_EXPORTED,
      }),
    );

    const result = await generateExport(TEST_USER_ID, defaultContext);

    expect(result.business).toEqual(business);
    expect(result.auditTrail).toEqual(auditLogs);
    expect(result.exportedAt).toBeInstanceOf(Date);
    expect(result.metadata.includesDeletedData).toBe(false);
    expect(result.metadata.version).toBe('1.0.0');
    expect(result.metadata.format).toBe('json');
  });

  it('should generate export for soft-deleted business within recovery window', async () => {
    const now = new Date();
    const futureDate = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); // 15 days out
    const business = makeBusiness({
      deletedAt: now,
      hardDeleteAt: futureDate,
    });
    const auditLogs = [
      makeAuditLog(),
      makeAuditLog({
        id: '44444444-4444-4444-4444-444444444444',
        eventType: BusinessEventType.BUSINESS_SOFT_DELETED,
      }),
    ];

    vi.mocked(businessRepository.findByUserIdIncludeDeleted).mockResolvedValue(business);
    vi.mocked(auditService.getBusinessAuditHistory).mockResolvedValue(auditLogs);
    vi.mocked(auditService.logEvent).mockResolvedValue(
      makeAuditLog({
        eventType: BusinessEventType.BUSINESS_EXPORTED,
      }),
    );

    const result = await generateExport(TEST_USER_ID, defaultContext);

    expect(result.business.deletedAt).toEqual(now);
    expect(result.metadata.includesDeletedData).toBe(true);
    expect(result.auditTrail).toHaveLength(2);
  });

  it('should throw NOT_FOUND when no business exists', async () => {
    vi.mocked(businessRepository.findByUserIdIncludeDeleted).mockResolvedValue(null);

    await expect(generateExport(TEST_USER_ID, defaultContext)).rejects.toThrow(BusinessError);
    await expect(generateExport(TEST_USER_ID, defaultContext)).rejects.toMatchObject({
      code: BUSINESS_ERROR_CODES.NOT_FOUND,
    });

    expect(auditService.logEvent).not.toHaveBeenCalled();
  });

  it('should include all audit trail entries', async () => {
    const business = makeBusiness();
    const auditLogs = [
      makeAuditLog({ id: 'log-1', eventType: BusinessEventType.BUSINESS_CREATED }),
      makeAuditLog({ id: 'log-2', eventType: BusinessEventType.BUSINESS_UPDATED }),
      makeAuditLog({ id: 'log-3', eventType: BusinessEventType.BUSINESS_UPDATED }),
    ];

    vi.mocked(businessRepository.findByUserIdIncludeDeleted).mockResolvedValue(business);
    vi.mocked(auditService.getBusinessAuditHistory).mockResolvedValue(auditLogs);
    vi.mocked(auditService.logEvent).mockResolvedValue(
      makeAuditLog({
        eventType: BusinessEventType.BUSINESS_EXPORTED,
      }),
    );

    const result = await generateExport(TEST_USER_ID, defaultContext);

    expect(result.auditTrail).toHaveLength(3);
    expect(result.auditTrail).toEqual(auditLogs);
  });

  it('should log BUSINESS_EXPORTED audit event', async () => {
    const business = makeBusiness();

    vi.mocked(businessRepository.findByUserIdIncludeDeleted).mockResolvedValue(business);
    vi.mocked(auditService.getBusinessAuditHistory).mockResolvedValue([]);
    vi.mocked(auditService.logEvent).mockResolvedValue(
      makeAuditLog({
        eventType: BusinessEventType.BUSINESS_EXPORTED,
      }),
    );

    await generateExport(TEST_USER_ID, defaultContext);

    expect(auditService.logEvent).toHaveBeenCalledOnce();
    expect(auditService.logEvent).toHaveBeenCalledWith({
      eventType: BusinessEventType.BUSINESS_EXPORTED,
      userId: TEST_USER_ID,
      businessId: TEST_BUSINESS_ID,
      ipAddress: defaultContext.ipAddress,
      userAgent: defaultContext.userAgent,
      requestId: defaultContext.requestId,
    });
  });

  it('should set correct metadata for active business', async () => {
    const business = makeBusiness();

    vi.mocked(businessRepository.findByUserIdIncludeDeleted).mockResolvedValue(business);
    vi.mocked(auditService.getBusinessAuditHistory).mockResolvedValue([]);
    vi.mocked(auditService.logEvent).mockResolvedValue(
      makeAuditLog({
        eventType: BusinessEventType.BUSINESS_EXPORTED,
      }),
    );

    const result = await generateExport(TEST_USER_ID, defaultContext);

    expect(result.metadata).toEqual({
      version: '1.0.0',
      format: 'json',
      includesDeletedData: false,
    });
  });
});
