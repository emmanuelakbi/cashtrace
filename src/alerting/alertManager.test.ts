/**
 * Unit tests for the AlertManager.
 *
 * Validates: Requirements 6.1 (threshold-based alerts), 6.4 (severity levels)
 *
 * @module alerting/alertManager.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAlertManager,
  type AlertManager,
  type AlertDefinition,
  type MetricQueryFn,
} from './alertManager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefinition(overrides: Partial<AlertDefinition> = {}): AlertDefinition {
  return {
    name: 'high_cpu',
    query: 'cpu_usage',
    threshold: 80,
    comparison: 'gt',
    duration: '5m',
    severity: 'warning',
    channels: ['email'],
    ...overrides,
  };
}

/** Creates a MetricQueryFn backed by a simple map. */
function makeQueryFn(values: Record<string, number>): MetricQueryFn {
  return async (query: string) => values[query];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlertManager', () => {
  let manager: AlertManager;
  let metricValues: Record<string, number>;

  beforeEach(() => {
    metricValues = {};
    manager = createAlertManager(makeQueryFn(metricValues));
  });

  // -------------------------------------------------------------------------
  // defineAlert
  // -------------------------------------------------------------------------

  describe('defineAlert', () => {
    it('registers a valid alert definition', () => {
      manager.defineAlert(makeDefinition());
      expect(manager.getDefinitions()).toHaveLength(1);
      expect(manager.getDefinitions()[0]?.name).toBe('high_cpu');
    });

    it('rejects duplicate alert names', () => {
      manager.defineAlert(makeDefinition());
      expect(() => manager.defineAlert(makeDefinition())).toThrow('already exists');
    });

    it('rejects empty name', () => {
      expect(() => manager.defineAlert(makeDefinition({ name: '' }))).toThrow('non-empty name');
    });

    it('rejects empty query', () => {
      expect(() => manager.defineAlert(makeDefinition({ query: '' }))).toThrow('non-empty query');
    });

    it('rejects empty channels', () => {
      expect(() => manager.defineAlert(makeDefinition({ channels: [] }))).toThrow(
        'at least one channel',
      );
    });
  });

  // -------------------------------------------------------------------------
  // removeAlert
  // -------------------------------------------------------------------------

  describe('removeAlert', () => {
    it('removes an existing definition', () => {
      manager.defineAlert(makeDefinition());
      expect(manager.removeAlert('high_cpu')).toBe(true);
      expect(manager.getDefinitions()).toHaveLength(0);
    });

    it('returns false for non-existent definition', () => {
      expect(manager.removeAlert('nope')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // checkAlerts – threshold comparisons (Requirement 6.1)
  // -------------------------------------------------------------------------

  describe('checkAlerts – threshold comparisons', () => {
    it('fires alert when value > threshold (gt)', async () => {
      manager.defineAlert(makeDefinition({ comparison: 'gt', threshold: 80 }));
      metricValues['cpu_usage'] = 90;
      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(1);
      expect(fired[0]?.status).toBe('firing');
      expect(fired[0]?.value).toBe(90);
    });

    it('does not fire when value <= threshold (gt)', async () => {
      manager.defineAlert(makeDefinition({ comparison: 'gt', threshold: 80 }));
      metricValues['cpu_usage'] = 80;
      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(0);
    });

    it('fires alert when value < threshold (lt)', async () => {
      manager.defineAlert(makeDefinition({ comparison: 'lt', threshold: 20 }));
      metricValues['cpu_usage'] = 10;
      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(1);
    });

    it('does not fire when value >= threshold (lt)', async () => {
      manager.defineAlert(makeDefinition({ comparison: 'lt', threshold: 20 }));
      metricValues['cpu_usage'] = 20;
      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(0);
    });

    it('fires alert when value == threshold (eq)', async () => {
      manager.defineAlert(makeDefinition({ comparison: 'eq', threshold: 50 }));
      metricValues['cpu_usage'] = 50;
      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(1);
    });

    it('does not fire when value != threshold (eq)', async () => {
      manager.defineAlert(makeDefinition({ comparison: 'eq', threshold: 50 }));
      metricValues['cpu_usage'] = 49;
      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(0);
    });

    it('fires alert when value >= threshold (gte)', async () => {
      manager.defineAlert(makeDefinition({ comparison: 'gte', threshold: 80 }));
      metricValues['cpu_usage'] = 80;
      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(1);
    });

    it('does not fire when value < threshold (gte)', async () => {
      manager.defineAlert(makeDefinition({ comparison: 'gte', threshold: 80 }));
      metricValues['cpu_usage'] = 79;
      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(0);
    });

    it('fires alert when value <= threshold (lte)', async () => {
      manager.defineAlert(makeDefinition({ comparison: 'lte', threshold: 10 }));
      metricValues['cpu_usage'] = 10;
      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(1);
    });

    it('does not fire when value > threshold (lte)', async () => {
      manager.defineAlert(makeDefinition({ comparison: 'lte', threshold: 10 }));
      metricValues['cpu_usage'] = 11;
      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(0);
    });

    it('skips metrics that return undefined', async () => {
      manager.defineAlert(makeDefinition({ query: 'missing_metric' }));
      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(0);
    });

    it('does not duplicate alerts for the same definition', async () => {
      manager.defineAlert(makeDefinition());
      metricValues['cpu_usage'] = 90;
      const first = await manager.checkAlerts();
      expect(first).toHaveLength(1);
      // Second check should not fire again
      const second = await manager.checkAlerts();
      expect(second).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Severity levels (Requirement 6.4)
  // -------------------------------------------------------------------------

  describe('severity levels', () => {
    it('supports critical severity', async () => {
      manager.defineAlert(makeDefinition({ name: 'crit', severity: 'critical' }));
      metricValues['cpu_usage'] = 99;
      const fired = await manager.checkAlerts();
      expect(fired[0]?.severity).toBe('critical');
    });

    it('supports warning severity', async () => {
      manager.defineAlert(makeDefinition({ name: 'warn', severity: 'warning' }));
      metricValues['cpu_usage'] = 90;
      const fired = await manager.checkAlerts();
      expect(fired[0]?.severity).toBe('warning');
    });

    it('supports info severity', async () => {
      manager.defineAlert(makeDefinition({ name: 'inf', severity: 'info' }));
      metricValues['cpu_usage'] = 85;
      const fired = await manager.checkAlerts();
      expect(fired[0]?.severity).toBe('info');
    });
  });

  // -------------------------------------------------------------------------
  // Alert lifecycle – acknowledge & resolve
  // -------------------------------------------------------------------------

  describe('acknowledge', () => {
    it('transitions alert from firing to acknowledged', async () => {
      manager.defineAlert(makeDefinition());
      metricValues['cpu_usage'] = 95;
      const [alert] = await manager.checkAlerts();
      await manager.acknowledge(alert!.id, 'user-1');

      const active = manager.getActiveAlerts();
      expect(active).toHaveLength(1);
      expect(active[0]?.status).toBe('acknowledged');
      expect(active[0]?.acknowledgedBy).toBe('user-1');
      expect(active[0]?.acknowledgedAt).toBeInstanceOf(Date);
    });

    it('throws for unknown alert id', async () => {
      await expect(manager.acknowledge('bad-id', 'user-1')).rejects.toThrow('not found');
    });

    it('throws when acknowledging a resolved alert', async () => {
      manager.defineAlert(makeDefinition());
      metricValues['cpu_usage'] = 95;
      const [alert] = await manager.checkAlerts();
      await manager.resolve(alert!.id, 'user-1', 'fixed');
      await expect(manager.acknowledge(alert!.id, 'user-2')).rejects.toThrow(
        'Cannot acknowledge a resolved alert',
      );
    });
  });

  describe('resolve', () => {
    it('transitions alert to resolved with notes', async () => {
      manager.defineAlert(makeDefinition());
      metricValues['cpu_usage'] = 95;
      const [alert] = await manager.checkAlerts();
      await manager.resolve(alert!.id, 'user-1', 'Scaled up instances');

      const active = manager.getActiveAlerts();
      expect(active).toHaveLength(0);
    });

    it('stores resolution metadata', async () => {
      manager.defineAlert(makeDefinition());
      metricValues['cpu_usage'] = 95;
      const [alert] = await manager.checkAlerts();
      await manager.resolve(alert!.id, 'user-1', 'Scaled up');

      // After resolution, a new alert can fire for the same definition
      const newFired = await manager.checkAlerts();
      expect(newFired).toHaveLength(1);
      expect(newFired[0]?.id).not.toBe(alert!.id);
    });

    it('throws for unknown alert id', async () => {
      await expect(manager.resolve('bad-id', 'user-1', 'notes')).rejects.toThrow('not found');
    });

    it('throws when resolving an already resolved alert', async () => {
      manager.defineAlert(makeDefinition());
      metricValues['cpu_usage'] = 95;
      const [alert] = await manager.checkAlerts();
      await manager.resolve(alert!.id, 'user-1', 'done');
      await expect(manager.resolve(alert!.id, 'user-2', 'again')).rejects.toThrow(
        'already resolved',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Alert metadata
  // -------------------------------------------------------------------------

  describe('alert metadata', () => {
    it('includes runbook link when defined', async () => {
      manager.defineAlert(makeDefinition({ runbook: 'https://wiki.example.com/cpu-runbook' }));
      metricValues['cpu_usage'] = 95;
      const [alert] = await manager.checkAlerts();
      expect(alert?.runbook).toBe('https://wiki.example.com/cpu-runbook');
    });

    it('includes channels from definition', async () => {
      manager.defineAlert(makeDefinition({ channels: ['slack', 'pagerduty'] }));
      metricValues['cpu_usage'] = 95;
      const [alert] = await manager.checkAlerts();
      expect(alert?.channels).toEqual(['slack', 'pagerduty']);
    });

    it('includes threshold and comparison in alert', async () => {
      manager.defineAlert(makeDefinition({ threshold: 80, comparison: 'gt' }));
      metricValues['cpu_usage'] = 95;
      const [alert] = await manager.checkAlerts();
      expect(alert?.threshold).toBe(80);
      expect(alert?.comparison).toBe('gt');
    });

    it('includes firedAt timestamp', async () => {
      manager.defineAlert(makeDefinition());
      metricValues['cpu_usage'] = 95;
      const [alert] = await manager.checkAlerts();
      expect(alert?.firedAt).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple definitions
  // -------------------------------------------------------------------------

  describe('multiple definitions', () => {
    it('evaluates all definitions independently', async () => {
      manager.defineAlert(
        makeDefinition({ name: 'cpu_high', query: 'cpu', comparison: 'gt', threshold: 80 }),
      );
      manager.defineAlert(
        makeDefinition({ name: 'mem_high', query: 'memory', comparison: 'gt', threshold: 70 }),
      );

      metricValues['cpu'] = 90;
      metricValues['memory'] = 75;

      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(2);
      const names = fired.map((a) => a.definitionName).sort();
      expect(names).toEqual(['cpu_high', 'mem_high']);
    });

    it('only fires alerts for breached thresholds', async () => {
      manager.defineAlert(
        makeDefinition({ name: 'cpu_high', query: 'cpu', comparison: 'gt', threshold: 80 }),
      );
      manager.defineAlert(
        makeDefinition({ name: 'mem_high', query: 'memory', comparison: 'gt', threshold: 70 }),
      );

      metricValues['cpu'] = 90;
      metricValues['memory'] = 50;

      const fired = await manager.checkAlerts();
      expect(fired).toHaveLength(1);
      expect(fired[0]?.definitionName).toBe('cpu_high');
    });
  });
});
