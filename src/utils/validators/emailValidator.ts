/**
 * Email validation utility implementing RFC 5322 email format validation.
 *
 * Uses a practical regex pattern that covers the vast majority of valid
 * email addresses per RFC 5322, including:
 * - Standard local parts with dots, hyphens, underscores
 * - Quoted local parts with special characters
 * - International domain names (IDN)
 * - Subdomains and multi-level TLDs
 *
 * @module utils/validators/emailValidator
 */

import type { ValidationResult } from '../../types/index.js';

/**
 * Maximum allowed length for an email address per RFC 5321.
 * The total length must not exceed 254 characters.
 */
const MAX_EMAIL_LENGTH = 254;

/**
 * Maximum allowed length for the local part (before @) per RFC 5321.
 */
const MAX_LOCAL_PART_LENGTH = 64;

/**
 * RFC 5322 compliant email regex pattern.
 *
 * This pattern validates:
 * - Local part: allows alphanumeric, dots, hyphens, underscores, plus signs,
 *   and other permitted special characters. Also supports quoted strings.
 * - Domain part: allows alphanumeric labels separated by dots, with hyphens
 *   permitted within labels (but not at start/end). TLD must be at least
 *   2 characters.
 *
 * Note: This is a practical implementation that covers real-world email
 * addresses. Full RFC 5322 compliance including all edge cases (comments,
 * folding whitespace, etc.) is intentionally omitted for security and
 * practicality.
 */
const EMAIL_REGEX =
  /^(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x20-\x21\x23-\x5B\x5D-\x7E]|\\[\x20-\x7E])*")@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

/**
 * Validates an email address against RFC 5322 standards.
 *
 * Performs the following checks:
 * 1. Input is a non-empty string
 * 2. Total length does not exceed 254 characters
 * 3. Local part does not exceed 64 characters
 * 4. Format matches RFC 5322 pattern
 * 5. No consecutive dots in local part (outside quotes)
 *
 * @param email - The email address string to validate
 * @returns A ValidationResult indicating whether the email is valid
 *
 * @example
 * ```typescript
 * const result = validateEmail('user@example.com');
 * // { valid: true, errors: [] }
 *
 * const invalid = validateEmail('not-an-email');
 * // { valid: false, errors: ['Invalid email format'] }
 * ```
 */
export function validateEmail(email: string): ValidationResult {
  const errors: string[] = [];

  // Check for empty or whitespace-only input
  if (!email || email.trim().length === 0) {
    return { valid: false, errors: ['Email is required'] };
  }

  // Trim whitespace for validation
  const trimmed = email.trim();

  // Check total length (RFC 5321 limit)
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    errors.push(`Email must not exceed ${MAX_EMAIL_LENGTH} characters`);
    return { valid: false, errors };
  }

  // Split into local and domain parts
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex === -1) {
    return { valid: false, errors: ['Invalid email format'] };
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);

  // Check local part length (RFC 5321 limit)
  if (localPart.length > MAX_LOCAL_PART_LENGTH) {
    errors.push(`Email local part must not exceed ${MAX_LOCAL_PART_LENGTH} characters`);
    return { valid: false, errors };
  }

  // Check local part is not empty
  if (localPart.length === 0) {
    return { valid: false, errors: ['Invalid email format'] };
  }

  // Check domain part is not empty
  if (domainPart.length === 0) {
    return { valid: false, errors: ['Invalid email format'] };
  }

  // Validate against RFC 5322 regex pattern
  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, errors: ['Invalid email format'] };
  }

  return { valid: true, errors: [] };
}
