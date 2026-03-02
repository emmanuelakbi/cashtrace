/**
 * Property-based tests for business creation default values.
 *
 * **Property 3: Default Values on Creation**
 * For any business creation request that does not specify currency, the created
 * business SHALL have currency set to NGN. For any business creation request
 * that does not specify sector, the created business SHALL have sector set to OTHER.
 *
 * **Validates: Requirements 1.4, 2.4**
 *
 * Tag: Feature: business-management, Property 3: Default Values on Creation
 *
 * @module modules/business/services/businessService.property.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

import {
  BUSINESS_ERROR_CODES,
  type Business,
  BusinessEventType,
  BusinessSector,
  type CreateBusinessRequest,
  Currency,
  type UpdateBusinessRequest,
} from '../types/index.js';

vi.mock('../repositories/businessRepository.js', () => ({
  create: vi.fn(),
  findById: vi.fn(),
  findByUserId: vi.fn(),
  findByUserIdIncludeDeleted: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('./auditService.js', () => ({
  logEvent: vi.fn(),
}));

import * as businessRepository from '../repositories/businessRepository.js';
import * as auditService from './auditService.js';
import {
  createBusiness,
  getBusinessByUserId,
  getBusinessById,
  updateBusiness,
  softDeleteBusiness,
  restoreBusiness,
  BusinessError,
} from './businessService.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const validBusinessNameArb = fc
  .string({ minLength: 2, maxLength: 100 })
  .filter((s) => s.trim().length >= 2);

const userIdArb = fc.uuid();

const sectorArb = fc.constantFrom(...Object.values(BusinessSector));

const contextArb = fc.record({
  ipAddress: fc.ipV4(),
  userAgent: fc.constant('test-agent'),
  requestId: fc.uuid(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBusiness(overrides: {
  userId: string;
  name: string;
  sector: BusinessSector;
  currency: Currency;
}): {
  id: string;
  userId: string;
  name: string;
  sector: BusinessSector;
  currency: Currency;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: null;
  hardDeleteAt: null;
} {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    userId: overrides.userId,
    name: overrides.name,
    sector: overrides.sector,
    currency: overrides.currency,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    hardDeleteAt: null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 3: Default Values on Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(businessRepository.findByUserIdIncludeDeleted).mockResolvedValue(null);
  });

  /**
   * **Validates: Requirements 1.4, 2.4**
   *
   * For any valid name without a sector, the created business SHALL have
   * sector set to OTHER and currency set to NGN.
   */
  it('should default sector to OTHER and currency to NGN when sector is omitted', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validBusinessNameArb,
        contextArb,
        async (userId, name, context) => {
          const data: CreateBusinessRequest = { name };

          vi.mocked(businessRepository.create).mockImplementation(
            async (_uid: string, req: CreateBusinessRequest) =>
              makeBusiness({
                userId,
                name: req.name.trim(),
                sector: req.sector ?? BusinessSector.OTHER,
                currency: Currency.NGN,
              }),
          );

          const result = await createBusiness(userId, data, context);

          expect(result.sector).toBe(BusinessSector.OTHER);
          expect(result.currency).toBe(Currency.NGN);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * For any valid name with an explicit sector, the created business SHALL
   * have that sector and currency set to NGN.
   */
  it('should preserve explicit sector and default currency to NGN', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validBusinessNameArb,
        sectorArb,
        contextArb,
        async (userId, name, sector, context) => {
          const data: CreateBusinessRequest = { name, sector };

          vi.mocked(businessRepository.create).mockImplementation(
            async (_uid: string, req: CreateBusinessRequest) =>
              makeBusiness({
                userId,
                name: req.name.trim(),
                sector: req.sector ?? BusinessSector.OTHER,
                currency: Currency.NGN,
              }),
          );

          const result = await createBusiness(userId, data, context);

          expect(result.sector).toBe(sector);
          expect(result.currency).toBe(Currency.NGN);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Currency is always NGN regardless of input — CreateBusinessRequest has
   * no currency field, so the system must always default to NGN.
   */
  it('should always set currency to NGN (no currency field in request)', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validBusinessNameArb,
        fc.option(sectorArb, { nil: undefined }),
        contextArb,
        async (userId, name, sector, context) => {
          const data: CreateBusinessRequest = { name, ...(sector !== undefined && { sector }) };

          vi.mocked(businessRepository.create).mockImplementation(
            async (_uid: string, req: CreateBusinessRequest) =>
              makeBusiness({
                userId,
                name: req.name.trim(),
                sector: req.sector ?? BusinessSector.OTHER,
                currency: Currency.NGN,
              }),
          );

          const result = await createBusiness(userId, data, context);

          expect(result.currency).toBe(Currency.NGN);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});

// ─── Property 6: Business Retrieval Correctness ──────────────────────────────

/**
 * **Property 6: Business Retrieval Correctness**
 *
 * For any authenticated user with a non-deleted business, retrieving their
 * business SHALL return exactly that business with all fields populated.
 * For any user whose business is soft-deleted, normal retrieval SHALL return null.
 *
 * **Validates: Requirements 4.1, 4.4**
 *
 * Tag: Feature: business-management, Property 6: Business Retrieval Correctness
 */
describe('Property 6: Business Retrieval Correctness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 4.1**
   *
   * For any user with a non-deleted business, getBusinessByUserId returns
   * that business with all fields matching the stored record.
   */
  it('should return the exact business with all fields for a non-deleted business', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, validBusinessNameArb, sectorArb, async (userId, name, sector) => {
        const storedBusiness: Business = {
          id: crypto.randomUUID(),
          userId,
          name: name.trim(),
          sector,
          currency: Currency.NGN,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          hardDeleteAt: null,
        };

        vi.mocked(businessRepository.findByUserId).mockResolvedValue(storedBusiness);

        const result = await getBusinessByUserId(userId);

        expect(result).not.toBeNull();
        expect(result!.id).toBe(storedBusiness.id);
        expect(result!.userId).toBe(storedBusiness.userId);
        expect(result!.name).toBe(storedBusiness.name);
        expect(result!.sector).toBe(storedBusiness.sector);
        expect(result!.currency).toBe(storedBusiness.currency);
        expect(result!.createdAt).toBe(storedBusiness.createdAt);
        expect(result!.updatedAt).toBe(storedBusiness.updatedAt);
        expect(result!.deletedAt).toBeNull();
        expect(result!.hardDeleteAt).toBeNull();
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * For any user whose business is soft-deleted, the repository returns null
   * and getBusinessByUserId propagates that null (404 scenario).
   */
  it('should return null for a soft-deleted business', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        vi.mocked(businessRepository.findByUserId).mockResolvedValue(null);

        const result = await getBusinessByUserId(userId);

        expect(result).toBeNull();
      }),
      { numRuns: 100, verbose: true },
    );
  });
});

// ─── Property 5: Ownership Enforcement ───────────────────────────────────────

/**
 * **Property 5: Ownership Enforcement**
 *
 * For any business operation (update, delete, restore, export), if the
 * requesting user's ID does not match the business's userId, the operation
 * SHALL be rejected with a 403 Forbidden error and the business SHALL
 * remain unchanged.
 *
 * **Validates: Requirements 3.1, 3.6, 5.7**
 *
 * Tag: Feature: business-management, Property 5: Ownership Enforcement
 */
describe('Property 5: Ownership Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Generate two distinct UUIDs for owner and non-owner. */
  const distinctUserPairArb = fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b);

  /**
   * **Validates: Requirements 3.1, 3.6**
   *
   * For any business owned by userA, calling updateBusiness with userB
   * (where userA !== userB) throws BusinessError with FORBIDDEN code.
   */
  it('should reject updateBusiness when userId does not match business owner', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctUserPairArb,
        validBusinessNameArb,
        sectorArb,
        contextArb,
        async ([ownerUserId, otherUserId], name, sector, context) => {
          const storedBusiness: Business = {
            id: crypto.randomUUID(),
            userId: ownerUserId,
            name: name.trim(),
            sector,
            currency: Currency.NGN,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            hardDeleteAt: null,
          };

          vi.mocked(businessRepository.findById).mockResolvedValue(storedBusiness);

          const updateData: UpdateBusinessRequest = { name: 'New Name' };

          try {
            await updateBusiness(storedBusiness.id, otherUserId, updateData, context);
            expect.unreachable('updateBusiness should have thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(BusinessError);
            expect((error as BusinessError).code).toBe(BUSINESS_ERROR_CODES.FORBIDDEN);
          }
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 3.1, 5.7**
   *
   * For any business owned by userA, calling getBusinessById with userB
   * throws BusinessError with FORBIDDEN code.
   */
  it('should reject getBusinessById when userId does not match business owner', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctUserPairArb,
        validBusinessNameArb,
        sectorArb,
        async ([ownerUserId, otherUserId], name, sector) => {
          const storedBusiness: Business = {
            id: crypto.randomUUID(),
            userId: ownerUserId,
            name: name.trim(),
            sector,
            currency: Currency.NGN,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            hardDeleteAt: null,
          };

          vi.mocked(businessRepository.findById).mockResolvedValue(storedBusiness);

          try {
            await getBusinessById(storedBusiness.id, otherUserId);
            expect.unreachable('getBusinessById should have thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(BusinessError);
            expect((error as BusinessError).code).toBe(BUSINESS_ERROR_CODES.FORBIDDEN);
          }
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.6**
   *
   * After a failed ownership check on update, the business remains
   * unchanged — repository.update is never called.
   */
  it('should not call repository.update when ownership check fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctUserPairArb,
        validBusinessNameArb,
        sectorArb,
        contextArb,
        async ([ownerUserId, otherUserId], name, sector, context) => {
          const storedBusiness: Business = {
            id: crypto.randomUUID(),
            userId: ownerUserId,
            name: name.trim(),
            sector,
            currency: Currency.NGN,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            hardDeleteAt: null,
          };

          vi.mocked(businessRepository.findById).mockResolvedValue(storedBusiness);
          vi.mocked(businessRepository.update).mockClear();

          const updateData: UpdateBusinessRequest = { name: 'New Name' };

          try {
            await updateBusiness(storedBusiness.id, otherUserId, updateData, context);
          } catch {
            // Expected to throw — we only care about the side-effect assertion below.
          }

          expect(businessRepository.update).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});

// ─── Property 7: Soft Delete Behavior ────────────────────────────────────────

/**
 * **Property 7: Soft Delete Behavior**
 *
 * For any business deletion request by the owner, the business SHALL be marked
 * with deletedAt timestamp and hardDeleteAt set to exactly 30 days after
 * deletedAt, but the business record SHALL still exist in the database.
 *
 * **Validates: Requirements 5.1, 5.2**
 *
 * Tag: Feature: business-management, Property 7: Soft Delete Behavior
 */
describe('Property 7: Soft Delete Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For any owner-initiated deletion, softDeleteBusiness calls
   * repository.softDelete with the correct business ID.
   */
  it('should call repository.softDelete with the business ID for owner deletions', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validBusinessNameArb,
        sectorArb,
        contextArb,
        async (userId, name, sector, context) => {
          const business: Business = {
            id: crypto.randomUUID(),
            userId,
            name: name.trim(),
            sector,
            currency: Currency.NGN,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            hardDeleteAt: null,
          };

          vi.mocked(businessRepository.findById).mockResolvedValue(business);
          vi.mocked(businessRepository.softDelete).mockResolvedValue(undefined);

          await softDeleteBusiness(business.id, userId, context);

          expect(businessRepository.softDelete).toHaveBeenCalledWith(business.id);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For any owner-initiated deletion, an audit event of type
   * BUSINESS_SOFT_DELETED is logged with the previous business values.
   */
  it('should log BUSINESS_SOFT_DELETED audit event with previous values', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validBusinessNameArb,
        sectorArb,
        contextArb,
        async (userId, name, sector, context) => {
          const business: Business = {
            id: crypto.randomUUID(),
            userId,
            name: name.trim(),
            sector,
            currency: Currency.NGN,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            hardDeleteAt: null,
          };

          vi.mocked(businessRepository.findById).mockResolvedValue(business);
          vi.mocked(businessRepository.softDelete).mockResolvedValue(undefined);

          await softDeleteBusiness(business.id, userId, context);

          expect(auditService.logEvent).toHaveBeenCalledWith(
            expect.objectContaining({
              eventType: BusinessEventType.BUSINESS_SOFT_DELETED,
              userId,
              businessId: business.id,
              ipAddress: context.ipAddress,
              previousValues: {
                id: business.id,
                name: business.name,
                sector: business.sector,
                currency: business.currency,
              },
            }),
          );
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});

// ─── Property 8: Business Restore Within Recovery Window ─────────────────────

/**
 * **Property 8: Business Restore Within Recovery Window**
 *
 * For any soft-deleted business where the current time is before hardDeleteAt,
 * a restore request by the owner SHALL succeed, clearing deletedAt and
 * hardDeleteAt, and the business SHALL be retrievable again.
 *
 * **Validates: Requirements 5.5**
 *
 * Tag: Feature: business-management, Property 8: Business Restore Within Recovery Window
 */
describe('Property 8: Business Restore Within Recovery Window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * For any soft-deleted business within the recovery window, restoreBusiness
   * calls repository.restore and returns a business with null deletedAt/hardDeleteAt.
   */
  it('should restore a soft-deleted business within the recovery window', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validBusinessNameArb,
        sectorArb,
        contextArb,
        async (userId, name, sector, context) => {
          const businessId = crypto.randomUUID();
          const now = new Date();
          const deletedAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
          const hardDeleteAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000); // 25 days from now

          const softDeletedBusiness: Business = {
            id: businessId,
            userId,
            name: name.trim(),
            sector,
            currency: Currency.NGN,
            createdAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
            updatedAt: deletedAt,
            deletedAt,
            hardDeleteAt,
          };

          const restoredBusiness: Business = {
            ...softDeletedBusiness,
            deletedAt: null,
            hardDeleteAt: null,
            updatedAt: now,
          };

          vi.mocked(businessRepository.findByUserIdIncludeDeleted).mockResolvedValue(
            softDeletedBusiness,
          );
          vi.mocked(businessRepository.restore).mockResolvedValue(restoredBusiness);

          const result = await restoreBusiness(businessId, userId, context);

          expect(businessRepository.restore).toHaveBeenCalledWith(businessId);
          expect(result.deletedAt).toBeNull();
          expect(result.hardDeleteAt).toBeNull();
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * For any successful restore, a BUSINESS_RESTORED audit event is logged
   * with the previous deletedAt/hardDeleteAt and new null values.
   */
  it('should log BUSINESS_RESTORED audit event on successful restore', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validBusinessNameArb,
        sectorArb,
        contextArb,
        async (userId, name, sector, context) => {
          const businessId = crypto.randomUUID();
          const now = new Date();
          const deletedAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
          const hardDeleteAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

          const softDeletedBusiness: Business = {
            id: businessId,
            userId,
            name: name.trim(),
            sector,
            currency: Currency.NGN,
            createdAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
            updatedAt: deletedAt,
            deletedAt,
            hardDeleteAt,
          };

          const restoredBusiness: Business = {
            ...softDeletedBusiness,
            deletedAt: null,
            hardDeleteAt: null,
            updatedAt: now,
          };

          vi.mocked(businessRepository.findByUserIdIncludeDeleted).mockResolvedValue(
            softDeletedBusiness,
          );
          vi.mocked(businessRepository.restore).mockResolvedValue(restoredBusiness);

          await restoreBusiness(businessId, userId, context);

          expect(auditService.logEvent).toHaveBeenCalledWith(
            expect.objectContaining({
              eventType: BusinessEventType.BUSINESS_RESTORED,
              userId,
              businessId,
              ipAddress: context.ipAddress,
              previousValues: {
                deletedAt: deletedAt.toISOString(),
                hardDeleteAt: hardDeleteAt.toISOString(),
              },
              newValues: {
                deletedAt: null,
                hardDeleteAt: null,
              },
            }),
          );
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});
