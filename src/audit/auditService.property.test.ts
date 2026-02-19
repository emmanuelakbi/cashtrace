/**
 * Property-based tests for Audit Completeness
 *
 * **Property 4: Audit Completeness**
 * For any data access or modification, an audit entry SHALL be created
 * with user, resource, action, and timestamp.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { AuditServiceImpl, type AuditContext } from './auditService.js';
import type { AuditEvent, AuditEventType, AuditAction } from './types.js';

// ─── Generators ──────────────────────────────────────────────────────────────

const eventTypeArb = fc.constantFrom(
  'data_access',
  'data_modify',
  'auth',
  'admin',
  'consent',
  'export',
) as fc.Arbitrary<AuditEventType>;

const actionArb = fc.constantFrom(
  'create',
  'read',
  'update',
  'delete',
  'export',
  'grant',
  'revoke',
) as fc.Arbitrary<AuditAction>;

const safeStringArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,30}$/);

const ipArb = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Generate an arbitrary AuditEvent. */
const auditEventArb: fc.Arbitrary<AuditEvent> = fc.record({
  eventType: eventTypeArb,
  userId: safeStringArb,
  businessId: safeStringArb,
  resourceType: safeStringArb,
  resourceId: safeStringArb,
  action: actionArb,
});

/** Generate an arbitrary AuditContext. */
const auditContextArb: fc.Arbitrary<AuditContext> = fc.record({
  ipAddress: ipArb,
  userAgent: safeStringArb,
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Audit Completeness (Property 4)', () => {
  /**
   * For any audit event logged, the resulting entry SHALL contain the
   * original userId, businessId, resourceType, resourceId, and action.
   *
   * **Validates: Requirements 4.1, 4.2**
   */
  it('every logged event produces an entry preserving user, resource, and action fields', async () => {
    await fc.assert(
      fc.asyncProperty(auditEventArb, auditContextArb, async (event, context) => {
        const service = new AuditServiceImpl();
        await service.log(event, context);

        const entries = await service.query({ userId: event.userId });
        expect(entries).toHaveLength(1);

        const entry = entries[0];
        expect(entry.userId).toBe(event.userId);
        expect(entry.businessId).toBe(event.businessId);
        expect(entry.resourceType).toBe(event.resourceType);
        expect(entry.resourceId).toBe(event.resourceId);
        expect(entry.action).toBe(event.action);
        expect(entry.eventType).toBe(event.eventType);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any audit event logged, the resulting entry SHALL have a valid
   * timestamp that is a Date instance set at or after the moment of logging.
   *
   * **Validates: Requirements 4.1, 4.2, 4.3**
   */
  it('every logged event produces an entry with a valid timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(auditEventArb, auditContextArb, async (event, context) => {
        const service = new AuditServiceImpl();
        const before = new Date();
        await service.log(event, context);
        const after = new Date();

        const entries = await service.query({});
        expect(entries).toHaveLength(1);

        const entry = entries[0];
        expect(entry.timestamp).toBeInstanceOf(Date);
        expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(entry.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any audit event logged, the resulting entry SHALL have a non-empty
   * SHA-256 checksum for tamper detection.
   *
   * **Validates: Requirements 4.1, 4.2, 4.3**
   */
  it('every logged event produces an entry with a valid checksum', async () => {
    await fc.assert(
      fc.asyncProperty(auditEventArb, auditContextArb, async (event, context) => {
        const service = new AuditServiceImpl();
        await service.log(event, context);

        const entries = await service.query({});
        expect(entries).toHaveLength(1);

        const entry = entries[0];
        expect(entry.checksum).toBeTruthy();
        expect(entry.checksum).toMatch(/^[a-f0-9]{64}$/);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any sequence of distinct audit events, each event SHALL produce
   * exactly one audit entry — no events are lost or duplicated.
   *
   * **Validates: Requirements 4.1, 4.2, 4.3**
   */
  it('logging N events produces exactly N audit entries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(auditEventArb, auditContextArb), { minLength: 1, maxLength: 20 }),
        async (eventPairs) => {
          const service = new AuditServiceImpl();
          for (const [event, context] of eventPairs) {
            await service.log(event, context);
          }

          const entries = await service.query({});
          expect(entries).toHaveLength(eventPairs.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * For any logged event, the entry SHALL have a unique id and correlationId.
   *
   * **Validates: Requirements 4.1, 4.2, 4.3**
   */
  it('every logged event gets a unique id and correlationId', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(auditEventArb, auditContextArb), { minLength: 2, maxLength: 15 }),
        async (eventPairs) => {
          const service = new AuditServiceImpl();
          for (const [event, context] of eventPairs) {
            await service.log(event, context);
          }

          const entries = await service.query({});
          const ids = entries.map((e) => e.id);
          const correlationIds = entries.map((e) => e.correlationId);

          expect(new Set(ids).size).toBe(entries.length);
          expect(new Set(correlationIds).size).toBe(entries.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
