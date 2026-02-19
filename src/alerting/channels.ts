/**
 * Alert Channels
 *
 * Provides notifier implementations for email, Slack, and PagerDuty alert
 * channels. Each notifier formats alert messages appropriately for its
 * channel and sends them via a configurable transport abstraction.
 *
 * The transport layer allows production code to use real HTTP/SMTP clients
 * while tests use lightweight in-memory transports.
 *
 * Requirements: 6.2 (support alert channels: email, Slack, PagerDuty)
 *
 * @module alerting/channels
 */

import type { Alert, AlertChannel, AlertSeverity } from './alertManager.js';

// ─── Transport Abstraction ───────────────────────────────────────────────────

/** Generic transport for delivering alert payloads to external services. */
export interface AlertTransport {
  /** Send a payload to the configured endpoint. Returns true if accepted. */
  send(payload: AlertPayload): boolean;
}

/** A structured payload ready for transport. */
export interface AlertPayload {
  channel: AlertChannel;
  endpoint: string;
  subject: string;
  body: string;
  metadata: Record<string, string>;
}

// ─── Notifier Interface ──────────────────────────────────────────────────────

/** Common interface for all alert channel notifiers. */
export interface AlertNotifier {
  /** The channel type this notifier handles. */
  readonly channel: AlertChannel;
  /** Send an alert notification. Returns the formatted payload, or null if disabled. */
  notify(alert: Alert): AlertPayload | null;
}

// ─── Message Formatting ──────────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
};

/** Format a human-readable subject line for an alert. */
export function formatSubject(alert: Alert): string {
  const prefix = `[${alert.severity.toUpperCase()}]`;
  return `${prefix} Alert: ${alert.definitionName}`;
}

/** Format an alert body suitable for email (plain text). */
export function formatEmailBody(alert: Alert): string {
  const lines = [
    `Alert: ${alert.definitionName}`,
    `Severity: ${alert.severity}`,
    `Status: ${alert.status}`,
    `Value: ${alert.value} (threshold: ${alert.comparison} ${alert.threshold})`,
    `Fired at: ${alert.firedAt.toISOString()}`,
  ];
  if (alert.runbook) {
    lines.push(`Runbook: ${alert.runbook}`);
  }
  return lines.join('\n');
}

/** Format an alert body suitable for Slack (markdown). */
export function formatSlackBody(alert: Alert): string {
  const emoji = SEVERITY_EMOJI[alert.severity];
  const lines = [
    `${emoji} *${alert.definitionName}*`,
    `*Severity:* ${alert.severity}`,
    `*Status:* ${alert.status}`,
    `*Value:* \`${alert.value}\` (threshold: ${alert.comparison} ${alert.threshold})`,
    `*Fired at:* ${alert.firedAt.toISOString()}`,
  ];
  if (alert.runbook) {
    lines.push(`*Runbook:* <${alert.runbook}|View Runbook>`);
  }
  return lines.join('\n');
}

/** Format an alert body suitable for PagerDuty (concise). */
export function formatPagerDutyBody(alert: Alert): string {
  const lines = [
    `${alert.definitionName}: ${alert.severity} alert`,
    `Value ${alert.value} ${alert.comparison} threshold ${alert.threshold}`,
    `Fired: ${alert.firedAt.toISOString()}`,
  ];
  if (alert.runbook) {
    lines.push(`Runbook: ${alert.runbook}`);
  }
  return lines.join(' | ');
}

// ─── Channel Configurations ─────────────────────────────────────────────────

export interface EmailChannelConfig {
  /** SMTP endpoint or API URL for sending email. */
  endpoint: string;
  /** Recipient email address. */
  recipient: string;
  /** Sender email address. */
  from: string;
  /** Whether this channel is enabled. Defaults to true. */
  enabled?: boolean;
}

export interface SlackChannelConfig {
  /** Slack webhook URL. */
  webhookUrl: string;
  /** Slack channel name (for metadata). */
  channelName?: string;
  /** Whether this channel is enabled. Defaults to true. */
  enabled?: boolean;
}

export interface PagerDutyChannelConfig {
  /** PagerDuty Events API endpoint. */
  endpoint: string;
  /** PagerDuty routing/integration key. */
  routingKey: string;
  /** Whether this channel is enabled. Defaults to true. */
  enabled?: boolean;
}

// ─── Notifier Factories ─────────────────────────────────────────────────────

/** Create an email alert notifier. */
export function createEmailNotifier(
  config: EmailChannelConfig,
  transport: AlertTransport,
): AlertNotifier {
  if (!config.endpoint) throw new Error('Email channel requires a non-empty endpoint');
  if (!config.recipient) throw new Error('Email channel requires a non-empty recipient');
  if (!config.from) throw new Error('Email channel requires a non-empty from address');

  const isEnabled = config.enabled !== false;

  return {
    channel: 'email',
    notify(alert: Alert): AlertPayload | null {
      if (!isEnabled) return null;
      const payload: AlertPayload = {
        channel: 'email',
        endpoint: config.endpoint,
        subject: formatSubject(alert),
        body: formatEmailBody(alert),
        metadata: {
          to: config.recipient,
          from: config.from,
          severity: alert.severity,
        },
      };
      transport.send(payload);
      return payload;
    },
  };
}

/** Create a Slack alert notifier. */
export function createSlackNotifier(
  config: SlackChannelConfig,
  transport: AlertTransport,
): AlertNotifier {
  if (!config.webhookUrl) throw new Error('Slack channel requires a non-empty webhookUrl');

  const isEnabled = config.enabled !== false;

  return {
    channel: 'slack',
    notify(alert: Alert): AlertPayload | null {
      if (!isEnabled) return null;
      const payload: AlertPayload = {
        channel: 'slack',
        endpoint: config.webhookUrl,
        subject: formatSubject(alert),
        body: formatSlackBody(alert),
        metadata: {
          channelName: config.channelName ?? '',
          severity: alert.severity,
        },
      };
      transport.send(payload);
      return payload;
    },
  };
}

/** Create a PagerDuty alert notifier. */
export function createPagerDutyNotifier(
  config: PagerDutyChannelConfig,
  transport: AlertTransport,
): AlertNotifier {
  if (!config.endpoint) throw new Error('PagerDuty channel requires a non-empty endpoint');
  if (!config.routingKey) throw new Error('PagerDuty channel requires a non-empty routingKey');

  const isEnabled = config.enabled !== false;

  return {
    channel: 'pagerduty',
    notify(alert: Alert): AlertPayload | null {
      if (!isEnabled) return null;
      const payload: AlertPayload = {
        channel: 'pagerduty',
        endpoint: config.endpoint,
        subject: formatSubject(alert),
        body: formatPagerDutyBody(alert),
        metadata: {
          routingKey: config.routingKey,
          severity: alert.severity,
        },
      };
      transport.send(payload);
      return payload;
    },
  };
}

// ─── In-Memory Transport (for testing) ───────────────────────────────────────

/** A simple in-memory transport that stores payloads for inspection. */
export function createInMemoryAlertTransport(): AlertTransport & { payloads: AlertPayload[] } {
  const payloads: AlertPayload[] = [];
  return {
    payloads,
    send(payload: AlertPayload): boolean {
      payloads.push(payload);
      return true;
    },
  };
}
