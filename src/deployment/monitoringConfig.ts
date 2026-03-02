/**
 * Monitoring infrastructure configuration validation.
 *
 * Provides pure functions to validate Prometheus/Grafana monitoring
 * configurations, alert rules, and retention policies.
 * Supports Requirements 10.1–10.3, 10.6 (monitoring and alerting).
 *
 * @module deployment/monitoringConfig
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default metric retention period in days. */
export const DEFAULT_RETENTION_DAYS = 30;

/** Minimum allowed retention period in days. */
export const MIN_RETENTION_DAYS = 7;

/** Maximum allowed retention period in days. */
export const MAX_RETENTION_DAYS = 90;

/** Valid alert severity levels. */
export const VALID_ALERT_SEVERITIES = ['critical', 'warning', 'info'] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single alerting rule definition. */
export interface AlertRule {
  /** Human-readable alert name. */
  name: string;
  /** Severity level of the alert. */
  severity: string;
  /** PromQL or alerting expression. */
  expression: string;
  /** Duration the condition must hold before firing (e.g. "5m"). */
  forDuration: string;
  /** Additional annotations (summary, description, etc.). */
  annotations: Record<string, string>;
}

/** Complete monitoring stack configuration. */
export interface MonitoringConfig {
  /** Whether Prometheus metrics collection is enabled. */
  prometheusEnabled: boolean;
  /** Whether Grafana dashboards are enabled. */
  grafanaEnabled: boolean;
  /** Metric retention period in days. */
  retentionDays: number;
  /** Configured alert rules. */
  alertRules: AlertRule[];
  /** Whether PagerDuty integration is active. */
  pagerDutyIntegration: boolean;
}

/** Result of validating a monitoring configuration. */
export interface MonitoringValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a complete monitoring configuration.
 *
 * Checks:
 * - prometheusEnabled must be true
 * - grafanaEnabled must be true
 * - retentionDays must be between MIN and MAX
 * - Each alertRule must have a non-empty name, valid severity, and non-empty expression
 * - If any alert has severity 'critical', pagerDutyIntegration must be true
 */
export function validateMonitoringConfig(config: MonitoringConfig): MonitoringValidationResult {
  const errors: string[] = [];

  if (!config.prometheusEnabled) {
    errors.push('prometheusEnabled must be true');
  }

  if (!config.grafanaEnabled) {
    errors.push('grafanaEnabled must be true');
  }

  if (config.retentionDays < MIN_RETENTION_DAYS || config.retentionDays > MAX_RETENTION_DAYS) {
    errors.push(
      `retentionDays must be between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}, got ${config.retentionDays}`,
    );
  }

  for (const rule of config.alertRules) {
    if (!rule.name || rule.name.trim().length === 0) {
      errors.push('Alert rule name must be non-empty');
    }

    if (!(VALID_ALERT_SEVERITIES as readonly string[]).includes(rule.severity)) {
      errors.push(
        `Invalid alert severity "${rule.severity}". Must be one of: ${VALID_ALERT_SEVERITIES.join(', ')}`,
      );
    }

    if (!rule.expression || rule.expression.trim().length === 0) {
      errors.push('Alert rule expression must be non-empty');
    }
  }

  const hasCritical = config.alertRules.some((r) => r.severity === 'critical');
  if (hasCritical && !config.pagerDutyIntegration) {
    errors.push('pagerDutyIntegration must be true when critical alerts are configured');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check whether all required alert names are present in the configuration.
 *
 * Returns an object indicating completeness and any missing alert names.
 */
export function hasRequiredAlerts(
  config: MonitoringConfig,
  requiredNames: string[],
): { complete: boolean; missing: string[] } {
  const configuredNames = new Set(config.alertRules.map((r) => r.name));
  const missing = requiredNames.filter((name) => !configuredNames.has(name));
  return { complete: missing.length === 0, missing };
}
