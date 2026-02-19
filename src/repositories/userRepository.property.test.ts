/**
 * Property-based tests for email uniqueness enforcement.
 *
 * **Property 4: Email Uniqueness Enforcement**
 * For any existing user in the system, attempting to register a new user
 * with the same email (case-insensitive) SHALL fail with a validation error.
 *
 * **Validates: Requirements 1.2**
 *
 * Tag: Feature: core-auth, Property 4: Email Uniqueness Enforcement
 *
 * @module repositories/userRepository.property.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { validEmailArb, validPasswordArb } from '../test/arbitraries.js';

// ─── In-Memory Store & Mock ──────────────────────────────────────────────────

/**
 * In-memory store that simulates the PostgreSQL users table.
 * Emails are stored lowercased to mirror the LOWER($1) behaviour
 * in the real INSERT statement and the UNIQUE constraint on the column.
 */
interface StoredRow {
  id: string;
  email: string;
  password_hash: string | null;
  email_verified: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

let store: StoredRow[];
let idCounter: number;

function resetStore(): void {
  store = [];
  idCounter = 0;
}

/**
 * Mock implementation of the `query` function from `../utils/db.js`.
 *
 * - INSERT: stores the row (lowercased email) and throws if a duplicate
 *   email already exists, simulating the DB UNIQUE constraint violation.
 * - SELECT (findByEmail): returns matching rows by lowercased email.
 */
function mockQuery(text: string, params?: unknown[]) {
  const sql = text.trim().toUpperCase();

  if (sql.startsWith('INSERT INTO USERS')) {
    const email = String(params?.[0] ?? '').toLowerCase();
    const passwordHash = params?.[1] as string;

    // Simulate UNIQUE constraint violation
    const exists = store.some((r) => r.email === email);
    if (exists) {
      const err = new Error(
        `duplicate key value violates unique constraint "users_email_key"`,
      ) as Error & { code: string };
      err.code = '23505'; // PostgreSQL unique_violation
      throw err;
    }

    const now = new Date();
    idCounter += 1;
    const row: StoredRow = {
      id: `00000000-0000-0000-0000-${String(idCounter).padStart(12, '0')}`,
      email,
      password_hash: passwordHash,
      email_verified: false,
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
      last_login_at: null,
    };
    store.push(row);
    return Promise.resolve({ rows: [row], rowCount: 1 });
  }

  if (sql.startsWith('SELECT') && sql.includes('LOWER(EMAIL) = LOWER')) {
    const email = String(params?.[0] ?? '').toLowerCase();
    const rows = store.filter((r) => r.email === email);
    return Promise.resolve({ rows, rowCount: rows.length });
  }

  return Promise.resolve({ rows: [], rowCount: 0 });
}

// Wire up the mock before importing the module under test
vi.mock('../utils/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(args[0] as string, args[1] as unknown[]),
}));

// Dynamic import so the mock is in place before the module resolves `query`
const { createUser } = await import('./userRepository.js');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 4: Email Uniqueness Enforcement', () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * For any valid email and password, creating a user and then attempting
   * to create another user with the exact same email SHALL throw an error.
   */
  it('should reject duplicate registration with the exact same email', async () => {
    await fc.assert(
      fc.asyncProperty(validEmailArb, validPasswordArb, async (email, password) => {
        resetStore();

        // First registration succeeds
        const user = await createUser(email, password);
        expect(user).toBeDefined();
        expect(user.email).toBe(email.toLowerCase());

        // Second registration with the same email must fail
        await expect(createUser(email, password)).rejects.toThrow(
          /duplicate key value violates unique constraint/,
        );
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * For any valid email, registering with a case-variant of that email
   * (e.g. "User@Example.COM" vs "user@example.com") SHALL be treated
   * as a duplicate and fail.
   */
  it('should reject duplicate registration with a different-case email', async () => {
    /**
     * Arbitrary that produces a pair of emails that differ only in case.
     * We take a valid email and produce a randomly-cased variant.
     */
    const emailWithCaseVariantArb = fc
      .tuple(
        validEmailArb,
        // A boolean array to decide per-character case flip
        fc.array(fc.boolean(), { minLength: 1, maxLength: 254 }),
      )
      .map(([email, flips]) => {
        const variant = email
          .split('')
          .map((ch, i) => {
            const shouldFlip = flips[i % flips.length];
            return shouldFlip ? ch.toUpperCase() : ch.toLowerCase();
          })
          .join('');
        return { original: email, variant };
      })
      // Ensure the variant is actually different in casing (not identical string)
      .filter(({ original, variant }) => variant !== original);

    await fc.assert(
      fc.asyncProperty(
        emailWithCaseVariantArb,
        validPasswordArb,
        async ({ original, variant }, password) => {
          resetStore();

          // First registration with original email succeeds
          const user = await createUser(original, password);
          expect(user).toBeDefined();

          // Second registration with case-variant email must fail
          await expect(createUser(variant, password)).rejects.toThrow(
            /duplicate key value violates unique constraint/,
          );
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * For any two distinct emails (case-insensitively), both registrations
   * SHALL succeed — uniqueness only blocks truly duplicate emails.
   */
  it('should allow registration of two distinct emails', async () => {
    const distinctEmailPairArb = fc
      .tuple(validEmailArb, validEmailArb)
      .filter(([a, b]) => a.toLowerCase() !== b.toLowerCase());

    await fc.assert(
      fc.asyncProperty(
        distinctEmailPairArb,
        validPasswordArb,
        async ([emailA, emailB], password) => {
          resetStore();

          const userA = await createUser(emailA, password);
          const userB = await createUser(emailB, password);

          expect(userA).toBeDefined();
          expect(userB).toBeDefined();
          expect(userA.email).toBe(emailA.toLowerCase());
          expect(userB.email).toBe(emailB.toLowerCase());
        },
      ),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  });
});
