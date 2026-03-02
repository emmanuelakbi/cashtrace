import { describe, expect, it } from 'vitest';

import type { AlertRule, MonitoringConfig } from './monitoringConfig.js';
import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  VALID_ALERT_SEVERITIES,
  hasRequiredAlerts,
  validateMonitoringConfig,
} from './monitoringConfig.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAlertRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    name: 'HighErrorRate',
    severity: 'warning',
    expression: 'rate(http_errors_total[5m]) > 0.05',
    forDuration: '5m',
    annotations: { summary: 'Error rate is high' },
    ...overrides,
  };
}

function makeMonitoringConfig(overrides: Partial<MonitoringConfig> = {}): MonitoringConfig {
  return {
    prometheusEnabled: true,
    grafanaEnabled: true,
    retentionDays: 30,
    alertRules: [makeAlertRule()],
    pagerDutyIntegration: false,
    ...overrides,
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('DEFAULT_RETENTION_DAYS is 30', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(30);
  });

  it('MIN_RETENTION_DAYS is 7', () => {
    expect(MIN_RETENTION_DAYS).toBe(7);
  });

  it('MAX_RETENTION_DAYS is 90', () => {
    expect(MAX_RETENTION_DAYS).toBe(90);
  });

  it('VALID_ALERT_SEVERITIES contains critical, warning, info', () => {
    expect(VALID_ALERT_SEVERITIES).toEqual(['critical', 'warning', 'info']);
  });
});

// ─── validateMonitoringConfig ───────────────────────────────────────────────

describe('validateMonitoringConfig', () => {
  it('returns valid for a correct configuration', () => {
    const result = validateMonitoringConfig(makeMonitoringConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects prometheusEnabled = false', () => {
    const result = validateMonitoringConfig(makeMonitoringConfig({ prometheusEnabled: false }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('prometheusEnabled must be true'));
  });

  it('rejects grafanaEnabled = false', () => {
    const result = validateMonitoringConfig(makeMonitoringConfig({ grafanaEnabled: false }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('grafanaEnabled must be true'));
  });

  it('rejects retentionDays below minimum', () => {
    const result = validateMonitoringConfig(makeMonitoringConfig({ retentionDays: 3 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('retentionDays must be between'));
  });

  it('rejects retentionDays above maximum', () => {
    const result = validateMonitoringConfig(makeMonitoringConfig({ retentionDays: 100 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('retentionDays must be between'));
  });

  it('accepts retentionDays at minimum boundary', () => {
    const result = validateMonitoringConfig(
      makeMonitoringConfig({ retentionDays: MIN_RETENTION_DAYS }),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts retentionDays at maximum boundary', () => {
    const result = validateMonitoringConfig(
      makeMonitoringConfig({ retentionDays: MAX_RETENTION_DAYS }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects alert rule with empty name', () => {
    const result = validateMonitoringConfig(
      makeMonitoringConfig({ alertRules: [makeAlertRule({ name: '' })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('name must be non-empty'));
  });

  it('rejects alert rule with invalid severity', () => {
    const result = validateMonitoringConfig(
      makeMonitoringConfig({ alertRules: [makeAlertRule({ severity: 'urgent' })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Invalid alert severity'));
  });

  it('rejects alert rule with empty expression', () => {
    const result = validateMonitoringConfig(
      makeMonitoringConfig({ alertRules: [makeAlertRule({ expression: '' })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('expression must be non-empty'));
  });

  it('requires pagerDutyIntegration when critical alerts exist', () => {
    const result = validateMonitoringConfig(
      makeMonitoringConfig({
        alertRules: [makeAlertRule({ severity: 'critical' })],
        pagerDutyIntegration: false,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('pagerDutyIntegration must be true'),
    );
  });

  it('accepts critical alerts when pagerDutyIntegration is true', () => {
    const result = validateMonitoringConfig(
      makeMonitoringConfig({
        alertRules: [makeAlertRule({ severity: 'critical' })],
        pagerDutyIntegration: true,
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const result = validateMonitoringConfig(
      makeMonitoringConfig({
        prometheusEnabled: false,
        grafanaEnabled: false,
        retentionDays: 1,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── hasRequiredAlerts ──────────────────────────────────────────────────────

describe('hasRequiredAlerts', () => {
  it('returns complete when all required alerts are present', () => {
    const config = makeMonitoringConfig({
      alertRules: [
        makeAlertRule({ name: 'HighErrorRate' }),
        makeAlertRule({ name: 'HighLatency' }),
      ],
    });
    const result = hasRequiredAlerts(config, ['HighErrorRate', 'HighLatency']);
    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('returns missing alerts when some are absent', () => {
    const config = makeMonitoringConfig({
      alertRules: [makeAlertRule({ name: 'HighErrorRate' })],
    });
    const result = hasRequiredAlerts(config, ['HighErrorRate', 'HighLatency', 'DiskFull']);
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(['HighLatency', 'DiskFull']);
  });

  it('returns complete for empty required list', () => {
    const config = makeMonitoringConfig();
    const result = hasRequiredAlerts(config, []);
    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('returns all missing when no alerts configured', () => {
    const config = makeMonitoringConfig({ alertRules: [] });
    const result = hasRequiredAlerts(config, ['HighErrorRate']);
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(['HighErrorRate']);
  });
});
