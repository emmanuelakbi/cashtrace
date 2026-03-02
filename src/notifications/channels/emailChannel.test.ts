/**
 * Unit tests for the Email Channel.
 *
 * Validates: Requirements 1.1 (configurable provider), 1.2 (proper headers)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import type {
  BounceEvent,
  DeliveryResult,
  EmailMessage,
  UnsubscribeEvent,
} from '../types/index.js';

import type { EmailChannel, EmailProvider } from './emailChannel.js';
import { createEmailChannel, createSendGridProvider, createSESProvider } from './emailChannel.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeTestProvider(overrides: Partial<EmailProvider> = {}): EmailProvider {
  return {
    name: 'test-provider',
    send: async (_message: EmailMessage): Promise<DeliveryResult> => ({
      messageId: uuidv4(),
      status: 'sent',
      timestamp: new Date(),
    }),
    getStatus: async (_messageId: string) => 'delivered' as const,
    ...overrides,
  };
}

function makeTestEmail(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: 'user@example.com',
    from: 'noreply@cashtrace.ng',
    replyTo: 'support@cashtrace.ng',
    subject: 'Test Notification',
    bodyHtml: '<p>Hello</p>',
    bodyText: 'Hello',
    headers: {},
    metadata: { notificationId: uuidv4(), category: 'transactions' },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('EmailChannel', () => {
  let channel: EmailChannel;
  let provider: EmailProvider;
  let sentMessages: EmailMessage[];

  beforeEach(() => {
    sentMessages = [];
    provider = makeTestProvider({
      send: async (message: EmailMessage): Promise<DeliveryResult> => {
        sentMessages.push(message);
        return { messageId: uuidv4(), status: 'sent', timestamp: new Date() };
      },
    });
    channel = createEmailChannel(provider);
  });

  describe('send', () => {
    it('should delegate sending to the configured provider', async () => {
      const email = makeTestEmail();
      const result = await channel.send(email);

      expect(result.status).toBe('sent');
      expect(result.messageId).toBeTruthy();
      expect(sentMessages).toHaveLength(1);
    });

    it('should add List-Unsubscribe header when missing', async () => {
      const email = makeTestEmail({ headers: {} });
      await channel.send(email);

      const sent = sentMessages[0];
      expect(sent).toBeDefined();
      expect(sent!.headers['List-Unsubscribe']).toContain('https://cashtrace.ng/unsubscribe');
      expect(sent!.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    });

    it('should preserve existing List-Unsubscribe header', async () => {
      const customUnsubscribe = '<https://custom.example.com/unsub>';
      const email = makeTestEmail({
        headers: { 'List-Unsubscribe': customUnsubscribe },
      });
      await channel.send(email);

      const sent = sentMessages[0];
      expect(sent!.headers['List-Unsubscribe']).toBe(customUnsubscribe);
    });

    it('should apply default From when empty', async () => {
      const email = makeTestEmail({ from: '' });
      await channel.send(email);

      const sent = sentMessages[0];
      expect(sent!.from).toBe('CashTrace <noreply@cashtrace.ng>');
    });

    it('should apply default Reply-To when empty', async () => {
      const email = makeTestEmail({ replyTo: '' });
      await channel.send(email);

      const sent = sentMessages[0];
      expect(sent!.replyTo).toBe('support@cashtrace.ng');
    });

    it('should include notification ID in unsubscribe URL', async () => {
      const notifId = 'notif-123';
      const email = makeTestEmail({
        headers: {},
        metadata: { notificationId: notifId, category: 'transactions' },
      });
      await channel.send(email);

      const sent = sentMessages[0];
      expect(sent!.headers['List-Unsubscribe']).toContain(notifId);
    });

    it('should reject sending to bounced email addresses', async () => {
      const bounceEvent: BounceEvent = {
        messageId: uuidv4(),
        email: 'bounced@example.com',
        bounceType: 'hard',
        timestamp: new Date(),
      };
      await channel.handleBounce(bounceEvent);

      const email = makeTestEmail({ to: 'bounced@example.com' });
      const result = await channel.send(email);

      expect(result.status).toBe('bounced');
      expect(sentMessages).toHaveLength(0);
    });
  });

  describe('getDeliveryStatus', () => {
    it('should delegate status lookup to the provider', async () => {
      const status = await channel.getDeliveryStatus('msg-123');
      expect(status).toBe('delivered');
    });
  });

  describe('handleBounce', () => {
    it('should mark hard-bounced emails as invalid', async () => {
      const bounceEvent: BounceEvent = {
        messageId: uuidv4(),
        email: 'bad@example.com',
        bounceType: 'hard',
        timestamp: new Date(),
      };
      await channel.handleBounce(bounceEvent);

      expect(channel.getBouncedEmails().has('bad@example.com')).toBe(true);
    });

    it('should not mark soft-bounced emails as invalid', async () => {
      const bounceEvent: BounceEvent = {
        messageId: uuidv4(),
        email: 'soft@example.com',
        bounceType: 'soft',
        timestamp: new Date(),
      };
      await channel.handleBounce(bounceEvent);

      expect(channel.getBouncedEmails().has('soft@example.com')).toBe(false);
    });
  });

  describe('handleUnsubscribe', () => {
    it('should track unsubscribed email and category', async () => {
      const event: UnsubscribeEvent = {
        messageId: uuidv4(),
        email: 'user@example.com',
        category: 'marketing',
        timestamp: new Date(),
      };
      await channel.handleUnsubscribe(event);

      const unsubs = channel.getUnsubscribedEmails();
      expect(unsubs.get('user@example.com')).toEqual(['marketing']);
    });

    it('should accumulate multiple category unsubscribes', async () => {
      await channel.handleUnsubscribe({
        messageId: uuidv4(),
        email: 'user@example.com',
        category: 'marketing',
        timestamp: new Date(),
      });
      await channel.handleUnsubscribe({
        messageId: uuidv4(),
        email: 'user@example.com',
        category: 'insights',
        timestamp: new Date(),
      });

      const unsubs = channel.getUnsubscribedEmails();
      expect(unsubs.get('user@example.com')).toEqual(['marketing', 'insights']);
    });

    it('should not duplicate category unsubscribes', async () => {
      const event: UnsubscribeEvent = {
        messageId: uuidv4(),
        email: 'user@example.com',
        category: 'marketing',
        timestamp: new Date(),
      };
      await channel.handleUnsubscribe(event);
      await channel.handleUnsubscribe(event);

      const unsubs = channel.getUnsubscribedEmails();
      expect(unsubs.get('user@example.com')).toEqual(['marketing']);
    });
  });
});

describe('Provider Stubs', () => {
  describe('SendGridProvider', () => {
    it('should return a provider named sendgrid', () => {
      const provider = createSendGridProvider();
      expect(provider.name).toBe('sendgrid');
    });

    it('should return sent status on send', async () => {
      const provider = createSendGridProvider();
      const result = await provider.send(makeTestEmail());
      expect(result.status).toBe('sent');
      expect(result.messageId).toBeTruthy();
    });

    it('should return delivered status on getStatus', async () => {
      const provider = createSendGridProvider();
      const status = await provider.getStatus('msg-123');
      expect(status).toBe('delivered');
    });
  });

  describe('SESProvider', () => {
    it('should return a provider named ses', () => {
      const provider = createSESProvider();
      expect(provider.name).toBe('ses');
    });

    it('should return sent status on send', async () => {
      const provider = createSESProvider();
      const result = await provider.send(makeTestEmail());
      expect(result.status).toBe('sent');
      expect(result.messageId).toBeTruthy();
    });

    it('should return delivered status on getStatus', async () => {
      const provider = createSESProvider();
      const status = await provider.getStatus('msg-123');
      expect(status).toBe('delivered');
    });
  });
});
