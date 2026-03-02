/**
 * Email Channel - Handles email delivery via pluggable providers.
 *
 * Supports SendGrid and AWS SES through the EmailProvider interface.
 * Adds required headers (From, Reply-To, List-Unsubscribe), tracks
 * delivery status, and handles bounce/unsubscribe events.
 *
 * @module notifications/channels/emailChannel
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  BounceEvent,
  DeliveryResult,
  DeliveryStatus,
  EmailMessage,
  UnsubscribeEvent,
} from '../types/index.js';

// ─── Provider Interface ──────────────────────────────────────────────────────

/** Pluggable email provider interface for external services. */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<DeliveryResult>;
  getStatus(messageId: string): Promise<DeliveryStatus>;
}

// ─── Email Channel Interface ─────────────────────────────────────────────────

/** Email channel for sending, tracking, and managing email delivery. */
export interface EmailChannel {
  send(email: EmailMessage): Promise<DeliveryResult>;
  getDeliveryStatus(messageId: string): Promise<DeliveryStatus>;
  handleBounce(bounceEvent: BounceEvent): Promise<void>;
  handleUnsubscribe(unsubscribeEvent: UnsubscribeEvent): Promise<void>;
  getBouncedEmails(): Set<string>;
  getUnsubscribedEmails(): Map<string, string[]>;
}

// ─── Default Headers ─────────────────────────────────────────────────────────

const DEFAULT_FROM = 'CashTrace <noreply@cashtrace.ng>';
const DEFAULT_REPLY_TO = 'support@cashtrace.ng';
const UNSUBSCRIBE_BASE_URL = 'https://cashtrace.ng/unsubscribe';

// ─── Provider Stubs ──────────────────────────────────────────────────────────

/** Create a SendGrid email provider stub. */
export function createSendGridProvider(): EmailProvider {
  return {
    name: 'sendgrid',
    async send(message: EmailMessage): Promise<DeliveryResult> {
      // In production, this would call the SendGrid API
      return {
        messageId: uuidv4(),
        status: 'sent',
        timestamp: new Date(),
      };
    },
    async getStatus(_messageId: string): Promise<DeliveryStatus> {
      // In production, this would query SendGrid's event webhook data
      return 'delivered';
    },
  };
}

/** Create an AWS SES email provider stub. */
export function createSESProvider(): EmailProvider {
  return {
    name: 'ses',
    async send(message: EmailMessage): Promise<DeliveryResult> {
      // In production, this would call the AWS SES API
      return {
        messageId: uuidv4(),
        status: 'sent',
        timestamp: new Date(),
      };
    },
    async getStatus(_messageId: string): Promise<DeliveryStatus> {
      // In production, this would query SES notification data
      return 'delivered';
    },
  };
}

// ─── Email Channel Factory ───────────────────────────────────────────────────

/** Ensure required headers are present on the email message. */
function applyRequiredHeaders(email: EmailMessage): EmailMessage {
  const headers: Record<string, string> = { ...email.headers };

  if (!headers['List-Unsubscribe']) {
    const notificationId = email.metadata['notificationId'] ?? 'unknown';
    headers['List-Unsubscribe'] = `<${UNSUBSCRIBE_BASE_URL}?id=${notificationId}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  return {
    ...email,
    from: email.from || DEFAULT_FROM,
    replyTo: email.replyTo || DEFAULT_REPLY_TO,
    headers,
  };
}

/**
 * Create an email channel backed by the given provider.
 *
 * The channel adds required headers (From, Reply-To, List-Unsubscribe),
 * delegates sending to the provider, and tracks bounces/unsubscribes.
 */
export function createEmailChannel(provider: EmailProvider): EmailChannel {
  const bouncedEmails = new Set<string>();
  const unsubscribedEmails = new Map<string, string[]>();

  return {
    async send(email: EmailMessage): Promise<DeliveryResult> {
      if (bouncedEmails.has(email.to)) {
        return {
          messageId: '',
          status: 'bounced',
          timestamp: new Date(),
        };
      }

      const prepared = applyRequiredHeaders(email);
      return provider.send(prepared);
    },

    async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
      return provider.getStatus(messageId);
    },

    async handleBounce(bounceEvent: BounceEvent): Promise<void> {
      if (bounceEvent.bounceType === 'hard') {
        bouncedEmails.add(bounceEvent.email);
      }
    },

    async handleUnsubscribe(unsubscribeEvent: UnsubscribeEvent): Promise<void> {
      const existing = unsubscribedEmails.get(unsubscribeEvent.email) ?? [];
      if (!existing.includes(unsubscribeEvent.category)) {
        unsubscribedEmails.set(unsubscribeEvent.email, [...existing, unsubscribeEvent.category]);
      }
    },

    getBouncedEmails(): Set<string> {
      return new Set(bouncedEmails);
    },

    getUnsubscribedEmails(): Map<string, string[]> {
      return new Map(unsubscribedEmails);
    },
  };
}
