/**
 * Business service for managing business profiles.
 *
 * Provides core business logic for creating, retrieving, updating,
 * and deleting business profiles. Delegates to the repository for
 * data access and the audit service for compliance logging.
 *
 * @module modules/business/services/businessService
 */

import * as businessRepository from '../repositories/businessRepository.js';
import * as auditService from './auditService.js';
import {
  type Business,
  BUSINESS_ERROR_CODES,
  type BusinessErrorCode,
  BusinessEventType,
  BusinessSector,
  type CreateBusinessRequest,
  type UpdateBusinessRequest,
} from '../types/index.js';
import { validateBusinessName } from '../validators/nameValidator.js';
import { validateBusinessSector } from '../validators/sectorValidator.js';

// ─── Error Class ─────────────────────────────────────────────────────────────

/**
 * Custom error class for business-related errors.
 *
 * Includes a machine-readable error code and optional field-level
 * validation errors for structured API responses.
 */
export class BusinessError extends Error {
  /** Machine-readable error code from BUSINESS_ERROR_CODES */
  readonly code: BusinessErrorCode;
  /** Optional field-specific validation errors */
  readonly fields?: Record<string, string[]>;

  constructor(code: BusinessErrorCode, message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
    this.fields = fields;
  }
}

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Create a new business profile for a user.
 *
 * Validates the business name and optional sector, checks that the user
 * does not already have a business, creates the record, and logs the
 * creation event to the audit trail.
 *
 * @param userId - The UUID of the authenticated user
 * @param data - Business creation data (name, optional sector)
 * @param context - Request context for audit logging
 * @returns The newly created Business record
 * @throws {BusinessError} INVALID_NAME if name fails validation
 * @throws {BusinessError} INVALID_SECTOR if sector is not a valid enum value
 * @throws {BusinessError} ALREADY_EXISTS if user already has a business
 */
export async function createBusiness(
  userId: string,
  data: CreateBusinessRequest,
  context: { ipAddress: string; userAgent?: string; requestId?: string },
): Promise<Business> {
  // 1. Validate name
  const nameResult = validateBusinessName(data.name);
  if (!nameResult.valid) {
    throw new BusinessError(
      BUSINESS_ERROR_CODES.INVALID_NAME,
      nameResult.errors[0] ?? 'Invalid business name',
      {
        name: nameResult.errors,
      },
    );
  }

  // 2. Validate sector if provided
  if (data.sector !== undefined) {
    const sectorResult = validateBusinessSector(data.sector);
    if (!sectorResult.valid) {
      throw new BusinessError(
        BUSINESS_ERROR_CODES.INVALID_SECTOR,
        sectorResult.errors[0] ?? 'Invalid sector',
        { sector: sectorResult.errors },
      );
    }
  }

  // 3. Check for existing business (including soft-deleted)
  const existing = await businessRepository.findByUserIdIncludeDeleted(userId);
  if (existing) {
    throw new BusinessError(
      BUSINESS_ERROR_CODES.ALREADY_EXISTS,
      'User already has a business profile',
    );
  }

  // 4. Create business with defaults
  const trimmedName = data.name.trim();
  const sector = data.sector ?? BusinessSector.OTHER;

  const business = await businessRepository.create(userId, {
    name: trimmedName,
    sector,
  });

  // 5. Log creation event to audit trail
  await auditService.logEvent({
    eventType: BusinessEventType.BUSINESS_CREATED,
    userId,
    businessId: business.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
    newValues: {
      id: business.id,
      name: business.name,
      sector: business.sector,
      currency: business.currency,
    },
  });

  return business;
}

/**
 * Retrieve a business profile by user ID.
 *
 * Returns the business linked to the authenticated user, or null if
 * no business exists. Soft-deleted businesses are excluded by the
 * repository layer.
 *
 * @param userId - The UUID of the authenticated user
 * @returns The user's Business or null if none exists
 */
export async function getBusinessByUserId(userId: string): Promise<Business | null> {
  return businessRepository.findByUserId(userId);
}

/**
 * Retrieve a business by its ID with ownership validation.
 *
 * Looks up the business by ID (excluding soft-deleted records) and
 * verifies that the requesting user is the owner.
 *
 * @param businessId - The UUID of the business to retrieve
 * @param userId - The UUID of the requesting user (for ownership check)
 * @returns The matching Business record
 * @throws {BusinessError} NOT_FOUND if no business exists with the given ID
 * @throws {BusinessError} FORBIDDEN if the requesting user does not own the business
 */
export async function getBusinessById(businessId: string, userId: string): Promise<Business> {
  const business = await businessRepository.findById(businessId);

  if (!business) {
    throw new BusinessError(BUSINESS_ERROR_CODES.NOT_FOUND, 'Business not found');
  }

  if (business.userId !== userId) {
    throw new BusinessError(BUSINESS_ERROR_CODES.FORBIDDEN, 'User does not own this business');
  }

  return business;
}

/**
 * Update a business profile with ownership validation.
 *
 * Validates that the requesting user owns the business, validates any
 * provided name or sector values, performs the update, and logs the
 * change to the audit trail with previous and new values.
 *
 * @param businessId - The UUID of the business to update
 * @param userId - The UUID of the requesting user (for ownership check)
 * @param data - Fields to update (name and/or sector)
 * @param context - Request context for audit logging
 * @returns The updated Business record
 * @throws {BusinessError} NOT_FOUND if no business exists with the given ID
 * @throws {BusinessError} FORBIDDEN if the requesting user does not own the business
 * @throws {BusinessError} INVALID_NAME if name fails validation
 * @throws {BusinessError} INVALID_SECTOR if sector is not a valid enum value
 */
export async function updateBusiness(
  businessId: string,
  userId: string,
  data: UpdateBusinessRequest,
  context: { ipAddress: string; userAgent?: string; requestId?: string },
): Promise<Business> {
  // 1. Find business by ID
  const business = await businessRepository.findById(businessId);
  if (!business) {
    throw new BusinessError(BUSINESS_ERROR_CODES.NOT_FOUND, 'Business not found');
  }

  // 2. Check ownership
  if (business.userId !== userId) {
    throw new BusinessError(BUSINESS_ERROR_CODES.FORBIDDEN, 'User does not own this business');
  }

  // 3. Validate name if provided
  if (data.name !== undefined) {
    const nameResult = validateBusinessName(data.name);
    if (!nameResult.valid) {
      throw new BusinessError(
        BUSINESS_ERROR_CODES.INVALID_NAME,
        nameResult.errors[0] ?? 'Invalid business name',
        { name: nameResult.errors },
      );
    }
  }

  // 4. Validate sector if provided
  if (data.sector !== undefined) {
    const sectorResult = validateBusinessSector(data.sector);
    if (!sectorResult.valid) {
      throw new BusinessError(
        BUSINESS_ERROR_CODES.INVALID_SECTOR,
        sectorResult.errors[0] ?? 'Invalid sector',
        { sector: sectorResult.errors },
      );
    }
  }

  // 5. Build update data with trimmed name
  const updateData: { name?: string; sector?: BusinessSector } = {};
  if (data.name !== undefined) {
    updateData.name = data.name.trim();
  }
  if (data.sector !== undefined) {
    updateData.sector = data.sector;
  }

  // 6. Capture previous values for audit
  const previousValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  if (data.name !== undefined) {
    previousValues.name = business.name;
    newValues.name = updateData.name;
  }
  if (data.sector !== undefined) {
    previousValues.sector = business.sector;
    newValues.sector = data.sector;
  }

  // 7. Perform update
  const updated = await businessRepository.update(businessId, updateData);

  // 8. Log BUSINESS_UPDATED event
  await auditService.logEvent({
    eventType: BusinessEventType.BUSINESS_UPDATED,
    userId,
    businessId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
    previousValues,
    newValues,
  });

  // 9. Return updated business
  return updated;
}

/**
 * Soft delete a business with ownership validation.
 *
 * Looks up the business by ID (excluding already-deleted records),
 * verifies ownership, performs the soft delete (setting deletedAt and
 * hardDeleteAt 30 days out), and logs the event to the audit trail.
 *
 * @param businessId - The UUID of the business to delete
 * @param userId - The UUID of the requesting user (for ownership check)
 * @param context - Request context for audit logging
 * @throws {BusinessError} NOT_FOUND if no business exists with the given ID
 * @throws {BusinessError} FORBIDDEN if the requesting user does not own the business
 */
export async function softDeleteBusiness(
  businessId: string,
  userId: string,
  context: { ipAddress: string; userAgent?: string; requestId?: string },
): Promise<void> {
  // 1. Find business by ID (excludes soft-deleted)
  const business = await businessRepository.findById(businessId);
  if (!business) {
    throw new BusinessError(BUSINESS_ERROR_CODES.NOT_FOUND, 'Business not found');
  }

  // 2. Check ownership
  if (business.userId !== userId) {
    throw new BusinessError(BUSINESS_ERROR_CODES.FORBIDDEN, 'User does not own this business');
  }

  // 3. Perform soft delete (sets deletedAt and hardDeleteAt)
  await businessRepository.softDelete(businessId);

  // 4. Log BUSINESS_SOFT_DELETED audit event with previous values
  await auditService.logEvent({
    eventType: BusinessEventType.BUSINESS_SOFT_DELETED,
    userId,
    businessId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
    previousValues: {
      id: business.id,
      name: business.name,
      sector: business.sector,
      currency: business.currency,
    },
  });
}

/**
 * Restore a soft-deleted business within the recovery window.
 *
 * Finds the business by user ID (including deleted records), verifies
 * ownership, checks that the recovery window has not expired, restores
 * the record, and logs the event to the audit trail.
 *
 * @param businessId - The UUID of the business to restore
 * @param userId - The UUID of the requesting user (for ownership check)
 * @param context - Request context for audit logging
 * @returns The restored Business record
 * @throws {BusinessError} NOT_FOUND if no business exists for the user
 * @throws {BusinessError} FORBIDDEN if the requesting user does not own the business
 * @throws {BusinessError} RECOVERY_EXPIRED if the 30-day recovery window has passed
 */
export async function restoreBusiness(
  businessId: string,
  userId: string,
  context: { ipAddress: string; userAgent?: string; requestId?: string },
): Promise<Business> {
  // 1. Find business by user ID including deleted
  const business = await businessRepository.findByUserIdIncludeDeleted(userId);

  // 2. Check that business exists
  if (!business || business.id !== businessId) {
    throw new BusinessError(BUSINESS_ERROR_CODES.NOT_FOUND, 'Business not found');
  }

  // 3. Check ownership
  if (business.userId !== userId) {
    throw new BusinessError(BUSINESS_ERROR_CODES.FORBIDDEN, 'User does not own this business');
  }

  // 4. Check that business is actually soft-deleted
  if (!business.deletedAt) {
    throw new BusinessError(BUSINESS_ERROR_CODES.NOT_FOUND, 'Business is not deleted');
  }

  // 5. Check recovery window (hardDeleteAt > now)
  if (business.hardDeleteAt && business.hardDeleteAt <= new Date()) {
    throw new BusinessError(BUSINESS_ERROR_CODES.RECOVERY_EXPIRED, 'Recovery window has expired');
  }

  // 6. Restore the business
  const restored = await businessRepository.restore(businessId);

  // 7. Log BUSINESS_RESTORED audit event
  await auditService.logEvent({
    eventType: BusinessEventType.BUSINESS_RESTORED,
    userId,
    businessId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
    previousValues: {
      deletedAt: business.deletedAt.toISOString(),
      hardDeleteAt: business.hardDeleteAt?.toISOString() ?? null,
    },
    newValues: {
      deletedAt: null,
      hardDeleteAt: null,
    },
  });

  return restored;
}
