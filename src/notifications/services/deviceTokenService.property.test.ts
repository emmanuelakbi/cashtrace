/**
 * Property-Based Tests — Device Token Cleanup
 *
 * Property 10: Device Token Cleanup
 * For any invalid device token detected, it SHALL be removed from the
 * user's devices within 24 hours.
 *
 * **Validates: Requirements 3.4**
 *
 * @module notifications/services/deviceTokenService.property.test
 */

import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeliveryResult, DevicePlatform } from '../types/index.js';
import type { PushMessage, PushProvider } from '../channels/pushChannel.js';
import { createPushChannel } from '../channels/pushChannel.js';

import { createDeviceTokenService, type DeviceTokenService } from './deviceTokenService.js';

// ─── Mock Pool ───────────────────────────────────────────────────────────────

interface MockPool {
  query: ReturnType<typeof vi.fn>;
}

function createMockPool(): MockPool {
  return { query: vi.fn() };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbPlatform: fc.Arbitrary<DevicePlatform> = fc.constantFrom('ios', 'android', 'web');

const arbTokenValue = fc
  .string({ minLength: 8, maxLength: 40 })
  .filter((s) => /^[a-zA-Z0-9]+$/.test(s))
  .map((s) => `fcm-${s}`);

const arbUserId = fc.uuid();

const arbDeviceName = fc.constantFrom(
  'Pixel 7',
  'iPhone 15',
  'Samsung S24',
  'Chrome PWA',
  'Firefox Web',
);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DeviceTokenService — Property Tests', () => {
  let pool: MockPool;
  let service: DeviceTokenService;

  beforeEach(() => {
    pool = createMockPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = createDeviceTokenService(pool as any);
  });

  /**
   * Property 10a: Token invalidation — getValidTokens never returns invalidated tokens
   *
   * For any set of device tokens and any subset marked as invalid,
   * getValidTokens should never return invalidated tokens.
   *
   * We verify that the SQL query sent to the pool correctly filters
   * by is_valid = true, so invalidated tokens are excluded.
   *
   * **Validates: Requirements 3.4**
   */
  it('getValidTokens never returns invalidated tokens', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            token: arbTokenValue,
            platform: arbPlatform,
            deviceName: arbDeviceName,
            isValid: fc.boolean(),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        arbUserId,
        async (tokens, userId) => {
          pool.query.mockReset();
          const validOnly = tokens.filter((t) => t.isValid);

          // Mock getValidTokens — the service queries WHERE is_valid = true
          const validRows = validOnly.map((t) => ({
            id: uuidv4(),
            user_id: userId,
            token: t.token,
            platform: t.platform,
            device_name: t.deviceName,
            is_valid: true,
            created_at: new Date(),
            last_used_at: new Date(),
          }));

          pool.query.mockResolvedValueOnce({ rows: validRows });

          const result = await service.getValidTokens(userId);

          // Every returned token must be valid
          for (const dt of result) {
            expect(dt.isValid).toBe(true);
          }

          // Count must match valid subset
          expect(result).toHaveLength(validOnly.length);

          // SQL must filter on is_valid = true
          const [sql] = pool.query.mock.calls[0] as [string];
          expect(sql).toContain('is_valid = true');
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 10b: Cleanup completeness — cleanupExpiredTokens removes exactly
   * those tokens older than N days
   *
   * For any set of tokens with varying ages, cleanupExpiredTokens(N) should
   * remove exactly those tokens older than N days. We verify the service
   * passes the correct maxAgeDays parameter to the DELETE query.
   *
   * **Validates: Requirements 3.4**
   */
  it('cleanupExpiredTokens passes correct age threshold to DELETE query', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 365 }),
        fc.integer({ min: 0, max: 50 }),
        async (maxAgeDays, deletedCount) => {
          pool.query.mockReset();
          pool.query.mockResolvedValueOnce({ rowCount: deletedCount });

          const result = await service.cleanupExpiredTokens(maxAgeDays);

          // Returned count matches what the DB reported
          expect(result).toBe(deletedCount);

          // Verify the SQL uses the correct interval
          const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
          expect(sql).toContain('DELETE FROM device_tokens');
          expect(sql).toContain('last_used_at');
          expect(params[0]).toBe(maxAgeDays);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 10c: Registration idempotency — registering the same token
   * multiple times results in exactly one entry via upsert
   *
   * For any token value registered multiple times, the SQL uses
   * ON CONFLICT (token) DO UPDATE, ensuring a single row per token.
   *
   * **Validates: Requirements 3.4**
   */
  it('registerToken uses upsert so duplicate tokens produce one entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        arbTokenValue,
        arbPlatform,
        arbDeviceName,
        fc.integer({ min: 2, max: 5 }),
        async (userId, token, platform, deviceName, registerCount) => {
          pool.query.mockReset();
          for (let i = 0; i < registerCount; i++) {
            const row = {
              id: uuidv4(),
              user_id: userId,
              token,
              platform,
              device_name: deviceName,
              is_valid: true,
              created_at: new Date(),
              last_used_at: new Date(),
            };
            pool.query.mockResolvedValueOnce({ rows: [row] });

            await service.registerToken(userId, token, platform, deviceName);
          }

          // Every call must use ON CONFLICT upsert
          for (let i = 0; i < registerCount; i++) {
            const [sql] = pool.query.mock.calls[i] as [string];
            expect(sql).toContain('ON CONFLICT (token) DO UPDATE');
          }

          // After N registrations, simulate getUserTokens returning 1 row
          const singleRow = {
            id: uuidv4(),
            user_id: userId,
            token,
            platform,
            device_name: deviceName,
            is_valid: true,
            created_at: new Date(),
            last_used_at: new Date(),
          };
          pool.query.mockResolvedValueOnce({ rows: [singleRow] });

          const tokens = await service.getUserTokens(userId);
          expect(tokens).toHaveLength(1);
          expect(tokens[0]?.token).toBe(token);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 10d: invalidateToken marks the token as invalid in the DB
   *
   * For any valid token, calling invalidateToken sends an UPDATE query
   * that sets is_valid = false.
   *
   * **Validates: Requirements 3.4**
   */
  it('invalidateToken sends correct UPDATE query for any token', async () => {
    await fc.assert(
      fc.asyncProperty(arbTokenValue, async (token) => {
        pool.query.mockReset();
        pool.query.mockResolvedValueOnce({ rowCount: 1 });

        const result = await service.invalidateToken(token);

        expect(result).toBe(true);

        const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('UPDATE device_tokens SET is_valid = false');
        expect(params[0]).toBe(token);
      }),
      { numRuns: 100 },
    );
  });
});

describe('PushChannel — Invalid Token Detection Property Tests', () => {
  /**
   * Property 10e: Invalid token detection — when a push provider returns
   * failed status, the token is automatically marked invalid
   *
   * For any push notification sent to an invalid token (provider returns
   * failed), the token should be marked invalid and excluded from
   * subsequent getDevices calls.
   *
   * **Validates: Requirements 3.4**
   */
  it('tokens are auto-invalidated when provider returns failed', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        fc.array(arbTokenValue, { minLength: 1, maxLength: 8 }),
        fc.func(fc.boolean()),
        async (userId, tokenValues, shouldFailFn) => {
          // Deduplicate tokens
          const uniqueTokens = [...new Set(tokenValues)];
          if (uniqueTokens.length === 0) return;

          // Decide which tokens will fail
          const failSet = new Set<string>();
          uniqueTokens.forEach((t, i) => {
            if (shouldFailFn(i)) {
              failSet.add(t);
            }
          });

          const provider: PushProvider = {
            name: 'test-provider',
            async send(message: PushMessage): Promise<DeliveryResult> {
              if (failSet.has(message.token)) {
                return { messageId: '', status: 'failed', timestamp: new Date() };
              }
              return { messageId: uuidv4(), status: 'sent', timestamp: new Date() };
            },
            async getDeliveryStatus(): Promise<'delivered'> {
              return 'delivered';
            },
          };

          const channel = createPushChannel(provider);

          // Register all tokens
          for (const token of uniqueTokens) {
            channel.registerDevice({
              userId,
              token,
              platform: 'android',
              deviceName: 'Test Device',
              isValid: true,
            });
          }

          // Send to each device individually
          for (const token of uniqueTokens) {
            await channel.sendToDevice(token, { title: 'Test', body: 'Hello' });
          }

          // Verify: failed tokens are now invalid
          const devices = channel.getDevices(userId);
          for (const device of devices) {
            if (failSet.has(device.token)) {
              expect(device.isValid).toBe(false);
            } else {
              expect(device.isValid).toBe(true);
            }
          }

          // Verify: sendToAllDevices skips invalidated tokens
          const results = await channel.sendToAllDevices(userId, {
            title: 'Follow-up',
            body: 'Test',
          });
          const validCount = uniqueTokens.filter((t) => !failSet.has(t)).length;
          expect(results).toHaveLength(validCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});
