/**
 * Alert Manager
 *
 * Provides threshold-based alerting on metrics with support for
 * multiple severity levels, alert channels, and lifecycle management
 * (acknowledgment and resolution).
 *
 * @module alerting/alertManager
 */

import { randomUUID } from 'node:crypto';
import type { AlertDeduplicator } from './deduplication.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertChannel = 'email' | 'slack' | 'pagerduty';
export type AlertComparison = 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
export type AlertStatus = 'firing' | 'acknowledged' | 'resolved';

export interface AlertDefinition {
  name: string;
  /** Metric name to query */
  query: string;
  /** Threshold value to compare against */
  threshold: number;
  /** Comparison operator */
  comparison: AlertComparison;
  /** Duration string (e.g. "5m", "1h") – reserved for future windowed evaluation */
  duration: string;
  severity: AlertSeverity;
  channels: AlertChannel[];
  runbook?: string;
}

export interface Alert {
  id: string;
  definitionName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  value: number;
  threshold: number;
  comparison: AlertComparison;
  channels: AlertChannel[];
  runbook?: string;
  firedAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolveNotes?: string;
}

/**
 * A function that returns the current numeric value for a given metric query.
 * This allows the AlertManager to remain decoupled from any specific metrics
 * implementation.
 */
export type MetricQueryFn = (query: string) => Promise<number | undefined>;

export interface AlertManager {
  defineAlert(alert: AlertDefinition): void;
  removeAlert(name: string): boolean;
  getDefinitions(): AlertDefinition[];
  checkAlerts(): Promise<Alert[]>;
  getActiveAlerts(): Alert[];
  acknowledge(alertId: string, userId: string): Promise<void>;
  resolve(alertId: string, userId: string, notes: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compareValue(value: number, comparison: AlertComparison, threshold: number): boolean {
  switch (comparison) {
    case 'gt':
      return value > threshold;
    case 'lt':
      return value < threshold;
    case 'eq':
      return value === threshold;
    case 'gte':
      return value >= threshold;
    case 'lte':
      return value <= threshold;
  }
}

function validateDefinition(def: AlertDefinition): void {
  if (!def.name || def.name.trim().length === 0) {
    throw new Error('Alert definition must have a non-empty name');
  }
  if (!def.query || def.query.trim().length === 0) {
    throw new Error('Alert definition must have a non-empty query');
  }
  if (def.channels.length === 0) {
    throw new Error('Alert definition must specify at least one channel');
  }
  const validComparisons: AlertComparison[] = ['gt', 'lt', 'eq', 'gte', 'lte'];
  if (!validComparisons.includes(def.comparison)) {
    throw new Error(`Invalid comparison operator: ${String(def.comparison)}`);
  }
  const validSeverities: AlertSeverity[] = ['critical', 'warning', 'info'];
  if (!validSeverities.includes(def.severity)) {
    throw new Error(`Invalid severity: ${String(def.severity)}`);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface AlertManagerOptions {
  /** A function that resolves a metric query string to its current numeric value. */
  queryMetric: MetricQueryFn;
  /** Optional deduplicator for cooldown, rate limiting, and suppression. */
  deduplicator?: AlertDeduplicator;
}

/**
 * Creates an AlertManager instance.
 *
 * @param queryMetricOrOptions - Either a MetricQueryFn (legacy) or an options object.
 */
export function createAlertManager(
  queryMetricOrOptions: MetricQueryFn | AlertManagerOptions,
): AlertManager {
  const options: AlertManagerOptions =
    typeof queryMetricOrOptions === 'function'
      ? { queryMetric: queryMetricOrOptions }
      : queryMetricOrOptions;

  const { queryMetric, deduplicator } = options;
  const definitions = new Map<string, AlertDefinition>();
  const activeAlerts = new Map<string, Alert>();

  return {
    defineAlert(alert: AlertDefinition): void {
      validateDefinition(alert);
      if (definitions.has(alert.name)) {
        throw new Error(`Alert definition already exists: ${alert.name}`);
      }
      definitions.set(alert.name, { ...alert });
    },

    removeAlert(name: string): boolean {
      return definitions.delete(name);
    },

    getDefinitions(): AlertDefinition[] {
      return [...definitions.values()];
    },

    async checkAlerts(): Promise<Alert[]> {
      const fired: Alert[] = [];

      for (const def of definitions.values()) {
        const value = await queryMetric(def.query);
        if (value === undefined) continue;

        const breached = compareValue(value, def.comparison, def.threshold);
        if (!breached) continue;

        // Check if there is already a firing/acknowledged alert for this definition
        const existing = [...activeAlerts.values()].find(
          (a) => a.definitionName === def.name && a.status !== 'resolved',
        );
        if (existing) continue;

        // Check deduplication (cooldown, rate limit, suppression windows)
        if (deduplicator) {
          const dedupResult = deduplicator.check(def.name, def.severity, def.channels);
          if (!dedupResult.allowed) continue;
        }

        const alert: Alert = {
          id: randomUUID(),
          definitionName: def.name,
          severity: def.severity,
          status: 'firing',
          value,
          threshold: def.threshold,
          comparison: def.comparison,
          channels: [...def.channels],
          runbook: def.runbook,
          firedAt: new Date(),
        };

        activeAlerts.set(alert.id, alert);
        fired.push(alert);

        // Record notification for rate limiting
        if (deduplicator) {
          for (const channel of def.channels) {
            deduplicator.recordNotification(channel);
          }
        }
      }

      return fired;
    },

    getActiveAlerts(): Alert[] {
      return [...activeAlerts.values()].filter((a) => a.status !== 'resolved');
    },

    async acknowledge(alertId: string, userId: string): Promise<void> {
      const alert = activeAlerts.get(alertId);
      if (!alert) {
        throw new Error(`Alert not found: ${alertId}`);
      }
      if (alert.status === 'resolved') {
        throw new Error(`Cannot acknowledge a resolved alert: ${alertId}`);
      }
      alert.status = 'acknowledged';
      alert.acknowledgedAt = new Date();
      alert.acknowledgedBy = userId;
    },

    async resolve(alertId: string, userId: string, notes: string): Promise<void> {
      const alert = activeAlerts.get(alertId);
      if (!alert) {
        throw new Error(`Alert not found: ${alertId}`);
      }
      if (alert.status === 'resolved') {
        throw new Error(`Alert already resolved: ${alertId}`);
      }
      alert.status = 'resolved';
      alert.resolvedAt = new Date();
      alert.resolvedBy = userId;
      alert.resolveNotes = notes;

      // Start cooldown period for this alert definition
      if (deduplicator) {
        deduplicator.recordResolution(alert.definitionName);
      }
    },
  };
}
