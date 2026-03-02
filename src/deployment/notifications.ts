/**
 * Deployment notification validation and configuration.
 *
 * Pure functions for validating notification channels, targets, and configs,
 * plus a builder for deployment notification payloads.
 *
 * @module deployment/notifications
 */

import type { Deployment, PipelineNotification } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Supported notification channels. */
export const NOTIFICATION_CHANNELS = ['slack', 'email', 'webhook'] as const;

/** Supported notification events. */
export const NOTIFICATION_EVENTS = ['success', 'failure', 'started', 'approval_needed'] as const;

/** Valid Slack channel format (e.g. #deployments). */
export const SLACK_CHANNEL_PATTERN = /^#[a-z0-9_-]+$/;

/** Basic email validation pattern. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Webhook must use HTTPS. */
export const WEBHOOK_PATTERN = /^https:\/\/.+/;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A supported notification channel. */
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** A supported notification event. */
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Result of validating a single notification or target. */
export interface NotificationValidationResult {
  valid: boolean;
  errors: string[];
}

/** Payload sent when a deployment event fires. */
export interface DeploymentNotificationPayload {
  environment: string;
  version: string;
  status: 'started' | 'succeeded' | 'failed' | 'rolled_back';
  timestamp: Date;
  initiatedBy: string;
  commitSha: string;
  duration?: number;
}

/** Configuration wrapping a set of pipeline notifications. */
export interface NotificationConfig {
  notifications: PipelineNotification[];
  requireFailureNotification: boolean;
}

/** Result of validating a full notification config. */
export interface NotificationConfigValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── Validation Functions ────────────────────────────────────────────────────

/**
 * Validate a notification target for the given channel.
 *
 * - `slack` targets must match {@link SLACK_CHANNEL_PATTERN}.
 * - `email` targets must match {@link EMAIL_PATTERN}.
 * - `webhook` targets must match {@link WEBHOOK_PATTERN}.
 */
export function validateNotificationTarget(
  channel: NotificationChannel,
  target: string,
): NotificationValidationResult {
  const errors: string[] = [];

  switch (channel) {
    case 'slack':
      if (!SLACK_CHANNEL_PATTERN.test(target)) {
        errors.push(
          `Invalid Slack channel "${target}": must start with # followed by lowercase alphanumeric, hyphens, or underscores`,
        );
      }
      break;
    case 'email':
      if (!EMAIL_PATTERN.test(target)) {
        errors.push(`Invalid email address "${target}"`);
      }
      break;
    case 'webhook':
      if (!WEBHOOK_PATTERN.test(target)) {
        errors.push(`Invalid webhook URL "${target}": must start with https://`);
      }
      break;
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a single {@link PipelineNotification}.
 *
 * Checks that the channel is supported, events are non-empty and recognised,
 * and the target passes channel-specific validation.
 */
export function validateNotification(
  notification: PipelineNotification,
): NotificationValidationResult {
  const errors: string[] = [];

  const validChannels: readonly string[] = NOTIFICATION_CHANNELS;
  if (!validChannels.includes(notification.channel)) {
    errors.push(
      `Invalid channel "${notification.channel}": must be one of ${NOTIFICATION_CHANNELS.join(', ')}`,
    );
  }

  if (!notification.events || notification.events.length === 0) {
    errors.push('Events must be a non-empty array');
  } else {
    const validEvents: readonly string[] = NOTIFICATION_EVENTS;
    for (const event of notification.events) {
      if (!validEvents.includes(event)) {
        errors.push(`Invalid event "${event}": must be one of ${NOTIFICATION_EVENTS.join(', ')}`);
      }
    }
  }

  if (validChannels.includes(notification.channel)) {
    const targetResult = validateNotificationTarget(
      notification.channel as NotificationChannel,
      notification.target,
    );
    errors.push(...targetResult.errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a full {@link NotificationConfig}.
 *
 * Validates every notification and, when `requireFailureNotification` is true,
 * ensures at least one notification subscribes to the `failure` event.
 */
export function validateNotificationConfig(
  config: NotificationConfig,
): NotificationConfigValidationResult {
  const errors: string[] = [];

  for (let i = 0; i < config.notifications.length; i++) {
    const result = validateNotification(config.notifications[i]!);
    for (const error of result.errors) {
      errors.push(`Notification[${i}]: ${error}`);
    }
  }

  if (config.requireFailureNotification) {
    const hasFailure = config.notifications.some((n) => n.events.includes('failure'));
    if (!hasFailure) {
      errors.push('At least one notification must include the "failure" event');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Payload Builder ─────────────────────────────────────────────────────────

/**
 * Build a {@link DeploymentNotificationPayload} from a {@link Deployment}.
 *
 * Maps the deployment status to the notification status and calculates
 * duration in seconds when both `startedAt` and `completedAt` are present.
 */
export function buildNotificationPayload(deployment: Deployment): DeploymentNotificationPayload {
  const statusMap: Record<string, DeploymentNotificationPayload['status']> = {
    pending: 'started',
    in_progress: 'started',
    succeeded: 'succeeded',
    failed: 'failed',
    rolled_back: 'rolled_back',
  };

  const payload: DeploymentNotificationPayload = {
    environment: deployment.environment,
    version: deployment.version,
    status: statusMap[deployment.status] ?? 'started',
    timestamp: deployment.startedAt,
    initiatedBy: deployment.initiatedBy,
    commitSha: deployment.commitSha,
  };

  if (deployment.completedAt) {
    payload.duration = Math.round(
      (deployment.completedAt.getTime() - deployment.startedAt.getTime()) / 1_000,
    );
  }

  return payload;
}
