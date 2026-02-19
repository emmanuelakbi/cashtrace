/**
 * Property-based tests for Retention Enforcement
 *
 * **Property 8: Retention Enforcement**
 * For any data past retention period, it SHALL be archived or deleted
 * according to policy.
 *
 * **Validates: Requirements 8.2, 8.3**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { RetentionManager } from './retentionManager.js';
import type { RetentionDataType } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ALL_DATA_TYPES: RetentionDataType[] = [
  'transactions',
  'logs',
  'audit_records',
  'user_data',
  'consent_records',
  'financial_reports',
];

// ─── Generators ──────────────────────────────────────────────────────────────

const dataTypeArb: fc.Arbitrary<RetentionDataType> = fc.constantFrom(...ALL_DATA_TYPES);

const businessIdArb = fc.stringMatching(/^biz-[a-z0-9]{1,12}$/);

/**
 * Generate a "now" reference date and a record createdAt date that is
 * past the active retention period for the given data type.
 * Returns { createdAt, now } where the record age >= activeRetentionDays.
 */
function pastActiveRetentionArb(dataType: RetentionDataType) {
  const manager = new RetentionManager();
  const policy = manager.getRetentionPeriod(dataType);
  // Extra days past active retention: [0, archiveRetentionDays - 1] to stay below total
  const maxExtra = Math.max(policy.totalRetentionDays - policy.activeRetentionDays - 1, 0);
  return fc.integer({ min: 0, max: maxExtra }).map((extraDays) => {
    const ageDays = policy.activeRetentionDays + extraDays;
    const now = new Date('2025-01-01T00:00:00Z');
    const createdAt = new Date(now.getTime() - ageDays * MS_PER_DAY);
    return { createdAt, now, ageDays };
  });
}

/**
 * Generate dates where the record is past the total retention period.
 */
function pastTotalRetentionArb(dataType: RetentionDataType) {
  const manager = new RetentionManager();
  const policy = manager.getRetentionPeriod(dataType);
  return fc.integer({ min: 0, max: 1000 }).map((extraDays) => {
    const ageDays = policy.totalRetentionDays + extraDays;
    const now = new Date('2025-01-01T00:00:00Z');
    const createdAt = new Date(now.getTime() - ageDays * MS_PER_DAY);
    return { createdAt, now, ageDays };
  });
}

/**
 * Generate dates where the record is within active retention (not eligible for archival).
 */
function withinActiveRetentionArb(dataType: RetentionDataType) {
  const manager = new RetentionManager();
  const policy = manager.getRetentionPeriod(dataType);
  // Age in [0, activeRetentionDays - 1]
  return fc.integer({ min: 0, max: policy.activeRetentionDays - 1 }).map((ageDays) => {
    const now = new Date('2025-01-01T00:00:00Z');
    const createdAt = new Date(now.getTime() - ageDays * MS_PER_DAY);
    return { createdAt, now, ageDays };
  });
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Retention Enforcement (Property 8)', () => {
  /**
   * **Validates: Requirements 8.2**
   *
   * For any record past active retention (and not on legal hold),
   * autoArchive will archive it.
   */
  it('archives records past active retention period', () => {
    fc.assert(
      fc.property(
        dataTypeArb.chain((dt) =>
          fc.tuple(fc.constant(dt), businessIdArb, pastActiveRetentionArb(dt)),
        ),
        ([dataType, businessId, { createdAt, now }]) => {
          const manager = new RetentionManager();
          const record = manager.addRecord({ dataType, businessId, createdAt });

          const result = manager.autoArchive('system', now);

          expect(result.archived.some((r) => r.id === record.id)).toBe(true);
          const updated = manager.getRecord(record.id)!;
          expect(updated.archivedAt).toBeDefined();
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * For any record past total retention (and not on legal hold),
   * it will be eligible for deletion.
   */
  it('marks records past total retention as delete-eligible', () => {
    fc.assert(
      fc.property(
        dataTypeArb.chain((dt) =>
          fc.tuple(fc.constant(dt), businessIdArb, pastTotalRetentionArb(dt)),
        ),
        ([dataType, businessId, { createdAt, now }]) => {
          const manager = new RetentionManager();
          const record = manager.addRecord({ dataType, businessId, createdAt });

          const eligible = manager.findDeleteEligible(now);
          expect(eligible.some((r) => r.id === record.id)).toBe(true);

          const check = manager.checkRetention(record.id, now);
          expect(check.status).toBe('delete_eligible');
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 8.2, 8.3**
   *
   * Legal holds prevent both archival and deletion regardless of record age.
   */
  it('legal holds prevent archival and deletion regardless of age', () => {
    fc.assert(
      fc.property(
        dataTypeArb.chain((dt) =>
          fc.tuple(fc.constant(dt), businessIdArb, pastTotalRetentionArb(dt)),
        ),
        ([dataType, businessId, { createdAt, now }]) => {
          const manager = new RetentionManager();
          const record = manager.addRecord({ dataType, businessId, createdAt });

          manager.placeLegalHold({
            businessId,
            reason: 'Investigation',
            createdBy: 'admin',
            dataRecordIds: [record.id],
          });

          // autoArchive should not archive the held record
          const archiveResult = manager.autoArchive('system', now);
          expect(archiveResult.archived.some((r) => r.id === record.id)).toBe(false);
          expect(manager.getRecord(record.id)!.archivedAt).toBeUndefined();

          // findDeleteEligible should not include the held record
          const deleteEligible = manager.findDeleteEligible(now);
          expect(deleteEligible.some((r) => r.id === record.id)).toBe(false);

          // Direct deletion should throw
          expect(() => manager.deleteRecord(record.id)).toThrow(/legal hold/i);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * Records within active retention are never archived by autoArchive.
   */
  it('does not archive records within active retention period', () => {
    fc.assert(
      fc.property(
        dataTypeArb.chain((dt) =>
          fc.tuple(fc.constant(dt), businessIdArb, withinActiveRetentionArb(dt)),
        ),
        ([dataType, businessId, { createdAt, now }]) => {
          const manager = new RetentionManager();
          const record = manager.addRecord({ dataType, businessId, createdAt });

          const result = manager.autoArchive('system', now);

          expect(result.archived.some((r) => r.id === record.id)).toBe(false);
          expect(manager.getRecord(record.id)!.archivedAt).toBeUndefined();

          const check = manager.checkRetention(record.id, now);
          expect(check.status).toBe('active');
        },
      ),
      { numRuns: 200 },
    );
  });
});
