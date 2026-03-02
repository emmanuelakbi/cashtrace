/**
 * Notification System Module
 *
 * Multi-channel notification delivery for CashTrace, supporting email,
 * in-app, and push notifications with user preference management,
 * rate limiting, digest support, and NDPR compliance.
 *
 * @module notifications
 */

// Types
export type {
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  DeliveryStatus,
  NotificationFrequency,
  InAppNotificationType,
  DevicePlatform,
  NotificationRequest,
  NotificationResult,
  Notification,
  DeliveryAttempt,
  NotificationTemplate,
  TemplateVariable,
  RenderedTemplate,
  ValidationResult,
  NotificationPreferences,
  QuietHours,
  EmailMessage,
  DeliveryResult,
  DeviceToken,
  NotificationErrorCode,
  RateLimitResult,
  BounceType,
  BounceEvent,
  UnsubscribeEvent,
  NotificationAction,
  InAppNotification,
  InAppGetOptions,
  UnsubscribeAction,
  UnsubscribeMethod,
  UnsubscribeAuditEntry,
} from './types/index.js';

export { NOTIFICATION_ERROR_CODES } from './types/index.js';

// Channels
export type { EmailProvider, EmailChannel } from './channels/index.js';
export { createEmailChannel, createSendGridProvider, createSESProvider } from './channels/index.js';

export type { InAppChannel } from './channels/index.js';
export { createInAppChannel } from './channels/index.js';

export type { PushProvider, PushChannel, PushMessage } from './channels/index.js';
export { createPushChannel, createFCMProvider } from './channels/index.js';

// Services
export type { QueueItem, NotificationQueue } from './services/index.js';
export { createNotificationQueue } from './services/index.js';

export type { PreferenceService } from './services/index.js';
export { createPreferenceService } from './services/index.js';

export type { TemplateEngine } from './services/index.js';
export { createTemplateEngine } from './services/index.js';

export type { RateLimiter } from './services/index.js';
export { createRateLimiter } from './services/index.js';

export type { Locale } from './services/index.js';
export { formatNaira, formatWatDate, formatWatTime, translate } from './services/index.js';

export type { DeliveryTracker } from './services/index.js';
export { createDeliveryTracker } from './services/index.js';

export type { RetryConfig, RetryHandler } from './services/index.js';
export { createRetryHandler } from './services/index.js';

export type { DeviceTokenService } from './services/index.js';
export { createDeviceTokenService } from './services/index.js';

export type { NotificationDispatcher, DispatcherDeps } from './services/index.js';
export { createNotificationDispatcher } from './services/index.js';

export type { DeduplicationService } from './services/index.js';
export { createDeduplicationService, generateDedupKey } from './services/index.js';

export type { ScheduledNotification, NotificationScheduler } from './services/index.js';
export { createNotificationScheduler } from './services/index.js';

export type {
  CategorySummary,
  DigestEntry,
  DigestResult,
  DigestBuilder,
} from './services/index.js';
export { createDigestBuilder } from './services/index.js';

export type {
  UnsubscribeManager,
  UnsubscribeManagerConfig,
  UnsubscribeResult,
} from './services/index.js';
export { createUnsubscribeManager } from './services/index.js';

export type { AnalyticsStats, AnalyticsTracker } from './services/index.js';
export { createAnalyticsTracker } from './services/index.js';

export type {
  QueueProcessor,
  QueueProcessorDeps,
  QueuePayload,
  DeadLetterItem,
} from './services/index.js';
export { createQueueProcessor } from './services/index.js';

// Controllers
export type { NotificationControllerDeps } from './controllers/index.js';
export { createNotificationController } from './controllers/index.js';

// Repositories
export type {
  NotificationRepository,
  GetNotificationsOptions,
  CreateNotificationInput,
} from './repositories/index.js';
export { createNotificationRepository } from './repositories/index.js';
