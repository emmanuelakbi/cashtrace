// Gemini Integration - PII redaction utility
// Validates: Requirements 12.3, 12.4

/**
 * Nigerian phone number pattern.
 * Matches 11-digit numbers starting with 080, 081, 070, 090, 091
 * with optional +234 international prefix and optional separators.
 */
const NIGERIAN_PHONE_REGEX =
  /(?:\+234[-.\s]?|234[-.\s]?)?(?:0?[789][01])\d[-.\s]?\d{3}[-.\s]?\d{4}/g;

/**
 * BVN (Bank Verification Number) pattern — exactly 11 digits at a word boundary.
 * Must be checked BEFORE account numbers since BVN is also purely numeric.
 */
const BVN_REGEX = /\b\d{11}\b/g;

/**
 * Account number pattern — exactly 10 digits at a word boundary.
 */
const ACCOUNT_NUMBER_REGEX = /\b\d{10}\b/g;

/**
 * Email address pattern.
 */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Name pattern — names preceded by common prefixes.
 * Captures the prefix and the following 1-3 capitalised words.
 */
const NAME_PREFIX_REGEX =
  /\b(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Chief|Alhaji|Alhaja|Pastor|Engr\.?|Prof\.?|Barrister)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g;

/**
 * Redact PII from a plain text string.
 *
 * Applies redaction in a specific order to avoid partial matches:
 * 1. Emails (most specific pattern)
 * 2. Names with prefixes
 * 3. Phone numbers (before pure digit patterns)
 * 4. BVN (11 digits — before 10-digit account numbers)
 * 5. Account numbers (10 digits)
 */
export function redact(text: string): string {
  let result = text;

  // 1. Redact emails first (most specific)
  result = result.replace(EMAIL_REGEX, '[EMAIL]');

  // 2. Redact names with prefixes
  result = result.replace(NAME_PREFIX_REGEX, '[NAME]');

  // 3. Redact phone numbers (before pure digit patterns)
  result = result.replace(NIGERIAN_PHONE_REGEX, '[PHONE]');

  // 4. Redact BVN (11 digits) before account numbers (10 digits)
  result = result.replace(BVN_REGEX, '[BVN]');

  // 5. Redact account numbers (10 digits)
  result = result.replace(ACCOUNT_NUMBER_REGEX, '[ACCOUNT]');

  return result;
}

/**
 * Deep-clone an object and redact all string values containing PII.
 *
 * Handles nested objects, arrays, and primitive values. Non-string
 * primitives are returned unchanged.
 */
export function redactObject<T>(obj: T): T {
  return deepRedact(obj) as T;
}

function deepRedact(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redact(value);
  }

  if (Array.isArray(value)) {
    return value.map(deepRedact);
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deepRedact(val);
    }
    return result;
  }

  // numbers, booleans, etc.
  return value;
}

/**
 * Check whether a text string contains any detectable PII.
 */
export function containsPii(text: string): boolean {
  return redact(text) !== text;
}
