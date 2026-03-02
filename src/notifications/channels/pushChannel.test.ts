/**
 * Unit tests for the Push Channel.
 *
 * Validates: Requirements 3.1 (FCM integration), 3.5 (deep links)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import type { DeliveryResult, DeliveryStatus } from '../types/index.js';

import type { PushChannel, PushMessage, PushProvider } from './pushChannel.js';
import { createFCMProvider, createPushChannel } from './pushChannel.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeTestProvider(overrides: Partial<PushProvider> = {}): PushProvider {
  return {
    name: 'test-provider',
    send: async (_message: PushMessage): Promise<DeliveryResult> => ({
      messageId: uuidv4(),
      status: 'sent',
      timestamp: new Date(),
    }),
    getDeliveryStatus: async (_messageId: string): Promise<DeliveryStatus> => 'delivered',
    ...overrides,
  };
}

function makeTestMessage(
  overrides: Partial<Omit<PushMessage, 'token'>> = {},
): Omit<PushMessage, 'token'> {
  return {
    title: 'Test Notification',
    body: 'You have a new transaction',
    ...overrides,
  };
}

function registerTestDevice(
  channel: PushChannel,
  userId: string,
  token: string,
  platform: 'ios' | 'android' | 'web' = 'android',
): void {
  channel.registerDevice({
    userId,
    token,
    platform,
    deviceName: `Test ${platform}`,
    isValid: true,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PushChannel', () => {
  let channel: PushChannel;
  let provider: PushProvider;
  let sentMessages: PushMessage[];

  beforeEach(() => {
    sentMessages = [];
    provider = makeTestProvider({
      send: async (message: PushMessage): Promise<DeliveryResult> => {
        sentMessages.push(message);
        return { messageId: uuidv4(), status: 'sent', timestamp: new Date() };
      },
    });
    channel = createPushChannel(provider);
  });

  describe('sendToDevice', () => {
    it('should send a push notification to a specific device token', async () => {
      const result = await channel.sendToDevice('token-abc', makeTestMessage());

      expect(result.status).toBe('sent');
      expect(result.messageId).toBeTruthy();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]!.token).toBe('token-abc');
    });

    it('should include title and body in the push message', async () => {
      await channel.sendToDevice(
        'token-abc',
        makeTestMessage({ title: 'Payment Received', body: '₦50,000 from GTBank' }),
      );

      expect(sentMessages[0]!.title).toBe('Payment Received');
      expect(sentMessages[0]!.body).toBe('₦50,000 from GTBank');
    });

    it('should include deep link in data payload', async () => {
      await channel.sendToDevice(
        'token-abc',
        makeTestMessage({ deepLink: 'cashtrace://transactions/tx-123' }),
      );

      expect(sentMessages[0]!.data).toEqual(
        expect.objectContaining({ deepLink: 'cashtrace://transactions/tx-123' }),
      );
    });

    it('should include custom data in the push message', async () => {
      await channel.sendToDevice(
        'token-abc',
        makeTestMessage({ data: { transactionId: 'tx-123', amount: '50000' } }),
      );

      expect(sentMessages[0]!.data).toEqual(
        expect.objectContaining({ transactionId: 'tx-123', amount: '50000' }),
      );
    });

    it('should merge deep link with custom data', async () => {
      await channel.sendToDevice(
        'token-abc',
        makeTestMessage({
          data: { category: 'transactions' },
          deepLink: 'cashtrace://transactions/tx-123',
        }),
      );

      expect(sentMessages[0]!.data).toEqual(
        expect.objectContaining({
          category: 'transactions',
          deepLink: 'cashtrace://transactions/tx-123',
        }),
      );
    });
  });

  describe('send (alias for sendToAllDevices)', () => {
    it('should send to all valid devices for a user', async () => {
      registerTestDevice(channel, 'user-1', 'token-a', 'android');
      registerTestDevice(channel, 'user-1', 'token-b', 'ios');

      const results = await channel.send('user-1', makeTestMessage());

      expect(results).toHaveLength(2);
      expect(sentMessages).toHaveLength(2);
    });

    it('should return empty array when user has no devices', async () => {
      const results = await channel.send('user-no-devices', makeTestMessage());

      expect(results).toHaveLength(0);
      expect(sentMessages).toHaveLength(0);
    });
  });

  describe('sendToAllDevices', () => {
    it('should send to all valid devices for a user', async () => {
      registerTestDevice(channel, 'user-1', 'token-a');
      registerTestDevice(channel, 'user-1', 'token-b');
      registerTestDevice(channel, 'user-1', 'token-c');

      const results = await channel.sendToAllDevices('user-1', makeTestMessage());

      expect(results).toHaveLength(3);
      const tokens = sentMessages.map((m) => m.token);
      expect(tokens).toContain('token-a');
      expect(tokens).toContain('token-b');
      expect(tokens).toContain('token-c');
    });

    it('should skip invalid devices', async () => {
      registerTestDevice(channel, 'user-1', 'token-valid');
      channel.registerDevice({
        userId: 'user-1',
        token: 'token-invalid',
        platform: 'web',
        deviceName: 'Old browser',
        isValid: false,
      });

      const results = await channel.sendToAllDevices('user-1', makeTestMessage());

      expect(results).toHaveLength(1);
      expect(sentMessages[0]!.token).toBe('token-valid');
    });

    it('should not send to other users devices', async () => {
      registerTestDevice(channel, 'user-1', 'token-a');
      registerTestDevice(channel, 'user-2', 'token-b');

      const results = await channel.sendToAllDevices('user-1', makeTestMessage());

      expect(results).toHaveLength(1);
      expect(sentMessages[0]!.token).toBe('token-a');
    });
  });

  describe('invalid token handling', () => {
    it('should invalidate token when provider returns failed status', async () => {
      const failProvider = makeTestProvider({
        send: async (_message: PushMessage): Promise<DeliveryResult> => ({
          messageId: '',
          status: 'failed',
          timestamp: new Date(),
        }),
      });
      const failChannel = createPushChannel(failProvider);

      failChannel.registerDevice({
        userId: 'user-1',
        token: 'bad-token',
        platform: 'android',
        deviceName: 'Old phone',
        isValid: true,
      });

      await failChannel.sendToDevice('bad-token', makeTestMessage());

      const devices = failChannel.getDevices('user-1');
      const badDevice = devices.find((d) => d.token === 'bad-token');
      expect(badDevice?.isValid).toBe(false);
    });

    it('should not send to invalidated tokens on subsequent calls', async () => {
      const callCount = { value: 0 };
      const failOnceProvider = makeTestProvider({
        send: async (_message: PushMessage): Promise<DeliveryResult> => {
          callCount.value++;
          if (callCount.value === 1) {
            return { messageId: '', status: 'failed', timestamp: new Date() };
          }
          return { messageId: uuidv4(), status: 'sent', timestamp: new Date() };
        },
      });
      const ch = createPushChannel(failOnceProvider);

      ch.registerDevice({
        userId: 'user-1',
        token: 'flaky-token',
        platform: 'android',
        deviceName: 'Phone',
        isValid: true,
      });

      // First send fails and invalidates
      await ch.sendToDevice('flaky-token', makeTestMessage());

      // Second send via sendToAllDevices should skip the invalid token
      const results = await ch.sendToAllDevices('user-1', makeTestMessage());
      expect(results).toHaveLength(0);
    });

    it('should allow explicit token invalidation', async () => {
      registerTestDevice(channel, 'user-1', 'token-to-invalidate');

      channel.invalidateToken('token-to-invalidate');

      const devices = channel.getDevices('user-1');
      expect(devices[0]!.isValid).toBe(false);
    });
  });

  describe('device management', () => {
    it('should register a new device and return it with generated fields', () => {
      const device = channel.registerDevice({
        userId: 'user-1',
        token: 'new-token',
        platform: 'ios',
        deviceName: 'iPhone 15',
        isValid: true,
      });

      expect(device.id).toBeTruthy();
      expect(device.userId).toBe('user-1');
      expect(device.token).toBe('new-token');
      expect(device.platform).toBe('ios');
      expect(device.createdAt).toBeInstanceOf(Date);
      expect(device.lastUsedAt).toBeInstanceOf(Date);
    });

    it('should support multiple devices per user', () => {
      registerTestDevice(channel, 'user-1', 'token-android', 'android');
      registerTestDevice(channel, 'user-1', 'token-ios', 'ios');
      registerTestDevice(channel, 'user-1', 'token-web', 'web');

      const devices = channel.getDevices('user-1');
      expect(devices).toHaveLength(3);
    });

    it('should replace existing device on re-registration with same token', () => {
      registerTestDevice(channel, 'user-1', 'same-token', 'android');
      registerTestDevice(channel, 'user-1', 'same-token', 'android');

      const devices = channel.getDevices('user-1');
      expect(devices).toHaveLength(1);
    });

    it('should remove a device by token ID', () => {
      const device = channel.registerDevice({
        userId: 'user-1',
        token: 'token-to-remove',
        platform: 'android',
        deviceName: 'Old phone',
        isValid: true,
      });

      const removed = channel.removeDevice(device.id);
      expect(removed).toBe(true);
      expect(channel.getDevices('user-1')).toHaveLength(0);
    });

    it('should return false when removing non-existent device', () => {
      const removed = channel.removeDevice('non-existent-id');
      expect(removed).toBe(false);
    });

    it('should return empty array for user with no devices', () => {
      expect(channel.getDevices('unknown-user')).toEqual([]);
    });
  });
});

describe('FCM Provider Stub', () => {
  it('should return a provider named fcm', () => {
    const provider = createFCMProvider();
    expect(provider.name).toBe('fcm');
  });

  it('should return sent status on send', async () => {
    const provider = createFCMProvider();
    const result = await provider.send({
      token: 'valid-token',
      title: 'Test',
      body: 'Hello',
    });
    expect(result.status).toBe('sent');
    expect(result.messageId).toBeTruthy();
  });

  it('should return failed status for invalid tokens', async () => {
    const provider = createFCMProvider();
    const result = await provider.send({
      token: 'invalid:expired-token',
      title: 'Test',
      body: 'Hello',
    });
    expect(result.status).toBe('failed');
    expect(result.messageId).toBe('');
  });

  it('should return delivered status on getDeliveryStatus', async () => {
    const provider = createFCMProvider();
    const status = await provider.getDeliveryStatus('msg-123');
    expect(status).toBe('delivered');
  });
});
