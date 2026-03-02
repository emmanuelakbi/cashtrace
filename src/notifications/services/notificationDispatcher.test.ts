/**
 * Unit tests for NotificationDispatcher
 *
 * @module notifications/services/notificationDispatcher.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  NotificationChannel,
  NotificationRequest,
  RateLimitResult,
  RenderedTemplate,
  ValidationResult,
} from '../types/index.js';

import type { DispatcherDeps } from './notificationDispatcher.js';
import { createNotificationDispatcher } from './notificationDispatcher.js';
import type { NotificationQueue } from './notificationQueue.js';
import type { PreferenceService } from './preferenceService.js';
import type { RateLimiter } from './rateLimiter.js';
import type { TemplateEngine } from './templateEngine.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_VALIDATION: ValidationResult = {
  valid: true,
  missingVariables: [],
  invalidVariables: [],
};

const RENDERED: RenderedTemplate = {
  subject: 'Test Subject',
  bodyHtml: '<p>Hello</p>',
  bodyText: 'Hello',
  pushTitle: 'Test',
  pushBody: 'Hello',
};

const ALLOWED_RATE: RateLimitResult = {
  allowed: true,
  remaining: 5,
  resetAt: new Date(),
};

function makeRequest(overrides?: Partial<NotificationRequest>): NotificationRequest {
  return {
    userId: 'user-1',
    businessId: 'biz-1',
    category: 'transactions',
    templateId: 'tpl-welcome',
    variables: { name: 'Ada' },
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<DispatcherDeps>): DispatcherDeps {
  const preferences: PreferenceService = {
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
    shouldDeliver: vi.fn().mockResolvedValue(true),
    getQuietHours: vi.fn(),
    isInQuietHours: vi.fn(),
  };

  const rateLimiter: RateLimiter = {
    checkLimit: vi.fn().mockResolvedValue(ALLOWED_RATE),
    recordDelivery: vi.fn(),
    getRemainingQuota: vi.fn(),
  };

  const templateEngine: TemplateEngine = {
    render: vi.fn().mockResolvedValue(RENDERED),
    validate: vi.fn().mockResolvedValue(VALID_VALIDATION),
    getTemplate: vi.fn(),
  };

  const queue: NotificationQueue = {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    peek: vi.fn(),
    size: vi.fn(),
    acknowledge: vi.fn(),
    moveToDeadLetterQueue: vi.fn(),
    deadLetterQueueSize: vi.fn(),
    peekDeadLetterQueue: vi.fn(),
  };

  return { preferences, rateLimiter, templateEngine, queue, ...overrides };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('NotificationDispatcher', () => {
  let deps: DispatcherDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  describe('send', () => {
    it('should validate template before dispatching', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const request = makeRequest();

      await dispatcher.send(request);

      expect(deps.templateEngine.validate).toHaveBeenCalledWith('tpl-welcome', { name: 'Ada' });
    });

    it('should throw when template validation fails', async () => {
      const invalid: ValidationResult = {
        valid: false,
        missingVariables: ['amount'],
        invalidVariables: [],
      };
      (deps.templateEngine.validate as ReturnType<typeof vi.fn>).mockResolvedValue(invalid);
      const dispatcher = createNotificationDispatcher(deps);

      await expect(dispatcher.send(makeRequest())).rejects.toThrow('Missing required variables');
    });

    it('should use default channels when none specified', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const request = makeRequest({ channels: undefined });

      const result = await dispatcher.send(request);

      expect(result.channels).toEqual(['email', 'in_app', 'push']);
    });

    it('should use specified channels when provided', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const channels: NotificationChannel[] = ['email'];
      const request = makeRequest({ channels });

      const result = await dispatcher.send(request);

      expect(result.channels).toEqual(['email']);
    });

    it('should check preferences for each channel', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const request = makeRequest({ channels: ['email', 'push'] });

      await dispatcher.send(request);

      expect(deps.preferences.shouldDeliver).toHaveBeenCalledWith(
        'user-1',
        'transactions',
        'email',
      );
      expect(deps.preferences.shouldDeliver).toHaveBeenCalledWith('user-1', 'transactions', 'push');
    });

    it('should filter out channels disabled by preferences', async () => {
      (deps.preferences.shouldDeliver as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true) // email
        .mockResolvedValueOnce(false) // in_app
        .mockResolvedValueOnce(false); // push
      const dispatcher = createNotificationDispatcher(deps);

      const result = await dispatcher.send(makeRequest());

      expect(result.channels).toEqual(['email']);
    });

    it('should return empty channels when all preferences disabled', async () => {
      (deps.preferences.shouldDeliver as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const dispatcher = createNotificationDispatcher(deps);

      const result = await dispatcher.send(makeRequest());

      expect(result.channels).toEqual([]);
      expect(result.status).toBe('pending');
      expect(deps.queue.enqueue).not.toHaveBeenCalled();
    });

    it('should check rate limits for allowed channels', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const request = makeRequest({ channels: ['email'] });

      await dispatcher.send(request);

      expect(deps.rateLimiter.checkLimit).toHaveBeenCalledWith('user-1', 'email', 'transactions');
    });

    it('should throw when all channels are rate limited', async () => {
      const limited: RateLimitResult = { allowed: false, remaining: 0, resetAt: new Date() };
      (deps.rateLimiter.checkLimit as ReturnType<typeof vi.fn>).mockResolvedValue(limited);
      const dispatcher = createNotificationDispatcher(deps);

      await expect(dispatcher.send(makeRequest())).rejects.toThrow('Rate limit exceeded');
    });

    it('should render template after passing checks', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const request = makeRequest();

      await dispatcher.send(request);

      expect(deps.templateEngine.render).toHaveBeenCalledWith('tpl-welcome', { name: 'Ada' });
    });

    it('should enqueue notification with correct priority', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const request = makeRequest({ priority: 'high' });

      const result = await dispatcher.send(request);

      expect(deps.queue.enqueue).toHaveBeenCalledWith(
        result.notificationId,
        'high',
        expect.any(String),
      );
    });

    it('should default priority to normal', async () => {
      const dispatcher = createNotificationDispatcher(deps);

      const result = await dispatcher.send(makeRequest());

      expect(deps.queue.enqueue).toHaveBeenCalledWith(
        result.notificationId,
        'normal',
        expect.any(String),
      );
    });

    it('should return queued status on success', async () => {
      const dispatcher = createNotificationDispatcher(deps);

      const result = await dispatcher.send(makeRequest());

      expect(result.status).toBe('queued');
      expect(result.notificationId).toBeDefined();
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should bypass preferences for security notifications', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const request = makeRequest({ category: 'security', channels: ['email', 'push'] });

      const result = await dispatcher.send(request);

      expect(deps.preferences.shouldDeliver).not.toHaveBeenCalled();
      expect(result.channels).toEqual(['email', 'push']);
    });

    it('should bypass rate limits for security notifications', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const request = makeRequest({ category: 'security', channels: ['email'] });

      await dispatcher.send(request);

      expect(deps.rateLimiter.checkLimit).not.toHaveBeenCalled();
    });

    it('should include rendered content in queue payload', async () => {
      const dispatcher = createNotificationDispatcher(deps);

      await dispatcher.send(makeRequest());

      const payload = (deps.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as string;
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      expect(parsed).toHaveProperty('rendered');
      expect(parsed).toHaveProperty('userId', 'user-1');
      expect(parsed).toHaveProperty('category', 'transactions');
    });
  });

  describe('sendBatch', () => {
    it('should send each notification individually', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const requests = [makeRequest({ userId: 'user-1' }), makeRequest({ userId: 'user-2' })];

      const results = await dispatcher.sendBatch(requests);

      expect(results).toHaveLength(2);
      expect(deps.queue.enqueue).toHaveBeenCalledTimes(2);
    });

    it('should return results for all notifications', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const requests = [makeRequest(), makeRequest()];

      const results = await dispatcher.sendBatch(requests);

      for (const result of results) {
        expect(result.status).toBe('queued');
        expect(result.notificationId).toBeDefined();
      }
    });
  });

  describe('schedule', () => {
    it('should validate template before scheduling', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const sendAt = new Date(Date.now() + 3600000);

      await dispatcher.schedule(makeRequest(), sendAt);

      expect(deps.templateEngine.validate).toHaveBeenCalled();
    });

    it('should throw when template validation fails for scheduled notification', async () => {
      const invalid: ValidationResult = {
        valid: false,
        missingVariables: ['amount'],
        invalidVariables: [],
      };
      (deps.templateEngine.validate as ReturnType<typeof vi.fn>).mockResolvedValue(invalid);
      const dispatcher = createNotificationDispatcher(deps);

      await expect(
        dispatcher.schedule(makeRequest(), new Date(Date.now() + 3600000)),
      ).rejects.toThrow('Missing required variables');
    });

    it('should enqueue with scheduledAt in payload', async () => {
      const dispatcher = createNotificationDispatcher(deps);
      const sendAt = new Date('2025-01-15T08:00:00Z');

      await dispatcher.schedule(makeRequest(), sendAt);

      const payload = (deps.queue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as string;
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      expect(parsed).toHaveProperty('scheduledAt', '2025-01-15T08:00:00.000Z');
    });

    it('should return a notification ID', async () => {
      const dispatcher = createNotificationDispatcher(deps);

      const id = await dispatcher.schedule(makeRequest(), new Date(Date.now() + 3600000));

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });
  });

  describe('cancel', () => {
    it('should move notification to dead letter queue', async () => {
      const dispatcher = createNotificationDispatcher(deps);

      await dispatcher.cancel('notif-123');

      expect(deps.queue.moveToDeadLetterQueue).toHaveBeenCalledWith('notif-123', 'cancelled');
    });
  });
});
