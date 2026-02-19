import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityHeaders } from './securityHeaders.js';
import type { HeaderMap } from './securityHeaders.js';

describe('SecurityHeaders', () => {
  let secHeaders: SecurityHeaders;

  beforeEach(() => {
    secHeaders = new SecurityHeaders();
  });

  // ─── getDefaultHeaders() ───

  describe('getDefaultHeaders()', () => {
    it('returns all required security headers', () => {
      const headers = secHeaders.getDefaultHeaders();

      expect(headers['Content-Security-Policy']).toBe("default-src 'self'");
      expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
      expect(headers['X-Frame-Options']).toBe('DENY');
    });

    it('returns additional protective headers', () => {
      const headers = secHeaders.getDefaultHeaders();

      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-XSS-Protection']).toBe('0');
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
    });

    it('returns 7 headers total', () => {
      const headers = secHeaders.getDefaultHeaders();

      expect(Object.keys(headers)).toHaveLength(7);
    });

    it('returns a copy each time', () => {
      const a = secHeaders.getDefaultHeaders();
      const b = secHeaders.getDefaultHeaders();

      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  // ─── getHeaders() with customization ───

  describe('getHeaders() with custom options', () => {
    it('allows overriding CSP', () => {
      const custom = new SecurityHeaders({
        contentSecurityPolicy: "default-src 'self'; script-src 'self' cdn.example.com",
      });

      expect(custom.getHeaders()['Content-Security-Policy']).toBe(
        "default-src 'self'; script-src 'self' cdn.example.com",
      );
    });

    it('allows overriding HSTS', () => {
      const custom = new SecurityHeaders({
        strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
      });

      expect(custom.getHeaders()['Strict-Transport-Security']).toBe(
        'max-age=63072000; includeSubDomains; preload',
      );
    });

    it('allows overriding X-Frame-Options', () => {
      const custom = new SecurityHeaders({ xFrameOptions: 'SAMEORIGIN' });

      expect(custom.getHeaders()['X-Frame-Options']).toBe('SAMEORIGIN');
    });

    it('preserves non-overridden headers', () => {
      const custom = new SecurityHeaders({ xFrameOptions: 'SAMEORIGIN' });
      const headers = custom.getHeaders();

      expect(headers['Content-Security-Policy']).toBe("default-src 'self'");
      expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });

    it('allows overriding all headers', () => {
      const custom = new SecurityHeaders({
        contentSecurityPolicy: 'custom-csp',
        strictTransportSecurity: 'custom-hsts',
        xFrameOptions: 'SAMEORIGIN',
        xContentTypeOptions: 'custom-xcto',
        xXssProtection: '1; mode=block',
        referrerPolicy: 'no-referrer',
        permissionsPolicy: 'camera=(self)',
      });
      const headers = custom.getHeaders();

      expect(headers['Content-Security-Policy']).toBe('custom-csp');
      expect(headers['Strict-Transport-Security']).toBe('custom-hsts');
      expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
      expect(headers['X-Content-Type-Options']).toBe('custom-xcto');
      expect(headers['X-XSS-Protection']).toBe('1; mode=block');
      expect(headers['Referrer-Policy']).toBe('no-referrer');
      expect(headers['Permissions-Policy']).toBe('camera=(self)');
    });
  });

  // ─── applyHeaders() ───

  describe('applyHeaders()', () => {
    it('returns header map when no response provided', () => {
      const headers = secHeaders.applyHeaders();

      expect(headers['Content-Security-Policy']).toBe("default-src 'self'");
      expect(headers['X-Frame-Options']).toBe('DENY');
    });

    it('calls setHeader on response object for each header', () => {
      const applied: Record<string, string> = {};
      const mockResponse = {
        setHeader: (name: string, value: string) => {
          applied[name] = value;
        },
      };

      secHeaders.applyHeaders(mockResponse);

      expect(applied['Content-Security-Policy']).toBe("default-src 'self'");
      expect(applied['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
      expect(applied['X-Frame-Options']).toBe('DENY');
      expect(applied['X-Content-Type-Options']).toBe('nosniff');
      expect(applied['X-XSS-Protection']).toBe('0');
      expect(applied['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(applied['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
    });

    it('also returns the header map when response is provided', () => {
      const mockResponse = { setHeader: () => {} };
      const headers = secHeaders.applyHeaders(mockResponse);

      expect(Object.keys(headers)).toHaveLength(7);
    });
  });

  // ─── validateHeaders() ───

  describe('validateHeaders()', () => {
    it('passes for default headers', () => {
      const result = secHeaders.validateHeaders(secHeaders.getDefaultHeaders());

      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('fails when CSP is missing', () => {
      const headers: HeaderMap = {
        'Strict-Transport-Security': 'max-age=31536000',
        'X-Frame-Options': 'DENY',
      };

      const result = secHeaders.validateHeaders(headers);

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('Content-Security-Policy');
    });

    it('fails when HSTS is missing', () => {
      const headers: HeaderMap = {
        'Content-Security-Policy': "default-src 'self'",
        'X-Frame-Options': 'DENY',
      };

      const result = secHeaders.validateHeaders(headers);

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('Strict-Transport-Security');
    });

    it('fails when X-Frame-Options is missing', () => {
      const headers: HeaderMap = {
        'Content-Security-Policy': "default-src 'self'",
        'Strict-Transport-Security': 'max-age=31536000',
      };

      const result = secHeaders.validateHeaders(headers);

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('X-Frame-Options');
    });

    it('reports all missing headers at once', () => {
      const result = secHeaders.validateHeaders({});

      expect(result.valid).toBe(false);
      expect(result.missing).toHaveLength(3);
    });

    it('warns on unsafe-inline in CSP', () => {
      const headers: HeaderMap = {
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'",
        'Strict-Transport-Security': 'max-age=31536000',
        'X-Frame-Options': 'DENY',
      };

      const result = secHeaders.validateHeaders(headers);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('unsafe-inline'))).toBe(true);
    });

    it('warns on unsafe-eval in CSP', () => {
      const headers: HeaderMap = {
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-eval'",
        'Strict-Transport-Security': 'max-age=31536000',
        'X-Frame-Options': 'DENY',
      };

      const result = secHeaders.validateHeaders(headers);

      expect(result.warnings.some((w) => w.includes('unsafe-eval'))).toBe(true);
    });

    it('warns on short HSTS max-age', () => {
      const headers: HeaderMap = {
        'Content-Security-Policy': "default-src 'self'",
        'Strict-Transport-Security': 'max-age=3600',
        'X-Frame-Options': 'DENY',
      };

      const result = secHeaders.validateHeaders(headers);

      expect(result.warnings.some((w) => w.includes('max-age'))).toBe(true);
    });

    it('warns on X-Frame-Options ALLOWALL', () => {
      const headers: HeaderMap = {
        'Content-Security-Policy': "default-src 'self'",
        'Strict-Transport-Security': 'max-age=31536000',
        'X-Frame-Options': 'ALLOWALL',
      };

      const result = secHeaders.validateHeaders(headers);

      expect(result.warnings.some((w) => w.includes('ALLOWALL'))).toBe(true);
    });

    it('handles case-insensitive header names', () => {
      const headers: HeaderMap = {
        'content-security-policy': "default-src 'self'",
        'strict-transport-security': 'max-age=31536000',
        'x-frame-options': 'DENY',
      };

      const result = secHeaders.validateHeaders(headers);

      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('no warnings for secure defaults', () => {
      const result = secHeaders.validateHeaders(secHeaders.getDefaultHeaders());

      expect(result.warnings).toHaveLength(0);
    });
  });
});
