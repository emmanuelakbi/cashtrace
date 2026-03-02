/**
 * Export service for NDPR-compliant business data export.
 *
 * Generates complete data exports including business profile,
 * audit trail, and metadata. Handles soft-deleted businesses
 * within the recovery window.
 *
 * @module modules/business/services/exportService
 */

import * as businessRepository from '../repositories/businessRepository.js';
import * as auditService from './auditService.js';
import { BusinessError } from './businessService.js';
import {
  BUSINESS_ERROR_CODES,
  type BusinessExport,
  BusinessEventType,
  type ExportMetadata,
} from '../types/index.js';

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Generate a complete NDPR-compliant data export for a user's business.
 *
 * Includes the full business profile (even if soft-deleted within recovery
 * window), all audit trail entries, and export metadata. Logs a
 * BUSINESS_EXPORTED event to the audit trail after generation.
 *
 * @param userId - The UUID of the authenticated user
 * @param context - Request context for audit logging
 * @returns The complete BusinessExport object
 * @throws {BusinessError} NOT_FOUND if no business exists for the user
 */
export async function generateExport(
  userId: string,
  context: { ipAddress: string; userAgent?: string; requestId?: string },
): Promise<BusinessExport> {
  // 1. Find business including soft-deleted (for recovery window exports)
  const business = await businessRepository.findByUserIdIncludeDeleted(userId);

  if (!business) {
    throw new BusinessError(BUSINESS_ERROR_CODES.NOT_FOUND, 'Business not found');
  }

  // 2. Get full audit history for the business
  const auditTrail = await auditService.getBusinessAuditHistory(business.id);

  // 3. Build export metadata
  const metadata: ExportMetadata = {
    version: '1.0.0',
    format: 'json',
    includesDeletedData: business.deletedAt !== null,
  };

  // 4. Build the export object
  const exportData: BusinessExport = {
    exportedAt: new Date(),
    business,
    auditTrail,
    metadata,
  };

  // 5. Log BUSINESS_EXPORTED audit event
  await auditService.logEvent({
    eventType: BusinessEventType.BUSINESS_EXPORTED,
    userId,
    businessId: business.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
  });

  return exportData;
}
