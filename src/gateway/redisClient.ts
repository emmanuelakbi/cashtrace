/**
 * Redis client factory for the API Gateway module.
 *
 * Provides a factory function to create configured Redis clients
 * for rate limiting and caching. Supports configuration via
 * environment variables and explicit options.
 *
 * @module gateway/redisClient
 */

import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Configuration options for the gateway Redis client. */
export interface GatewayRedisConfig {
  /** Redis server hostname. Defaults to REDIS_HOST env var or 'localhost'. */
  host?: string;
  /** Redis server port. Defaults to REDIS_PORT env var or 6379. */
  port?: number;
  /** Redis authentication password. Defaults to REDIS_PASSWORD env var. */
  password?: string;
  /** Redis database index. Defaults to REDIS_DB env var or 0. */
  db?: number;
  /** Key prefix for all gateway keys. Defaults to 'gw:'. */
  keyPrefix?: string;
  /** Maximum number of retries per request. Defaults to 3. */
  maxRetriesPerRequest?: number;
  /** Whether to connect lazily (on first command). Defaults to false. */
  lazyConnect?: boolean;
  /** Connection timeout in milliseconds. Defaults to 5000. */
  connectTimeout?: number;
  /** Enable ready check on connect. Defaults to true. */
  enableReadyCheck?: boolean;
}

/** Event handler callbacks for Redis connection lifecycle events. */
export interface RedisEventHandlers {
  onConnect?: () => void;
  onReady?: () => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
  onReconnecting?: (delayMs: number) => void;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Resolve gateway Redis configuration from environment and overrides. */
export function resolveRedisConfig(overrides: GatewayRedisConfig = {}): RedisOptions {
  return {
    host: overrides.host ?? process.env['REDIS_HOST'] ?? 'localhost',
    port: overrides.port ?? parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
    password: overrides.password ?? process.env['REDIS_PASSWORD'] ?? undefined,
    db: overrides.db ?? parseInt(process.env['REDIS_DB'] ?? '0', 10),
    keyPrefix: overrides.keyPrefix ?? 'gw:',
    maxRetriesPerRequest: overrides.maxRetriesPerRequest ?? 3,
    lazyConnect: overrides.lazyConnect ?? false,
    connectTimeout: overrides.connectTimeout ?? 5000,
    enableReadyCheck: overrides.enableReadyCheck ?? true,
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a configured Redis client for the API Gateway.
 *
 * The client is configured for rate limiting and caching use cases
 * with sensible defaults. All keys are prefixed with 'gw:' by default
 * to avoid collisions with other modules.
 *
 * @example
 * ```ts
 * const redis = createGatewayRedisClient();
 * // or with explicit config
 * const redis = createGatewayRedisClient(
 *   { host: '10.0.0.1', port: 6380 },
 *   { onError: (err) => logger.error('Redis error', err) },
 * );
 * ```
 */
export function createGatewayRedisClient(
  config: GatewayRedisConfig = {},
  handlers: RedisEventHandlers = {},
): Redis {
  const resolved = resolveRedisConfig(config);
  const client = new Redis(resolved);

  if (handlers.onConnect) {
    client.on('connect', handlers.onConnect);
  }

  if (handlers.onReady) {
    client.on('ready', handlers.onReady);
  }

  if (handlers.onError) {
    client.on('error', handlers.onError);
  }

  if (handlers.onClose) {
    client.on('close', handlers.onClose);
  }

  if (handlers.onReconnecting) {
    client.on('reconnecting', handlers.onReconnecting);
  }

  return client;
}
