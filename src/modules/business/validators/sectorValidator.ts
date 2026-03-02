/**
 * Business sector validation utility.
 *
 * Validates business sector values against the 11 predefined Nigerian SME sectors.
 * Only exact enum values are accepted (case-sensitive).
 * On validation failure, returns the list of valid sector options.
 *
 * @module modules/business/validators/sectorValidator
 */

import type { ValidationResult } from '../../../types/index.js';

import { BusinessSector } from '../types/index.js';

/** Set of valid sector values for O(1) lookup. */
const VALID_SECTORS = new Set<string>(Object.values(BusinessSector));

/**
 * Validates a business sector value against predefined Nigerian SME sectors.
 *
 * Performs case-sensitive matching against the BusinessSector enum values.
 * On failure, the error message includes all valid sector options.
 *
 * @param sector - The sector string to validate
 * @returns A ValidationResult indicating whether the sector is valid,
 *          with valid options listed in the error message on failure
 *
 * @example
 * ```typescript
 * const result = validateBusinessSector('RETAIL_TRADING');
 * // { valid: true, errors: [] }
 *
 * const invalid = validateBusinessSector('INVALID');
 * // { valid: false, errors: ['Invalid sector. Valid options: RETAIL_TRADING, ...'] }
 * ```
 */
export function validateBusinessSector(sector: string): ValidationResult {
  if (VALID_SECTORS.has(sector)) {
    return { valid: true, errors: [] };
  }

  const validOptions = Object.values(BusinessSector).join(', ');

  return {
    valid: false,
    errors: [`Invalid sector. Valid options: ${validOptions}`],
  };
}
