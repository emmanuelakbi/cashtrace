/**
 * Notification Controller
 *
 * Express route handlers for the notification API. Thin controllers that
 * delegate to services for business logic. Routes are mounted under
 * `/api/notifications/`.
 *
 * @module notifications/controllers/notificationController
 */

import { Router } from 'express';

import type { Request, Response, NextFunction } from 'express';

import type { InAppChannel } from '../channels/inAppChannel.js';
import type {
  GetNotificationsOptions,
  NotificationRepository,
} from '../repositories/notificationRepository.js';
import type { PreferenceService } from '../services/preferenceService.js';
import type { UnsubscribeManager } from '../services/unsubscribeManager.js';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationStatus,
} from '../types/index.js';
import { NOTIFICATION_ERROR_CODES } from '../types/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NotificationControllerDeps {
  notificationRepository: NotificationRepository;
  preferenceService: PreferenceService;
  unsubscribeManager: UnsubscribeManager;
  inAppChannel: InAppChannel;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUserId(req: Request): string | undefined {
  return req.headers['x-user-id'] as string | undefined;
}

function errorResponse(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    success: false,
    error: { code, message },
  });
}

const VALID_STATUSES: NotificationStatus[] = [
  'pending',
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'expired',
];

const VALID_CHANNELS: NotificationChannel[] = ['email', 'in_app', 'push'];

const VALID_CATEGORIES: NotificationCategory[] = [
  'security',
  'transactions',
  'insights',
  'compliance',
  'system',
  'marketing',
];

function isValidStatus(value: string): value is NotificationStatus {
  return VALID_STATUSES.includes(value as NotificationStatus);
}

function isValidChannel(value: string): value is NotificationChannel {
  return VALID_CHANNELS.includes(value as NotificationChannel);
}

function isValidCategory(value: string): value is NotificationCategory {
  return VALID_CATEGORIES.includes(value as NotificationCategory);
}

function parsePositiveInt(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return defaultValue;
  }
  return parsed;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createNotificationController(deps: NotificationControllerDeps): Router {
  const { notificationRepository, preferenceService, unsubscribeManager, inAppChannel } = deps;

  const router = Router();

  // ─── GET / — List user notifications ─────────────────────────────────

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        errorResponse(
          res,
          401,
          NOTIFICATION_ERROR_CODES.NOTIF_USER_NOT_FOUND,
          'Missing x-user-id header',
        );
        return;
      }

      const options: GetNotificationsOptions = {
        limit: parsePositiveInt(req.query.limit, 50),
        offset: parsePositiveInt(req.query.offset, 0),
      };

      if (typeof req.query.status === 'string' && isValidStatus(req.query.status)) {
        options.status = req.query.status;
      }
      if (typeof req.query.channel === 'string' && isValidChannel(req.query.channel)) {
        options.channel = req.query.channel;
      }
      if (typeof req.query.category === 'string' && isValidCategory(req.query.category)) {
        options.category = req.query.category;
      }

      const notifications = notificationRepository.getNotificationsByUserId(userId, options);
      const allForUser = notificationRepository.getNotificationsByUserId(userId, {
        status: options.status,
        channel: options.channel,
        category: options.category,
      });

      res.status(200).json({
        success: true,
        notifications,
        total: allForUser.length,
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /:id/read — Mark notification as read ──────────────────────

  router.post('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        errorResponse(
          res,
          401,
          NOTIFICATION_ERROR_CODES.NOTIF_USER_NOT_FOUND,
          'Missing x-user-id header',
        );
        return;
      }

      const { id } = req.params;
      const notification = notificationRepository.getNotificationById(id!);

      if (!notification || notification.userId !== userId) {
        errorResponse(
          res,
          404,
          NOTIFICATION_ERROR_CODES.NOTIF_USER_NOT_FOUND,
          'Notification not found',
        );
        return;
      }

      notificationRepository.markAsRead(id!);

      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /preferences — Get user notification preferences ────────────

  router.get('/preferences', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        errorResponse(
          res,
          401,
          NOTIFICATION_ERROR_CODES.NOTIF_USER_NOT_FOUND,
          'Missing x-user-id header',
        );
        return;
      }

      const preferences = await preferenceService.getPreferences(userId);

      res.status(200).json({ success: true, preferences });
    } catch (err) {
      next(err);
    }
  });

  // ─── PUT /preferences — Update user notification preferences ─────────

  router.put('/preferences', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        errorResponse(
          res,
          401,
          NOTIFICATION_ERROR_CODES.NOTIF_USER_NOT_FOUND,
          'Missing x-user-id header',
        );
        return;
      }

      await preferenceService.updatePreferences(userId, req.body);

      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /unsubscribe — Unsubscribe from a category ─────────────────

  router.post('/unsubscribe', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // One-click unsubscribe via token query param
      const token = req.query.token as string | undefined;
      if (token) {
        const result = await unsubscribeManager.processUnsubscribe(token);
        if (!result.success) {
          errorResponse(res, 400, NOTIFICATION_ERROR_CODES.NOTIF_INVALID_TEMPLATE, result.error!);
          return;
        }
        res.status(200).json({ success: true });
        return;
      }

      // Direct unsubscribe via body
      const userId = getUserId(req);
      if (!userId) {
        errorResponse(
          res,
          401,
          NOTIFICATION_ERROR_CODES.NOTIF_USER_NOT_FOUND,
          'Missing x-user-id header',
        );
        return;
      }

      const { category } = req.body as { category?: string };
      if (!category || !isValidCategory(category)) {
        errorResponse(
          res,
          400,
          NOTIFICATION_ERROR_CODES.NOTIF_MISSING_VARIABLES,
          'Invalid or missing category',
        );
        return;
      }

      const ok = await unsubscribeManager.unsubscribeFromCategory(userId, category);
      if (!ok) {
        errorResponse(
          res,
          400,
          NOTIFICATION_ERROR_CODES.NOTIF_MISSING_VARIABLES,
          'Cannot unsubscribe from security notifications',
        );
        return;
      }

      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /unread-count — Get unread notification count ───────────────

  router.get('/unread-count', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        errorResponse(
          res,
          401,
          NOTIFICATION_ERROR_CODES.NOTIF_USER_NOT_FOUND,
          'Missing x-user-id header',
        );
        return;
      }

      const count = notificationRepository.countUnread(userId);

      res.status(200).json({ success: true, count });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
