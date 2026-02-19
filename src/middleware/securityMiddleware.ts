/**
 * Security Middleware Helpers for CashTrace.
 *
 * Express-compatible middleware that applies security headers
 * and provides auto-encryption hooks for request/response pipelines.
 *
 * @module middleware/securityMiddleware
 *
 * Requirement 11.4: Configure security headers (CSP, HSTS, X-Frame-Options).
 * Requirement 1.5: Support transparent encryption/decryption in data access layer.
 */

import { SecurityHeaders } from '../security/securityHeaders.js';
import type { SecurityHeadersOptions } from '../security/securityHeaders.js';
import type { EncryptionServiceImpl } from '../encryption/encryptionService.js';

/** Minimal Express-compatible request. */
interface Request {
  body?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Minimal Express-compatible response. */
interface Response {
  setHeader(name: string, value: string): void;
  [key: string]: unknown;
}

/** Express-compatible next function. */
type NextFunction = (err?: unknown) => void;

/**
 * Middleware that applies security headers to every response.
 *
 * Requirement 11.4
 */
export function securityHeadersMiddleware(options?: SecurityHeadersOptions) {
  const secHeaders = new SecurityHeaders(options);

  return (_req: Request, res: Response, next: NextFunction): void => {
    secHeaders.applyHeaders(res);
    next();
  };
}

/**
 * Configuration for the auto-encryption middleware.
 */
export interface AutoEncryptionOptions {
  /** The encryption service instance to use. */
  encryptionService: EncryptionServiceImpl;
  /** The key ID to encrypt with. */
  keyId: string;
  /** Fields in request body to encrypt before passing downstream. */
  fieldsToEncrypt: string[];
}

/**
 * Middleware that auto-encrypts specified request body fields.
 *
 * Requirement 1.5: Support transparent encryption/decryption in data access layer.
 */
export function autoEncryptionMiddleware(options: AutoEncryptionOptions) {
  const { encryptionService, keyId, fieldsToEncrypt } = options;

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.body && typeof req.body === 'object') {
        for (const field of fieldsToEncrypt) {
          const value = req.body[field];
          if (value !== undefined && value !== null) {
            const encrypted = await encryptionService.encrypt(String(value), keyId);
            req.body[field] = encrypted;
          }
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
