/**
 * Property-based tests for Audit Immutability
 *
 * **Property 6: Audit Immutability**
 * For any audit log entry, modification or deletion SHALL be prevented,
 * and tampering SHALL be detectable via checksum.
 *
 * **Validates: Requirements 10.5**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createAuditLogger, computeChecksum, type AuditLogEntry } from './auditLogger.js';

// ─── Generators ──────────────────────────────────────────────────────────────

const eventTypeArb = fc.constantFrom('data_access', 'data_modify', 'auth', 'admin') as fc.Arbitrary<
  'data_access' | 'data_modify' | 'auth' | 'admin'
>;

const actionArb = fc.constantFrom('create', 'read', 'update', 'delete', 'login', 'logout') as fc.Arbitrary<
  'create' | 'read' | 'update' | 'delete' | 'login' | 'logout'
>;

const safeStringArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/);

const ipArb = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

const optionalRecordArb = fc.option(fc.dictionary(fc.stringMatching(/^[a-z]{1,8}$/), fc.jsonValue()), {
  nil: undefined,
});

/** Generate a complete audit log entry (without checksum chain). */
const auditEntryPartsArb = fc.record({
  id: fc.uuid(),
  timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
  eventType: eventTypeArb,
  userId: safeStringArb,
  businessId: safeStringArb,
  resourceType: safeStringArb,
  resourceId: safeStringArb,
  action: actionArb,
  previousValue: optionalRecordArb,
  newValue: optionalRecordArb,
  ipAddress: ipArb,
  userAgent: safeStringArb,
  correlationId: fc.uuid(),
  previousChecksum: fc.option(fc.stringMatching(/^[a-f0-9]{64}$/), { nil: null }),
});

/** Generate access params for the logger. */
const accessParamsArb = fc.record({
  userId: safeStringArb,
  businessId: safeStringArb,
  resourceType: safeStringArb,
  resourceId: safeStringArb,
  ipAddress: ipArb,
  userAgent: safeStringArb,
});

// ─── Tamper field selectors ──────────────────────────────────────────────────

type TamperableField = keyof Omit<AuditLogEntry, 'checksum' | 'previousValue' | 'newValue' | 'timestamp'>;

const tamperableFields: TamperableField[] = [
  'id',
  'eventType',
  'userId',
  'businessId',
  'resourceType',
  'resourceId',
  'action',
  'ipAddress',
  'userAgent',
  'correlationId',
  'previousChecksum',
];

const tamperFieldArb = fc.constantFrom(...tamperableFields);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Audit Immutability (Property 6)', () => {
  /**
   * For any audit entry, the checksum is deterministic — same content always
   * produces the same checksum.
   */
  it('checksum is deterministic for the same entry content', () => {
    fc.assert(
      fc.property(auditEntryPartsArb, (parts) => {
        const entry: Omit<AuditLogEntry, 'checksum'> = { ...parts };
        const checksum1 = computeChecksum(entry);
        const checksum2 = computeChecksum(entry);
        expect(checksum1).toBe(checksum2);
        expect(checksum1).toMatch(/^[a-f0-9]{64}$/);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any modification to any field of an audit entry, the checksum
   * verification detects the tampering.
   */
  it('detects tampering when any string field is modified', () => {
    fc.assert(
      fc.property(
        auditEntryPartsArb,
        tamperFieldArb,
        safeStringArb,
        (parts, field, newValue) => {
          const entry: Omit<AuditLogEntry, 'checksum'> = { ...parts };
          const originalChecksum = computeChecksum(entry);

          // Create a tampered copy
          const tampered = { ...entry, [field]: newValue };

          // Only test when the value actually changed
          if (JSON.stringify(tampered[field]) === JSON.stringify(entry[field])) return;

          const tamperedChecksum = computeChecksum(tampered);
          expect(tamperedChecksum).not.toBe(originalChecksum);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * For any sequence of audit entries, the hash chain is valid.
   */
  it('hash chain is valid for any sequence of logged entries', () => {
    fc.assert(
      fc.property(
        fc.array(accessParamsArb, { minLength: 1, maxLength: 10 }),
        (paramsList) => {
          const logger = createAuditLogger();
          for (const params of paramsList) {
            logger.logAccess(params);
          }

          const result = logger.verifyChain();
          expect(result.valid).toBe(true);
          expect(result.brokenAt).toBeNull();

          // Also verify each entry individually
          const bulk = logger.verifyAll();
          expect(bulk.valid).toBe(true);
          expect(bulk.tamperedEntries).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * For any modification to any entry in a chain, the chain verification
   * detects the break.
   */
  it('detects chain break when any entry in a sequence is tampered', () => {
    fc.assert(
      fc.property(
        fc.array(accessParamsArb, { minLength: 2, maxLength: 8 }),
        (paramsList) => {
          const logger = createAuditLogger();
          for (const params of paramsList) {
            logger.logAccess(params);
          }

          const entries = logger.getEntries();
          // Pick a random entry to tamper
          const idx = Math.floor(Math.random() * entries.length);
          const target = entries[idx];

          // Tamper with the entry's userId
          (target as Record<string, unknown>).userId = 'tampered-user-xyz';

          // Chain verification should detect the break
          const chainResult = logger.verifyChain();
          expect(chainResult.valid).toBe(false);
          expect(chainResult.brokenAt).toBe(target.id);

          // Bulk integrity should also detect it
          const bulkResult = logger.verifyAll();
          expect(bulkResult.valid).toBe(false);
          expect(bulkResult.tamperedEntries).toContain(target.id);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Checksums are unique for entries with different content.
   */
  it('produces unique checksums for entries with different content', () => {
    fc.assert(
      fc.property(
        auditEntryPartsArb,
        auditEntryPartsArb,
        (parts1, parts2) => {
          const entry1: Omit<AuditLogEntry, 'checksum'> = { ...parts1 };
          const entry2: Omit<AuditLogEntry, 'checksum'> = { ...parts2 };

          const checksum1 = computeChecksum(entry1);
          const checksum2 = computeChecksum(entry2);

          // If the serialized content differs, checksums must differ
          const serialize = (e: Omit<AuditLogEntry, 'checksum'>) =>
            JSON.stringify({
              id: e.id,
              timestamp: e.timestamp.toISOString(),
              eventType: e.eventType,
              userId: e.userId,
              businessId: e.businessId,
              resourceType: e.resourceType,
              resourceId: e.resourceId,
              action: e.action,
              previousValue: e.previousValue,
              newValue: e.newValue,
              ipAddress: e.ipAddress,
              userAgent: e.userAgent,
              correlationId: e.correlationId,
              previousChecksum: e.previousChecksum,
            });

          if (serialize(entry1) !== serialize(entry2)) {
            expect(checksum1).not.toBe(checksum2);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
