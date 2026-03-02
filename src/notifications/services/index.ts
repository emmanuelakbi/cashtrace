/**
 * Notification Services
 *
 * Business logic services for notification dispatching, preferences,
 * templates, rate limiting, digests, queuing, and unsubscribe management.
 *
 * @module notifications/services
 */

export type { QueueItem, NotificationQueue } from './notificationQueue.js';
export { createNotificationQueue } from './notificationQueue.js';

export type { PreferenceService } from './preferenceService.js';
export { createPreferenceService } from './preferenceService.js';

export type { TemplateEngine } from './templateEngine.js';
export { createTemplateEngine } from './templateEngine.js';

export type { RateLimiter } from './rateLimiter.js';
export { createRateLimiter } from './rateLimiter.js';

export type { Locale } from './localization.js';
export { formatNaira, formatWatDate, formatWatTime, translate } from './localization.js';

export type { DeliveryTracker } from './deliveryTracker.js';
export { createDeliveryTracker } from './deliveryTracker.js';

export type { RetryConfig, RetryHandler } from './retryHandler.js';
export { createRetryHandler } from './retryHandler.js';

export type { DeviceTokenService } from './deviceTokenService.js';
export { createDeviceTokenService } from './deviceTokenService.js';

export type { NotificationDispatcher, DispatcherDeps } from './notificationDispatcher.js';
export { createNotificationDispatcher } from './notificationDispatcher.js';

export type { DeduplicationService } from './deduplication.js';
export { createDeduplicationService, generateDedupKey } from './deduplication.js';

export type { ScheduledNotification, NotificationScheduler } from './notificationScheduler.js';
export { createNotificationScheduler } from './notificationScheduler.js';

export type { CategorySummary, DigestEntry, DigestResult, DigestBuilder } from './digestBuilder.js';
export { createDigestBuilder } from './digestBuilder.js';

export type {
  UnsubscribeManager,
  UnsubscribeManagerConfig,
  UnsubscribeResult,
} from './unsubscribeManager.js';
export { createUnsubscribeManager } from './unsubscribeManager.js';

export type { AnalyticsStats, AnalyticsTracker } from './analyticsTracker.js';
export { createAnalyticsTracker } from './analyticsTracker.js';

export type {
  QueueProcessor,
  QueueProcessorDeps,
  QueuePayload,
  DeadLetterItem,
} from './queueProcessor.js';
export { createQueueProcessor } from './queueProcessor.js';
