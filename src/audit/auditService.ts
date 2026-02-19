/**
 * Audit Service for CashTrace Security & Compliance Module.
 *
 * Provides an append-only, tamper-evident audit trail with
 * comprehensive logging of all data access and modifications.
 * Uses SHA-256 checksums for integrity verification.
 *
 * @module audit
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  AuditAction,
  AuditEvent,
  AuditEntry,
  AuditFilter,
  ExportFormat,
  IntegrityResult,
  ChainIntegrityResult,
  RetentionStatus,
} from './types.js';

export interface AuditContext {
  ipAddress: string;
  userAgent: string;
}

/** 7 years in days (per Nigerian regulatory requirements, Req 4.6). */
export const RETENTION_PERIOD_DAYS = 2555;

export class AuditServiceImpl {
  private readonly entries: AuditEntry[] = [];

  /**
   * Log an audit event. Automatically generates id, timestamp,
   * correlationId, and a SHA-256 chain checksum for tamper detection.
   * Each entry's checksum includes the previous entry's checksum,
   * forming a hash chain that makes mid-log tampering detectable.
   */
  async log(event: AuditEvent, context: AuditContext): Promise<void> {
    const previousChecksum =
      this.entries.length > 0 ? this.entries[this.entries.length - 1]!.checksum : '';
    const entry: AuditEntry = {
      ...event,
      id: randomUUID(),
      timestamp: new Date(),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: randomUUID(),
      checksum: '',
      previousChecksum,
    };
    entry.checksum = this.computeChecksum(entry);
    this.entries.push(entry);
  }
  /**
   * Convenience method for logging authentication events.
   * Automatically sets eventType to 'auth' and includes
   * the authentication outcome and method in metadata.
   *
   * @param params.userId - The user attempting authentication
   * @param params.businessId - The business context
   * @param params.outcome - Whether authentication succeeded or failed
   * @param params.method - The authentication method used (e.g. 'password', 'magic_link')
   * @param context - IP address and user agent of the request
   */
  async logAuth(
    params: {
      userId: string;
      businessId: string;
      outcome: 'success' | 'failure';
      method: string;
    },
    context: AuditContext,
  ): Promise<void> {
    const action: AuditAction = params.outcome === 'success' ? 'create' : 'read';
    await this.log(
      {
        eventType: 'auth',
        userId: params.userId,
        businessId: params.businessId,
        resourceType: 'session',
        resourceId: params.userId,
        action,
        metadata: {
          outcome: params.outcome,
          method: params.method,
        },
      },
      context,
    );
  }

  /**
   * Convenience method for logging administrative actions.
   * Automatically sets eventType to 'admin' and includes
   * the admin action description and details in metadata.
   *
   * @param params.userId - The admin user performing the action
   * @param params.businessId - The business context
   * @param params.adminAction - Description of the administrative action performed
   * @param params.targetResource - The type of resource being acted upon
   * @param params.targetResourceId - The ID of the resource being acted upon
   * @param params.details - Optional additional details about the action
   * @param context - IP address and user agent of the request
   */
  async logAdmin(
    params: {
      userId: string;
      businessId: string;
      adminAction: string;
      targetResource: string;
      targetResourceId: string;
      details?: Record<string, unknown>;
    },
    context: AuditContext,
  ): Promise<void> {
    await this.log(
      {
        eventType: 'admin',
        userId: params.userId,
        businessId: params.businessId,
        resourceType: params.targetResource,
        resourceId: params.targetResourceId,
        action: 'update',
        metadata: {
          adminAction: params.adminAction,
          ...(params.details ?? {}),
        },
      },
      context,
    );
  }

  /**
   * Query audit entries with optional filtering.
   */
  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    let results = this.entries.filter((entry) => {
      if (filter.userId && entry.userId !== filter.userId) return false;
      if (filter.businessId && entry.businessId !== filter.businessId) return false;
      if (filter.eventType && entry.eventType !== filter.eventType) return false;
      if (filter.action && entry.action !== filter.action) return false;
      if (filter.resourceType && entry.resourceType !== filter.resourceType) return false;
      if (filter.startDate && entry.timestamp < filter.startDate) return false;
      if (filter.endDate && entry.timestamp > filter.endDate) return false;
      return true;
    });

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? results.length;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Export audit entries in JSON or CSV format.
   */
  async export(filter: AuditFilter, format: ExportFormat): Promise<string> {
    const entries = await this.query(filter);

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }

    // CSV format
    if (entries.length === 0) return '';

    const headers = [
      'id',
      'timestamp',
      'eventType',
      'userId',
      'businessId',
      'resourceType',
      'resourceId',
      'action',
      'ipAddress',
      'userAgent',
      'correlationId',
      'checksum',
    ];

    const rows = entries.map((entry) =>
      headers
        .map((h) => {
          const value = entry[h as keyof AuditEntry];
          const str = value instanceof Date ? value.toISOString() : String(value ?? '');
          // Escape CSV values containing commas or quotes
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Verify the integrity of an audit entry by recomputing its checksum.
   */
  async verifyIntegrity(entryId: string): Promise<IntegrityResult> {
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry) {
      return {
        entryId,
        valid: false,
        expectedChecksum: '',
        actualChecksum: '',
      };
    }

    const actualChecksum = this.computeChecksum(entry);
    return {
      entryId,
      valid: entry.checksum === actualChecksum,
      expectedChecksum: entry.checksum,
      actualChecksum,
    };
  }

  /**
   * Verify the integrity of the entire audit chain from start to end.
   * Checks that each entry's checksum is valid and that the chain
   * of previousChecksum references is unbroken.
   */
  async verifyChainIntegrity(): Promise<ChainIntegrityResult> {
    if (this.entries.length === 0) {
      return {
        valid: true,
        totalEntries: 0,
        firstInvalidIndex: null,
        details: 'No entries to verify',
      };
    }

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!;

      // Verify the previousChecksum link
      const expectedPrevChecksum = i === 0 ? '' : this.entries[i - 1]!.checksum;
      if (entry.previousChecksum !== expectedPrevChecksum) {
        return {
          valid: false,
          totalEntries: this.entries.length,
          firstInvalidIndex: i,
          details: `Chain broken at index ${i}: previousChecksum mismatch`,
        };
      }

      // Verify the entry's own checksum
      const recomputed = this.computeChecksum(entry);
      if (entry.checksum !== recomputed) {
        return {
          valid: false,
          totalEntries: this.entries.length,
          firstInvalidIndex: i,
          details: `Tampered entry at index ${i}: checksum mismatch`,
        };
      }
    }

    return {
      valid: true,
      totalEntries: this.entries.length,
      firstInvalidIndex: null,
      details: 'All entries verified',
    };
  }

  /**
   * Check whether a single audit entry is within the 7-year retention period.
   */
  isWithinRetention(entry: AuditEntry, now: Date = new Date()): boolean {
    const ageMs = now.getTime() - entry.timestamp.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays <= RETENTION_PERIOD_DAYS;
  }

  /**
   * Return the retention status for a single audit entry.
   */
  getRetentionStatus(entry: AuditEntry, now: Date = new Date()): RetentionStatus {
    const ageMs = now.getTime() - entry.timestamp.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return {
      entryId: entry.id,
      timestamp: entry.timestamp,
      ageInDays: Math.floor(ageDays),
      withinRetention: ageDays <= RETENTION_PERIOD_DAYS,
      retentionPeriodDays: RETENTION_PERIOD_DAYS,
    };
  }

  /**
   * Return all entries that have exceeded the 7-year retention period.
   * These are flagged for archival — the service NEVER deletes entries
   * automatically. Actual deletion must be a separate, audited process.
   */
  async getExpiredEntries(now: Date = new Date()): Promise<AuditEntry[]> {
    return this.entries.filter((entry) => !this.isWithinRetention(entry, now));
  }

  /**
   * Compute a SHA-256 checksum over the entry's core fields.
   * Includes the previousChecksum to form a hash chain.
   * The checksum itself is excluded from the hash input.
   */
  private computeChecksum(entry: AuditEntry): string {
    const payload = {
      id: entry.id,
      timestamp: entry.timestamp.toISOString(),
      eventType: entry.eventType,
      userId: entry.userId,
      businessId: entry.businessId,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      action: entry.action,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      correlationId: entry.correlationId,
      previousValue: entry.previousValue,
      newValue: entry.newValue,
      metadata: entry.metadata,
      previousChecksum: entry.previousChecksum,
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}
