/**
 * Push Channel - Handles push notification delivery via pluggable providers.
 *
 * Supports Firebase Cloud Messaging through the PushProvider interface.
 * Manages device tokens, deep links, and multi-device delivery.
 *
 * @module notifications/channels/pushChannel
 */

import { v4 as uuidv4 } from 'uuid';

import type { DeliveryResult, DeliveryStatus, DeviceToken } from '../types/index.js';

// ─── Push Message ────────────────────────────────────────────────────────────

/** Message payload for push notifications. */
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  deepLink?: string;
}

// ─── Provider Interface ──────────────────────────────────────────────────────

/** Pluggable push provider interface for external services. */
export interface PushProvider {
  readonly name: string;
  send(message: PushMessage): Promise<DeliveryResult>;
  getDeliveryStatus(messageId: string): Promise<DeliveryStatus>;
}

// ─── Push Channel Interface ──────────────────────────────────────────────────

/** Push channel for sending notifications to user devices. */
export interface PushChannel {
  send(userId: string, message: Omit<PushMessage, 'token'>): Promise<DeliveryResult[]>;
  sendToDevice(token: string, message: Omit<PushMessage, 'token'>): Promise<DeliveryResult>;
  sendToAllDevices(userId: string, message: Omit<PushMessage, 'token'>): Promise<DeliveryResult[]>;
  registerDevice(device: Omit<DeviceToken, 'id' | 'createdAt' | 'lastUsedAt'>): DeviceToken;
  removeDevice(tokenId: string): boolean;
  getDevices(userId: string): DeviceToken[];
  invalidateToken(token: string): void;
}

// ─── FCM Provider Stub ───────────────────────────────────────────────────────

/** Tokens the FCM stub considers invalid (simulates FCM error responses). */
const INVALID_TOKEN_PREFIX = 'invalid:';

/** Create a Firebase Cloud Messaging provider stub. */
export function createFCMProvider(): PushProvider {
  return {
    name: 'fcm',
    async send(message: PushMessage): Promise<DeliveryResult> {
      // Simulate invalid token detection
      if (message.token.startsWith(INVALID_TOKEN_PREFIX)) {
        return {
          messageId: '',
          status: 'failed',
          timestamp: new Date(),
        };
      }

      // In production, this would call the FCM HTTP v1 API
      return {
        messageId: uuidv4(),
        status: 'sent',
        timestamp: new Date(),
      };
    },
    async getDeliveryStatus(_messageId: string): Promise<DeliveryStatus> {
      // In production, this would query FCM delivery data
      return 'delivered';
    },
  };
}

// ─── Push Channel Factory ────────────────────────────────────────────────────

/**
 * Create a push notification channel backed by the given provider.
 *
 * Manages device tokens per user, sends to individual or all devices,
 * supports deep links, and invalidates tokens on failed delivery.
 */
export function createPushChannel(provider: PushProvider): PushChannel {
  const devices = new Map<string, DeviceToken[]>();

  function getValidDevices(userId: string): DeviceToken[] {
    return (devices.get(userId) ?? []).filter((d) => d.isValid);
  }

  async function sendSingle(
    token: string,
    message: Omit<PushMessage, 'token'>,
  ): Promise<DeliveryResult> {
    const pushMessage: PushMessage = {
      ...message,
      token,
      data: {
        ...message.data,
        ...(message.deepLink ? { deepLink: message.deepLink } : {}),
      },
    };

    const result = await provider.send(pushMessage);

    // Invalidate token on failed delivery (simulates FCM invalid-registration response)
    if (result.status === 'failed') {
      invalidateTokenValue(token);
    }

    return result;
  }

  function invalidateTokenValue(tokenValue: string): void {
    for (const [userId, userDevices] of devices.entries()) {
      const updated = userDevices.map((d) =>
        d.token === tokenValue ? { ...d, isValid: false } : d,
      );
      devices.set(userId, updated);
    }
  }

  return {
    async send(userId: string, message: Omit<PushMessage, 'token'>): Promise<DeliveryResult[]> {
      return this.sendToAllDevices(userId, message);
    },

    async sendToDevice(
      token: string,
      message: Omit<PushMessage, 'token'>,
    ): Promise<DeliveryResult> {
      return sendSingle(token, message);
    },

    async sendToAllDevices(
      userId: string,
      message: Omit<PushMessage, 'token'>,
    ): Promise<DeliveryResult[]> {
      const validDevices = getValidDevices(userId);

      if (validDevices.length === 0) {
        return [];
      }

      const results = await Promise.all(
        validDevices.map((device) => sendSingle(device.token, message)),
      );

      return results;
    },

    registerDevice(device: Omit<DeviceToken, 'id' | 'createdAt' | 'lastUsedAt'>): DeviceToken {
      const now = new Date();
      const newDevice: DeviceToken = {
        ...device,
        id: uuidv4(),
        createdAt: now,
        lastUsedAt: now,
      };

      const userDevices = devices.get(device.userId) ?? [];

      // Replace existing token for the same device (re-registration)
      const filtered = userDevices.filter((d) => d.token !== device.token);
      filtered.push(newDevice);
      devices.set(device.userId, filtered);

      return newDevice;
    },

    removeDevice(tokenId: string): boolean {
      for (const [userId, userDevices] of devices.entries()) {
        const idx = userDevices.findIndex((d) => d.id === tokenId);
        if (idx !== -1) {
          userDevices.splice(idx, 1);
          devices.set(userId, userDevices);
          return true;
        }
      }
      return false;
    },

    getDevices(userId: string): DeviceToken[] {
      return [...(devices.get(userId) ?? [])];
    },

    invalidateToken(token: string): void {
      invalidateTokenValue(token);
    },
  };
}
