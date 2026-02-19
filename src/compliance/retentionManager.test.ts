import { describe, it, expect, beforeEach } from 'vitest';
import { RetentionManager } from './retentionManager.js';
import type { RetentionDataType } from './types.js';

/** Helper: create a date N days in the past. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe('RetentionManager', () => {
  let manager: RetentionManager;

  beforeEach(() => {
    manager = new RetentionManager();
  });

  // ─── Requirement 8.1: Retention periods per data type ───

  describe('getRetentionPeriod', () => {
    it('should return 7-year retention for transactions', () => {
      const config = manager.getRetentionPeriod('transactions');
      expect(config.dataType).toBe('transactions');
      expect(config.totalRetentionDays).toBe(2555);
      expect(config.activeRetentionDays).toBe(365);
    });

    it('should return 1-year retention for logs', () => {
      const config = manager.getRetentionPeriod('logs');
      expect(config.dataType).toBe('logs');
      expect(config.totalRetentionDays).toBe(365);
      expect(config.activeRetentionDays).toBe(90);
    });

    it('should define retention periods for all data types', () => {
      const types: RetentionDataType[] = [
        'transactions',
        'logs',
        'audit_records',
        'user_data',
        'consent_records',
        'financial_reports',
      ];
      for (const dt of types) {
        const config = manager.getRetentionPeriod(dt);
        expect(config.dataType).toBe(dt);
        expect(config.totalRetentionDays).toBeGreaterThan(0);
        expect(config.activeRetentionDays).toBeGreaterThan(0);
        expect(config.totalRetentionDays).toBeGreaterThanOrEqual(config.activeRetentionDays);
      }
    });

    it('should return all retention periods via getAllRetentionPeriods', () => {
      const all = manager.getAllRetentionPeriods();
      expect(all.length).toBe(6);
    });
  });

  describe('setRetentionPeriod', () => {
    it('should allow setting a custom retention period', () => {
      manager.setRetentionPeriod({
        dataType: 'logs',
        activeRetentionDays: 180,
        archiveRetentionDays: 180,
        totalRetentionDays: 730,
        description: 'Custom log retention',
      });
      const config = manager.getRetentionPeriod('logs');
      expect(config.totalRetentionDays).toBe(730);
    });

    it('should reject total retention less than active retention', () => {
      expect(() =>
        manager.setRetentionPeriod({
          dataType: 'logs',
          activeRetentionDays: 500,
          archiveRetentionDays: 100,
          totalRetentionDays: 200,
          description: 'Invalid',
        }),
      ).toThrow('Total retention must be >= active retention');
    });
  });

  // ─── Data Record Management ───

  describe('addRecord / getRecord', () => {
    it('should add and retrieve a data record', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: new Date(),
      });
      expect(record.id).toBeDefined();
      expect(manager.getRecord(record.id)).toBe(record);
    });

    it('should return undefined for unknown record id', () => {
      expect(manager.getRecord('nonexistent')).toBeUndefined();
    });
  });

  // ─── Retention Checks ───

  describe('checkRetention', () => {
    it('should return active for recent data', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: new Date(),
      });
      const result = manager.checkRetention(record.id);
      expect(result.status).toBe('active');
      expect(result.legalHold).toBe(false);
    });

    it('should return archive_eligible when past active retention', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400), // > 365 active retention
      });
      const result = manager.checkRetention(record.id);
      expect(result.status).toBe('archive_eligible');
    });

    it('should return delete_eligible when past total retention', () => {
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400), // > 365 total retention for logs
      });
      const result = manager.checkRetention(record.id);
      expect(result.status).toBe('delete_eligible');
    });

    it('should return archived for already-archived records within total retention', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(500),
        archivedAt: daysAgo(100),
      });
      const result = manager.checkRetention(record.id);
      expect(result.status).toBe('archived');
    });

    it('should return deleted for already-deleted records', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(500),
        deletedAt: daysAgo(10),
      });
      const result = manager.checkRetention(record.id);
      expect(result.status).toBe('deleted');
    });

    it('should return legal_hold when record is on hold', () => {
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400), // past total retention
      });
      manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Investigation',
        createdBy: 'admin',
        dataRecordIds: [record.id],
      });
      const result = manager.checkRetention(record.id);
      expect(result.status).toBe('legal_hold');
      expect(result.legalHold).toBe(true);
    });

    it('should throw for unknown record id', () => {
      expect(() => manager.checkRetention('nonexistent')).toThrow('Record not found');
    });
  });

  describe('isPastActiveRetention / isPastTotalRetention', () => {
    it('should correctly identify records past active retention', () => {
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(100), // > 90 active retention for logs
      });
      expect(manager.isPastActiveRetention(record.id)).toBe(true);
      expect(manager.isPastTotalRetention(record.id)).toBe(false);
    });

    it('should correctly identify records past total retention', () => {
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400), // > 365 total retention for logs
      });
      expect(manager.isPastTotalRetention(record.id)).toBe(true);
    });

    it('should throw for unknown record id', () => {
      expect(() => manager.isPastActiveRetention('nope')).toThrow('Record not found');
      expect(() => manager.isPastTotalRetention('nope')).toThrow('Record not found');
    });
  });

  // ─── Archive & Delete (Requirements 8.2, 8.3) ───

  describe('archiveRecord', () => {
    it('should archive a record and set archivedAt', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      const archived = manager.archiveRecord(record.id, 'admin');
      expect(archived.archivedAt).toBeInstanceOf(Date);
    });

    it('should throw when archiving a deleted record', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
        deletedAt: new Date(),
      });
      expect(() => manager.archiveRecord(record.id)).toThrow('already deleted');
    });

    it('should throw when archiving an already-archived record', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
        archivedAt: new Date(),
      });
      expect(() => manager.archiveRecord(record.id)).toThrow('already archived');
    });

    it('should throw when archiving a record on legal hold', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Investigation',
        createdBy: 'admin',
        dataRecordIds: [record.id],
      });
      expect(() => manager.archiveRecord(record.id)).toThrow('legal hold');
    });

    it('should throw for unknown record id', () => {
      expect(() => manager.archiveRecord('nope')).toThrow('Record not found');
    });
  });

  describe('deleteRecord', () => {
    it('should delete a record and set deletedAt', () => {
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      const deleted = manager.deleteRecord(record.id, 'admin');
      expect(deleted.deletedAt).toBeInstanceOf(Date);
    });

    it('should throw when deleting an already-deleted record', () => {
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
        deletedAt: new Date(),
      });
      expect(() => manager.deleteRecord(record.id)).toThrow('already deleted');
    });

    it('should throw when deleting a record on legal hold', () => {
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Investigation',
        createdBy: 'admin',
        dataRecordIds: [record.id],
      });
      expect(() => manager.deleteRecord(record.id)).toThrow('legal hold');
    });

    it('should throw for unknown record id', () => {
      expect(() => manager.deleteRecord('nope')).toThrow('Record not found');
    });
  });

  // ─── Legal Hold (Requirement 8.4) ───

  describe('placeLegalHold', () => {
    it('should create a legal hold on records', () => {
      const r1 = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: new Date(),
      });
      const r2 = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: new Date(),
      });

      const hold = manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Fraud investigation',
        createdBy: 'legal-team',
        dataRecordIds: [r1.id, r2.id],
      });

      expect(hold.id).toBeDefined();
      expect(hold.dataRecordIds).toEqual([r1.id, r2.id]);
      expect(hold.releasedAt).toBeUndefined();
      expect(manager.isRecordOnLegalHold(r1.id)).toBe(true);
      expect(manager.isRecordOnLegalHold(r2.id)).toBe(true);
    });

    it('should throw if any record id does not exist', () => {
      expect(() =>
        manager.placeLegalHold({
          businessId: 'biz-1',
          reason: 'Test',
          createdBy: 'admin',
          dataRecordIds: ['nonexistent'],
        }),
      ).toThrow('Record not found');
    });
  });

  describe('releaseLegalHold', () => {
    it('should release a legal hold', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: new Date(),
      });
      const hold = manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Investigation',
        createdBy: 'admin',
        dataRecordIds: [record.id],
      });

      const released = manager.releaseLegalHold(hold.id, 'admin');
      expect(released.releasedAt).toBeInstanceOf(Date);
      expect(manager.isRecordOnLegalHold(record.id)).toBe(false);
    });

    it('should throw for unknown hold id', () => {
      expect(() => manager.releaseLegalHold('nope', 'admin')).toThrow('Legal hold not found');
    });

    it('should throw when releasing an already-released hold', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: new Date(),
      });
      const hold = manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Test',
        createdBy: 'admin',
        dataRecordIds: [record.id],
      });
      manager.releaseLegalHold(hold.id, 'admin');
      expect(() => manager.releaseLegalHold(hold.id, 'admin')).toThrow('already released');
    });
  });

  describe('getActiveLegalHolds', () => {
    it('should return only active holds for a business', () => {
      const r1 = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: new Date(),
      });
      const r2 = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: new Date(),
      });

      const hold1 = manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Hold 1',
        createdBy: 'admin',
        dataRecordIds: [r1.id],
      });
      manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Hold 2',
        createdBy: 'admin',
        dataRecordIds: [r2.id],
      });
      manager.releaseLegalHold(hold1.id, 'admin');

      const active = manager.getActiveLegalHolds('biz-1');
      expect(active).toHaveLength(1);
      expect(active[0]!.reason).toBe('Hold 2');
    });

    it('should not return holds from other businesses', () => {
      const r1 = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: new Date(),
      });
      manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Hold',
        createdBy: 'admin',
        dataRecordIds: [r1.id],
      });

      expect(manager.getActiveLegalHolds('biz-2')).toHaveLength(0);
    });
  });

  // ─── Audit Log (Requirement 8.5) ───

  describe('audit logging', () => {
    it('should log retention check actions', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: new Date(),
      });
      manager.checkRetention(record.id);

      const log = manager.getAuditLogForRecord(record.id);
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log.some((e) => e.action === 'retention_check')).toBe(true);
    });

    it('should log archive actions', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      manager.archiveRecord(record.id, 'admin');

      const log = manager.getAuditLogForRecord(record.id);
      expect(log.some((e) => e.action === 'archive')).toBe(true);
    });

    it('should log delete actions', () => {
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      manager.deleteRecord(record.id, 'admin');

      const log = manager.getAuditLogForRecord(record.id);
      expect(log.some((e) => e.action === 'delete')).toBe(true);
    });

    it('should log legal hold placed and released actions', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: new Date(),
      });
      const hold = manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Test',
        createdBy: 'admin',
        dataRecordIds: [record.id],
      });
      manager.releaseLegalHold(hold.id, 'admin');

      const log = manager.getAuditLogForRecord(record.id);
      expect(log.some((e) => e.action === 'legal_hold_placed')).toBe(true);
      expect(log.some((e) => e.action === 'legal_hold_released')).toBe(true);
    });

    it('should include performedBy in audit entries', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      manager.archiveRecord(record.id, 'compliance-officer');

      const log = manager.getAuditLogForRecord(record.id);
      const archiveEntry = log.find((e) => e.action === 'archive');
      expect(archiveEntry?.performedBy).toBe('compliance-officer');
    });
  });

  // ─── Batch Operations ───

  describe('findArchiveEligible', () => {
    it('should find records past active retention that are not archived or deleted', () => {
      manager.addRecord({ dataType: 'transactions', businessId: 'biz-1', createdAt: daysAgo(400) });
      manager.addRecord({ dataType: 'transactions', businessId: 'biz-1', createdAt: daysAgo(10) });
      manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(500),
        archivedAt: daysAgo(100),
      });

      const eligible = manager.findArchiveEligible();
      expect(eligible).toHaveLength(1);
    });

    it('should exclude records on legal hold', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Hold',
        createdBy: 'admin',
        dataRecordIds: [record.id],
      });

      expect(manager.findArchiveEligible()).toHaveLength(0);
    });
  });

  describe('findDeleteEligible', () => {
    it('should find records past total retention that are not deleted', () => {
      manager.addRecord({ dataType: 'logs', businessId: 'biz-1', createdAt: daysAgo(400) }); // past 365
      manager.addRecord({ dataType: 'logs', businessId: 'biz-1', createdAt: daysAgo(100) }); // not past

      const eligible = manager.findDeleteEligible();
      expect(eligible).toHaveLength(1);
    });

    it('should exclude records on legal hold', () => {
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Hold',
        createdBy: 'admin',
        dataRecordIds: [record.id],
      });

      expect(manager.findDeleteEligible()).toHaveLength(0);
    });
  });

  // ─── Auto-Archival (Requirement 8.2) ───

  describe('autoArchive', () => {
    it('should archive all eligible records past active retention', () => {
      const r1 = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      const r2 = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(100),
      }); // past 90-day active
      // Still within active retention – should NOT be archived
      manager.addRecord({ dataType: 'transactions', businessId: 'biz-1', createdAt: daysAgo(10) });

      const result = manager.autoArchive();

      expect(result.total).toBe(2);
      expect(result.archived).toHaveLength(2);
      expect(result.skipped).toHaveLength(0);
      expect(result.archived.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort());

      // Verify records are actually archived
      expect(manager.getRecord(r1.id)?.archivedAt).toBeInstanceOf(Date);
      expect(manager.getRecord(r2.id)?.archivedAt).toBeInstanceOf(Date);
    });

    it('should return empty results when no records are eligible', () => {
      manager.addRecord({ dataType: 'transactions', businessId: 'biz-1', createdAt: new Date() });

      const result = manager.autoArchive();

      expect(result.total).toBe(0);
      expect(result.archived).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });

    it('should skip records on legal hold', () => {
      const r1 = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      const r2 = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });

      manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Investigation',
        createdBy: 'admin',
        dataRecordIds: [r1.id],
      });

      const result = manager.autoArchive();

      // r1 is on legal hold so findArchiveEligible excludes it; only r2 is eligible
      expect(result.total).toBe(1);
      expect(result.archived).toHaveLength(1);
      expect(result.archived[0]!.id).toBe(r2.id);
      expect(manager.getRecord(r1.id)?.archivedAt).toBeUndefined();
    });

    it('should not archive already-archived or deleted records', () => {
      manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
        archivedAt: daysAgo(50),
      });
      manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
        deletedAt: daysAgo(50),
      });

      const result = manager.autoArchive();

      expect(result.total).toBe(0);
      expect(result.archived).toHaveLength(0);
    });

    it('should log an auto_archive audit entry', () => {
      manager.addRecord({ dataType: 'transactions', businessId: 'biz-1', createdAt: daysAgo(400) });

      manager.autoArchive('retention-bot');

      const log = manager.getAuditLog();
      const autoArchiveEntry = log.find((e) => e.action === 'auto_archive');
      expect(autoArchiveEntry).toBeDefined();
      expect(autoArchiveEntry!.performedBy).toBe('retention-bot');
      expect(autoArchiveEntry!.details).toContain('1 archived');
    });

    it('should log individual archive actions for each record', () => {
      const r1 = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      const r2 = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-2',
        createdAt: daysAgo(100),
      });

      manager.autoArchive('system');

      const r1Log = manager.getAuditLogForRecord(r1.id);
      const r2Log = manager.getAuditLogForRecord(r2.id);
      expect(r1Log.some((e) => e.action === 'archive')).toBe(true);
      expect(r2Log.some((e) => e.action === 'archive')).toBe(true);
    });

    it('should use the provided performedBy identity', () => {
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });

      manager.autoArchive('cron-scheduler');

      const log = manager.getAuditLogForRecord(record.id);
      const archiveEntry = log.find((e) => e.action === 'archive');
      expect(archiveEntry?.performedBy).toBe('cron-scheduler');
    });

    it('should accept a custom reference date', () => {
      // Record is 50 days old – not eligible with current date for transactions (365 active)
      const record = manager.addRecord({
        dataType: 'transactions',
        businessId: 'biz-1',
        createdAt: daysAgo(50),
      });

      // With a future reference date that makes it 400 days old, it should be eligible
      const futureDate = new Date(Date.now() + 350 * 24 * 60 * 60 * 1000);
      const result = manager.autoArchive('system', futureDate);

      expect(result.archived).toHaveLength(1);
      expect(result.archived[0]!.id).toBe(record.id);
    });

    it('should handle mixed data types correctly', () => {
      // Logs: 90-day active retention
      manager.addRecord({ dataType: 'logs', businessId: 'biz-1', createdAt: daysAgo(100) }); // eligible
      manager.addRecord({ dataType: 'logs', businessId: 'biz-1', createdAt: daysAgo(50) }); // not eligible
      // Transactions: 365-day active retention
      manager.addRecord({ dataType: 'transactions', businessId: 'biz-1', createdAt: daysAgo(400) }); // eligible
      manager.addRecord({ dataType: 'transactions', businessId: 'biz-1', createdAt: daysAgo(100) }); // not eligible

      const result = manager.autoArchive();

      expect(result.total).toBe(2);
      expect(result.archived).toHaveLength(2);
    });
  });

  // ─── Auto-Deletion (Requirement 8.3) ───

  describe('autoDelete', () => {
    it('should delete all eligible records past total retention', () => {
      // Logs: 365-day total retention
      const r1 = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400), // past 365 total
      });
      const r2 = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-2',
        createdAt: daysAgo(500), // past 365 total
      });
      // Not past total retention – should NOT be deleted
      manager.addRecord({ dataType: 'logs', businessId: 'biz-1', createdAt: daysAgo(100) });

      const result = manager.autoDelete();

      expect(result.total).toBe(2);
      expect(result.deleted).toHaveLength(2);
      expect(result.skipped).toHaveLength(0);
      expect(result.deleted.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort());

      // Verify records are actually deleted
      expect(manager.getRecord(r1.id)?.deletedAt).toBeInstanceOf(Date);
      expect(manager.getRecord(r2.id)?.deletedAt).toBeInstanceOf(Date);
    });

    it('should return empty results when no records are eligible', () => {
      manager.addRecord({ dataType: 'transactions', businessId: 'biz-1', createdAt: new Date() });

      const result = manager.autoDelete();

      expect(result.total).toBe(0);
      expect(result.deleted).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });

    it('should skip records on legal hold', () => {
      const r1 = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      const r2 = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });

      manager.placeLegalHold({
        businessId: 'biz-1',
        reason: 'Investigation',
        createdBy: 'admin',
        dataRecordIds: [r1.id],
      });

      const result = manager.autoDelete();

      // r1 is on legal hold so findDeleteEligible excludes it; only r2 is eligible
      expect(result.total).toBe(1);
      expect(result.deleted).toHaveLength(1);
      expect(result.deleted[0]!.id).toBe(r2.id);
      expect(manager.getRecord(r1.id)?.deletedAt).toBeUndefined();
    });

    it('should not delete already-deleted records', () => {
      manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
        deletedAt: daysAgo(50),
      });

      const result = manager.autoDelete();

      expect(result.total).toBe(0);
      expect(result.deleted).toHaveLength(0);
    });

    it('should log an auto_delete audit entry', () => {
      manager.addRecord({ dataType: 'logs', businessId: 'biz-1', createdAt: daysAgo(400) });

      manager.autoDelete('retention-bot');

      const log = manager.getAuditLog();
      const autoDeleteEntry = log.find((e) => e.action === 'auto_delete');
      expect(autoDeleteEntry).toBeDefined();
      expect(autoDeleteEntry!.performedBy).toBe('retention-bot');
      expect(autoDeleteEntry!.details).toContain('1 deleted');
    });

    it('should log individual delete actions for each record', () => {
      const r1 = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });
      const r2 = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-2',
        createdAt: daysAgo(400),
      });

      manager.autoDelete('system');

      const r1Log = manager.getAuditLogForRecord(r1.id);
      const r2Log = manager.getAuditLogForRecord(r2.id);
      expect(r1Log.some((e) => e.action === 'delete')).toBe(true);
      expect(r2Log.some((e) => e.action === 'delete')).toBe(true);
    });

    it('should use the provided performedBy identity', () => {
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
      });

      manager.autoDelete('cron-scheduler');

      const log = manager.getAuditLogForRecord(record.id);
      const deleteEntry = log.find((e) => e.action === 'delete');
      expect(deleteEntry?.performedBy).toBe('cron-scheduler');
    });

    it('should accept a custom reference date', () => {
      // Record is 50 days old – not eligible with current date for logs (365 total)
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(50),
      });

      // With a future reference date that makes it 400 days old, it should be eligible
      const futureDate = new Date(Date.now() + 350 * 24 * 60 * 60 * 1000);
      const result = manager.autoDelete('system', futureDate);

      expect(result.deleted).toHaveLength(1);
      expect(result.deleted[0]!.id).toBe(record.id);
    });

    it('should handle mixed data types correctly', () => {
      // Logs: 365-day total retention
      manager.addRecord({ dataType: 'logs', businessId: 'biz-1', createdAt: daysAgo(400) }); // eligible
      manager.addRecord({ dataType: 'logs', businessId: 'biz-1', createdAt: daysAgo(100) }); // not eligible
      // User data: 730-day total retention
      manager.addRecord({ dataType: 'user_data', businessId: 'biz-1', createdAt: daysAgo(800) }); // eligible
      manager.addRecord({ dataType: 'user_data', businessId: 'biz-1', createdAt: daysAgo(400) }); // not eligible

      const result = manager.autoDelete();

      expect(result.total).toBe(2);
      expect(result.deleted).toHaveLength(2);
    });

    it('should delete archived records that are past total retention', () => {
      // An archived record that is now past total retention should still be deletable
      const record = manager.addRecord({
        dataType: 'logs',
        businessId: 'biz-1',
        createdAt: daysAgo(400),
        archivedAt: daysAgo(300),
      });

      const result = manager.autoDelete();

      expect(result.deleted).toHaveLength(1);
      expect(result.deleted[0]!.id).toBe(record.id);
      expect(manager.getRecord(record.id)?.deletedAt).toBeInstanceOf(Date);
    });
  });
});
