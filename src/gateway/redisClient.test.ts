import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createGatewayRedisClient, resolveRedisConfig } from './redisClient.js';

// ─── Mock ioredis ────────────────────────────────────────────────────────────

const mockOn = vi.fn();
const mockQuit = vi.fn().mockResolvedValue('OK');

vi.mock('ioredis', () => {
  const MockRedis = vi.fn().mockImplementation(() => ({
    on: mockOn,
    quit: mockQuit,
    status: 'connecting',
  }));
  return { Redis: MockRedis };
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolveRedisConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return defaults when no overrides or env vars are set', () => {
    delete process.env['REDIS_HOST'];
    delete process.env['REDIS_PORT'];
    delete process.env['REDIS_PASSWORD'];
    delete process.env['REDIS_DB'];

    const config = resolveRedisConfig();

    expect(config.host).toBe('localhost');
    expect(config.port).toBe(6379);
    expect(config.password).toBeUndefined();
    expect(config.db).toBe(0);
    expect(config.keyPrefix).toBe('gw:');
    expect(config.maxRetriesPerRequest).toBe(3);
    expect(config.lazyConnect).toBe(false);
    expect(config.connectTimeout).toBe(5000);
    expect(config.enableReadyCheck).toBe(true);
  });

  it('should read from environment variables', () => {
    process.env['REDIS_HOST'] = '10.0.0.5';
    process.env['REDIS_PORT'] = '6380';
    process.env['REDIS_PASSWORD'] = 's3cret';
    process.env['REDIS_DB'] = '2';

    const config = resolveRedisConfig();

    expect(config.host).toBe('10.0.0.5');
    expect(config.port).toBe(6380);
    expect(config.password).toBe('s3cret');
    expect(config.db).toBe(2);
  });

  it('should prefer explicit overrides over environment variables', () => {
    process.env['REDIS_HOST'] = 'env-host';
    process.env['REDIS_PORT'] = '9999';

    const config = resolveRedisConfig({ host: 'override-host', port: 7777 });

    expect(config.host).toBe('override-host');
    expect(config.port).toBe(7777);
  });

  it('should allow overriding keyPrefix', () => {
    const config = resolveRedisConfig({ keyPrefix: 'custom:' });
    expect(config.keyPrefix).toBe('custom:');
  });

  it('should allow overriding connection options', () => {
    const config = resolveRedisConfig({
      maxRetriesPerRequest: 5,
      lazyConnect: true,
      connectTimeout: 10000,
      enableReadyCheck: false,
    });

    expect(config.maxRetriesPerRequest).toBe(5);
    expect(config.lazyConnect).toBe(true);
    expect(config.connectTimeout).toBe(10000);
    expect(config.enableReadyCheck).toBe(false);
  });
});

describe('createGatewayRedisClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a Redis client with resolved config', async () => {
    const ioredis = await import('ioredis');
    const MockRedis = vi.mocked(ioredis.Redis);

    createGatewayRedisClient({ host: 'myhost', port: 6380 });

    expect(MockRedis).toHaveBeenCalledWith(expect.objectContaining({ host: 'myhost', port: 6380 }));
  });

  it('should register event handlers when provided', () => {
    const onConnect = vi.fn();
    const onReady = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const onReconnecting = vi.fn();

    createGatewayRedisClient(
      { lazyConnect: true },
      { onConnect, onReady, onError, onClose, onReconnecting },
    );

    expect(mockOn).toHaveBeenCalledWith('connect', onConnect);
    expect(mockOn).toHaveBeenCalledWith('ready', onReady);
    expect(mockOn).toHaveBeenCalledWith('error', onError);
    expect(mockOn).toHaveBeenCalledWith('close', onClose);
    expect(mockOn).toHaveBeenCalledWith('reconnecting', onReconnecting);
  });

  it('should not register event handlers when not provided', () => {
    createGatewayRedisClient({ lazyConnect: true });

    expect(mockOn).not.toHaveBeenCalled();
  });

  it('should return a Redis instance', () => {
    const client = createGatewayRedisClient({ lazyConnect: true });

    expect(client).toBeDefined();
    expect(client.on).toBeDefined();
  });

  it('should register only the handlers that are provided', () => {
    const onError = vi.fn();

    createGatewayRedisClient({ lazyConnect: true }, { onError });

    expect(mockOn).toHaveBeenCalledTimes(1);
    expect(mockOn).toHaveBeenCalledWith('error', onError);
  });
});
