import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InAppChannel } from '../channels/inAppChannel.js';
import { createNotificationRepository } from '../repositories/notificationRepository.js';
import type { NotificationRepository } from '../repositories/notificationRepository.js';
import type { PreferenceService } from '../services/preferenceService.js';
import type { UnsubscribeManager } from '../services/unsubscribeManager.js';
import { makePreferences } from '../test/helpers.js';
import { NOTIFICATION_ERROR_CODES } from '../types/index.js';

import {
  createNotificationController,
  type NotificationControllerDeps,
} from './notificationController.js';

// ─── Mock Factories ──────────────────────────────────────────────────────────

function makeMockPreferenceService(overrides: Partial<PreferenceService> = {}): PreferenceService {
  return {
    getPreferences: vi.fn().mockResolvedValue(makePreferences()),
    updatePreferences: vi.fn().mockResolvedValue(undefined),
    shouldDeliver: vi.fn().mockResolvedValue(true),
    getQuietHours: vi
      .fn()
      .mockResolvedValue({ enabled: true, startTime: '22:00', endTime: '07:00' }),
    isInQuietHours: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function makeMockUnsubscribeManager(
  overrides: Partial<UnsubscribeManager> = {},
): UnsubscribeManager {
  return {
    generateUnsubscribeLink: vi.fn().mockReturnValue('https://example.com/unsub?token=abc'),
    processUnsubscribe: vi.fn().mockResolvedValue({ success: true }),
    unsubscribeFromCategory: vi.fn().mockResolvedValue(true),
    getUnsubscribedCategories: vi.fn().mockResolvedValue([]),
    isUnsubscribed: vi.fn().mockResolvedValue(false),
    getAuditTrail: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeMockInAppChannel(overrides: Partial<InAppChannel> = {}): InAppChannel {
  return {
    create: vi.fn().mockResolvedValue({}),
    getForUser: vi.fn().mockResolvedValue([]),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    getUnreadCount: vi.fn().mockResolvedValue(0),
    expireOld: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

// ─── Test App Setup ──────────────────────────────────────────────────────────

const USER_ID = 'user-123';

let repo: NotificationRepository;
let deps: NotificationControllerDeps;
let app: express.Express;

function createTestApp(overrideDeps?: Partial<NotificationControllerDeps>): express.Express {
  const testApp = express();
  testApp.use(express.json());
  const finalDeps: NotificationControllerDeps = {
    notificationRepository: repo,
    preferenceService: makeMockPreferenceService(),
    unsubscribeManager: makeMockUnsubscribeManager(),
    inAppChannel: makeMockInAppChannel(),
    ...overrideDeps,
  };
  deps = finalDeps;
  testApp.use('/api/notifications', createNotificationController(finalDeps));
  return testApp;
}

beforeEach(() => {
  repo = createNotificationRepository();
  app = createTestApp();
});

// ─── GET /api/notifications ──────────────────────────────────────────────────

describe('GET /api/notifications', () => {
  it('returns 401 when x-user-id header is missing', async () => {
    const res = await request(app).get('/api/notifications');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(NOTIFICATION_ERROR_CODES.NOTIF_USER_NOT_FOUND);
  });

  it('returns empty list when user has no notifications', async () => {
    const res = await request(app).get('/api/notifications').set('x-user-id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.notifications).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('returns notifications for the authenticated user', async () => {
    repo.createNotification({
      userId: USER_ID,
      businessId: 'biz-1',
      category: 'transactions',
      templateId: 'txn-1',
      templateVersion: '1.0.0',
      channels: ['email'],
      priority: 'normal',
    });
    repo.createNotification({
      userId: USER_ID,
      businessId: 'biz-1',
      category: 'security',
      templateId: 'sec-1',
      templateVersion: '1.0.0',
      channels: ['in_app'],
      priority: 'high',
    });

    const res = await request(app).get('/api/notifications').set('x-user-id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.notifications).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it('filters by status query param', async () => {
    const n = repo.createNotification({
      userId: USER_ID,
      businessId: 'biz-1',
      category: 'transactions',
      templateId: 'txn-1',
      templateVersion: '1.0.0',
      channels: ['email'],
      priority: 'normal',
    });
    repo.updateNotificationStatus(n.id, 'sent');

    repo.createNotification({
      userId: USER_ID,
      businessId: 'biz-1',
      category: 'security',
      templateId: 'sec-1',
      templateVersion: '1.0.0',
      channels: ['in_app'],
      priority: 'normal',
    });

    const res = await request(app).get('/api/notifications?status=sent').set('x-user-id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('filters by category query param', async () => {
    repo.createNotification({
      userId: USER_ID,
      businessId: 'biz-1',
      category: 'transactions',
      templateId: 'txn-1',
      templateVersion: '1.0.0',
      channels: ['email'],
      priority: 'normal',
    });
    repo.createNotification({
      userId: USER_ID,
      businessId: 'biz-1',
      category: 'security',
      templateId: 'sec-1',
      templateVersion: '1.0.0',
      channels: ['in_app'],
      priority: 'normal',
    });

    const res = await request(app)
      .get('/api/notifications?category=security')
      .set('x-user-id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('supports limit and offset pagination', async () => {
    for (let i = 0; i < 5; i++) {
      repo.createNotification({
        userId: USER_ID,
        businessId: 'biz-1',
        category: 'transactions',
        templateId: `txn-${i}`,
        templateVersion: '1.0.0',
        channels: ['email'],
        priority: 'normal',
      });
    }

    const res = await request(app)
      .get('/api/notifications?limit=2&offset=1')
      .set('x-user-id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(2);
    expect(res.body.total).toBe(5);
  });
});

// ─── POST /api/notifications/:id/read ────────────────────────────────────────

describe('POST /api/notifications/:id/read', () => {
  it('returns 401 when x-user-id header is missing', async () => {
    const res = await request(app).post('/api/notifications/some-id/read');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 when notification does not exist', async () => {
    const res = await request(app)
      .post('/api/notifications/nonexistent-id/read')
      .set('x-user-id', USER_ID);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 when notification belongs to another user', async () => {
    const n = repo.createNotification({
      userId: 'other-user',
      businessId: 'biz-1',
      category: 'transactions',
      templateId: 'txn-1',
      templateVersion: '1.0.0',
      channels: ['email'],
      priority: 'normal',
    });

    const res = await request(app)
      .post(`/api/notifications/${n.id}/read`)
      .set('x-user-id', USER_ID);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('marks notification as read successfully', async () => {
    const n = repo.createNotification({
      userId: USER_ID,
      businessId: 'biz-1',
      category: 'transactions',
      templateId: 'txn-1',
      templateVersion: '1.0.0',
      channels: ['email'],
      priority: 'normal',
    });

    const res = await request(app)
      .post(`/api/notifications/${n.id}/read`)
      .set('x-user-id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = repo.getNotificationById(n.id);
    expect(updated?.status).toBe('read');
    expect(updated?.readAt).not.toBeNull();
  });
});

// ─── GET /api/notifications/preferences ──────────────────────────────────────

describe('GET /api/notifications/preferences', () => {
  it('returns 401 when x-user-id header is missing', async () => {
    const res = await request(app).get('/api/notifications/preferences');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns user preferences', async () => {
    const mockPrefs = makePreferences({ userId: USER_ID });
    const prefService = makeMockPreferenceService({
      getPreferences: vi.fn().mockResolvedValue(mockPrefs),
    });
    app = createTestApp({ preferenceService: prefService });

    const res = await request(app).get('/api/notifications/preferences').set('x-user-id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.preferences).toBeDefined();
    expect(res.body.preferences.userId).toBe(USER_ID);
  });
});

// ─── PUT /api/notifications/preferences ──────────────────────────────────────

describe('PUT /api/notifications/preferences', () => {
  it('returns 401 when x-user-id header is missing', async () => {
    const res = await request(app)
      .put('/api/notifications/preferences')
      .send({ frequency: 'daily_digest' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('updates preferences successfully', async () => {
    const updateFn = vi.fn().mockResolvedValue(undefined);
    const prefService = makeMockPreferenceService({
      updatePreferences: updateFn,
    });
    app = createTestApp({ preferenceService: prefService });

    const res = await request(app)
      .put('/api/notifications/preferences')
      .set('x-user-id', USER_ID)
      .send({ frequency: 'daily_digest' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(updateFn).toHaveBeenCalledWith(USER_ID, { frequency: 'daily_digest' });
  });
});

// ─── POST /api/notifications/unsubscribe ─────────────────────────────────────

describe('POST /api/notifications/unsubscribe', () => {
  it('processes one-click unsubscribe via token query param', async () => {
    const processUnsub = vi.fn().mockResolvedValue({ success: true });
    const unsubManager = makeMockUnsubscribeManager({
      processUnsubscribe: processUnsub,
    });
    app = createTestApp({ unsubscribeManager: unsubManager });

    const res = await request(app).post('/api/notifications/unsubscribe?token=valid-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(processUnsub).toHaveBeenCalledWith('valid-token');
  });

  it('returns error when token is invalid', async () => {
    const unsubManager = makeMockUnsubscribeManager({
      processUnsubscribe: vi.fn().mockResolvedValue({ success: false, error: 'Invalid token' }),
    });
    app = createTestApp({ unsubscribeManager: unsubManager });

    const res = await request(app).post('/api/notifications/unsubscribe?token=bad-token');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when no token and no x-user-id', async () => {
    const res = await request(app)
      .post('/api/notifications/unsubscribe')
      .send({ category: 'marketing' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when category is missing', async () => {
    const res = await request(app)
      .post('/api/notifications/unsubscribe')
      .set('x-user-id', USER_ID)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when category is invalid', async () => {
    const res = await request(app)
      .post('/api/notifications/unsubscribe')
      .set('x-user-id', USER_ID)
      .send({ category: 'invalid-category' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('unsubscribes from a valid category', async () => {
    const unsubFn = vi.fn().mockResolvedValue(true);
    const unsubManager = makeMockUnsubscribeManager({
      unsubscribeFromCategory: unsubFn,
    });
    app = createTestApp({ unsubscribeManager: unsubManager });

    const res = await request(app)
      .post('/api/notifications/unsubscribe')
      .set('x-user-id', USER_ID)
      .send({ category: 'marketing' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(unsubFn).toHaveBeenCalledWith(USER_ID, 'marketing');
  });

  it('returns 400 when trying to unsubscribe from security', async () => {
    const unsubManager = makeMockUnsubscribeManager({
      unsubscribeFromCategory: vi.fn().mockResolvedValue(false),
    });
    app = createTestApp({ unsubscribeManager: unsubManager });

    const res = await request(app)
      .post('/api/notifications/unsubscribe')
      .set('x-user-id', USER_ID)
      .send({ category: 'security' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/notifications/unread-count ─────────────────────────────────────

describe('GET /api/notifications/unread-count', () => {
  it('returns 401 when x-user-id header is missing', async () => {
    const res = await request(app).get('/api/notifications/unread-count');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 0 when user has no notifications', async () => {
    const res = await request(app).get('/api/notifications/unread-count').set('x-user-id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(0);
  });

  it('returns correct unread count', async () => {
    repo.createNotification({
      userId: USER_ID,
      businessId: 'biz-1',
      category: 'transactions',
      templateId: 'txn-1',
      templateVersion: '1.0.0',
      channels: ['email'],
      priority: 'normal',
    });
    const n2 = repo.createNotification({
      userId: USER_ID,
      businessId: 'biz-1',
      category: 'security',
      templateId: 'sec-1',
      templateVersion: '1.0.0',
      channels: ['in_app'],
      priority: 'normal',
    });
    repo.markAsRead(n2.id);

    const res = await request(app).get('/api/notifications/unread-count').set('x-user-id', USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});
