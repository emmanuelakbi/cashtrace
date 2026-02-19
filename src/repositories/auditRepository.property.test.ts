/**
 * Property-based tests for audit trail completeness.
 *
 * **Property 17: Audit Trail Completeness**
 * For any authentication event (signup, login, logout, logout-all, password reset,
 * token refresh, rate limit exceeded), an audit log entry SHALL be created with
 * event type, timestamp, IP address, user agent, and success status.
 *
 * **Validates: Requirements 2.5, 6.4, 7.4, 8.2**
 *
 * Tag: Feature: core-auth, Property 17: Audit Trail Completeness
 *
 * @module repositories/auditRepository.property.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { uuidArb, ipv4Arb, userAgentArb } from '../test/arbitraries.js';
import { AuthEventType } from '../types/index.js';

// ─── In-Memory Store & Mock ──────────────────────────────────────────────────

/**
 * In-memory store that simulates the PostgreSQL audit_logs table.
 * Each row mirrors the database schema with snake_case column names.
 */
interface StoredAuditRow {
  id: string;
  event_type: string;
  user_id: string | null;
  ip_address: string;
  user_agent: string;
  request_id: string;
  success: boolean;
  error_code: string | null;
  metadata: string;
  created_at: Date;
}

let store: StoredAuditRow[];
let idCounter: number;

function resetStore(): void {
  store = [];
  idCounter = 0;
}

/**
 * Mock implementation of the `query` function from `../utils/db.js`.
 *
 * Supports the SQL operations used by auditRepository:
 * - INSERT INTO audit_logs: creates a new audit log row
 * - SELECT ... WHERE user_id = $1 AND created_at >= $2 AND created_at <= $3: finds by userId + date range
 */
function mockQuery(text: string, params?: unknown[]) {
  const sql = text.replace(/\s+/g, ' ').trim().toUpperCase();

  // INSERT INTO audit_logs
  if (sql.startsWith('INSERT INTO AUDIT_LOGS')) {
    const eventType = String(params?.[0] ?? '');
    const userId = params?.[1] === null || params?.[1] === undefined ? null : String(params[1]);
    const ipAddress = String(params?.[2] ?? '');
    const userAgent = String(params?.[3] ?? '');
    const requestId = String(params?.[4] ?? '');
    const success = Boolean(params?.[5]);
    const errorCode = params?.[6] === null || params?.[6] === undefined ? null : String(params[6]);
    const metadata = String(params?.[7] ?? '{}');

    const now = new Date();
    idCounter += 1;
    const row: StoredAuditRow = {
      id: `00000000-0000-0000-0000-${String(idCounter).padStart(12, '0')}`,
      event_type: eventType,
      user_id: userId,
      ip_address: ipAddress,
      user_agent: userAgent,
      request_id: requestId,
      success,
      error_code: errorCode,
      metadata,
      created_at: now,
    };
    store.push(row);
    return Promise.resolve({ rows: [row], rowCount: 1 });
  }

  // SELECT ... WHERE user_id = $1 AND created_at >= $2 AND created_at <= $3
  if (sql.startsWith('SELECT') && sql.includes('USER_ID = $1') && sql.includes('CREATED_AT >=')) {
    const userId = String(params?.[0] ?? '');
    const from = new Date(String(params?.[1] ?? ''));
    const to = new Date(String(params?.[2] ?? ''));

    const rows = store
      .filter(
        (r) =>
          r.user_id === userId &&
          r.created_at.getTime() >= from.getTime() &&
          r.created_at.getTime() <= to.getTime(),
      )
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return Promise.resolve({ rows, rowCount: rows.length });
  }

  return Promise.resolve({ rows: [], rowCount: 0 });
}

// Wire up the mock before importing the module under test
vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(args[0] as string, args[1] as unknown[]),
}));

// Dynamic import so the mock is in place before the module resolves `query`
const { createAuditLog, findByUserId } = await import('./auditRepository.js');

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Arbitrary that generates any valid AuthEventType enum value.
 */
const authEventTypeArb: fc.Arbitrary<AuthEventType> = fc.constantFrom(
  ...Object.values(AuthEventType),
);

/**
 * Arbitrary that generates a boolean success status.
 */
const successArb: fc.Arbitrary<boolean> = fc.boolean();

/**
 * Arbitrary that generates a UUID for requestId (correlation ID).
 */
const requestIdArb: fc.Arbitrary<string> = fc.uuid();

/**
 * Arbitrary that generates a userId which can be null (for failed attempts on unknown emails).
 */
const nullableUserIdArb: fc.Arbitrary<string | null> = fc.option(uuidArb, { nil: null });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 17: Audit Trail Completeness', () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * **Validates: Requirements 2.5, 6.4, 7.4, 8.2**
   *
   * For any authentication event type, creating an audit log SHALL produce
   * an entry with the correct eventType, userId, ipAddress, userAgent,
   * requestId, success status, and a valid createdAt timestamp.
   */
  it('should create an audit log entry with all required fields for any auth event', async () => {
    await fc.assert(
      fc.asyncProperty(
        authEventTypeArb,
        nullableUserIdArb,
        ipv4Arb,
        userAgentArb,
        requestIdArb,
        successArb,
        async (eventType, userId, ipAddress, userAgent, requestId, success) => {
          resetStore();

          const auditLog = await createAuditLog({
            eventType,
            userId,
            ipAddress,
            userAgent,
            requestId,
            success,
          });

          // eventType must match the input
          expect(auditLog.eventType).toBe(eventType);

          // userId must match the input (can be null)
          expect(auditLog.userId).toBe(userId);

          // ipAddress must match the input
          expect(auditLog.ipAddress).toBe(ipAddress);

          // userAgent must match the input
          expect(auditLog.userAgent).toBe(userAgent);

          // requestId (correlation ID) must match the input
          expect(auditLog.requestId).toBe(requestId);

          // success must match the input
          expect(auditLog.success).toBe(success);

          // createdAt must be a valid Date
          expect(auditLog.createdAt).toBeInstanceOf(Date);
          expect(auditLog.createdAt.getTime()).not.toBeNaN();

          // id must be a non-empty string
          expect(typeof auditLog.id).toBe('string');
          expect(auditLog.id.length).toBeGreaterThan(0);
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 2.5, 6.4, 7.4, 8.2**
   *
   * ALL AuthEventType enum values SHALL produce valid audit log entries.
   * This ensures no event type is accidentally excluded from audit logging.
   */
  it('should produce valid audit logs for every AuthEventType value', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        ipv4Arb,
        userAgentArb,
        requestIdArb,
        successArb,
        async (userId, ipAddress, userAgent, requestId, success) => {
          resetStore();

          const allEventTypes = Object.values(AuthEventType);

          for (const eventType of allEventTypes) {
            const auditLog = await createAuditLog({
              eventType,
              userId,
              ipAddress,
              userAgent,
              requestId,
              success,
            });

            // Each event type must produce a valid audit log
            expect(auditLog.eventType).toBe(eventType);
            expect(auditLog.ipAddress).toBe(ipAddress);
            expect(auditLog.userAgent).toBe(userAgent);
            expect(auditLog.requestId).toBe(requestId);
            expect(auditLog.success).toBe(success);
            expect(auditLog.createdAt).toBeInstanceOf(Date);
          }

          // All event types must have been logged
          expect(store.length).toBe(allEventTypes.length);

          const loggedEventTypes = store.map((r) => r.event_type);
          for (const eventType of allEventTypes) {
            expect(loggedEventTypes).toContain(eventType);
          }
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 2.5, 6.4, 7.4, 8.2**
   *
   * Audit logs SHALL be queryable by userId within a date range.
   * Logs created for one user must not appear when querying another user's logs.
   */
  it('should allow querying audit logs by userId within a date range', async () => {
    const distinctUserPairArb = fc.tuple(uuidArb, uuidArb).filter(([a, b]) => a !== b);

    await fc.assert(
      fc.asyncProperty(
        distinctUserPairArb,
        authEventTypeArb,
        ipv4Arb,
        userAgentArb,
        requestIdArb,
        successArb,
        async ([userA, userB], eventType, ipAddress, userAgent, requestId, success) => {
          resetStore();

          const before = new Date(Date.now() - 1000);

          // Create audit logs for user A
          await createAuditLog({
            eventType,
            userId: userA,
            ipAddress,
            userAgent,
            requestId,
            success,
          });

          const after = new Date(Date.now() + 1000);

          // Query for user A within the date range — should find the log
          const logsA = await findByUserId(userA, before, after);
          expect(logsA.length).toBe(1);
          expect(logsA[0]!.userId).toBe(userA);
          expect(logsA[0]!.eventType).toBe(eventType);

          // Query for user B within the same date range — should find nothing
          const logsB = await findByUserId(userB, before, after);
          expect(logsB.length).toBe(0);
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 2.5, 6.4, 7.4, 8.2**
   *
   * Audit logs with null userId (failed attempts on unknown emails) SHALL
   * still be created with all other required fields intact.
   */
  it('should create audit logs with null userId for failed attempts on unknown emails', async () => {
    await fc.assert(
      fc.asyncProperty(
        authEventTypeArb,
        ipv4Arb,
        userAgentArb,
        requestIdArb,
        async (eventType, ipAddress, userAgent, requestId) => {
          resetStore();

          const auditLog = await createAuditLog({
            eventType,
            userId: null,
            ipAddress,
            userAgent,
            requestId,
            success: false,
          });

          // userId must be null
          expect(auditLog.userId).toBeNull();

          // All other fields must still be present and correct
          expect(auditLog.eventType).toBe(eventType);
          expect(auditLog.ipAddress).toBe(ipAddress);
          expect(auditLog.userAgent).toBe(userAgent);
          expect(auditLog.requestId).toBe(requestId);
          expect(auditLog.success).toBe(false);
          expect(auditLog.createdAt).toBeInstanceOf(Date);
          expect(auditLog.id.length).toBeGreaterThan(0);
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });
});
