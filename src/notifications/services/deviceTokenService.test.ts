import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeviceTokenService, type DeviceTokenService } from './deviceTokenService.js';

// ─── Mock Pool ───────────────────────────────────────────────────────────────

interface MockPool {
  query: ReturnType<typeof vi.fn>;
}

function createMockPool(): MockPool {
  return { query: vi.fn() };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USER_ID = '00000000-0000-0000-0000-000000000001';
const TOKEN_ID = '00000000-0000-0000-0000-000000000010';
const TOKEN_VALUE = 'fcm-token-abc123';

function makeDeviceTokenRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date();
  return {
    id: TOKEN_ID,
    user_id: USER_ID,
    token: TOKEN_VALUE,
    platform: 'android',
    device_name: 'Pixel 7',
    is_valid: true,
    created_at: now,
    last_used_at: now,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DeviceTokenService', () => {
  let pool: MockPool;
  let service: DeviceTokenService;

  beforeEach(() => {
    pool = createMockPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = createDeviceTokenService(pool as any);
  });

  describe('registerToken', () => {
    it('inserts a new device token and returns the mapped result', async () => {
      const row = makeDeviceTokenRow();
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const result = await service.registerToken(USER_ID, TOKEN_VALUE, 'android', 'Pixel 7');

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO device_tokens');
      expect(sql).toContain('ON CONFLICT (token) DO UPDATE');
      expect(params[1]).toBe(USER_ID);
      expect(params[2]).toBe(TOKEN_VALUE);
      expect(params[3]).toBe('android');
      expect(params[4]).toBe('Pixel 7');

      expect(result.userId).toBe(USER_ID);
      expect(result.token).toBe(TOKEN_VALUE);
      expect(result.platform).toBe('android');
      expect(result.deviceName).toBe('Pixel 7');
      expect(result.isValid).toBe(true);
    });

    it('upserts when the same token is re-registered', async () => {
      const row = makeDeviceTokenRow({ device_name: 'New Name' });
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const result = await service.registerToken(USER_ID, TOKEN_VALUE, 'android', 'New Name');

      expect(result.deviceName).toBe('New Name');
      expect(result.isValid).toBe(true);
    });
  });

  describe('removeToken', () => {
    it('returns true when a token is deleted', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await service.removeToken(TOKEN_ID);

      expect(result).toBe(true);
      const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM device_tokens');
      expect(params[0]).toBe(TOKEN_ID);
    });

    it('returns false when no token matches the ID', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });

      const result = await service.removeToken('nonexistent-id');

      expect(result).toBe(false);
    });
  });

  describe('getUserTokens', () => {
    it('returns all tokens for a user mapped to camelCase', async () => {
      const rows = [
        makeDeviceTokenRow({ platform: 'android', device_name: 'Pixel 7' }),
        makeDeviceTokenRow({
          id: '00000000-0000-0000-0000-000000000011',
          token: 'fcm-token-xyz',
          platform: 'ios',
          device_name: 'iPhone 15',
          is_valid: false,
        }),
      ];
      pool.query.mockResolvedValueOnce({ rows });

      const tokens = await service.getUserTokens(USER_ID);

      expect(tokens).toHaveLength(2);
      expect(tokens[0]?.platform).toBe('android');
      expect(tokens[1]?.platform).toBe('ios');
      expect(tokens[1]?.isValid).toBe(false);
    });

    it('returns empty array when user has no tokens', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const tokens = await service.getUserTokens(USER_ID);

      expect(tokens).toEqual([]);
    });
  });

  describe('getValidTokens', () => {
    it('returns only valid tokens for a user', async () => {
      const rows = [makeDeviceTokenRow({ is_valid: true })];
      pool.query.mockResolvedValueOnce({ rows });

      const tokens = await service.getValidTokens(USER_ID);

      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.isValid).toBe(true);

      const [sql] = pool.query.mock.calls[0] as [string];
      expect(sql).toContain('is_valid = true');
    });
  });

  describe('invalidateToken', () => {
    it('returns true when a valid token is invalidated', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await service.invalidateToken(TOKEN_VALUE);

      expect(result).toBe(true);
      const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE device_tokens SET is_valid = false');
      expect(params[0]).toBe(TOKEN_VALUE);
    });

    it('returns false when token is already invalid or not found', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });

      const result = await service.invalidateToken('unknown-token');

      expect(result).toBe(false);
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('deletes tokens older than the default 90 days', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 5 });

      const count = await service.cleanupExpiredTokens();

      expect(count).toBe(5);
      const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM device_tokens');
      expect(sql).toContain('last_used_at');
      expect(params[0]).toBe(90);
    });

    it('uses custom maxAgeDays when provided', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 2 });

      const count = await service.cleanupExpiredTokens(30);

      expect(count).toBe(2);
      const [_sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBe(30);
    });

    it('returns 0 when no tokens are expired', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });

      const count = await service.cleanupExpiredTokens();

      expect(count).toBe(0);
    });
  });
});
