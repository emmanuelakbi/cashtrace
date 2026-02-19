/**
 * Property-based tests for Audit Immutability (Property 5)
 *
 * **Validates: Requirements 4.5**
 *
 * Property: "For any audit entry, modification or deletion SHALL be prevented,
 * and tampering SHALL be detectable."
 *
 * Tests verify:
 * 1. For any sequence of audit events, the chain integrity is always valid
 * 2. For any entry in the chain, modifying any field makes tampering detectable
 * 3. For any entry, the checksum changes if any field is modified
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { AuditServiceImpl, type AuditContext } from './auditService.js';
import type { AuditEvent, AuditEventType, AuditAction, AuditEntry } from './types.js';

// ─── Generators ──────────────────────────────────────────────────────────────

const eventTypeArb: fc.Arbitrary<AuditEventType> = fc.constantFrom(
  'data_access',
  'data_modify',
  'auth',
  'admin',
  'consent',
  'export',
);

const actionArb: fc.Arbitrary<AuditAction> = fc.constantFrom(
  'create',
  'read',
  'update',
  'delete',
  'export',
  'grant',
  'revoke',
);

const safeStringArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/);

const ipArb = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

const optionalMetadataArb = fc.option(
  fc.dictionary(fc.stringMatching(/^[a-z]{1,8}$/), fc.jsonValue()),
  { nil: undefined },
);

/** Generate a valid AuditEvent. */
const auditEventArb: fc.Arbitrary<AuditEvent> = fc.record({
  eventType: eventTypeArb,
  userId: safeStringArb,
  businessId: safeStringArb,
  resourceType: safeStringArb,
  resourceId: safeStringArb,
  action: actionArb,
  previousValue: optionalMetadataArb,
  newValue: optionalMetadataArb,
  metadata: optionalMetadataArb,
});

/** Generate an AuditContext. */
const auditContextArb: fc.Arbitrary<AuditContext> = fc.record({
  ipAddress: ipArb,
  userAgent: safeStringArb,
});

/** Generate a pair of (AuditEvent, AuditContext) for logging. */
const logParamsArb = fc.tuple(auditEventArb, auditContextArb);

// ─── Tamperable fields on AuditEntry ─────────────────────────────────────────

type TamperableStringField =
  | 'userId'
  | 'businessId'
  | 'resourceType'
  | 'resourceId'
  | 'ipAddress'
  | 'userAgent'
  | 'correlationId';

const tamperableStringFields: TamperableStringField[] = [
  'userId',
  'businessId',
  'resourceType',
  'resourceId',
  'ipAddress',
  'userAgent',
  'correlationId',
];

const tamperFieldArb = fc.constantFrom(...tamperableStringFields);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Audit Immutability (Property 5)', () => {
  let service: AuditServiceImpl;

  beforeEach(() => {
    service = new AuditServiceImpl();
  });

  /**
   * **Validates: Requirements 4.5**
   *
   * For any sequence of audit events, the chain integrity is always valid
   * after logging. The append-only chain with SHA-256 checksums must remain
   * consistent for any arbitrary sequence of events.
   */
  it('chain integrity is always valid for any sequence of audit events', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(logParamsArb, { minLength: 1, maxLength: 15 }),
        async (paramsList) => {
          const svc = new AuditServiceImpl();

          for (const [event, context] of paramsList) {
            await svc.log(event, context);
          }

          const chainResult = await svc.verifyChainIntegrity();
          expect(chainResult.valid).toBe(true);
          expect(chainResult.totalEntries).toBe(paramsList.length);
          expect(chainResult.firstInvalidIndex).toBeNull();

          // Also verify each individual entry
          const entries = await svc.query({});
          for (const entry of entries) {
            const result = await svc.verifyIntegrity(entry.id);
            expect(result.valid).toBe(true);
            expect(result.expectedChecksum).toBe(result.actualChecksum);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.5**
   *
   * For any entry in the chain, modifying any string field makes tampering
   * detectable via verifyIntegrity (individual entry check) or
   * verifyChainIntegrity (full chain check).
   */
  it('detects tampering when any field of an entry is modified', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(logParamsArb, { minLength: 2, maxLength: 8 }),
        tamperFieldArb,
        safeStringArb,
        async (paramsList, field, tamperValue) => {
          const svc = new AuditServiceImpl();

          for (const [event, context] of paramsList) {
            await svc.log(event, context);
          }

          const entries = await svc.query({});
          // Pick a random entry to tamper with
          const targetIdx = Math.floor(Math.random() * entries.length);
          const target = entries[targetIdx]!;

          // Skip if the tamper value is the same as the original
          if ((target as Record<string, unknown>)[field] === tamperValue) return;

          // Tamper with the entry directly
          (target as Record<string, unknown>)[field] = tamperValue;

          // Individual integrity check should detect tampering
          const integrityResult = await svc.verifyIntegrity(target.id);
          expect(integrityResult.valid).toBe(false);
          expect(integrityResult.expectedChecksum).not.toBe(integrityResult.actualChecksum);

          // Chain integrity check should also detect tampering
          const chainResult = await svc.verifyChainIntegrity();
          expect(chainResult.valid).toBe(false);
          expect(chainResult.firstInvalidIndex).not.toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 4.5**
   *
   * For any entry, the checksum changes if any field is modified.
   * This ensures the SHA-256 checksum covers all critical fields and
   * any modification is reflected in a different checksum value.
   */
  it('checksum changes when any field of an entry is modified', async () => {
    await fc.assert(
      fc.asyncProperty(
        logParamsArb,
        tamperFieldArb,
        safeStringArb,
        async ([event, context], field, tamperValue) => {
          const svc = new AuditServiceImpl();
          await svc.log(event, context);

          const entries = await svc.query({});
          const entry = entries[0]!;
          const originalChecksum = entry.checksum;

          // Skip if the tamper value is the same as the original
          if ((entry as Record<string, unknown>)[field] === tamperValue) return;

          // Tamper with the field
          (entry as Record<string, unknown>)[field] = tamperValue;

          // Recompute integrity — the stored checksum should no longer match
          const result = await svc.verifyIntegrity(entry.id);
          expect(result.valid).toBe(false);
          // The stored (expected) checksum is the original
          expect(result.expectedChecksum).toBe(originalChecksum);
          // The recomputed (actual) checksum should differ
          expect(result.actualChecksum).not.toBe(originalChecksum);
        },
      ),
      { numRuns: 200 },
    );
  });
});
