/**
 * Property-based tests for consent record creation.
 *
 * **Property 18: Consent Record Creation**
 * For any successful user registration, consent records SHALL be created for
 * all required consent types (terms of service, privacy policy, data processing)
 * with timestamp, IP address, and consent version.
 *
 * **Validates: Requirements 1.5, 8.4**
 *
 * Tag: Feature: core-auth, Property 18: Consent Record Creation
 *
 * @module repositories/consentRepository.property.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { uuidArb, ipv4Arb, userAgentArb } from '../test/arbitraries.js';
import { ConsentType } from '../types/index.js';
import type { ConsentRecord } from '../types/index.js';

// ─── In-Memory Store & Mock ──────────────────────────────────────────────────

/**
 * In-memory store that simulates the PostgreSQL consent_records table.
 * Each row mirrors the database schema with snake_case column names.
 */
interface StoredConsentRow {
  id: string;
  user_id: string;
  consent_type: string;
  consent_version: string;
  ip_address: string;
  user_agent: string;
  granted_at: Date;
  revoked_at: Date | null;
}

let store: StoredConsentRow[];
let idCounter: number;

function resetStore(): void {
  store = [];
  idCounter = 0;
}

/**
 * Mock implementation of the `query` function from `../utils/db.js`.
 *
 * Supports the SQL operations used by consentRepository:
 * - INSERT INTO consent_records: creates a new consent row
 * - SELECT ... WHERE user_id = $1: finds consent records by user ID
 * - UPDATE ... WHERE id = $1 AND revoked_at IS NULL: revokes a consent record
 */
function mockQuery(text: string, params?: unknown[]) {
  const sql = text.replace(/\s+/g, ' ').trim().toUpperCase();

  // INSERT INTO consent_records
  if (sql.startsWith('INSERT INTO CONSENT_RECORDS')) {
    const userId = String(params?.[0] ?? '');
    const consentType = String(params?.[1] ?? '');
    const consentVersion = String(params?.[2] ?? '');
    const ipAddress = String(params?.[3] ?? '');
    const userAgent = String(params?.[4] ?? '');

    const now = new Date();
    idCounter += 1;
    const row: StoredConsentRow = {
      id: `00000000-0000-0000-0000-${String(idCounter).padStart(12, '0')}`,
      user_id: userId,
      consent_type: consentType,
      consent_version: consentVersion,
      ip_address: ipAddress,
      user_agent: userAgent,
      granted_at: now,
      revoked_at: null,
    };
    store.push(row);
    return Promise.resolve({ rows: [row], rowCount: 1 });
  }

  // SELECT ... WHERE user_id = $1 ORDER BY granted_at DESC
  if (sql.startsWith('SELECT') && sql.includes('USER_ID = $1')) {
    const userId = String(params?.[0] ?? '');
    const rows = store
      .filter((r) => r.user_id === userId)
      .sort((a, b) => b.granted_at.getTime() - a.granted_at.getTime());
    return Promise.resolve({ rows, rowCount: rows.length });
  }

  // UPDATE ... SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL
  if (
    sql.startsWith('UPDATE') &&
    sql.includes('WHERE ID = $1') &&
    sql.includes('REVOKED_AT IS NULL')
  ) {
    const consentId = String(params?.[0] ?? '');
    const now = new Date();
    let count = 0;
    for (const row of store) {
      if (row.id === consentId && row.revoked_at === null) {
        row.revoked_at = now;
        count += 1;
      }
    }
    return Promise.resolve({ rows: [], rowCount: count });
  }

  return Promise.resolve({ rows: [], rowCount: 0 });
}

// Wire up the mock before importing the module under test
vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(args[0] as string, args[1] as unknown[]),
}));

// Dynamic import so the mock is in place before the module resolves `query`
const { createConsent, findByUserId } = await import('./consentRepository.js');

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Arbitrary that generates a consent version string (e.g. "1.0", "2.3").
 */
const consentVersionArb: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 9 }))
  .map(([major, minor]) => `${major}.${minor}`);

/**
 * The three required consent types that must be created for every registration.
 */
const ALL_REQUIRED_CONSENT_TYPES: ConsentType[] = [
  ConsentType.TERMS_OF_SERVICE,
  ConsentType.PRIVACY_POLICY,
  ConsentType.DATA_PROCESSING,
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 18: Consent Record Creation', () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * **Validates: Requirements 1.5, 8.4**
   *
   * For any successful user registration, creating consent records for all
   * three required consent types SHALL result in exactly three records
   * associated with the user, covering TERMS_OF_SERVICE, PRIVACY_POLICY,
   * and DATA_PROCESSING.
   */
  it('should create consent records for all three required consent types', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        consentVersionArb,
        ipv4Arb,
        userAgentArb,
        async (userId, version, ipAddress, userAgent) => {
          resetStore();

          // Simulate registration: create consent records for all required types
          for (const consentType of ALL_REQUIRED_CONSENT_TYPES) {
            await createConsent(userId, consentType, version, ipAddress, userAgent);
          }

          // Retrieve all consent records for the user
          const records = await findByUserId(userId);

          // Exactly 3 consent records must exist
          expect(records.length).toBe(3);

          // All three required consent types must be present
          const recordedTypes = records.map((r) => r.consentType);
          for (const requiredType of ALL_REQUIRED_CONSENT_TYPES) {
            expect(recordedTypes).toContain(requiredType);
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
   * **Validates: Requirements 1.5, 8.4**
   *
   * For any consent record created during registration, it SHALL include
   * the correct userId, consentType, consentVersion, ipAddress, userAgent,
   * and a grantedAt timestamp.
   */
  it('should include all required fields in each consent record', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        consentVersionArb,
        ipv4Arb,
        userAgentArb,
        async (userId, version, ipAddress, userAgent) => {
          resetStore();

          // Create consent records for all required types
          for (const consentType of ALL_REQUIRED_CONSENT_TYPES) {
            await createConsent(userId, consentType, version, ipAddress, userAgent);
          }

          // Retrieve and verify each record
          const records = await findByUserId(userId);

          for (const record of records) {
            // userId must match
            expect(record.userId).toBe(userId);

            // consentType must be one of the required types
            expect(ALL_REQUIRED_CONSENT_TYPES).toContain(record.consentType);

            // consentVersion must match the version provided
            expect(record.consentVersion).toBe(version);

            // ipAddress must match
            expect(record.ipAddress).toBe(ipAddress);

            // userAgent must match
            expect(record.userAgent).toBe(userAgent);

            // grantedAt must be a valid Date
            expect(record.grantedAt).toBeInstanceOf(Date);
            expect(record.grantedAt.getTime()).not.toBeNaN();

            // revokedAt must be null (freshly created consent)
            expect(record.revokedAt).toBeNull();

            // id must be a non-empty string
            expect(typeof record.id).toBe('string');
            expect(record.id.length).toBeGreaterThan(0);
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
   * **Validates: Requirements 1.5, 8.4**
   *
   * Consent records SHALL be properly associated with the user — records
   * created for one user must not appear when querying another user's records.
   */
  it('should associate consent records with the correct user only', async () => {
    const distinctUserPairArb = fc.tuple(uuidArb, uuidArb).filter(([a, b]) => a !== b);

    await fc.assert(
      fc.asyncProperty(
        distinctUserPairArb,
        consentVersionArb,
        ipv4Arb,
        userAgentArb,
        async ([userA, userB], version, ipAddress, userAgent) => {
          resetStore();

          // Create consent records for user A only
          for (const consentType of ALL_REQUIRED_CONSENT_TYPES) {
            await createConsent(userA, consentType, version, ipAddress, userAgent);
          }

          // User A should have 3 consent records
          const recordsA = await findByUserId(userA);
          expect(recordsA.length).toBe(3);
          for (const record of recordsA) {
            expect(record.userId).toBe(userA);
          }

          // User B should have 0 consent records
          const recordsB = await findByUserId(userB);
          expect(recordsB.length).toBe(0);
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });
});
