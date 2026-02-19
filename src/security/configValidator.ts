/**
 * Configuration Validator for CashTrace Security & Compliance Module.
 *
 * Enforces secure defaults and validates service configurations against
 * CIS-inspired security benchmarks. Provides methods to retrieve secure
 * defaults, apply them to partial configs, and validate configurations.
 *
 * @module security/configValidator
 *
 * Requirement 11.1: Enforce secure defaults for all services.
 * Requirement 11.5: Validate configurations against security benchmarks (CIS).
 */

import type {
  ConfigRule,
  ConfigRuleCategory,
  ConfigRuleResult,
  ConfigValidationResult,
  ServiceConfig,
} from './types.js';

/** Milliseconds in one minute. */
const MS_PER_MINUTE = 60 * 1000;
/** Milliseconds in one hour. */
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * Secure default configuration.
 *
 * Requirement 11.1: Enforce secure defaults for all services.
 */
const SECURE_DEFAULTS: ServiceConfig = {
  authentication: {
    passwordMinLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    maxLoginAttempts: 5,
    lockoutDurationMs: 30 * MS_PER_MINUTE,
    sessionTimeoutMs: 1 * MS_PER_HOUR,
    mfaEnabled: true,
  },
  encryption: {
    algorithm: 'aes-256-gcm',
    keyLengthBits: 256,
    tlsMinVersion: '1.2',
    enforceHttps: true,
    certificateValidation: true,
  },
  network: {
    allowedPorts: [443],
    corsEnabled: true,
    corsAllowAll: false,
    rateLimitEnabled: true,
    rateLimitMaxRequests: 100,
    rateLimitWindowMs: 15 * MS_PER_MINUTE,
  },
  logging: {
    enabled: true,
    logLevel: 'info',
    auditEnabled: true,
    logSensitiveData: false,
    retentionDays: 365,
  },
  accessControl: {
    rbacEnabled: true,
    defaultDeny: true,
    enforceBusinessIsolation: true,
    maxSessionsPerUser: 3,
  },
};

/**
 * CIS-inspired security benchmark rules.
 *
 * Requirement 11.5: Validate configurations against security benchmarks (CIS).
 */
const CIS_BENCHMARK_RULES: ConfigRule[] = [
  // ─── Authentication Rules ───
  {
    id: 'CIS-AUTH-001',
    name: 'Minimum password length',
    description: 'Passwords must be at least 8 characters long.',
    severity: 'critical',
    category: 'authentication',
    check: (config) => config.authentication.passwordMinLength >= 8,
  },
  {
    id: 'CIS-AUTH-002',
    name: 'Password complexity - uppercase',
    description: 'Passwords must require at least one uppercase letter.',
    severity: 'high',
    category: 'authentication',
    check: (config) => config.authentication.requireUppercase,
  },
  {
    id: 'CIS-AUTH-003',
    name: 'Password complexity - numbers',
    description: 'Passwords must require at least one numeric digit.',
    severity: 'high',
    category: 'authentication',
    check: (config) => config.authentication.requireNumbers,
  },
  {
    id: 'CIS-AUTH-004',
    name: 'Account lockout threshold',
    description: 'Accounts must lock after at most 10 failed login attempts.',
    severity: 'high',
    category: 'authentication',
    check: (config) =>
      config.authentication.maxLoginAttempts > 0 && config.authentication.maxLoginAttempts <= 10,
  },
  {
    id: 'CIS-AUTH-005',
    name: 'Account lockout duration',
    description: 'Account lockout must last at least 15 minutes.',
    severity: 'medium',
    category: 'authentication',
    check: (config) => config.authentication.lockoutDurationMs >= 15 * MS_PER_MINUTE,
  },
  {
    id: 'CIS-AUTH-006',
    name: 'Session timeout',
    description: 'Sessions must time out within 4 hours of inactivity.',
    severity: 'medium',
    category: 'authentication',
    check: (config) =>
      config.authentication.sessionTimeoutMs > 0 &&
      config.authentication.sessionTimeoutMs <= 4 * MS_PER_HOUR,
  },
  {
    id: 'CIS-AUTH-007',
    name: 'Multi-factor authentication',
    description: 'Multi-factor authentication must be enabled.',
    severity: 'critical',
    category: 'authentication',
    check: (config) => config.authentication.mfaEnabled,
  },

  // ─── Encryption Rules ───
  {
    id: 'CIS-ENC-001',
    name: 'Strong encryption algorithm',
    description: 'Encryption must use AES-256-GCM or equivalent.',
    severity: 'critical',
    category: 'encryption',
    check: (config) => config.encryption.algorithm === 'aes-256-gcm',
  },
  {
    id: 'CIS-ENC-002',
    name: 'Minimum key length',
    description: 'Encryption keys must be at least 256 bits.',
    severity: 'critical',
    category: 'encryption',
    check: (config) => config.encryption.keyLengthBits >= 256,
  },
  {
    id: 'CIS-ENC-003',
    name: 'TLS minimum version',
    description: 'TLS version must be 1.2 or higher.',
    severity: 'critical',
    category: 'encryption',
    check: (config) => {
      const version = parseFloat(config.encryption.tlsMinVersion);
      return !isNaN(version) && version >= 1.2;
    },
  },
  {
    id: 'CIS-ENC-004',
    name: 'HTTPS enforcement',
    description: 'HTTPS must be enforced for all connections.',
    severity: 'critical',
    category: 'encryption',
    check: (config) => config.encryption.enforceHttps,
  },
  {
    id: 'CIS-ENC-005',
    name: 'Certificate validation',
    description: 'SSL/TLS certificate validation must be enabled.',
    severity: 'critical',
    category: 'encryption',
    check: (config) => config.encryption.certificateValidation,
  },

  // ─── Network Rules ───
  {
    id: 'CIS-NET-001',
    name: 'No insecure ports',
    description: 'Port 80 (HTTP) must not be in the allowed ports list.',
    severity: 'high',
    category: 'network',
    check: (config) => !config.network.allowedPorts.includes(80),
  },
  {
    id: 'CIS-NET-002',
    name: 'CORS not open to all',
    description: 'CORS must not allow all origins when enabled.',
    severity: 'high',
    category: 'network',
    check: (config) => !config.network.corsEnabled || !config.network.corsAllowAll,
  },
  {
    id: 'CIS-NET-003',
    name: 'Rate limiting enabled',
    description: 'Rate limiting must be enabled to prevent abuse.',
    severity: 'high',
    category: 'network',
    check: (config) => config.network.rateLimitEnabled,
  },
  {
    id: 'CIS-NET-004',
    name: 'Rate limit threshold',
    description: 'Rate limit must allow at most 1000 requests per window.',
    severity: 'medium',
    category: 'network',
    check: (config) =>
      config.network.rateLimitMaxRequests > 0 && config.network.rateLimitMaxRequests <= 1000,
  },

  // ─── Logging Rules ───
  {
    id: 'CIS-LOG-001',
    name: 'Logging enabled',
    description: 'Logging must be enabled for all services.',
    severity: 'critical',
    category: 'logging',
    check: (config) => config.logging.enabled,
  },
  {
    id: 'CIS-LOG-002',
    name: 'Audit logging enabled',
    description: 'Audit logging must be enabled for compliance.',
    severity: 'critical',
    category: 'logging',
    check: (config) => config.logging.auditEnabled,
  },
  {
    id: 'CIS-LOG-003',
    name: 'No sensitive data in logs',
    description: 'Sensitive data must not be logged.',
    severity: 'critical',
    category: 'logging',
    check: (config) => !config.logging.logSensitiveData,
  },
  {
    id: 'CIS-LOG-004',
    name: 'Log retention period',
    description: 'Logs must be retained for at least 90 days.',
    severity: 'high',
    category: 'logging',
    check: (config) => config.logging.retentionDays >= 90,
  },

  // ─── Access Control Rules ───
  {
    id: 'CIS-AC-001',
    name: 'RBAC enabled',
    description: 'Role-based access control must be enabled.',
    severity: 'critical',
    category: 'access_control',
    check: (config) => config.accessControl.rbacEnabled,
  },
  {
    id: 'CIS-AC-002',
    name: 'Default deny policy',
    description: 'Access control must default to deny.',
    severity: 'critical',
    category: 'access_control',
    check: (config) => config.accessControl.defaultDeny,
  },
  {
    id: 'CIS-AC-003',
    name: 'Business data isolation',
    description: 'Business-level data isolation must be enforced.',
    severity: 'critical',
    category: 'access_control',
    check: (config) => config.accessControl.enforceBusinessIsolation,
  },
  {
    id: 'CIS-AC-004',
    name: 'Session limit per user',
    description: 'Maximum concurrent sessions per user must be limited (≤ 10).',
    severity: 'medium',
    category: 'access_control',
    check: (config) =>
      config.accessControl.maxSessionsPerUser > 0 && config.accessControl.maxSessionsPerUser <= 10,
  },
];

export class ConfigValidator {
  private readonly rules: ConfigRule[];

  constructor(options?: { additionalRules?: ConfigRule[] }) {
    this.rules = [...CIS_BENCHMARK_RULES, ...(options?.additionalRules ?? [])];
  }

  /**
   * Validate a configuration against all registered rules.
   *
   * Requirement 11.5: Validate configurations against security benchmarks (CIS).
   */
  validate(config: ServiceConfig): ConfigValidationResult {
    const results: ConfigRuleResult[] = this.rules.map((rule) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      category: rule.category,
      passed: rule.check(config),
      description: rule.description,
    }));

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    return {
      valid: failed === 0,
      totalRules: results.length,
      passed,
      failed,
      results,
    };
  }

  /**
   * Get the secure default configuration.
   *
   * Requirement 11.1: Enforce secure defaults for all services.
   */
  getSecureDefaults(): ServiceConfig {
    return structuredClone(SECURE_DEFAULTS);
  }

  /**
   * Apply secure defaults to a partial configuration.
   * User-provided values take precedence over defaults.
   *
   * Requirement 11.1: Enforce secure defaults for all services.
   */
  applySecureDefaults(config: Partial<DeepPartial<ServiceConfig>>): ServiceConfig {
    const defaults = this.getSecureDefaults();

    return {
      authentication: {
        ...defaults.authentication,
        ...(config.authentication ?? {}),
      },
      encryption: {
        ...defaults.encryption,
        ...(config.encryption ?? {}),
      },
      network: {
        ...defaults.network,
        ...(config.network ?? {}),
        allowedPorts:
          config.network?.allowedPorts?.filter((p): p is number => p != null) ??
          defaults.network.allowedPorts,
      },
      logging: {
        ...defaults.logging,
        ...(config.logging ?? {}),
      },
      accessControl: {
        ...defaults.accessControl,
        ...(config.accessControl ?? {}),
      },
    };
  }

  /**
   * Get all registered validation rules.
   */
  getRules(): ConfigRule[] {
    return this.rules.map((rule) => ({ ...rule }));
  }

  /**
   * Get rules filtered by category.
   */
  getRulesByCategory(category: ConfigRuleCategory): ConfigRule[] {
    return this.rules.filter((rule) => rule.category === category).map((rule) => ({ ...rule }));
  }
}

/**
 * Utility type for deeply partial objects.
 */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
