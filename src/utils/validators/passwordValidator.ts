/**
 * Password validation utility for the authentication module.
 *
 * Validates that passwords meet the minimum security requirements:
 * - Minimum 8 characters in length
 * - At least 1 numeric digit
 *
 * @module utils/validators/passwordValidator
 */

import type { ValidationResult } from '../../types/index.js';

/**
 * Minimum required password length.
 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Regex pattern to check for at least one numeric digit.
 */
const HAS_NUMBER_REGEX = /\d/;

/**
 * Validates a password against the authentication module's strength requirements.
 *
 * Performs the following checks:
 * 1. Password is a non-empty string
 * 2. Password contains at least 8 characters
 * 3. Password contains at least 1 numeric digit
 *
 * All failing checks are reported in the errors array, allowing the caller
 * to display all issues at once rather than one at a time.
 *
 * @param password - The password string to validate
 * @returns A ValidationResult indicating whether the password meets requirements
 *
 * @example
 * ```typescript
 * const result = validatePassword('securePass1');
 * // { valid: true, errors: [] }
 *
 * const weak = validatePassword('short');
 * // { valid: false, errors: ['Password must be at least 8 characters', 'Password must contain at least 1 number'] }
 * ```
 */
export function validatePassword(password: string): ValidationResult {
  const errors: string[] = [];

  // Check for empty or missing input
  if (!password || password.length === 0) {
    return {
      valid: false,
      errors: ['Password is required'],
    };
  }

  // Check minimum length
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  // Check for at least one number
  if (!HAS_NUMBER_REGEX.test(password)) {
    errors.push('Password must contain at least 1 number');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
