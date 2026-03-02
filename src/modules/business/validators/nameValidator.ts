/**
 * Business name validation utility.
 *
 * Validates business names for Nigerian SMEs according to the following rules:
 * - Must be between 2 and 100 characters inclusive (after trimming)
 * - Unicode characters are allowed (Nigerian business names may include special characters)
 * - Whitespace is trimmed from both ends before validation
 * - Empty or whitespace-only strings are rejected
 *
 * @module modules/business/validators/nameValidator
 */

import type { ValidationResult } from '../../../types/index.js';

/** Minimum allowed length for a business name after trimming. */
const MIN_NAME_LENGTH = 2;

/** Maximum allowed length for a business name after trimming. */
const MAX_NAME_LENGTH = 100;

/**
 * Validates a business name against CashTrace requirements.
 *
 * Performs the following checks:
 * 1. Trims whitespace from both ends
 * 2. Rejects empty or whitespace-only strings
 * 3. Validates length is between 2 and 100 characters inclusive
 *
 * Unicode characters are fully supported to accommodate Nigerian business names
 * that may include special characters, diacritics, or non-Latin scripts.
 *
 * @param name - The business name string to validate
 * @returns A ValidationResult indicating whether the name is valid,
 *          with the trimmed name accessible via the original reference
 *
 * @example
 * ```typescript
 * const result = validateBusinessName('Ade & Sons Trading');
 * // { valid: true, errors: [] }
 *
 * const invalid = validateBusinessName('A');
 * // { valid: false, errors: ['Business name must be between 2 and 100 characters'] }
 * ```
 */
export function validateBusinessName(name: string): ValidationResult {
  const errors: string[] = [];

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { valid: false, errors: ['Business name is required'] };
  }

  if (trimmed.length < MIN_NAME_LENGTH) {
    errors.push(
      `Business name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters`,
    );
    return { valid: false, errors };
  }

  if (trimmed.length > MAX_NAME_LENGTH) {
    errors.push(
      `Business name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters`,
    );
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}
