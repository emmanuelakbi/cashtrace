import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigValidator } from './configValidator.js';
import type { ConfigRule, ConfigRuleCategory, ServiceConfig } from './types.js';

/**
 * Returns a config that passes all CIS benchmark rules.
 */
function secureConfig(): ServiceConfig {
  return new ConfigValidator().getSecureDefaults();
}

/**
 * Returns a config that violates many rules.
 */
function insecureConfig(): ServiceConfig {
  return {
    authentication: {
      passwordMinLength: 4,
      requireUppercase: false,
      requireLowercase: false,
      requireNumbers: false,
      requireSpecialChars: false,
      maxLoginAttempts: 0,
      lockoutDurationMs: 0,
      sessionTimeoutMs: 0,
      mfaEnabled: false,
    },
    encryption: {
      algorithm: 'des',
      keyLengthBits: 56,
      tlsMinVersion: '1.0',
      enforceHttps: false,
      certificateValidation: false,
    },
    network: {
      allowedPorts: [80, 443, 8080],
      corsEnabled: true,
      corsAllowAll: true,
      rateLimitEnabled: false,
      rateLimitMaxRequests: 0,
      rateLimitWindowMs: 0,
    },
    logging: {
      enabled: false,
      logLevel: 'debug',
      auditEnabled: false,
      logSensitiveData: true,
      retentionDays: 7,
    },
    accessControl: {
      rbacEnabled: false,
      defaultDeny: false,
      enforceBusinessIsolation: false,
      maxSessionsPerUser: 0,
    },
  };
}

describe('ConfigValidator', () => {
  let validator: ConfigValidator;

  beforeEach(() => {
    validator = new ConfigValidator();
  });

  // ─── getSecureDefaults() ───

  describe('getSecureDefaults()', () => {
    it('returns a complete configuration object', () => {
      const defaults = validator.getSecureDefaults();

      expect(defaults.authentication).toBeDefined();
      expect(defaults.encryption).toBeDefined();
      expect(defaults.network).toBeDefined();
      expect(defaults.logging).toBeDefined();
      expect(defaults.accessControl).toBeDefined();
    });

    it('returns secure authentication defaults', () => {
      const defaults = validator.getSecureDefaults();

      expect(defaults.authentication.passwordMinLength).toBeGreaterThanOrEqual(8);
      expect(defaults.authentication.requireUppercase).toBe(true);
      expect(defaults.authentication.requireNumbers).toBe(true);
      expect(defaults.authentication.mfaEnabled).toBe(true);
      expect(defaults.authentication.maxLoginAttempts).toBeGreaterThan(0);
      expect(defaults.authentication.maxLoginAttempts).toBeLessThanOrEqual(10);
    });

    it('returns secure encryption defaults', () => {
      const defaults = validator.getSecureDefaults();

      expect(defaults.encryption.algorithm).toBe('aes-256-gcm');
      expect(defaults.encryption.keyLengthBits).toBeGreaterThanOrEqual(256);
      expect(defaults.encryption.enforceHttps).toBe(true);
      expect(defaults.encryption.certificateValidation).toBe(true);
    });

    it('returns secure network defaults', () => {
      const defaults = validator.getSecureDefaults();

      expect(defaults.network.allowedPorts).not.toContain(80);
      expect(defaults.network.corsAllowAll).toBe(false);
      expect(defaults.network.rateLimitEnabled).toBe(true);
    });

    it('returns secure logging defaults', () => {
      const defaults = validator.getSecureDefaults();

      expect(defaults.logging.enabled).toBe(true);
      expect(defaults.logging.auditEnabled).toBe(true);
      expect(defaults.logging.logSensitiveData).toBe(false);
      expect(defaults.logging.retentionDays).toBeGreaterThanOrEqual(90);
    });

    it('returns secure access control defaults', () => {
      const defaults = validator.getSecureDefaults();

      expect(defaults.accessControl.rbacEnabled).toBe(true);
      expect(defaults.accessControl.defaultDeny).toBe(true);
      expect(defaults.accessControl.enforceBusinessIsolation).toBe(true);
    });

    it('returns a deep copy each time', () => {
      const a = validator.getSecureDefaults();
      const b = validator.getSecureDefaults();

      expect(a).toEqual(b);
      expect(a).not.toBe(b);
      expect(a.network.allowedPorts).not.toBe(b.network.allowedPorts);
    });
  });

  // ─── validate() ───

  describe('validate()', () => {
    it('passes all rules for secure defaults', () => {
      const result = validator.validate(secureConfig());

      expect(result.valid).toBe(true);
      expect(result.failed).toBe(0);
      expect(result.passed).toBe(result.totalRules);
      expect(result.totalRules).toBeGreaterThan(0);
    });

    it('fails rules for insecure configuration', () => {
      const result = validator.validate(insecureConfig());

      expect(result.valid).toBe(false);
      expect(result.failed).toBeGreaterThan(0);
    });

    it('returns individual rule results', () => {
      const result = validator.validate(secureConfig());

      for (const r of result.results) {
        expect(r.ruleId).toBeDefined();
        expect(r.ruleName).toBeDefined();
        expect(r.severity).toBeDefined();
        expect(r.category).toBeDefined();
        expect(typeof r.passed).toBe('boolean');
        expect(r.description).toBeDefined();
      }
    });

    it('totalRules equals passed + failed', () => {
      const result = validator.validate(insecureConfig());

      expect(result.totalRules).toBe(result.passed + result.failed);
    });

    // ─── Authentication rule checks ───

    it('fails when password min length is below 8', () => {
      const config = secureConfig();
      config.authentication.passwordMinLength = 4;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-AUTH-001');

      expect(rule).toBeDefined();
      expect(rule!.passed).toBe(false);
    });

    it('passes when password min length is exactly 8', () => {
      const config = secureConfig();
      config.authentication.passwordMinLength = 8;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-AUTH-001');

      expect(rule!.passed).toBe(true);
    });

    it('fails when MFA is disabled', () => {
      const config = secureConfig();
      config.authentication.mfaEnabled = false;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-AUTH-007');

      expect(rule!.passed).toBe(false);
    });

    it('fails when max login attempts exceeds 10', () => {
      const config = secureConfig();
      config.authentication.maxLoginAttempts = 15;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-AUTH-004');

      expect(rule!.passed).toBe(false);
    });

    it('fails when lockout duration is under 15 minutes', () => {
      const config = secureConfig();
      config.authentication.lockoutDurationMs = 5 * 60 * 1000; // 5 min

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-AUTH-005');

      expect(rule!.passed).toBe(false);
    });

    it('fails when session timeout exceeds 4 hours', () => {
      const config = secureConfig();
      config.authentication.sessionTimeoutMs = 5 * 60 * 60 * 1000; // 5 hours

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-AUTH-006');

      expect(rule!.passed).toBe(false);
    });

    // ─── Encryption rule checks ───

    it('fails when encryption algorithm is not aes-256-gcm', () => {
      const config = secureConfig();
      config.encryption.algorithm = 'des';

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-ENC-001');

      expect(rule!.passed).toBe(false);
    });

    it('fails when key length is below 256 bits', () => {
      const config = secureConfig();
      config.encryption.keyLengthBits = 128;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-ENC-002');

      expect(rule!.passed).toBe(false);
    });

    it('fails when TLS version is below 1.2', () => {
      const config = secureConfig();
      config.encryption.tlsMinVersion = '1.0';

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-ENC-003');

      expect(rule!.passed).toBe(false);
    });

    it('passes when TLS version is 1.3', () => {
      const config = secureConfig();
      config.encryption.tlsMinVersion = '1.3';

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-ENC-003');

      expect(rule!.passed).toBe(true);
    });

    it('fails when HTTPS is not enforced', () => {
      const config = secureConfig();
      config.encryption.enforceHttps = false;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-ENC-004');

      expect(rule!.passed).toBe(false);
    });

    it('fails when certificate validation is disabled', () => {
      const config = secureConfig();
      config.encryption.certificateValidation = false;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-ENC-005');

      expect(rule!.passed).toBe(false);
    });

    // ─── Network rule checks ───

    it('fails when port 80 is allowed', () => {
      const config = secureConfig();
      config.network.allowedPorts = [80, 443];

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-NET-001');

      expect(rule!.passed).toBe(false);
    });

    it('fails when CORS allows all origins', () => {
      const config = secureConfig();
      config.network.corsEnabled = true;
      config.network.corsAllowAll = true;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-NET-002');

      expect(rule!.passed).toBe(false);
    });

    it('passes CORS rule when CORS is disabled', () => {
      const config = secureConfig();
      config.network.corsEnabled = false;
      config.network.corsAllowAll = true;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-NET-002');

      expect(rule!.passed).toBe(true);
    });

    it('fails when rate limiting is disabled', () => {
      const config = secureConfig();
      config.network.rateLimitEnabled = false;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-NET-003');

      expect(rule!.passed).toBe(false);
    });

    it('fails when rate limit exceeds 1000 requests', () => {
      const config = secureConfig();
      config.network.rateLimitMaxRequests = 5000;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-NET-004');

      expect(rule!.passed).toBe(false);
    });

    // ─── Logging rule checks ───

    it('fails when logging is disabled', () => {
      const config = secureConfig();
      config.logging.enabled = false;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-LOG-001');

      expect(rule!.passed).toBe(false);
    });

    it('fails when audit logging is disabled', () => {
      const config = secureConfig();
      config.logging.auditEnabled = false;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-LOG-002');

      expect(rule!.passed).toBe(false);
    });

    it('fails when sensitive data logging is enabled', () => {
      const config = secureConfig();
      config.logging.logSensitiveData = true;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-LOG-003');

      expect(rule!.passed).toBe(false);
    });

    it('fails when log retention is below 90 days', () => {
      const config = secureConfig();
      config.logging.retentionDays = 30;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-LOG-004');

      expect(rule!.passed).toBe(false);
    });

    // ─── Access Control rule checks ───

    it('fails when RBAC is disabled', () => {
      const config = secureConfig();
      config.accessControl.rbacEnabled = false;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-AC-001');

      expect(rule!.passed).toBe(false);
    });

    it('fails when default deny is disabled', () => {
      const config = secureConfig();
      config.accessControl.defaultDeny = false;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-AC-002');

      expect(rule!.passed).toBe(false);
    });

    it('fails when business isolation is disabled', () => {
      const config = secureConfig();
      config.accessControl.enforceBusinessIsolation = false;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-AC-003');

      expect(rule!.passed).toBe(false);
    });

    it('fails when max sessions per user exceeds 10', () => {
      const config = secureConfig();
      config.accessControl.maxSessionsPerUser = 50;

      const result = validator.validate(config);
      const rule = result.results.find((r) => r.ruleId === 'CIS-AC-004');

      expect(rule!.passed).toBe(false);
    });
  });

  // ─── applySecureDefaults() ───

  describe('applySecureDefaults()', () => {
    it('returns full secure defaults when given empty object', () => {
      const result = validator.applySecureDefaults({});
      const defaults = validator.getSecureDefaults();

      expect(result).toEqual(defaults);
    });

    it('overrides specific authentication values', () => {
      const result = validator.applySecureDefaults({
        authentication: { passwordMinLength: 16 },
      });

      expect(result.authentication.passwordMinLength).toBe(16);
      // Other auth fields should be defaults
      expect(result.authentication.mfaEnabled).toBe(true);
    });

    it('overrides specific encryption values', () => {
      const result = validator.applySecureDefaults({
        encryption: { tlsMinVersion: '1.3' },
      });

      expect(result.encryption.tlsMinVersion).toBe('1.3');
      expect(result.encryption.algorithm).toBe('aes-256-gcm');
    });

    it('overrides network allowed ports', () => {
      const result = validator.applySecureDefaults({
        network: { allowedPorts: [443, 8443] },
      });

      expect(result.network.allowedPorts).toEqual([443, 8443]);
    });

    it('preserves default ports when not overridden', () => {
      const result = validator.applySecureDefaults({
        network: { rateLimitEnabled: true },
      });

      expect(result.network.allowedPorts).toEqual([443]);
    });

    it('overrides logging values', () => {
      const result = validator.applySecureDefaults({
        logging: { retentionDays: 730 },
      });

      expect(result.logging.retentionDays).toBe(730);
      expect(result.logging.enabled).toBe(true);
    });

    it('overrides access control values', () => {
      const result = validator.applySecureDefaults({
        accessControl: { maxSessionsPerUser: 5 },
      });

      expect(result.accessControl.maxSessionsPerUser).toBe(5);
      expect(result.accessControl.rbacEnabled).toBe(true);
    });

    it('applied defaults pass validation', () => {
      const config = validator.applySecureDefaults({});
      const result = validator.validate(config);

      expect(result.valid).toBe(true);
    });
  });

  // ─── getRules() ───

  describe('getRules()', () => {
    it('returns all registered rules', () => {
      const rules = validator.getRules();

      expect(rules.length).toBeGreaterThan(0);
    });

    it('each rule has required fields', () => {
      const rules = validator.getRules();

      for (const rule of rules) {
        expect(rule.id).toBeDefined();
        expect(rule.name).toBeDefined();
        expect(rule.description).toBeDefined();
        expect(rule.severity).toBeDefined();
        expect(rule.category).toBeDefined();
        expect(typeof rule.check).toBe('function');
      }
    });

    it('rules have unique ids', () => {
      const rules = validator.getRules();
      const ids = rules.map((r) => r.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it('covers all five categories', () => {
      const rules = validator.getRules();
      const categories = new Set(rules.map((r) => r.category));

      expect(categories.has('authentication')).toBe(true);
      expect(categories.has('encryption')).toBe(true);
      expect(categories.has('network')).toBe(true);
      expect(categories.has('logging')).toBe(true);
      expect(categories.has('access_control')).toBe(true);
    });

    it('returns copies (not references)', () => {
      const a = validator.getRules();
      const b = validator.getRules();

      expect(a).toEqual(b);
      expect(a[0]).not.toBe(b[0]);
    });
  });

  // ─── getRulesByCategory() ───

  describe('getRulesByCategory()', () => {
    const categories: ConfigRuleCategory[] = [
      'authentication',
      'encryption',
      'network',
      'logging',
      'access_control',
    ];

    it.each(categories)('returns rules for %s category', (category) => {
      const rules = validator.getRulesByCategory(category);

      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.category).toBe(category);
      }
    });

    it('returns empty array for unknown category', () => {
      const rules = validator.getRulesByCategory('nonexistent' as ConfigRuleCategory);

      expect(rules).toEqual([]);
    });
  });

  // ─── Custom rules ───

  describe('custom rules', () => {
    it('accepts additional rules via constructor', () => {
      const customRule: ConfigRule = {
        id: 'CUSTOM-001',
        name: 'Custom rule',
        description: 'A custom security rule.',
        severity: 'high',
        category: 'authentication',
        check: (config) => config.authentication.passwordMinLength >= 16,
      };

      const customValidator = new ConfigValidator({ additionalRules: [customRule] });
      const rules = customValidator.getRules();

      expect(rules.find((r) => r.id === 'CUSTOM-001')).toBeDefined();
    });

    it('validates against custom rules', () => {
      const customRule: ConfigRule = {
        id: 'CUSTOM-001',
        name: 'Strict password length',
        description: 'Passwords must be at least 16 characters.',
        severity: 'high',
        category: 'authentication',
        check: (config) => config.authentication.passwordMinLength >= 16,
      };

      const customValidator = new ConfigValidator({ additionalRules: [customRule] });

      // Default has passwordMinLength=12, which fails the custom rule
      const result = customValidator.validate(secureConfig());
      const customResult = result.results.find((r) => r.ruleId === 'CUSTOM-001');

      expect(customResult).toBeDefined();
      expect(customResult!.passed).toBe(false);
    });
  });
});
