/**
 * Property-based tests for NDPR-compliant data export completeness.
 *
 * **Property 10: Data Export Completeness**
 * For any data export request, the generated export SHALL contain the complete
 * business profile, all audit trail entries for that business, and export
 * metadata. For any soft-deleted business within recovery window, the export
 * SHALL include the data with deletion status indicated.
 *
 * **Validates: Requirements 6.1, 6.2, 6.5**
 *
 * Tag: Feature: business-management, Property 10: Data Export Completeness
 *
 * @module modules/business/services/exportService.property.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

import {
  type Business,
  type BusinessAuditLog,
  BusinessEventType,
  BusinessSector,
  Currency,
} from '../types/index.js';

vi.mock('../repositories/businessRepository.js', () => ({
  findByUserIdIncludeDeleted: vi.fn(),
}));

vi.mock('./auditService.js', () => ({
  getBusinessAuditHistory: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock('./businessService.js', () => ({
  BusinessError: class BusinessError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import * as businessRepository from '../repositories/businessRepository.js';
import * as auditService from './auditService.js';
import { generateExport } from './exportService.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const userIdArb = fc.uuid();

const validBusinessNameArb = fc
  .string({ minLength: 2, maxLength: 100 })
  .filter((s) => s.trim().length >= 2);

const sectorArb = fc.constantFrom(...Object.values(BusinessSector));

const contextArb = fc.record({
  ipAddress: fc.ipV4(),
  userAgent: fc.constant('test-agent'),
  requestId: fc.uuid(),
});

const auditLogArb = fc.record({
  id: fc.uuid(),
  eventType: fc.constantFrom(...Object.values(BusinessEventType)),
  userId: fc.uuid(),
  businessId: fc.uuid(),
  ipAddress: fc.ipV4(),
  userAgent: fc.constant('test-agent'),
  requestId: fc.uuid(),
  previousValues: fc.constant(null),
  newValues: fc.constant(null),
  createdAt: fc.date(),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 10: Data Export Completeness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * For any active business, generateExport SHALL return the complete business
   * profile, all audit trail entries, and metadata with version, format, and
   * includesDeletedData set to false.
   */
  it('should include complete business profile and metadata for active business', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validBusinessNameArb,
        sectorArb,
        contextArb,
        fc.array(auditLogArb, { minLength: 0, maxLength: 5 }),
        async (userId, name, sector, context, auditLogs) => {
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

          const typedAuditLogs: BusinessAuditLog[] = auditLogs.map((log) => ({
            ...log,
            businessId: business.id,
            userId,
          }));

          vi.mocked(businessRepository.findByUserIdIncludeDeleted).mockResolvedValue(business);
          vi.mocked(auditService.getBusinessAuditHistory).mockResolvedValue(typedAuditLogs);
          vi.mocked(auditService.logEvent).mockResolvedValue(undefined as never);

          const result = await generateExport(userId, context);

          // Business profile is complete
          expect(result.business).toEqual(business);

          // Audit trail matches
          expect(result.auditTrail).toEqual(typedAuditLogs);

          // Metadata is correct for active business
          expect(result.metadata.version).toBe('1.0.0');
          expect(result.metadata.format).toBe('json');
          expect(result.metadata.includesDeletedData).toBe(false);

          // exportedAt is a Date
          expect(result.exportedAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * For any soft-deleted business within the recovery window, generateExport
   * SHALL include the data with deletion status indicated
   * (includesDeletedData === true) and the business deletedAt is not null.
   */
  it('should indicate deletion status for soft-deleted business within recovery window', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validBusinessNameArb,
        sectorArb,
        contextArb,
        fc.array(auditLogArb, { minLength: 0, maxLength: 5 }),
        async (userId, name, sector, context, auditLogs) => {
          const now = new Date();
          const deletedAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
          const hardDeleteAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

          const business: Business = {
            id: crypto.randomUUID(),
            userId,
            name: name.trim(),
            sector,
            currency: Currency.NGN,
            createdAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
            updatedAt: deletedAt,
            deletedAt,
            hardDeleteAt,
          };

          const typedAuditLogs: BusinessAuditLog[] = auditLogs.map((log) => ({
            ...log,
            businessId: business.id,
            userId,
          }));

          vi.mocked(businessRepository.findByUserIdIncludeDeleted).mockResolvedValue(business);
          vi.mocked(auditService.getBusinessAuditHistory).mockResolvedValue(typedAuditLogs);
          vi.mocked(auditService.logEvent).mockResolvedValue(undefined as never);

          const result = await generateExport(userId, context);

          // Business profile matches exactly (including deletion fields)
          expect(result.business).toEqual(business);
          expect(result.business.deletedAt).not.toBeNull();

          // Metadata indicates deleted data is included
          expect(result.metadata.includesDeletedData).toBe(true);

          // Audit trail matches
          expect(result.auditTrail).toEqual(typedAuditLogs);

          // exportedAt is a Date
          expect(result.exportedAt).toBeInstanceOf(Date);
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});
