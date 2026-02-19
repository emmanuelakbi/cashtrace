/**
 * PII Scrubber
 *
 * Detects and redacts personally identifiable information (PII) from log
 * messages and structured objects. Ensures NDPR compliance by removing
 * sensitive data before logs are persisted.
 *
 * Requirements: 2.1 (email redaction), 2.2 (phone redaction), 2.3 (bank account redaction), 2.4 (BVN redaction), 2.5 (placeholder tokens), 2.6 (readability)
 *
 * @module logging/piiScrubber
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PIIPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

export interface PIIScrubber {
  scrub(text: string): string;
  scrubObject(obj: Record<string, unknown>): Record<string, unknown>;
  addPattern(name: string, pattern: RegExp, replacement: string): void;
}

// ─── Default Patterns ────────────────────────────────────────────────────────

/**
 * Email pattern: standard RFC-5322-ish match.
 * Matches local@domain.tld with common characters.
 */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Phone patterns for Nigerian and international formats:
 * - International with country code: +234XXXXXXXXXX (13 digits total with +)
 * - Local format: 0XXXXXXXXXX (11 digits starting with 0)
 * - Generic international: +X (7-15 digits)
 *
 * The order matters — more specific patterns should be checked first.
 */
const NIGERIAN_INTL_PHONE_PATTERN = /\+234\d{10}/g;
const NIGERIAN_LOCAL_PHONE_PATTERN = /\b0[7-9][01]\d{8}\b/g;
const INTL_PHONE_PATTERN = /\+\d{7,15}/g;

/**
 * Nigerian BVN (Bank Verification Number): exactly 11 consecutive digits
 * that are NOT preceded or followed by another digit.
 *
 * Applied AFTER phone redaction so remaining 11-digit sequences are BVNs.
 * Must be checked before bank account (10 digits) to avoid partial matches.
 */
const BVN_PATTERN = /\b\d{11}\b/g;

/**
 * Nigerian bank account number: exactly 10 consecutive digits
 * that are NOT preceded or followed by another digit.
 *
 * Applied AFTER BVN redaction so remaining 10-digit sequences are account numbers.
 */
const BANK_ACCOUNT_PATTERN = /\b\d{10}\b/g;

// ─── Implementation ──────────────────────────────────────────────────────────

export function createPIIScrubber(): PIIScrubber {
  const customPatterns: PIIPattern[] = [];

  function scrub(text: string): string {
    let result = text;

    // Apply built-in patterns (order: most specific first)
    result = result.replace(EMAIL_PATTERN, '[EMAIL_REDACTED]');
    result = result.replace(NIGERIAN_INTL_PHONE_PATTERN, '[PHONE_REDACTED]');
    result = result.replace(NIGERIAN_LOCAL_PHONE_PATTERN, '[PHONE_REDACTED]');
    result = result.replace(INTL_PHONE_PATTERN, '[PHONE_REDACTED]');

    // Nigerian financial identifiers (after phone redaction to avoid conflicts)
    // BVN (11 digits) before bank account (10 digits) to prevent partial matches
    result = result.replace(BVN_PATTERN, '[BVN_REDACTED]');
    result = result.replace(BANK_ACCOUNT_PATTERN, '[ACCOUNT_REDACTED]');

    // Apply custom patterns
    for (const p of customPatterns) {
      result = result.replace(p.pattern, p.replacement);
    }

    return result;
  }

  function scrubValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return scrub(value);
    }
    if (Array.isArray(value)) {
      return value.map(scrubValue);
    }
    if (value !== null && typeof value === 'object') {
      return scrubObject(value as Record<string, unknown>);
    }
    return value;
  }

  function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = scrubValue(obj[key]);
    }
    return result;
  }

  function addPattern(name: string, pattern: RegExp, replacement: string): void {
    customPatterns.push({ name, pattern, replacement });
  }

  return { scrub, scrubObject, addPattern };
}
