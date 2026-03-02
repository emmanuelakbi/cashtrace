/**
 * Notification System — Test Utilities
 *
 * Re-exports all test helpers, factories, and mock providers.
 *
 * @module notifications/test
 */

export {
  makeDeviceToken,
  makeEmailMessage,
  makeNotification,
  makeNotificationRequest,
  makePreferences,
  makeTemplate,
} from './helpers.js';

export {
  createMockEmailProvider,
  createMockPushProvider,
  createMockRedis,
} from './mockProviders.js';

export type {
  MockEmailProvider,
  MockPushProvider,
  MockRedis,
  MockRedisPipeline,
  SentEmail,
  SentPush,
} from './mockProviders.js';
