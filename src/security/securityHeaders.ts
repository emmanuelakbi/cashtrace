/**
 * Security Headers for CashTrace Security & Compliance Module.
 *
 * Configures and validates security headers including CSP, HSTS,
 * X-Frame-Options, and other protective headers.
 *
 * @module security/securityHeaders
 *
 * Requirement 11.4: Configure security headers (CSP, HSTS, X-Frame-Options).
 */

/** Map of header name to header value. */
export type HeaderMap = Record<string, string>;

/** Options for customizing individual security headers. */
export interface SecurityHeadersOptions {
  /** Content-Security-Policy value. */
  contentSecurityPolicy?: string;
  /** Strict-Transport-Security value. */
  strictTransportSecurity?: string;
  /** X-Frame-Options value. */
  xFrameOptions?: string;
  /** X-Content-Type-Options value. */
  xContentTypeOptions?: string;
  /** X-XSS-Protection value. */
  xXssProtection?: string;
  /** Referrer-Policy value. */
  referrerPolicy?: string;
  /** Permissions-Policy value. */
  permissionsPolicy?: string;
}

/** Result of validating a set of headers against security requirements. */
export interface HeaderValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

/** Secure default values for each header. */
const DEFAULT_HEADERS: HeaderMap = {
  'Content-Security-Policy': "default-src 'self'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '0',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** Headers that must be present for validation to pass. */
const REQUIRED_HEADERS = [
  'Content-Security-Policy',
  'Strict-Transport-Security',
  'X-Frame-Options',
] as const;

export class SecurityHeaders {
  private readonly headers: HeaderMap;

  constructor(options?: SecurityHeadersOptions) {
    this.headers = { ...DEFAULT_HEADERS };

    if (options) {
      this.applyOptions(options);
    }
  }

  /**
   * Get the default security headers map.
   *
   * Requirement 11.4
   */
  getDefaultHeaders(): HeaderMap {
    return { ...DEFAULT_HEADERS };
  }

  /**
   * Get the configured headers (defaults + any customizations).
   */
  getHeaders(): HeaderMap {
    return { ...this.headers };
  }

  /**
   * Apply security headers to a response-like object that has a `setHeader` method,
   * or return the header map if no response is provided.
   *
   * Requirement 11.4
   */
  applyHeaders(response?: { setHeader: (name: string, value: string) => void }): HeaderMap {
    const headers = this.getHeaders();

    if (response) {
      for (const [name, value] of Object.entries(headers)) {
        response.setHeader(name, value);
      }
    }

    return headers;
  }

  /**
   * Validate a set of headers against security requirements.
   *
   * Checks that required headers (CSP, HSTS, X-Frame-Options) are present
   * and flags potential security concerns.
   *
   * Requirement 11.4
   */
  validateHeaders(headers: HeaderMap): HeaderValidationResult {
    const missing: string[] = [];
    const warnings: string[] = [];

    for (const required of REQUIRED_HEADERS) {
      const value = this.findHeader(headers, required);
      if (!value) {
        missing.push(required);
      }
    }

    // Check for weak CSP
    const csp = this.findHeader(headers, 'Content-Security-Policy');
    if (csp && csp.includes("'unsafe-inline'")) {
      warnings.push("CSP contains 'unsafe-inline' which weakens protection against XSS");
    }
    if (csp && csp.includes("'unsafe-eval'")) {
      warnings.push("CSP contains 'unsafe-eval' which weakens protection against XSS");
    }

    // Check for weak HSTS
    const hsts = this.findHeader(headers, 'Strict-Transport-Security');
    if (hsts) {
      const maxAgeMatch = hsts.match(/max-age=(\d+)/);
      if (maxAgeMatch) {
        const maxAge = parseInt(maxAgeMatch[1]!, 10);
        if (maxAge < 31536000) {
          warnings.push('HSTS max-age is less than 1 year (31536000 seconds)');
        }
      }
    }

    // Check for weak X-Frame-Options
    const xfo = this.findHeader(headers, 'X-Frame-Options');
    if (xfo && xfo.toUpperCase() === 'ALLOWALL') {
      warnings.push('X-Frame-Options ALLOWALL provides no clickjacking protection');
    }

    return {
      valid: missing.length === 0,
      missing,
      warnings,
    };
  }

  /**
   * Case-insensitive header lookup.
   */
  private findHeader(headers: HeaderMap, name: string): string | undefined {
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lower) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Apply custom options over defaults.
   */
  private applyOptions(options: SecurityHeadersOptions): void {
    if (options.contentSecurityPolicy !== undefined) {
      this.headers['Content-Security-Policy'] = options.contentSecurityPolicy;
    }
    if (options.strictTransportSecurity !== undefined) {
      this.headers['Strict-Transport-Security'] = options.strictTransportSecurity;
    }
    if (options.xFrameOptions !== undefined) {
      this.headers['X-Frame-Options'] = options.xFrameOptions;
    }
    if (options.xContentTypeOptions !== undefined) {
      this.headers['X-Content-Type-Options'] = options.xContentTypeOptions;
    }
    if (options.xXssProtection !== undefined) {
      this.headers['X-XSS-Protection'] = options.xXssProtection;
    }
    if (options.referrerPolicy !== undefined) {
      this.headers['Referrer-Policy'] = options.referrerPolicy;
    }
    if (options.permissionsPolicy !== undefined) {
      this.headers['Permissions-Policy'] = options.permissionsPolicy;
    }
  }
}
