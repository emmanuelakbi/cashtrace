/**
 * Unit tests for Alert Deduplication.
 *
 * Validates: Requirements 6.3 (alert deduplication to prevent spam)
 *
 * @module alerting/deduplication.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAlertDeduplicator,
  isInTimeWindow,
  type AlertDeduplicator,
  type DeduplicationConfig,
} from './deduplication.js';
import { createAlertManager, type AlertManager, type AlertDefinition } from './alertManager.js';

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

// ---------------------------------------------------------------------------
// isInTimeWindow
// ---------------------------------------------------------------------------

describe('isInTimeWindow', () => {
  it('returns true when hour is within a normal range', () => {
    expect(isInTimeWindow(10, 9, 17)).toBe(true);
  });

  it('returns false when hour is outside a normal range', () => {
    expect(isInTimeWindow(8, 9, 17)).toBe(false);
  });

  it('returns true at the start boundary (inclusive)', () => {
    expect(isInTimeWindow(9, 9, 17)).toBe(true);
  });

  it('returns false at the end boundary (exclusive)', () => {
    expect(isInTimeWindow(17, 9, 17)).toBe(false);
  });

  it('handles wrap-around past midnight — hour in evening', () => {
    expect(isInTimeWindow(23, 22, 6)).toBe(true);
  });

  it('handles wrap-around past midnight — hour in morning', () => {
    expect(isInTimeWindow(3, 22, 6)).toBe(true);
  });

  it('handles wrap-around past midnight — hour outside', () => {
    expect(isInTimeWindow(12, 22, 6)).toBe(false);
  });

  it('returns false for zero-width window (start === end)', () => {
    expect(isInTimeWindow(10, 10, 10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AlertDeduplicator — Cooldown
// ---------------------------------------------------------------------------

describe('AlertDeduplicator — Cooldown', () => {
  let dedup: AlertDeduplicator;
  let currentTime: number;

  beforeEach(() => {
    currentTime = Date.now();
    dedup = createAlertDeduplicator(
      { defaultCooldown: { durationMs: 5 * 60 * 1000 } },
      () => currentTime,
    );
  });

  it('allows alert when no cooldown is active', () => {
    const result = dedup.check('high_cpu', 'warning', ['email']);
    expect(result.allowed).toBe(true);
    expect(result.suppressed).toHaveLength(0);
  });

  it('suppresses alert during cooldown period after resolution', () => {
    dedup.recordResolution('high_cpu');
    currentTime += 2 * 60 * 1000; // 2 minutes later

    const result = dedup.check('high_cpu', 'warning', ['email']);
    expect(result.allowed).toBe(false);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0]?.type).toBe('cooldown');
  });

  it('allows alert after cooldown period expires', () => {
    dedup.recordResolution('high_cpu');
    currentTime += 6 * 60 * 1000; // 6 minutes later

    const result = dedup.check('high_cpu', 'warning', ['email']);
    expect(result.allowed).toBe(true);
  });

  it('uses per-alert cooldown config over default', () => {
    dedup = createAlertDeduplicator(
      {
        defaultCooldown: { durationMs: 5 * 60 * 1000 },
        cooldowns: { high_cpu: { durationMs: 1 * 60 * 1000 } },
      },
      () => currentTime,
    );

    dedup.recordResolution('high_cpu');
    currentTime += 2 * 60 * 1000; // 2 minutes — past per-alert cooldown

    const result = dedup.check('high_cpu', 'warning', ['email']);
    expect(result.allowed).toBe(true);
  });

  it('does not affect other alert definitions', () => {
    dedup.recordResolution('high_cpu');
    currentTime += 1 * 60 * 1000;

    const result = dedup.check('high_memory', 'warning', ['email']);
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AlertDeduplicator — Rate Limiting
// ---------------------------------------------------------------------------

describe('AlertDeduplicator — Rate Limiting', () => {
  let dedup: AlertDeduplicator;
  let currentTime: number;

  beforeEach(() => {
    currentTime = Date.now();
    dedup = createAlertDeduplicator(
      {
        rateLimits: {
          email: { maxNotifications: 3, windowMs: 60 * 60 * 1000 },
          slack: { maxNotifications: 5, windowMs: 60 * 60 * 1000 },
        },
      },
      () => currentTime,
    );
  });

  it('allows notifications under the rate limit', () => {
    dedup.recordNotification('email');
    dedup.recordNotification('email');

    const result = dedup.check('any_alert', 'warning', ['email']);
    expect(result.allowed).toBe(true);
  });

  it('suppresses when rate limit is reached', () => {
    dedup.recordNotification('email');
    dedup.recordNotification('email');
    dedup.recordNotification('email');

    const result = dedup.check('any_alert', 'warning', ['email']);
    expect(result.allowed).toBe(false);
    expect(result.suppressed[0]?.type).toBe('rate_limit');
  });

  it('allows again after window expires', () => {
    dedup.recordNotification('email');
    dedup.recordNotification('email');
    dedup.recordNotification('email');

    currentTime += 61 * 60 * 1000; // past the 1-hour window

    const result = dedup.check('any_alert', 'warning', ['email']);
    expect(result.allowed).toBe(true);
  });

  it('tracks channels independently', () => {
    dedup.recordNotification('email');
    dedup.recordNotification('email');
    dedup.recordNotification('email');

    // email is at limit, but slack is not
    const emailResult = dedup.check('any_alert', 'warning', ['email']);
    expect(emailResult.allowed).toBe(false);

    const slackResult = dedup.check('any_alert', 'warning', ['slack']);
    expect(slackResult.allowed).toBe(true);
  });

  it('suppresses if any channel in the list is rate-limited', () => {
    dedup.recordNotification('email');
    dedup.recordNotification('email');
    dedup.recordNotification('email');

    const result = dedup.check('any_alert', 'warning', ['email', 'slack']);
    expect(result.allowed).toBe(false);
  });

  it('allows channels without rate limit config', () => {
    dedup.recordNotification('pagerduty');
    dedup.recordNotification('pagerduty');
    dedup.recordNotification('pagerduty');
    dedup.recordNotification('pagerduty');

    const result = dedup.check('any_alert', 'critical', ['pagerduty']);
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AlertDeduplicator — Suppression Windows
// ---------------------------------------------------------------------------

describe('AlertDeduplicator — Suppression Windows', () => {
  it('suppresses alerts during a suppression window', () => {
    // Set time to Wednesday 3:00 UTC
    const wed3am = new Date('2025-01-08T03:00:00Z').getTime();
    const dedup = createAlertDeduplicator(
      {
        suppressionWindows: [{ name: 'night', startHour: 0, endHour: 6 }],
      },
      () => wed3am,
    );

    const result = dedup.check('high_cpu', 'warning', ['email']);
    expect(result.allowed).toBe(false);
    expect(result.suppressed[0]?.type).toBe('suppression_window');
  });

  it('allows alerts outside a suppression window', () => {
    const wed10am = new Date('2025-01-08T10:00:00Z').getTime();
    const dedup = createAlertDeduplicator(
      {
        suppressionWindows: [{ name: 'night', startHour: 0, endHour: 6 }],
      },
      () => wed10am,
    );

    const result = dedup.check('high_cpu', 'warning', ['email']);
    expect(result.allowed).toBe(true);
  });

  it('respects day-of-week filter', () => {
    // Wednesday = day 3
    const wed3am = new Date('2025-01-08T03:00:00Z').getTime();
    const dedup = createAlertDeduplicator(
      {
        suppressionWindows: [
          { name: 'weekend-night', startHour: 0, endHour: 6, daysOfWeek: [0, 6] },
        ],
      },
      () => wed3am,
    );

    // Wednesday is not in [Sunday, Saturday], so should be allowed
    const result = dedup.check('high_cpu', 'warning', ['email']);
    expect(result.allowed).toBe(true);
  });

  it('suppresses on matching day-of-week', () => {
    // Sunday = day 0, Jan 5 2025 is a Sunday
    const sun3am = new Date('2025-01-05T03:00:00Z').getTime();
    const dedup = createAlertDeduplicator(
      {
        suppressionWindows: [
          { name: 'weekend-night', startHour: 0, endHour: 6, daysOfWeek: [0, 6] },
        ],
      },
      () => sun3am,
    );

    const result = dedup.check('high_cpu', 'warning', ['email']);
    expect(result.allowed).toBe(false);
  });

  it('respects severity filter', () => {
    const wed3am = new Date('2025-01-08T03:00:00Z').getTime();
    const dedup = createAlertDeduplicator(
      {
        suppressionWindows: [
          { name: 'night-info-only', startHour: 0, endHour: 6, severities: ['info'] },
        ],
      },
      () => wed3am,
    );

    // Warning should not be suppressed
    const warningResult = dedup.check('high_cpu', 'warning', ['email']);
    expect(warningResult.allowed).toBe(true);

    // Info should be suppressed
    const infoResult = dedup.check('low_disk', 'info', ['email']);
    expect(infoResult.allowed).toBe(false);
  });

  it('respects channel filter', () => {
    const wed3am = new Date('2025-01-08T03:00:00Z').getTime();
    const dedup = createAlertDeduplicator(
      {
        suppressionWindows: [
          { name: 'night-email-only', startHour: 0, endHour: 6, channels: ['email'] },
        ],
      },
      () => wed3am,
    );

    // Slack should not be suppressed
    const slackResult = dedup.check('high_cpu', 'warning', ['slack']);
    expect(slackResult.allowed).toBe(true);

    // Email should be suppressed
    const emailResult = dedup.check('high_cpu', 'warning', ['email']);
    expect(emailResult.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AlertDeduplicator — Config & Reset
// ---------------------------------------------------------------------------

describe('AlertDeduplicator — Config & Reset', () => {
  it('returns current config', () => {
    const config: DeduplicationConfig = { defaultCooldown: { durationMs: 1000 } };
    const dedup = createAlertDeduplicator(config);
    expect(dedup.getConfig()).toEqual(config);
  });

  it('updates config at runtime', () => {
    const dedup = createAlertDeduplicator({});
    dedup.updateConfig({ defaultCooldown: { durationMs: 9999 } });
    expect(dedup.getConfig().defaultCooldown?.durationMs).toBe(9999);
  });

  it('reset clears all internal state', () => {
    let currentTime = Date.now();
    const dedup = createAlertDeduplicator(
      {
        defaultCooldown: { durationMs: 5 * 60 * 1000 },
        rateLimits: { email: { maxNotifications: 1, windowMs: 60 * 60 * 1000 } },
      },
      () => currentTime,
    );

    dedup.recordResolution('high_cpu');
    dedup.recordNotification('email');

    // Both should suppress
    const before = dedup.check('high_cpu', 'warning', ['email']);
    expect(before.allowed).toBe(false);

    dedup.reset();

    // After reset, should be allowed
    const after = dedup.check('high_cpu', 'warning', ['email']);
    expect(after.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AlertDeduplicator — Multiple suppression reasons
// ---------------------------------------------------------------------------

describe('AlertDeduplicator — Multiple reasons', () => {
  it('collects all suppression reasons', () => {
    const wed3am = new Date('2025-01-08T03:00:00Z').getTime();
    let currentTime = wed3am;

    const dedup = createAlertDeduplicator(
      {
        defaultCooldown: { durationMs: 10 * 60 * 1000 },
        rateLimits: { email: { maxNotifications: 0, windowMs: 60 * 60 * 1000 } },
        suppressionWindows: [{ name: 'night', startHour: 0, endHour: 6 }],
      },
      () => currentTime,
    );

    dedup.recordResolution('high_cpu');

    const result = dedup.check('high_cpu', 'warning', ['email']);
    expect(result.allowed).toBe(false);
    expect(result.suppressed).toHaveLength(3);

    const types = result.suppressed.map((s) => s.type).sort();
    expect(types).toEqual(['cooldown', 'rate_limit', 'suppression_window']);
  });
});

// ---------------------------------------------------------------------------
// Integration: AlertManager + Deduplicator
// ---------------------------------------------------------------------------

describe('AlertManager with Deduplicator integration', () => {
  let metricValues: Record<string, number>;
  let currentTime: number;

  beforeEach(() => {
    metricValues = {};
    currentTime = Date.now();
  });

  function makeQueryFn() {
    return async (query: string) => metricValues[query];
  }

  it('suppresses re-fire during cooldown after resolution', async () => {
    const dedup = createAlertDeduplicator(
      { defaultCooldown: { durationMs: 5 * 60 * 1000 } },
      () => currentTime,
    );
    const manager = createAlertManager({ queryMetric: makeQueryFn(), deduplicator: dedup });

    manager.defineAlert(makeDefinition());
    metricValues['cpu_usage'] = 90;

    // First fire
    const first = await manager.checkAlerts();
    expect(first).toHaveLength(1);

    // Resolve
    await manager.resolve(first[0]!.id, 'user-1', 'fixed');

    // Try to re-fire within cooldown
    currentTime += 2 * 60 * 1000;
    const second = await manager.checkAlerts();
    expect(second).toHaveLength(0);

    // After cooldown expires
    currentTime += 4 * 60 * 1000;
    const third = await manager.checkAlerts();
    expect(third).toHaveLength(1);
  });

  it('rate limits notifications per channel', async () => {
    const dedup = createAlertDeduplicator(
      { rateLimits: { email: { maxNotifications: 2, windowMs: 60 * 60 * 1000 } } },
      () => currentTime,
    );
    const manager = createAlertManager({ queryMetric: makeQueryFn(), deduplicator: dedup });

    // Define two alerts on the same channel
    manager.defineAlert(makeDefinition({ name: 'alert_1', query: 'metric_1' }));
    manager.defineAlert(makeDefinition({ name: 'alert_2', query: 'metric_2' }));
    manager.defineAlert(makeDefinition({ name: 'alert_3', query: 'metric_3' }));

    metricValues['metric_1'] = 90;
    metricValues['metric_2'] = 90;
    metricValues['metric_3'] = 90;

    const fired = await manager.checkAlerts();
    // Only 2 should fire due to rate limit of 2 per hour on email
    expect(fired).toHaveLength(2);
  });

  it('works without deduplicator (backward compatible)', async () => {
    const manager = createAlertManager(makeQueryFn());
    manager.defineAlert(makeDefinition());
    metricValues['cpu_usage'] = 90;

    const fired = await manager.checkAlerts();
    expect(fired).toHaveLength(1);
  });
});
