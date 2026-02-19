/**
 * Drift Detector for CashTrace Security & Compliance Module.
 *
 * Compares current service configurations against a secure baseline
 * and reports fields that have drifted. Supports compliance checks
 * based on drift severity.
 *
 * @module security/driftDetector
 *
 * Requirement 11.6: Alert on configuration drift from secure baseline.
 */

import type { DriftItem, DriftSeverity, DriftSummary, ServiceConfig } from './types.js';
import { ConfigValidator } from './configValidator.js';

/**
 * Maps top-level config section names to a severity level.
 * Critical security sections get higher severity ratings.
 */
const SECTION_SEVERITY: Record<string, DriftSeverity> = {
  encryption: 'critical',
  authentication: 'critical',
  accessControl: 'high',
  logging: 'high',
  network: 'medium',
};

export class DriftDetector {
  private baseline: ServiceConfig;

  /**
   * Create a DriftDetector with a baseline configuration.
   * If no baseline is provided, the secure defaults are used.
   */
  constructor(baseline?: ServiceConfig) {
    this.baseline = baseline
      ? structuredClone(baseline)
      : new ConfigValidator().getSecureDefaults();
  }

  /**
   * Get the current baseline configuration.
   */
  getBaseline(): ServiceConfig {
    return structuredClone(this.baseline);
  }

  /**
   * Update the baseline configuration.
   */
  setBaseline(baseline: ServiceConfig): void {
    this.baseline = structuredClone(baseline);
  }

  /**
   * Detect configuration drift between the current config and the baseline.
   * Returns a list of fields that have changed.
   *
   * Requirement 11.6: Alert on configuration drift from secure baseline.
   */
  detectDrift(currentConfig: ServiceConfig): DriftItem[] {
    const drifts: DriftItem[] = [];

    for (const section of Object.keys(this.baseline) as (keyof ServiceConfig)[]) {
      const baseSection = this.baseline[section];
      const currSection = currentConfig[section];
      const severity = SECTION_SEVERITY[section] ?? 'low';

      for (const key of Object.keys(baseSection) as (keyof typeof baseSection)[]) {
        const baseVal = baseSection[key];
        const currVal = currSection[key];

        if (!this.isEqual(baseVal, currVal)) {
          drifts.push({
            fieldPath: `${section}.${String(key)}`,
            baselineValue: baseVal,
            currentValue: currVal,
            severity,
          });
        }
      }
    }

    return drifts;
  }

  /**
   * Get a summary of drift counts grouped by severity.
   */
  getDriftSummary(currentConfig: ServiceConfig): DriftSummary {
    const drifts = this.detectDrift(currentConfig);
    const summary: DriftSummary = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };

    for (const drift of drifts) {
      summary[drift.severity]++;
      summary.total++;
    }

    return summary;
  }

  /**
   * Check if the current config is compliant (no critical or high severity drifts).
   *
   * Requirement 11.6: Alert on configuration drift from secure baseline.
   */
  isCompliant(currentConfig: ServiceConfig): boolean {
    const drifts = this.detectDrift(currentConfig);
    return !drifts.some((d) => d.severity === 'critical' || d.severity === 'high');
  }

  /**
   * Deep equality check for primitive values and arrays.
   */
  private isEqual(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return a === b;
  }
}
