/**
 * Retention Manager for CashTrace Security & Compliance Module.
 *
 * Manages data retention policies per data type, supports archival,
 * deletion, legal holds, and audit logging of all retention actions.
 *
 * @module compliance/retentionManager
 *
 * Requirement 8.1: Define retention periods per data type.
 * Requirement 8.2: Automatically archive data past active retention period.
 * Requirement 8.3: Automatically delete data past total retention period.
 * Requirement 8.4: Support legal hold to prevent deletion during investigations.
 * Requirement 8.5: Log all retention actions for audit.
 * Requirement 8.6: Respect user deletion requests within retention constraints.
 */

import { randomUUID } from 'node:crypto';
import type {
  RetentionDataType,
  RetentionPeriodConfig,
  RetentionDataRecord,
  RetentionStatus,
  RetentionCheckResult,
  LegalHold,
  RetentionAuditEntry,
} from './types.js';

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Default retention periods per data type.
 * Requirement 8.1: transactions 7 years, logs 1 year.
 */
const DEFAULT_RETENTION_PERIODS: ReadonlyMap<RetentionDataType, RetentionPeriodConfig> = new Map([
  [
    'transactions',
    {
      dataType: 'transactions',
      activeRetentionDays: 365,
      archiveRetentionDays: 2190,
      totalRetentionDays: 2555, // ~7 years
      description: 'Financial transactions retained for 7 years per Nigerian regulations',
    },
  ],
  [
    'logs',
    {
      dataType: 'logs',
      activeRetentionDays: 90,
      archiveRetentionDays: 275,
      totalRetentionDays: 365, // 1 year
      description: 'System logs retained for 1 year',
    },
  ],
  [
    'audit_records',
    {
      dataType: 'audit_records',
      activeRetentionDays: 730,
      archiveRetentionDays: 1825,
      totalRetentionDays: 2555, // ~7 years (same as transactions for compliance)
      description: 'Audit records retained for 7 years per Nigerian regulations',
    },
  ],
  [
    'user_data',
    {
      dataType: 'user_data',
      activeRetentionDays: 365,
      archiveRetentionDays: 365,
      totalRetentionDays: 730, // 2 years
      description: 'User personal data retained for 2 years after account closure',
    },
  ],
  [
    'consent_records',
    {
      dataType: 'consent_records',
      activeRetentionDays: 365,
      archiveRetentionDays: 1825,
      totalRetentionDays: 2190, // 6 years
      description: 'Consent records retained for 6 years for NDPR compliance',
    },
  ],
  [
    'financial_reports',
    {
      dataType: 'financial_reports',
      activeRetentionDays: 730,
      archiveRetentionDays: 1825,
      totalRetentionDays: 2555, // ~7 years
      description: 'Financial reports retained for 7 years per Nigerian regulations',
    },
  ],
]);

export class RetentionManager {
  /** In-memory data record store keyed by record id. */
  private readonly records = new Map<string, RetentionDataRecord>();

  /** In-memory legal hold store keyed by hold id. */
  private readonly legalHolds = new Map<string, LegalHold>();

  /** In-memory audit log for retention actions. */
  private readonly auditLog: RetentionAuditEntry[] = [];

  /** Retention period configs (mutable copy so custom policies can be added). */
  private readonly retentionPolicies: Map<RetentionDataType, RetentionPeriodConfig>;

  constructor() {
    this.retentionPolicies = new Map(DEFAULT_RETENTION_PERIODS);
  }

  // ─── Retention Period Definitions (Requirement 8.1) ───

  /**
   * Get the retention period configuration for a data type.
   */
  getRetentionPeriod(dataType: RetentionDataType): RetentionPeriodConfig {
    const config = this.retentionPolicies.get(dataType);
    if (!config) {
      throw new Error(`No retention policy defined for data type: ${dataType}`);
    }
    return config;
  }

  /**
   * Get all defined retention period configurations.
   */
  getAllRetentionPeriods(): RetentionPeriodConfig[] {
    return Array.from(this.retentionPolicies.values());
  }

  /**
   * Set a custom retention period for a data type.
   */
  setRetentionPeriod(config: RetentionPeriodConfig): void {
    if (config.totalRetentionDays < config.activeRetentionDays) {
      throw new Error('Total retention must be >= active retention');
    }
    this.retentionPolicies.set(config.dataType, config);
  }

  // ─── Data Record Management ───

  /**
   * Register a data record for retention tracking.
   */
  addRecord(record: Omit<RetentionDataRecord, 'id'> & { id?: string }): RetentionDataRecord {
    const fullRecord: RetentionDataRecord = {
      id: record.id ?? randomUUID(),
      dataType: record.dataType,
      businessId: record.businessId,
      createdAt: record.createdAt,
      archivedAt: record.archivedAt,
      deletedAt: record.deletedAt,
      metadata: record.metadata,
    };
    this.records.set(fullRecord.id, fullRecord);
    return fullRecord;
  }

  /**
   * Get a data record by id.
   */
  getRecord(recordId: string): RetentionDataRecord | undefined {
    return this.records.get(recordId);
  }

  // ─── Retention Checks ───

  /**
   * Check the retention status of a data record.
   * Determines whether data should be retained, archived, or deleted.
   */
  checkRetention(recordId: string, now: Date = new Date()): RetentionCheckResult {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error(`Record not found: ${recordId}`);
    }

    const policy = this.getRetentionPeriod(record.dataType);
    const ageDays = this.calculateAgeDays(record.createdAt, now);
    const isOnLegalHold = this.isRecordOnLegalHold(recordId);

    let status: RetentionStatus;
    let reason: string;

    if (record.deletedAt) {
      status = 'deleted';
      reason = 'Record has been deleted';
    } else if (isOnLegalHold) {
      status = 'legal_hold';
      reason = 'Record is under legal hold and cannot be modified or deleted';
    } else if (ageDays >= policy.totalRetentionDays) {
      status = 'delete_eligible';
      reason = `Record age (${ageDays} days) exceeds total retention period (${policy.totalRetentionDays} days)`;
    } else if (record.archivedAt) {
      status = 'archived';
      reason = 'Record has been archived';
    } else if (ageDays >= policy.activeRetentionDays) {
      status = 'archive_eligible';
      reason = `Record age (${ageDays} days) exceeds active retention period (${policy.activeRetentionDays} days)`;
    } else {
      status = 'active';
      reason = `Record is within active retention period (${ageDays}/${policy.activeRetentionDays} days)`;
    }

    this.logRetentionAction({
      action: 'retention_check',
      recordId,
      dataType: record.dataType,
      businessId: record.businessId,
      performedBy: 'system',
      details: reason,
    });

    return {
      recordId,
      dataType: record.dataType,
      status,
      ageDays,
      policy,
      legalHold: isOnLegalHold,
      reason,
    };
  }

  /**
   * Check whether a data record is past its active retention period.
   */
  isPastActiveRetention(recordId: string, now: Date = new Date()): boolean {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error(`Record not found: ${recordId}`);
    }
    const policy = this.getRetentionPeriod(record.dataType);
    return this.calculateAgeDays(record.createdAt, now) >= policy.activeRetentionDays;
  }

  /**
   * Check whether a data record is past its total retention period.
   */
  isPastTotalRetention(recordId: string, now: Date = new Date()): boolean {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error(`Record not found: ${recordId}`);
    }
    const policy = this.getRetentionPeriod(record.dataType);
    return this.calculateAgeDays(record.createdAt, now) >= policy.totalRetentionDays;
  }

  // ─── Archive & Delete (Requirements 8.2, 8.3) ───

  /**
   * Archive a data record. Fails if the record is on legal hold.
   * Requirement 8.2: Automatically archive data past active retention period.
   */
  archiveRecord(recordId: string, performedBy: string = 'system'): RetentionDataRecord {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error(`Record not found: ${recordId}`);
    }
    if (record.deletedAt) {
      throw new Error(`Record ${recordId} is already deleted`);
    }
    if (record.archivedAt) {
      throw new Error(`Record ${recordId} is already archived`);
    }
    if (this.isRecordOnLegalHold(recordId)) {
      throw new Error(`Record ${recordId} is under legal hold and cannot be archived`);
    }

    record.archivedAt = new Date();

    this.logRetentionAction({
      action: 'archive',
      recordId,
      dataType: record.dataType,
      businessId: record.businessId,
      performedBy,
      details: `Record archived`,
    });

    return record;
  }

  /**
   * Delete a data record. Fails if the record is on legal hold.
   * Requirement 8.3: Automatically delete data past total retention period.
   */
  deleteRecord(recordId: string, performedBy: string = 'system'): RetentionDataRecord {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error(`Record not found: ${recordId}`);
    }
    if (record.deletedAt) {
      throw new Error(`Record ${recordId} is already deleted`);
    }
    if (this.isRecordOnLegalHold(recordId)) {
      throw new Error(`Record ${recordId} is under legal hold and cannot be deleted`);
    }

    record.deletedAt = new Date();

    this.logRetentionAction({
      action: 'delete',
      recordId,
      dataType: record.dataType,
      businessId: record.businessId,
      performedBy,
      details: `Record deleted`,
    });

    return record;
  }

  // ─── Legal Hold (Requirement 8.4) ───

  /**
   * Place a legal hold on one or more data records.
   * Records under legal hold cannot be archived or deleted.
   */
  placeLegalHold(input: {
    businessId: string;
    reason: string;
    createdBy: string;
    dataRecordIds: string[];
  }): LegalHold {
    // Validate all record ids exist
    for (const rid of input.dataRecordIds) {
      if (!this.records.has(rid)) {
        throw new Error(`Record not found: ${rid}`);
      }
    }

    const hold: LegalHold = {
      id: randomUUID(),
      businessId: input.businessId,
      reason: input.reason,
      createdBy: input.createdBy,
      createdAt: new Date(),
      dataRecordIds: [...input.dataRecordIds],
    };

    this.legalHolds.set(hold.id, hold);

    for (const rid of input.dataRecordIds) {
      const record = this.records.get(rid)!;
      this.logRetentionAction({
        action: 'legal_hold_placed',
        recordId: rid,
        dataType: record.dataType,
        businessId: record.businessId,
        performedBy: input.createdBy,
        details: `Legal hold placed: ${input.reason}`,
      });
    }

    return hold;
  }

  /**
   * Release a legal hold, allowing normal retention processing to resume.
   */
  releaseLegalHold(holdId: string, releasedBy: string): LegalHold {
    const hold = this.legalHolds.get(holdId);
    if (!hold) {
      throw new Error(`Legal hold not found: ${holdId}`);
    }
    if (hold.releasedAt) {
      throw new Error(`Legal hold ${holdId} is already released`);
    }

    hold.releasedAt = new Date();

    for (const rid of hold.dataRecordIds) {
      const record = this.records.get(rid);
      if (record) {
        this.logRetentionAction({
          action: 'legal_hold_released',
          recordId: rid,
          dataType: record.dataType,
          businessId: record.businessId,
          performedBy: releasedBy,
          details: `Legal hold released: ${hold.reason}`,
        });
      }
    }

    return hold;
  }

  /**
   * Check if a specific record is under any active legal hold.
   */
  isRecordOnLegalHold(recordId: string): boolean {
    for (const hold of this.legalHolds.values()) {
      if (!hold.releasedAt && hold.dataRecordIds.includes(recordId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all active legal holds for a business.
   */
  getActiveLegalHolds(businessId: string): LegalHold[] {
    const holds: LegalHold[] = [];
    for (const hold of this.legalHolds.values()) {
      if (hold.businessId === businessId && !hold.releasedAt) {
        holds.push(hold);
      }
    }
    return holds;
  }

  // ─── Audit Log (Requirement 8.5) ───

  /**
   * Get all retention audit log entries.
   */
  getAuditLog(): ReadonlyArray<RetentionAuditEntry> {
    return this.auditLog;
  }

  /**
   * Get audit log entries for a specific record.
   */
  getAuditLogForRecord(recordId: string): RetentionAuditEntry[] {
    return this.auditLog.filter((e) => e.recordId === recordId);
  }

  // ─── Batch Operations ───

  /**
   * Find all records eligible for archival.
   */
  findArchiveEligible(now: Date = new Date()): RetentionDataRecord[] {
    const eligible: RetentionDataRecord[] = [];
    for (const record of this.records.values()) {
      if (record.archivedAt || record.deletedAt) continue;
      if (this.isRecordOnLegalHold(record.id)) continue;
      const policy = this.getRetentionPeriod(record.dataType);
      if (this.calculateAgeDays(record.createdAt, now) >= policy.activeRetentionDays) {
        eligible.push(record);
      }
    }
    return eligible;
  }

  /**
   * Find all records eligible for deletion.
   */
  findDeleteEligible(now: Date = new Date()): RetentionDataRecord[] {
    const eligible: RetentionDataRecord[] = [];
    for (const record of this.records.values()) {
      if (record.deletedAt) continue;
      if (this.isRecordOnLegalHold(record.id)) continue;
      const policy = this.getRetentionPeriod(record.dataType);
      if (this.calculateAgeDays(record.createdAt, now) >= policy.totalRetentionDays) {
        eligible.push(record);
      }
    }
    return eligible;
  }

  // ─── Auto-Archival (Requirement 8.2) ───

  /**
   * Automatically archive all records that are past their active retention
   * period and eligible for archival.
   *
   * Requirement 8.2: Automatically archive data past active retention period.
   *
   * @param performedBy - Identity performing the operation (defaults to 'system').
   * @param now - Reference date for age calculations (defaults to current time).
   * @returns Summary of the auto-archival run.
   */
  autoArchive(
    performedBy: string = 'system',
    now: Date = new Date(),
  ): {
    archived: RetentionDataRecord[];
    skipped: Array<{ recordId: string; reason: string }>;
    total: number;
  } {
    const eligible = this.findArchiveEligible(now);
    const archived: RetentionDataRecord[] = [];
    const skipped: Array<{ recordId: string; reason: string }> = [];

    for (const record of eligible) {
      try {
        this.archiveRecord(record.id, performedBy);
        archived.push(record);
      } catch (err) {
        skipped.push({
          recordId: record.id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logRetentionAction({
      action: 'auto_archive',
      recordId: '',
      dataType: 'transactions',
      businessId: '',
      performedBy,
      details: `Auto-archive completed: ${archived.length} archived, ${skipped.length} skipped out of ${eligible.length} eligible`,
    });

    return { archived, skipped, total: eligible.length };
  }

  // ─── Auto-Deletion (Requirement 8.3) ───

  /**
   * Automatically delete all records that are past their total retention
   * period and eligible for deletion.
   *
   * Requirement 8.3: Automatically delete data past total retention period.
   *
   * @param performedBy - Identity performing the operation (defaults to 'system').
   * @param now - Reference date for age calculations (defaults to current time).
   * @returns Summary of the auto-deletion run.
   */
  autoDelete(
    performedBy: string = 'system',
    now: Date = new Date(),
  ): {
    deleted: RetentionDataRecord[];
    skipped: Array<{ recordId: string; reason: string }>;
    total: number;
  } {
    const eligible = this.findDeleteEligible(now);
    const deleted: RetentionDataRecord[] = [];
    const skipped: Array<{ recordId: string; reason: string }> = [];

    for (const record of eligible) {
      try {
        this.deleteRecord(record.id, performedBy);
        deleted.push(record);
      } catch (err) {
        skipped.push({
          recordId: record.id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logRetentionAction({
      action: 'auto_delete',
      recordId: '',
      dataType: 'transactions',
      businessId: '',
      performedBy,
      details: `Auto-delete completed: ${deleted.length} deleted, ${skipped.length} skipped out of ${eligible.length} eligible`,
    });

    return { deleted, skipped, total: eligible.length };
  }

  // ─── Helpers ───

  private calculateAgeDays(createdAt: Date, now: Date): number {
    return Math.floor((now.getTime() - createdAt.getTime()) / MS_PER_DAY);
  }

  private logRetentionAction(input: Omit<RetentionAuditEntry, 'id' | 'performedAt'>): void {
    this.auditLog.push({
      id: randomUUID(),
      ...input,
      performedAt: new Date(),
    });
  }
}
