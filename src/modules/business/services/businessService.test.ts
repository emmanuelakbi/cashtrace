/**
 * Unit tests for the business service createBusiness function.
 *
 * Mocks the repository and audit service to test business logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  BusinessSector,
  BusinessEventType,
  Currency,
  BUSINESS_ERROR_CODES,
} from '../types/index.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../repositories/businessRepository.js', () => ({
  create: vi.fn(),
  findByUserId: vi.fn(),
  findByUserIdIncludeDeleted: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  hardDelete: vi.fn(),
  findPendingHardDelete: vi.fn(),
}));

vi.mock('./auditService.js', () => ({
  logEvent: vi.fn(),
  getBusinessAuditHistory: vi.fn(),
  getUserAuditHistory: vi.fn(),
  deleteBusinessAuditLogs: vi.fn(),
}));

import * as businessRepository from '../repositories/businessRepository.js';
import * as auditService from './auditService.js';
import {
  createBusiness,
  getBusinessById,
  getBusinessByUserId,
  updateBusiness,
  softDeleteBusiness,
  restoreBusiness,
  BusinessError,
} from './businessService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockRepo = vi.mocked(businessRepository);
const mockAudit = vi.mocked(auditService);

const defaultContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'test-agent',
  requestId: 'req-123',
};

function makeBusiness(
  overrides: Partial<import('../types/index.js').Business> = {},
): import('../types/index.js').Business {
  return {
    id: 'biz-001',
    userId: 'user-001',
    name: 'Test Business',
    sector: BusinessSector.OTHER,
    currency: Currency.NGN,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    deletedAt: null,
    hardDeleteAt: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createBusiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a business with valid name and default sector/currency', async () => {
    const business = makeBusiness();
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue(business);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    const result = await createBusiness('user-001', { name: 'Test Business' }, defaultContext);

    expect(result).toEqual(business);
    expect(mockRepo.create).toHaveBeenCalledWith('user-001', {
      name: 'Test Business',
      sector: BusinessSector.OTHER,
    });
  });

  it('should create a business with an explicit sector', async () => {
    const business = makeBusiness({ sector: BusinessSector.RETAIL_TRADING });
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue(business);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    const result = await createBusiness(
      'user-001',
      { name: 'Test Business', sector: BusinessSector.RETAIL_TRADING },
      defaultContext,
    );

    expect(result.sector).toBe(BusinessSector.RETAIL_TRADING);
    expect(mockRepo.create).toHaveBeenCalledWith('user-001', {
      name: 'Test Business',
      sector: BusinessSector.RETAIL_TRADING,
    });
  });

  it('should trim whitespace from the business name', async () => {
    const business = makeBusiness({ name: 'Trimmed Name' });
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue(business);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    await createBusiness('user-001', { name: '  Trimmed Name  ' }, defaultContext);

    expect(mockRepo.create).toHaveBeenCalledWith('user-001', {
      name: 'Trimmed Name',
      sector: BusinessSector.OTHER,
    });
  });

  it('should log a BUSINESS_CREATED audit event', async () => {
    const business = makeBusiness();
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue(business);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    await createBusiness('user-001', { name: 'Test Business' }, defaultContext);

    expect(mockAudit.logEvent).toHaveBeenCalledWith({
      eventType: BusinessEventType.BUSINESS_CREATED,
      userId: 'user-001',
      businessId: 'biz-001',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      requestId: 'req-123',
      newValues: {
        id: 'biz-001',
        name: 'Test Business',
        sector: BusinessSector.OTHER,
        currency: Currency.NGN,
      },
    });
  });

  it('should throw INVALID_NAME for a name that is too short', async () => {
    await expect(createBusiness('user-001', { name: 'A' }, defaultContext)).rejects.toThrow(
      BusinessError,
    );

    try {
      await createBusiness('user-001', { name: 'A' }, defaultContext);
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.INVALID_NAME);
      expect(bizError.fields).toHaveProperty('name');
    }
  });

  it('should throw INVALID_NAME for an empty name', async () => {
    await expect(createBusiness('user-001', { name: '' }, defaultContext)).rejects.toThrow(
      BusinessError,
    );

    try {
      await createBusiness('user-001', { name: '' }, defaultContext);
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.INVALID_NAME);
    }
  });

  it('should throw INVALID_SECTOR for an invalid sector value', async () => {
    await expect(
      createBusiness(
        'user-001',
        { name: 'Valid Name', sector: 'INVALID_SECTOR' as BusinessSector },
        defaultContext,
      ),
    ).rejects.toThrow(BusinessError);

    try {
      await createBusiness(
        'user-001',
        { name: 'Valid Name', sector: 'INVALID_SECTOR' as BusinessSector },
        defaultContext,
      );
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.INVALID_SECTOR);
      expect(bizError.fields).toHaveProperty('sector');
    }
  });

  it('should throw ALREADY_EXISTS when user already has a business', async () => {
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(makeBusiness());

    await expect(
      createBusiness('user-001', { name: 'New Business' }, defaultContext),
    ).rejects.toThrow(BusinessError);

    try {
      await createBusiness('user-001', { name: 'New Business' }, defaultContext);
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.ALREADY_EXISTS);
    }
  });

  it('should throw ALREADY_EXISTS even when existing business is soft-deleted', async () => {
    const deletedBusiness = makeBusiness({
      deletedAt: new Date(),
      hardDeleteAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(deletedBusiness);

    await expect(
      createBusiness('user-001', { name: 'New Business' }, defaultContext),
    ).rejects.toThrow(BusinessError);

    try {
      await createBusiness('user-001', { name: 'New Business' }, defaultContext);
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.ALREADY_EXISTS);
    }
  });

  it('should not call repository create when validation fails', async () => {
    try {
      await createBusiness('user-001', { name: 'A' }, defaultContext);
    } catch {
      // expected
    }

    expect(mockRepo.create).not.toHaveBeenCalled();
    expect(mockRepo.findByUserIdIncludeDeleted).not.toHaveBeenCalled();
  });

  it('should not call audit service when duplicate check fails', async () => {
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(makeBusiness());

    try {
      await createBusiness('user-001', { name: 'New Business' }, defaultContext);
    } catch {
      // expected
    }

    expect(mockRepo.create).not.toHaveBeenCalled();
    expect(mockAudit.logEvent).not.toHaveBeenCalled();
  });
});

// ─── getBusinessByUserId Tests ───────────────────────────────────────────────

describe('getBusinessByUserId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the business for a valid user', async () => {
    const business = makeBusiness();
    mockRepo.findByUserId.mockResolvedValue(business);

    const result = await getBusinessByUserId('user-001');

    expect(result).toEqual(business);
    expect(mockRepo.findByUserId).toHaveBeenCalledWith('user-001');
  });

  it('should return null when user has no business', async () => {
    mockRepo.findByUserId.mockResolvedValue(null);

    const result = await getBusinessByUserId('user-999');

    expect(result).toBeNull();
    expect(mockRepo.findByUserId).toHaveBeenCalledWith('user-999');
  });

  it('should return null when business is soft-deleted (repository excludes it)', async () => {
    mockRepo.findByUserId.mockResolvedValue(null);

    const result = await getBusinessByUserId('user-001');

    expect(result).toBeNull();
  });
});

// ─── getBusinessById Tests ───────────────────────────────────────────────────

describe('getBusinessById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the business when ID and ownership match', async () => {
    const business = makeBusiness();
    mockRepo.findById.mockResolvedValue(business);

    const result = await getBusinessById('biz-001', 'user-001');

    expect(result).toEqual(business);
    expect(mockRepo.findById).toHaveBeenCalledWith('biz-001');
  });

  it('should throw NOT_FOUND when business does not exist', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(getBusinessById('biz-999', 'user-001')).rejects.toThrow(BusinessError);

    try {
      await getBusinessById('biz-999', 'user-001');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.NOT_FOUND);
      expect(bizError.message).toBe('Business not found');
    }
  });

  it('should throw FORBIDDEN when user does not own the business', async () => {
    const business = makeBusiness({ userId: 'user-001' });
    mockRepo.findById.mockResolvedValue(business);

    await expect(getBusinessById('biz-001', 'user-other')).rejects.toThrow(BusinessError);

    try {
      await getBusinessById('biz-001', 'user-other');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.FORBIDDEN);
      expect(bizError.message).toBe('User does not own this business');
    }
  });

  it('should throw NOT_FOUND for soft-deleted business (repository excludes it)', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(getBusinessById('biz-001', 'user-001')).rejects.toThrow(BusinessError);

    try {
      await getBusinessById('biz-001', 'user-001');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.NOT_FOUND);
    }
  });

  it('should include all business fields in the returned object', async () => {
    const business = makeBusiness({
      id: 'biz-full',
      userId: 'user-001',
      name: 'Full Business',
      sector: BusinessSector.TECHNOLOGY_DIGITAL,
      currency: Currency.NGN,
      createdAt: new Date('2024-06-01'),
      updatedAt: new Date('2024-06-15'),
    });
    mockRepo.findById.mockResolvedValue(business);

    const result = await getBusinessById('biz-full', 'user-001');

    expect(result.id).toBe('biz-full');
    expect(result.name).toBe('Full Business');
    expect(result.sector).toBe(BusinessSector.TECHNOLOGY_DIGITAL);
    expect(result.currency).toBe(Currency.NGN);
    expect(result.createdAt).toEqual(new Date('2024-06-01'));
    expect(result.updatedAt).toEqual(new Date('2024-06-15'));
  });
});

// ─── updateBusiness Tests ────────────────────────────────────────────────────

describe('updateBusiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update name only', async () => {
    const existing = makeBusiness({ name: 'Old Name' });
    const updated = makeBusiness({ name: 'New Name', updatedAt: new Date('2024-02-01') });
    mockRepo.findById.mockResolvedValue(existing);
    mockRepo.update.mockResolvedValue(updated);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    const result = await updateBusiness(
      'biz-001',
      'user-001',
      { name: 'New Name' },
      defaultContext,
    );

    expect(result.name).toBe('New Name');
    expect(mockRepo.update).toHaveBeenCalledWith('biz-001', { name: 'New Name' });
  });

  it('should update sector only', async () => {
    const existing = makeBusiness({ sector: BusinessSector.OTHER });
    const updated = makeBusiness({ sector: BusinessSector.RETAIL_TRADING });
    mockRepo.findById.mockResolvedValue(existing);
    mockRepo.update.mockResolvedValue(updated);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    const result = await updateBusiness(
      'biz-001',
      'user-001',
      { sector: BusinessSector.RETAIL_TRADING },
      defaultContext,
    );

    expect(result.sector).toBe(BusinessSector.RETAIL_TRADING);
    expect(mockRepo.update).toHaveBeenCalledWith('biz-001', {
      sector: BusinessSector.RETAIL_TRADING,
    });
  });

  it('should update both name and sector', async () => {
    const existing = makeBusiness({ name: 'Old Name', sector: BusinessSector.OTHER });
    const updated = makeBusiness({
      name: 'New Name',
      sector: BusinessSector.TECHNOLOGY_DIGITAL,
      updatedAt: new Date('2024-02-01'),
    });
    mockRepo.findById.mockResolvedValue(existing);
    mockRepo.update.mockResolvedValue(updated);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    const result = await updateBusiness(
      'biz-001',
      'user-001',
      { name: 'New Name', sector: BusinessSector.TECHNOLOGY_DIGITAL },
      defaultContext,
    );

    expect(result.name).toBe('New Name');
    expect(result.sector).toBe(BusinessSector.TECHNOLOGY_DIGITAL);
    expect(mockRepo.update).toHaveBeenCalledWith('biz-001', {
      name: 'New Name',
      sector: BusinessSector.TECHNOLOGY_DIGITAL,
    });
  });

  it('should log audit event with previous and new values', async () => {
    const existing = makeBusiness({ name: 'Old Name', sector: BusinessSector.OTHER });
    const updated = makeBusiness({
      name: 'New Name',
      sector: BusinessSector.MANUFACTURING,
    });
    mockRepo.findById.mockResolvedValue(existing);
    mockRepo.update.mockResolvedValue(updated);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    await updateBusiness(
      'biz-001',
      'user-001',
      { name: 'New Name', sector: BusinessSector.MANUFACTURING },
      defaultContext,
    );

    expect(mockAudit.logEvent).toHaveBeenCalledWith({
      eventType: BusinessEventType.BUSINESS_UPDATED,
      userId: 'user-001',
      businessId: 'biz-001',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      requestId: 'req-123',
      previousValues: { name: 'Old Name', sector: BusinessSector.OTHER },
      newValues: { name: 'New Name', sector: BusinessSector.MANUFACTURING },
    });
  });

  it('should throw FORBIDDEN when user does not own the business', async () => {
    const existing = makeBusiness({ userId: 'user-001' });
    mockRepo.findById.mockResolvedValue(existing);

    try {
      await updateBusiness('biz-001', 'user-other', { name: 'Hacked' }, defaultContext);
      expect.fail('Expected BusinessError to be thrown');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.FORBIDDEN);
      expect(bizError.message).toBe('User does not own this business');
    }

    expect(mockRepo.update).not.toHaveBeenCalled();
    expect(mockAudit.logEvent).not.toHaveBeenCalled();
  });

  it('should throw NOT_FOUND when business does not exist', async () => {
    mockRepo.findById.mockResolvedValue(null);

    try {
      await updateBusiness('biz-999', 'user-001', { name: 'New Name' }, defaultContext);
      expect.fail('Expected BusinessError to be thrown');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.NOT_FOUND);
      expect(bizError.message).toBe('Business not found');
    }

    expect(mockRepo.update).not.toHaveBeenCalled();
    expect(mockAudit.logEvent).not.toHaveBeenCalled();
  });

  it('should throw INVALID_NAME for a name that is too short', async () => {
    const existing = makeBusiness();
    mockRepo.findById.mockResolvedValue(existing);

    try {
      await updateBusiness('biz-001', 'user-001', { name: 'A' }, defaultContext);
      expect.fail('Expected BusinessError to be thrown');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.INVALID_NAME);
      expect(bizError.fields).toHaveProperty('name');
    }

    expect(mockRepo.update).not.toHaveBeenCalled();
    expect(mockAudit.logEvent).not.toHaveBeenCalled();
  });

  it('should throw INVALID_SECTOR for an invalid sector value', async () => {
    const existing = makeBusiness();
    mockRepo.findById.mockResolvedValue(existing);

    try {
      await updateBusiness(
        'biz-001',
        'user-001',
        { sector: 'INVALID_SECTOR' as BusinessSector },
        defaultContext,
      );
      expect.fail('Expected BusinessError to be thrown');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.INVALID_SECTOR);
      expect(bizError.fields).toHaveProperty('sector');
    }

    expect(mockRepo.update).not.toHaveBeenCalled();
    expect(mockAudit.logEvent).not.toHaveBeenCalled();
  });

  it('should trim whitespace from the business name on update', async () => {
    const existing = makeBusiness({ name: 'Old Name' });
    const updated = makeBusiness({ name: 'Trimmed Name' });
    mockRepo.findById.mockResolvedValue(existing);
    mockRepo.update.mockResolvedValue(updated);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    await updateBusiness('biz-001', 'user-001', { name: '  Trimmed Name  ' }, defaultContext);

    expect(mockRepo.update).toHaveBeenCalledWith('biz-001', { name: 'Trimmed Name' });
  });
});

// ─── softDeleteBusiness Tests ────────────────────────────────────────────────

describe('softDeleteBusiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should soft delete a business owned by the user', async () => {
    const business = makeBusiness();
    mockRepo.findById.mockResolvedValue(business);
    mockRepo.softDelete.mockResolvedValue(undefined);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    await softDeleteBusiness('biz-001', 'user-001', defaultContext);

    expect(mockRepo.softDelete).toHaveBeenCalledWith('biz-001');
  });

  it('should log BUSINESS_SOFT_DELETED audit event with previous values', async () => {
    const business = makeBusiness({
      name: 'My Business',
      sector: BusinessSector.RETAIL_TRADING,
      currency: Currency.NGN,
    });
    mockRepo.findById.mockResolvedValue(business);
    mockRepo.softDelete.mockResolvedValue(undefined);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    await softDeleteBusiness('biz-001', 'user-001', defaultContext);

    expect(mockAudit.logEvent).toHaveBeenCalledWith({
      eventType: BusinessEventType.BUSINESS_SOFT_DELETED,
      userId: 'user-001',
      businessId: 'biz-001',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      requestId: 'req-123',
      previousValues: {
        id: 'biz-001',
        name: 'My Business',
        sector: BusinessSector.RETAIL_TRADING,
        currency: Currency.NGN,
      },
    });
  });

  it('should throw NOT_FOUND when business does not exist', async () => {
    mockRepo.findById.mockResolvedValue(null);

    try {
      await softDeleteBusiness('biz-999', 'user-001', defaultContext);
      expect.fail('Expected BusinessError to be thrown');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.NOT_FOUND);
      expect(bizError.message).toBe('Business not found');
    }

    expect(mockRepo.softDelete).not.toHaveBeenCalled();
    expect(mockAudit.logEvent).not.toHaveBeenCalled();
  });

  it('should throw FORBIDDEN when user does not own the business', async () => {
    const business = makeBusiness({ userId: 'user-001' });
    mockRepo.findById.mockResolvedValue(business);

    try {
      await softDeleteBusiness('biz-001', 'user-other', defaultContext);
      expect.fail('Expected BusinessError to be thrown');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.FORBIDDEN);
      expect(bizError.message).toBe('User does not own this business');
    }

    expect(mockRepo.softDelete).not.toHaveBeenCalled();
    expect(mockAudit.logEvent).not.toHaveBeenCalled();
  });

  it('should not call audit service when ownership check fails', async () => {
    const business = makeBusiness({ userId: 'user-001' });
    mockRepo.findById.mockResolvedValue(business);

    try {
      await softDeleteBusiness('biz-001', 'user-other', defaultContext);
    } catch {
      // expected
    }

    expect(mockRepo.softDelete).not.toHaveBeenCalled();
    expect(mockAudit.logEvent).not.toHaveBeenCalled();
  });
});

// ─── restoreBusiness Tests ───────────────────────────────────────────────────

describe('restoreBusiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should restore a soft-deleted business within recovery window', async () => {
    const now = new Date();
    const deletedBusiness = makeBusiness({
      deletedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      hardDeleteAt: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
    });
    const restoredBusiness = makeBusiness({ deletedAt: null, hardDeleteAt: null });
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(deletedBusiness);
    mockRepo.restore.mockResolvedValue(restoredBusiness);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    const result = await restoreBusiness('biz-001', 'user-001', defaultContext);

    expect(result).toEqual(restoredBusiness);
    expect(mockRepo.restore).toHaveBeenCalledWith('biz-001');
  });

  it('should log BUSINESS_RESTORED audit event with previous and new values', async () => {
    const deletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const hardDeleteAt = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
    const deletedBusiness = makeBusiness({ deletedAt, hardDeleteAt });
    const restoredBusiness = makeBusiness({ deletedAt: null, hardDeleteAt: null });
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(deletedBusiness);
    mockRepo.restore.mockResolvedValue(restoredBusiness);
    mockAudit.logEvent.mockResolvedValue({} as import('../types/index.js').BusinessAuditLog);

    await restoreBusiness('biz-001', 'user-001', defaultContext);

    expect(mockAudit.logEvent).toHaveBeenCalledWith({
      eventType: BusinessEventType.BUSINESS_RESTORED,
      userId: 'user-001',
      businessId: 'biz-001',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      requestId: 'req-123',
      previousValues: {
        deletedAt: deletedAt.toISOString(),
        hardDeleteAt: hardDeleteAt.toISOString(),
      },
      newValues: {
        deletedAt: null,
        hardDeleteAt: null,
      },
    });
  });

  it('should throw NOT_FOUND when no business exists for the user', async () => {
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(null);

    try {
      await restoreBusiness('biz-001', 'user-001', defaultContext);
      expect.fail('Expected BusinessError to be thrown');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.NOT_FOUND);
      expect(bizError.message).toBe('Business not found');
    }

    expect(mockRepo.restore).not.toHaveBeenCalled();
    expect(mockAudit.logEvent).not.toHaveBeenCalled();
  });

  it('should throw NOT_FOUND when business ID does not match', async () => {
    const business = makeBusiness({ id: 'biz-other' });
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(business);

    try {
      await restoreBusiness('biz-001', 'user-001', defaultContext);
      expect.fail('Expected BusinessError to be thrown');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.NOT_FOUND);
    }

    expect(mockRepo.restore).not.toHaveBeenCalled();
  });

  it('should throw NOT_FOUND when business is not soft-deleted', async () => {
    const activeBusiness = makeBusiness({ deletedAt: null, hardDeleteAt: null });
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(activeBusiness);

    try {
      await restoreBusiness('biz-001', 'user-001', defaultContext);
      expect.fail('Expected BusinessError to be thrown');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.NOT_FOUND);
      expect(bizError.message).toBe('Business is not deleted');
    }

    expect(mockRepo.restore).not.toHaveBeenCalled();
  });

  it('should throw RECOVERY_EXPIRED when recovery window has passed', async () => {
    const expiredBusiness = makeBusiness({
      deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      hardDeleteAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    });
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(expiredBusiness);

    try {
      await restoreBusiness('biz-001', 'user-001', defaultContext);
      expect.fail('Expected BusinessError to be thrown');
    } catch (error) {
      const bizError = error as BusinessError;
      expect(bizError.code).toBe(BUSINESS_ERROR_CODES.RECOVERY_EXPIRED);
      expect(bizError.message).toBe('Recovery window has expired');
    }

    expect(mockRepo.restore).not.toHaveBeenCalled();
    expect(mockAudit.logEvent).not.toHaveBeenCalled();
  });

  it('should not call restore or audit when recovery window expired', async () => {
    const expiredBusiness = makeBusiness({
      deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      hardDeleteAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    });
    mockRepo.findByUserIdIncludeDeleted.mockResolvedValue(expiredBusiness);

    try {
      await restoreBusiness('biz-001', 'user-001', defaultContext);
    } catch {
      // expected
    }

    expect(mockRepo.restore).not.toHaveBeenCalled();
    expect(mockAudit.logEvent).not.toHaveBeenCalled();
  });
});
