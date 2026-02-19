/**
 * Fast-check arbitraries for property-based testing.
 *
 * Provides reusable generators for common auth-domain values
 * such as emails, passwords, and device fingerprints. These
 * arbitraries are used across all property tests in the module.
 *
 * @module test/arbitraries
 */

import fc from 'fast-check';

// ─── Email Arbitraries ──────────────────────────────────────────────────────

/**
 * Arbitrary that generates valid email addresses.
 * Uses fast-check's built-in emailAddress generator.
 */
export const validEmailArb: fc.Arbitrary<string> = fc.emailAddress();

/**
 * Arbitrary that generates strings which are NOT valid emails.
 * Filters out anything that looks like a valid email.
 */
export const invalidEmailArb: fc.Arbitrary<string> = fc.string().filter((s) => !looksLikeEmail(s));

/**
 * Quick heuristic to check if a string looks like an email.
 * Used only for filtering in test generators — not for production validation.
 */
function looksLikeEmail(s: string): boolean {
  // Basic structural check: has exactly one @, non-empty local and domain parts
  const atIndex = s.indexOf('@');
  if (atIndex <= 0 || atIndex === s.length - 1) return false;
  if (s.indexOf('@', atIndex + 1) !== -1) return false;
  const domain = s.slice(atIndex + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

// ─── Password Arbitraries ───────────────────────────────────────────────────

/**
 * Arbitrary that generates valid passwords.
 * Valid = at least 8 characters AND contains at least 1 digit.
 */
export const validPasswordArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.string({ minLength: 7, maxLength: 64, unit: fc.char() }),
    fc.integer({ min: 0, max: 9 }),
  )
  .map(([base, digit]) => {
    // Insert a digit at a random-ish position to guarantee at least one digit
    const insertPos = base.length > 0 ? base.length % (base.length + 1) : 0;
    return base.slice(0, insertPos) + String(digit) + base.slice(insertPos);
  })
  .filter((s) => s.length >= 8 && /\d/.test(s));

/**
 * Arbitrary that generates passwords that are too short (< 8 chars).
 */
export const tooShortPasswordArb: fc.Arbitrary<string> = fc.string({
  maxLength: 7,
});

/**
 * Arbitrary that generates passwords with no digits (but >= 8 chars).
 */
export const noDigitPasswordArb: fc.Arbitrary<string> = fc
  .string({ minLength: 8, maxLength: 64, unit: fc.char() })
  .filter((s) => s.length >= 8 && !/\d/.test(s));

/**
 * Arbitrary that generates invalid passwords (either too short OR no digit).
 */
export const invalidPasswordArb: fc.Arbitrary<string> = fc.oneof(
  tooShortPasswordArb,
  noDigitPasswordArb,
);

// ─── Device Fingerprint Arbitraries ─────────────────────────────────────────

/**
 * Arbitrary that generates valid device fingerprints.
 * A fingerprint is a 64-character hex string (SHA-256 hash).
 */
export const deviceFingerprintArb: fc.Arbitrary<string> = fc.hexaString({
  minLength: 64,
  maxLength: 64,
});

// ─── User Arbitraries ───────────────────────────────────────────────────────

/**
 * Arbitrary that generates a valid user registration payload.
 */
export const signupRequestArb: fc.Arbitrary<{
  email: string;
  password: string;
}> = fc.record({
  email: validEmailArb,
  password: validPasswordArb,
});

// ─── Token Arbitraries ──────────────────────────────────────────────────────

/**
 * Arbitrary that generates a UUID string.
 */
export const uuidArb: fc.Arbitrary<string> = fc.uuid();

/**
 * Arbitrary that generates a hex token string (e.g. for magic links, reset tokens).
 */
export const hexTokenArb: fc.Arbitrary<string> = fc.hexaString({
  minLength: 32,
  maxLength: 64,
});

// ─── IP Address Arbitraries ─────────────────────────────────────────────────

/**
 * Arbitrary that generates valid IPv4 addresses.
 */
export const ipv4Arb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

// ─── User Agent Arbitraries ─────────────────────────────────────────────────

/**
 * Arbitrary that generates realistic-ish user agent strings.
 */
export const userAgentArb: fc.Arbitrary<string> = fc.constantFrom(
  'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
  'CashTrace-Mobile/1.0 Android/10',
  'CashTrace-Mobile/1.0 iOS/14',
);

// ─── Observability Arbitraries ──────────────────────────────────────────────

/**
 * Arbitrary that generates valid log levels.
 */
export const logLevelArb: fc.Arbitrary<'debug' | 'info' | 'warn' | 'error' | 'fatal'> =
  fc.constantFrom('debug', 'info', 'warn', 'error', 'fatal');

/**
 * Arbitrary that generates a log context with correlation ID, service, etc.
 */
export const logContextArb: fc.Arbitrary<{
  correlationId: string;
  userId: string;
  businessId: string;
  service: string;
}> = fc.record({
  correlationId: fc.uuid(),
  userId: fc.uuid(),
  businessId: fc.uuid(),
  service: fc.constantFrom('api', 'worker', 'scheduler', 'auth'),
});

/**
 * Arbitrary that generates Nigerian phone numbers (e.g. +2348012345678 or 08012345678).
 */
export const nigerianPhoneArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(
      fc.constantFrom('070', '080', '081', '090', '091'),
      fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
        minLength: 8,
        maxLength: 8,
      }),
    )
    .map(([prefix, rest]) => `${prefix}${rest}`),
  fc
    .tuple(
      fc.constantFrom('+23470', '+23480', '+23481', '+23490', '+23491'),
      fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
        minLength: 8,
        maxLength: 8,
      }),
    )
    .map(([prefix, rest]) => `${prefix}${rest}`),
);

/**
 * Arbitrary that generates Nigerian bank account numbers (10 digits).
 */
export const bankAccountArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
  { minLength: 10, maxLength: 10 },
);

/**
 * Arbitrary that generates Nigerian BVN numbers (11 digits).
 */
export const bvnArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
  { minLength: 11, maxLength: 11 },
);

/**
 * Arbitrary that generates span kind values.
 */
export const spanKindArb: fc.Arbitrary<'internal' | 'server' | 'client' | 'producer' | 'consumer'> =
  fc.constantFrom('internal', 'server', 'client', 'producer', 'consumer');

/**
 * Arbitrary that generates metric names (valid Prometheus-style names).
 */
export const metricNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('http', 'db', 'api', 'cache', 'queue'),
    fc.constantFrom('requests', 'duration', 'errors', 'connections', 'size'),
    fc.constantFrom('total', 'seconds', 'bytes', 'count'),
  )
  .map(([ns, name, suffix]) => `${ns}_${name}_${suffix}`);

/**
 * Arbitrary that generates positive durations in milliseconds (for latency testing).
 */
export const latencyMsArb: fc.Arbitrary<number> = fc.double({
  min: 0.1,
  max: 30000,
  noNaN: true,
});
