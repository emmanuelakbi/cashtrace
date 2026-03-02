/**
 * Property-based tests for Audit Trail Completeness
 *
 * Feature: business-management, Property 11: Audit Trail Completeness
 *
 * For any business operation (create, update, delete, restore, export),
 * an audit log entry SHALL be created containing: event type, user ID,
 * business ID, timestamp, IP address, and request ID. For any update
 * operation, the audit log SHALL additionally contain both previous and
 * new values for all changed fields.
 *
 * **Validates: Requirements 1.5, 3.4, 5.4, 6.3, 7.1, 7.2, 7.3, 7.5**
 */
import crypto from 'node:crypto';

import fc from 'fast-check';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BusinessEventType } from '../types/index.js';

import { logEvent } from './auditService.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock('../../../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
vi.mock('uuid', () => ({
  v4: () => crypto.randomUUID(),
}));

// ─── Generators ──────────────────────────────────────────────────────────────

const eventTypeArb = fc.constantFrom(
  BusinessEventType.BUSINESS_CREATED,
  BusinessEventType.BUSINESS_UPDATED,
  BusinessEventType.BUSINESS_SOFT_DELETED,
  BusinessEventType.BUSINESS_RESTORED,
  BusinessEventType.BUSINESS_HARD_DELETED,
  BusinessEventType.BUSINESS_EXPORTED,
);

const uuidArb = fc.uuid();

const ipV4Arb = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

const safeKeyArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,15}$/);

const changedFieldsArb = fc.dictionary(safeKeyArb, fc.jsonValue(), {
  minKeys: 1,
  maxKeys: 5,
});

/** Generate a valid BusinessAuditEvent with optional requestId. */
const auditEventArb = fc.record({
  eventType: eventTypeArb,
  userId: uuidArb,
  businessId: uuidArb,
  ipAddress: ipV4Arb,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Configure mockQuery to return a row that mirrors the input,
 * simulating a RETURNING clause from PostgreSQL.
 */
function setupMockQuery(): void {
  mockQuery.mockImplementation((_sql: string, params: unknown[]) => {
    const now = new Date();
    return Promise.resolve({
      rows: [
        {
          id: crypto.randomUUID(),
          event_type: params[0] as string,
          user_id: params[1] as string,
          business_id: params[2] as string,
          ip_address: params[3] as string,
          user_agent: (params[4] as string) ?? '',
          request_id: params[5] as string,
          previous_values: params[6] ? JSON.parse(params[6] as string) : null,
          new_values: params[7] ? JSON.parse(params[7] as string) : null,
          created_at: now,
        },
      ],
      rowCount: 1,
    });
  });
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Audit Trail Completeness (Property 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockQuery();
  });

  /**
   * Property 11.1: For any event type and valid event data, logEvent creates
   * an audit log with all required fields (eventType, userId, businessId,
   * ipAddress, requestId, createdAt).
   *
   * **Validates: Requirements 1.5, 3.4, 5.4, 6.3, 7.1, 7.2, 7.3**
   */
  it('creates audit log with all required fields for any event type', () => {
    fc.assert(
      fc.asyncProperty(auditEventArb, uuidArb, async (event, requestId) => {
        const result = await logEvent({ ...event, requestId });

        expect(result.eventType).toBe(event.eventType);
        expect(result.userId).toBe(event.userId);
        expect(result.businessId).toBe(event.businessId);
        expect(result.ipAddress).toBe(event.ipAddress);
        expect(result.requestId).toBe(requestId);
        expect(result.createdAt).toBeInstanceOf(Date);
        expect(result.id).toBeDefined();
        expect(typeof result.id).toBe('string');
        expect(result.id.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 11.2: For any update event with previousValues and newValues,
   * the audit log captures both.
   *
   * **Validates: Requirements 3.4, 7.2, 7.3**
   */
  it('captures previousValues and newValues for update events', () => {
    fc.assert(
      fc.asyncProperty(
        auditEventArb,
        changedFieldsArb,
        changedFieldsArb,
        async (baseEvent, previousValues, newValues) => {
          const event = {
            ...baseEvent,
            eventType: BusinessEventType.BUSINESS_UPDATED,
            previousValues,
            newValues,
          };

          const result = await logEvent(event);

          expect(result.eventType).toBe(BusinessEventType.BUSINESS_UPDATED);
          expect(result.previousValues).toEqual(previousValues);
          expect(result.newValues).toEqual(newValues);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 11.3: For any event without explicit requestId, one is
   * auto-generated (non-empty string).
   *
   * **Validates: Requirements 7.2, 7.5**
   */
  it('auto-generates a non-empty requestId when none is provided', () => {
    fc.assert(
      fc.asyncProperty(auditEventArb, async (event) => {
        const result = await logEvent(event);

        expect(typeof result.requestId).toBe('string');
        expect(result.requestId.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 11.4: For any event type from BusinessEventType enum, the
   * logged eventType matches exactly.
   *
   * **Validates: Requirements 7.1**
   */
  it('logged eventType matches the input event type exactly', () => {
    fc.assert(
      fc.asyncProperty(eventTypeArb, auditEventArb, async (eventType, baseEvent) => {
        const event = { ...baseEvent, eventType };

        const result = await logEvent(event);

        expect(result.eventType).toBe(eventType);
        expect(Object.values(BusinessEventType)).toContain(result.eventType);
      }),
      { numRuns: 100 },
    );
  });
});
