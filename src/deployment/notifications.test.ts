import { describe, expect, it } from 'vitest';

import {
  buildNotificationPayload,
  EMAIL_PATTERN,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  SLACK_CHANNEL_PATTERN,
  validateNotification,
  validateNotificationConfig,
  validateNotificationTarget,
  WEBHOOK_PATTERN,
} from './notifications.js';
import { makeDeployment, makePipelineNotification } from './testHelpers.js';

// ─── validateNotificationTarget ──────────────────────────────────────────────

describe('validateNotificationTarget', () => {
  describe('slack', () => {
    it('should accept a valid Slack channel', () => {
      const result = validateNotificationTarget('slack', '#deployments');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept channel with hyphens and underscores', () => {
      const result = validateNotificationTarget('slack', '#deploy-prod_alerts');
      expect(result.valid).toBe(true);
    });

    it('should reject channel without leading #', () => {
      const result = validateNotificationTarget('slack', 'deployments');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid Slack channel');
    });

    it('should reject channel with uppercase letters', () => {
      const result = validateNotificationTarget('slack', '#Deployments');
      expect(result.valid).toBe(false);
    });

    it('should reject channel with spaces', () => {
      const result = validateNotificationTarget('slack', '#deploy ments');
      expect(result.valid).toBe(false);
    });

    it('should reject empty string', () => {
      const result = validateNotificationTarget('slack', '');
      expect(result.valid).toBe(false);
    });
  });

  describe('email', () => {
    it('should accept a valid email address', () => {
      const result = validateNotificationTarget('email', 'team@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with subdomain', () => {
      const result = validateNotificationTarget('email', 'ops@deploy.cashtrace.ng');
      expect(result.valid).toBe(true);
    });

    it('should reject email without @', () => {
      const result = validateNotificationTarget('email', 'teamexample.com');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid email');
    });

    it('should reject email without domain', () => {
      const result = validateNotificationTarget('email', 'team@');
      expect(result.valid).toBe(false);
    });

    it('should reject email with spaces', () => {
      const result = validateNotificationTarget('email', 'te am@example.com');
      expect(result.valid).toBe(false);
    });

    it('should reject empty string', () => {
      const result = validateNotificationTarget('email', '');
      expect(result.valid).toBe(false);
    });
  });

  describe('webhook', () => {
    it('should accept a valid HTTPS webhook URL', () => {
      const result = validateNotificationTarget('webhook', 'https://hooks.example.com/deploy');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject HTTP webhook URL', () => {
      const result = validateNotificationTarget('webhook', 'http://hooks.example.com/deploy');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must start with https://');
    });

    it('should reject non-URL string', () => {
      const result = validateNotificationTarget('webhook', 'not-a-url');
      expect(result.valid).toBe(false);
    });

    it('should reject empty string', () => {
      const result = validateNotificationTarget('webhook', '');
      expect(result.valid).toBe(false);
    });
  });
});

// ─── validateNotification ────────────────────────────────────────────────────

describe('validateNotification', () => {
  it('should accept a valid notification', () => {
    const result = validateNotification(makePipelineNotification());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should accept notification with multiple valid events', () => {
    const result = validateNotification(
      makePipelineNotification({ events: ['success', 'failure', 'started'] }),
    );
    expect(result.valid).toBe(true);
  });

  it('should reject invalid channel', () => {
    const result = validateNotification(makePipelineNotification({ channel: 'sms' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid channel'))).toBe(true);
  });

  it('should reject empty events array', () => {
    const result = validateNotification(makePipelineNotification({ events: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-empty'))).toBe(true);
  });

  it('should reject invalid event', () => {
    const result = validateNotification(
      makePipelineNotification({ events: ['failure', 'cancelled'] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid event "cancelled"'))).toBe(true);
  });

  it('should reject invalid target for channel', () => {
    const result = validateNotification(
      makePipelineNotification({ channel: 'slack', target: 'not-a-channel' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid Slack channel'))).toBe(true);
  });

  it('should accumulate multiple errors', () => {
    const result = validateNotification(
      makePipelineNotification({ channel: 'email', events: ['bad_event'], target: 'not-email' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── validateNotificationConfig ──────────────────────────────────────────────

describe('validateNotificationConfig', () => {
  it('should accept a valid config', () => {
    const result = validateNotificationConfig({
      notifications: [makePipelineNotification()],
      requireFailureNotification: false,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should accept config with failure requirement when met', () => {
    const result = validateNotificationConfig({
      notifications: [makePipelineNotification({ events: ['failure'] })],
      requireFailureNotification: true,
    });
    expect(result.valid).toBe(true);
  });

  it('should reject config with failure requirement when not met', () => {
    const result = validateNotificationConfig({
      notifications: [makePipelineNotification({ events: ['success'] })],
      requireFailureNotification: true,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"failure" event'))).toBe(true);
  });

  it('should accept config without failure requirement even if no failure event', () => {
    const result = validateNotificationConfig({
      notifications: [makePipelineNotification({ events: ['success'] })],
      requireFailureNotification: false,
    });
    expect(result.valid).toBe(true);
  });

  it('should reject config with invalid notifications', () => {
    const result = validateNotificationConfig({
      notifications: [makePipelineNotification({ channel: 'sms' })],
      requireFailureNotification: false,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Notification[0]'))).toBe(true);
  });

  it('should accept empty notifications when failure not required', () => {
    const result = validateNotificationConfig({
      notifications: [],
      requireFailureNotification: false,
    });
    expect(result.valid).toBe(true);
  });

  it('should reject empty notifications when failure is required', () => {
    const result = validateNotificationConfig({
      notifications: [],
      requireFailureNotification: true,
    });
    expect(result.valid).toBe(false);
  });

  it('should aggregate errors from multiple invalid notifications', () => {
    const result = validateNotificationConfig({
      notifications: [
        makePipelineNotification({ channel: 'sms' }),
        makePipelineNotification({ events: [] }),
      ],
      requireFailureNotification: false,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Notification[0]'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Notification[1]'))).toBe(true);
  });
});

// ─── buildNotificationPayload ────────────────────────────────────────────────

describe('buildNotificationPayload', () => {
  it('should map a succeeded deployment to a payload', () => {
    const startedAt = new Date('2024-06-01T10:00:00Z');
    const completedAt = new Date('2024-06-01T10:05:00Z');
    const deployment = makeDeployment({
      environment: 'production',
      version: '2.0.0',
      status: 'succeeded',
      commitSha: 'abc123',
      startedAt,
      completedAt,
      initiatedBy: 'deploy-bot',
    });

    const payload = buildNotificationPayload(deployment);

    expect(payload.environment).toBe('production');
    expect(payload.version).toBe('2.0.0');
    expect(payload.status).toBe('succeeded');
    expect(payload.timestamp).toBe(startedAt);
    expect(payload.initiatedBy).toBe('deploy-bot');
    expect(payload.commitSha).toBe('abc123');
    expect(payload.duration).toBe(300);
  });

  it('should map a failed deployment', () => {
    const payload = buildNotificationPayload(makeDeployment({ status: 'failed' }));
    expect(payload.status).toBe('failed');
  });

  it('should map a rolled_back deployment', () => {
    const payload = buildNotificationPayload(makeDeployment({ status: 'rolled_back' }));
    expect(payload.status).toBe('rolled_back');
  });

  it('should map an in_progress deployment to started', () => {
    const payload = buildNotificationPayload(makeDeployment({ status: 'in_progress' }));
    expect(payload.status).toBe('started');
  });

  it('should map a pending deployment to started', () => {
    const payload = buildNotificationPayload(makeDeployment({ status: 'pending' }));
    expect(payload.status).toBe('started');
  });

  it('should omit duration when completedAt is not present', () => {
    const deployment = makeDeployment({ completedAt: undefined });
    const payload = buildNotificationPayload(deployment);
    expect(payload.duration).toBeUndefined();
  });

  it('should calculate duration in seconds', () => {
    const startedAt = new Date('2024-01-01T00:00:00Z');
    const completedAt = new Date('2024-01-01T00:01:30Z'); // 90 seconds
    const deployment = makeDeployment({ startedAt, completedAt });
    const payload = buildNotificationPayload(deployment);
    expect(payload.duration).toBe(90);
  });

  it('should handle zero duration when startedAt equals completedAt', () => {
    const now = new Date();
    const deployment = makeDeployment({ startedAt: now, completedAt: now });
    const payload = buildNotificationPayload(deployment);
    expect(payload.duration).toBe(0);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('notification constants', () => {
  it('should have three notification channels', () => {
    expect(NOTIFICATION_CHANNELS).toEqual(['slack', 'email', 'webhook']);
  });

  it('should have four notification events', () => {
    expect(NOTIFICATION_EVENTS).toEqual(['success', 'failure', 'started', 'approval_needed']);
  });

  it('should match valid Slack channels with SLACK_CHANNEL_PATTERN', () => {
    expect(SLACK_CHANNEL_PATTERN.test('#deploy')).toBe(true);
    expect(SLACK_CHANNEL_PATTERN.test('#a-b_c')).toBe(true);
    expect(SLACK_CHANNEL_PATTERN.test('deploy')).toBe(false);
  });

  it('should match valid emails with EMAIL_PATTERN', () => {
    expect(EMAIL_PATTERN.test('a@b.c')).toBe(true);
    expect(EMAIL_PATTERN.test('nope')).toBe(false);
  });

  it('should match HTTPS URLs with WEBHOOK_PATTERN', () => {
    expect(WEBHOOK_PATTERN.test('https://example.com')).toBe(true);
    expect(WEBHOOK_PATTERN.test('http://example.com')).toBe(false);
  });
});
