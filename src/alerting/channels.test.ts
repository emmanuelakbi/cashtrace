import { describe, it, expect } from 'vitest';
import type { Alert } from './alertManager.js';
import {
  createEmailNotifier,
  createSlackNotifier,
  createPagerDutyNotifier,
  createInMemoryAlertTransport,
  formatSubject,
  formatEmailBody,
  formatSlackBody,
  formatPagerDutyBody,
} from './channels.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'alert-1',
    definitionName: 'high_error_rate',
    severity: 'critical',
    status: 'firing',
    value: 95,
    threshold: 90,
    comparison: 'gt',
    channels: ['email', 'slack', 'pagerduty'],
    runbook: 'https://runbooks.example.com/high-error-rate',
    firedAt: new Date('2024-01-15T10:30:00Z'),
    ...overrides,
  };
}

// ─── formatSubject ───────────────────────────────────────────────────────────

describe('formatSubject', () => {
  it('includes severity in uppercase and alert name', () => {
    const alert = makeAlert({ severity: 'warning', definitionName: 'cpu_spike' });
    expect(formatSubject(alert)).toBe('[WARNING] Alert: cpu_spike');
  });

  it('formats critical severity', () => {
    const alert = makeAlert({ severity: 'critical' });
    expect(formatSubject(alert)).toBe('[CRITICAL] Alert: high_error_rate');
  });

  it('formats info severity', () => {
    const alert = makeAlert({ severity: 'info' });
    expect(formatSubject(alert)).toBe('[INFO] Alert: high_error_rate');
  });
});

// ─── formatEmailBody ─────────────────────────────────────────────────────────

describe('formatEmailBody', () => {
  it('includes all alert fields', () => {
    const body = formatEmailBody(makeAlert());
    expect(body).toContain('Alert: high_error_rate');
    expect(body).toContain('Severity: critical');
    expect(body).toContain('Status: firing');
    expect(body).toContain('Value: 95');
    expect(body).toContain('threshold: gt 90');
    expect(body).toContain('Fired at: 2024-01-15T10:30:00.000Z');
  });

  it('includes runbook when present', () => {
    const body = formatEmailBody(makeAlert());
    expect(body).toContain('Runbook: https://runbooks.example.com/high-error-rate');
  });

  it('omits runbook when absent', () => {
    const body = formatEmailBody(makeAlert({ runbook: undefined }));
    expect(body).not.toContain('Runbook');
  });
});

// ─── formatSlackBody ─────────────────────────────────────────────────────────

describe('formatSlackBody', () => {
  it('uses markdown formatting and emoji', () => {
    const body = formatSlackBody(makeAlert());
    expect(body).toContain('🔴');
    expect(body).toContain('*high_error_rate*');
    expect(body).toContain('*Severity:* critical');
    expect(body).toContain('`95`');
  });

  it('formats runbook as a Slack link', () => {
    const body = formatSlackBody(makeAlert());
    expect(body).toContain('<https://runbooks.example.com/high-error-rate|View Runbook>');
  });

  it('uses warning emoji for warning severity', () => {
    const body = formatSlackBody(makeAlert({ severity: 'warning' }));
    expect(body).toContain('🟡');
  });

  it('uses info emoji for info severity', () => {
    const body = formatSlackBody(makeAlert({ severity: 'info' }));
    expect(body).toContain('🔵');
  });
});

// ─── formatPagerDutyBody ─────────────────────────────────────────────────────

describe('formatPagerDutyBody', () => {
  it('uses pipe-delimited concise format', () => {
    const body = formatPagerDutyBody(makeAlert());
    expect(body).toContain('high_error_rate: critical alert');
    expect(body).toContain('Value 95 gt threshold 90');
    expect(body).toContain('|');
  });

  it('includes runbook when present', () => {
    const body = formatPagerDutyBody(makeAlert());
    expect(body).toContain('Runbook: https://runbooks.example.com/high-error-rate');
  });
});

// ─── Email Notifier ──────────────────────────────────────────────────────────

describe('createEmailNotifier', () => {
  const emailConfig = {
    endpoint: 'https://smtp.example.com/send',
    recipient: 'ops@example.com',
    from: 'alerts@cashtrace.ng',
  };

  it('sends alert payload via transport', () => {
    const transport = createInMemoryAlertTransport();
    const notifier = createEmailNotifier(emailConfig, transport);
    const alert = makeAlert();

    const payload = notifier.notify(alert);

    expect(payload).not.toBeNull();
    expect(payload!.channel).toBe('email');
    expect(payload!.endpoint).toBe(emailConfig.endpoint);
    expect(payload!.metadata.to).toBe('ops@example.com');
    expect(payload!.metadata.from).toBe('alerts@cashtrace.ng');
    expect(transport.payloads).toHaveLength(1);
  });

  it('returns null when disabled', () => {
    const transport = createInMemoryAlertTransport();
    const notifier = createEmailNotifier({ ...emailConfig, enabled: false }, transport);

    expect(notifier.notify(makeAlert())).toBeNull();
    expect(transport.payloads).toHaveLength(0);
  });

  it('has channel type "email"', () => {
    const transport = createInMemoryAlertTransport();
    const notifier = createEmailNotifier(emailConfig, transport);
    expect(notifier.channel).toBe('email');
  });

  it('throws on missing endpoint', () => {
    const transport = createInMemoryAlertTransport();
    expect(() => createEmailNotifier({ ...emailConfig, endpoint: '' }, transport)).toThrow(
      'non-empty endpoint',
    );
  });

  it('throws on missing recipient', () => {
    const transport = createInMemoryAlertTransport();
    expect(() => createEmailNotifier({ ...emailConfig, recipient: '' }, transport)).toThrow(
      'non-empty recipient',
    );
  });

  it('throws on missing from address', () => {
    const transport = createInMemoryAlertTransport();
    expect(() => createEmailNotifier({ ...emailConfig, from: '' }, transport)).toThrow(
      'non-empty from',
    );
  });
});

// ─── Slack Notifier ──────────────────────────────────────────────────────────

describe('createSlackNotifier', () => {
  const slackConfig = {
    webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
    channelName: '#ops-alerts',
  };

  it('sends alert payload via transport', () => {
    const transport = createInMemoryAlertTransport();
    const notifier = createSlackNotifier(slackConfig, transport);
    const alert = makeAlert();

    const payload = notifier.notify(alert);

    expect(payload).not.toBeNull();
    expect(payload!.channel).toBe('slack');
    expect(payload!.endpoint).toBe(slackConfig.webhookUrl);
    expect(payload!.metadata.channelName).toBe('#ops-alerts');
    expect(transport.payloads).toHaveLength(1);
  });

  it('returns null when disabled', () => {
    const transport = createInMemoryAlertTransport();
    const notifier = createSlackNotifier({ ...slackConfig, enabled: false }, transport);

    expect(notifier.notify(makeAlert())).toBeNull();
    expect(transport.payloads).toHaveLength(0);
  });

  it('has channel type "slack"', () => {
    const transport = createInMemoryAlertTransport();
    const notifier = createSlackNotifier(slackConfig, transport);
    expect(notifier.channel).toBe('slack');
  });

  it('defaults channelName to empty string when not provided', () => {
    const transport = createInMemoryAlertTransport();
    const notifier = createSlackNotifier({ webhookUrl: slackConfig.webhookUrl }, transport);
    const payload = notifier.notify(makeAlert());
    expect(payload!.metadata.channelName).toBe('');
  });

  it('throws on missing webhookUrl', () => {
    const transport = createInMemoryAlertTransport();
    expect(() => createSlackNotifier({ webhookUrl: '' }, transport)).toThrow(
      'non-empty webhookUrl',
    );
  });
});

// ─── PagerDuty Notifier ─────────────────────────────────────────────────────

describe('createPagerDutyNotifier', () => {
  const pdConfig = {
    endpoint: 'https://events.pagerduty.com/v2/enqueue',
    routingKey: 'R0123456789ABCDEF',
  };

  it('sends alert payload via transport', () => {
    const transport = createInMemoryAlertTransport();
    const notifier = createPagerDutyNotifier(pdConfig, transport);
    const alert = makeAlert();

    const payload = notifier.notify(alert);

    expect(payload).not.toBeNull();
    expect(payload!.channel).toBe('pagerduty');
    expect(payload!.endpoint).toBe(pdConfig.endpoint);
    expect(payload!.metadata.routingKey).toBe(pdConfig.routingKey);
    expect(transport.payloads).toHaveLength(1);
  });

  it('returns null when disabled', () => {
    const transport = createInMemoryAlertTransport();
    const notifier = createPagerDutyNotifier({ ...pdConfig, enabled: false }, transport);

    expect(notifier.notify(makeAlert())).toBeNull();
    expect(transport.payloads).toHaveLength(0);
  });

  it('has channel type "pagerduty"', () => {
    const transport = createInMemoryAlertTransport();
    const notifier = createPagerDutyNotifier(pdConfig, transport);
    expect(notifier.channel).toBe('pagerduty');
  });

  it('throws on missing endpoint', () => {
    const transport = createInMemoryAlertTransport();
    expect(() => createPagerDutyNotifier({ ...pdConfig, endpoint: '' }, transport)).toThrow(
      'non-empty endpoint',
    );
  });

  it('throws on missing routingKey', () => {
    const transport = createInMemoryAlertTransport();
    expect(() => createPagerDutyNotifier({ ...pdConfig, routingKey: '' }, transport)).toThrow(
      'non-empty routingKey',
    );
  });
});

// ─── In-Memory Transport ─────────────────────────────────────────────────────

describe('createInMemoryAlertTransport', () => {
  it('stores sent payloads', () => {
    const transport = createInMemoryAlertTransport();
    const payload = {
      channel: 'email' as const,
      endpoint: 'https://example.com',
      subject: 'Test',
      body: 'Test body',
      metadata: {},
    };

    const result = transport.send(payload);

    expect(result).toBe(true);
    expect(transport.payloads).toHaveLength(1);
    expect(transport.payloads[0]).toEqual(payload);
  });

  it('starts with empty payloads', () => {
    const transport = createInMemoryAlertTransport();
    expect(transport.payloads).toHaveLength(0);
  });
});
