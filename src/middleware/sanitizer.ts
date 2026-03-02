/**
 * Input sanitization middleware to prevent injection attacks.
 *
 * Sanitizes string values in request body and query parameters by:
 * - Stripping HTML tags to prevent XSS
 * - Removing null bytes to prevent null-byte injection
 * - Trimming leading/trailing whitespace
 *
 * Non-string values (numbers, booleans, null, undefined) are preserved as-is.
 * Nested objects and arrays are recursively sanitized.
 *
 * @module middleware/sanitizer
 * @see Requirements: 2.5
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * Sanitize a single string value.
 *
 * 1. Remove null bytes (\0)
 * 2. Strip HTML tags
 * 3. Trim whitespace
 */
export function sanitizeString(value: string): string {
  return value
    .replace(/\0/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/**
 * Recursively sanitize a value. Strings are sanitized, objects and arrays
 * are traversed recursively, and all other types are returned unchanged.
 */
export function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[key] = sanitizeValue(val);
    }
    return sanitized;
  }

  // numbers, booleans, null, undefined — pass through
  return value;
}

/**
 * Create an Express middleware that sanitizes req.body and req.query in-place
 * before downstream middleware (e.g. validation) runs.
 *
 * @see Requirement 2.5 — sanitize string inputs to prevent injection attacks
 */
export function createSanitizerMiddleware(): (
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeValue(req.body);
    }

    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeValue(req.query) as typeof req.query;
    }

    next();
  };
}
