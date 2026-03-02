/**
 * Notification Repositories
 *
 * Database access layer for notification persistence and queries.
 *
 * @module notifications/repositories
 */

export type {
  NotificationRepository,
  GetNotificationsOptions,
  CreateNotificationInput,
} from './notificationRepository.js';

export { createNotificationRepository } from './notificationRepository.js';
