/**
 * Hard delete batch job for permanently removing expired soft-deleted businesses.
 *
 * Queries businesses whose recovery window has expired (hardDeleteAt <= now),
 * logs a BUSINESS_HARD_DELETED audit event before removal, deletes associated
 * audit logs, then permanently removes the business record.
 *
 * Individual failures are handled gracefully — one failing business does not
 * stop the rest of the batch from being processed.
 *
 * @module modules/business/jobs/hardDeleteJob
 */

import * as auditService from '../services/auditService.js';
import * as businessRepository from '../repositories/businessRepository.js';
import { BusinessEventType } from '../types/index.js';

/** Summary returned after a hard-delete batch run. */
export interface HardDeleteResult {
  /** Number of businesses successfully hard-deleted */
  processed: number;
  /** Number of businesses that failed during hard-delete */
  failed: number;
  /** Errors encountered during processing */
  errors: Error[];
}

/**
 * Process all businesses whose hard-delete date has passed.
 *
 * For each expired business the function:
 * 1. Logs a BUSINESS_HARD_DELETED audit event (so a record exists before removal)
 * 2. Deletes all audit logs for the business
 * 3. Permanently deletes the business record
 *
 * If any step fails for a single business the error is captured and processing
 * continues with the remaining businesses.
 *
 * @returns A summary with processed/failed counts and any errors
 */
export async function processHardDeletes(): Promise<HardDeleteResult> {
  const pending = await businessRepository.findPendingHardDelete();

  const result: HardDeleteResult = {
    processed: 0,
    failed: 0,
    errors: [],
  };

  for (const business of pending) {
    try {
      // 1. Log hard-delete event BEFORE removal so we have a record
      await auditService.logEvent({
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

      // 2. Delete audit logs for this business
      await auditService.deleteBusinessAuditLogs(business.id);

      // 3. Permanently delete the business record
      await businessRepository.hardDelete(business.id);

      result.processed++;
    } catch (err) {
      result.failed++;
      result.errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  return result;
}
