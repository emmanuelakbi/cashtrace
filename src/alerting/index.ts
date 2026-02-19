/**
 * Alerting Module
 *
 * Provides threshold-based alerting with multi-channel notifications,
 * deduplication, and runbook integration for CashTrace observability.
 */

export {
  createAlertManager,
  type AlertManager,
  type AlertManagerOptions,
  type AlertDefinition,
  type Alert,
  type AlertSeverity,
  type AlertChannel,
  type AlertComparison,
  type AlertStatus,
  type MetricQueryFn,
} from './alertManager.js';

export {
  createEmailNotifier,
  createSlackNotifier,
  createPagerDutyNotifier,
  createInMemoryAlertTransport,
  formatSubject,
  formatEmailBody,
  formatSlackBody,
  formatPagerDutyBody,
  type AlertNotifier,
  type AlertTransport,
  type AlertPayload,
  type EmailChannelConfig,
  type SlackChannelConfig,
  type PagerDutyChannelConfig,
} from './channels.js';

export {
  createAlertDeduplicator,
  isInTimeWindow,
  type AlertDeduplicator,
  type DeduplicationConfig,
  type DeduplicationResult,
  type CooldownConfig,
  type RateLimitConfig,
  type SuppressionWindow,
  type SuppressionReason,
} from './deduplication.js';

export {
  createRunbookRegistry,
  formatRunbookGuidance,
  type RunbookEntry,
  type RunbookRegistry,
} from './runbooks.js';
