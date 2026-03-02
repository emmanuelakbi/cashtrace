/**
 * Nigerian phone number validation and formatting utilities.
 *
 * Supported formats:
 * - Local:         0XXX XXX XXXX  (11 digits starting with 0)
 * - International: +234 XXX XXX XXXX (country code + 10 digits)
 *
 * Valid prefixes (after country code): 70X, 80X, 81X, 90X, 91X
 * Carriers: MTN, Glo, Airtel, 9mobile
 *
 * @module utils/phoneValidation
 */

/**
 * Valid Nigerian mobile prefixes (the two digits after 0 or +234).
 * Covers MTN (803, 806, 813, 816, 903, 906, 913, 916, 706, 803),
 * Glo (805, 807, 815, 905, 705), Airtel (802, 808, 812, 902, 708),
 * 9mobile (809, 817, 818, 909, 908).
 *
 * Simplified to the leading two-digit groups: 70, 80, 81, 90, 91.
 */
const VALID_PREFIXES = ['70', '80', '81', '90', '91'];

/**
 * Regex matching a Nigerian phone number in local or international format.
 *
 * Accepts optional spaces, hyphens, or dots as separators.
 * - Local:         0(70|80|81|90|91)X XXXX XXX
 * - International: +234(70|80|81|90|91)X XXXX XXX
 */
export const NIGERIAN_PHONE_REGEX =
  /^\+234[\s.-]*(70|80|81|90|91)\d[\s.-]*\d{3}[\s.-]*\d{4}$|^0(70|80|81|90|91)\d[\s.-]*\d{3}[\s.-]*\d{4}$/;

/**
 * Strips all non-digit characters except a leading '+'.
 */
function stripFormatting(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '');
  }
  return trimmed.replace(/\D/g, '');
}

/**
 * Validates whether a string is a valid Nigerian phone number.
 *
 * Accepts local (0XXX...) and international (+234XXX...) formats,
 * with optional spaces, hyphens, or dots as separators.
 *
 * @param phone - The phone number string to validate
 * @returns `true` if the number is a valid Nigerian mobile number
 */
export function isValidNigerianPhone(phone: string): boolean {
  if (!phone || typeof phone !== 'string') {
    return false;
  }

  const stripped = stripFormatting(phone);

  // International format: +234 followed by 10 digits
  if (stripped.startsWith('+234')) {
    const subscriber = stripped.slice(4);
    if (subscriber.length !== 10) {
      return false;
    }
    const prefix = subscriber.slice(0, 2);
    return VALID_PREFIXES.includes(prefix);
  }

  // Local format: 0 followed by 10 digits (11 total)
  if (stripped.startsWith('0')) {
    if (stripped.length !== 11) {
      return false;
    }
    const prefix = stripped.slice(1, 3);
    return VALID_PREFIXES.includes(prefix);
  }

  return false;
}

/**
 * Normalizes a Nigerian phone number to international format (+234XXXXXXXXXX).
 *
 * @param phone - A valid Nigerian phone number (local or international)
 * @returns The number in +234XXXXXXXXXX format
 * @throws {Error} If the input is not a valid Nigerian phone number
 */
export function formatNigerianPhone(phone: string): string {
  if (!isValidNigerianPhone(phone)) {
    throw new Error(`Invalid Nigerian phone number: ${phone}`);
  }

  const stripped = stripFormatting(phone);

  // Already international
  if (stripped.startsWith('+234')) {
    return stripped;
  }

  // Local → international: replace leading 0 with +234
  return '+234' + stripped.slice(1);
}
