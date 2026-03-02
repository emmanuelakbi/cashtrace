/**
 * API Gateway rate limiter middleware.
 *
 * Uses Redis sorted sets to implement a sliding window rate limiter.
 * Supports per-IP limits for unauthenticated requests (100/min) and
 * per-user limits for authenticated requests (300/min).
 *
 * @module middleware/gatewayRateLimiter
 * @see Requirements: 1.1, 1.2, 1.3, 1.5, 1.6
 */

import type { Redis } from 'ioredis';
import type { Request, Response, NextFunction } from 'express';

import type { RateLimit, RateLimitResult } from '../gateway/types.js';
import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Configuration for the gateway rate limiter middleware. */
export interface RateLimiterConfig {
  /** Rate limit for unauthenticated (per-IP) requests. */
  ipLimit: RateLimit;
  /** Rate limit for authenticated (per-user) requests. */
  userLimit: RateLimit;
  /** Endpoint-specific rate limits keyed by path pattern (Req 1.3). */
  endpointLimits?: Map<string, RateLimit>;
  /** Whether requests with a valid API key header bypass rate limiting (Req 1.6). Default: true. */
  apiKeyBypass?: boolean;
  /** Header name to check for API key bypass. Default: 'x-api-key'. */
  bypassHeader?: string;
  /** Callback invoked when a request is rate limited (Req 1.7). */
  onViolation?: (info: RateLimitViolation) => void;
}

/** Information about a rate limit violation for security monitoring (Req 1.7). */
export interface RateLimitViolation {
  /** Client IP address. */
  clientIP: string;
  /** Request path. */
  path: string;
  /** Correlation ID for tracing. */
  correlationId: string;
  /** Authenticated user ID, if available. */
  userId?: string;
  /** Which limit was exceeded ('ip', 'user', or 'endpoint'). */
  limitType: 'ip' | 'user' | 'endpoint';
  /** Timestamp of the violation. */
  timestamp: Date;
}

/** Default per-IP rate limit: 100 requests per 60 seconds (Req 1.1). */
export const DEFAULT_IP_LIMIT: RateLimit = {
  requests: 100,
  window: 60,
  keyPrefix: 'gw:rl:ip:',
};

/** Default per-user rate limit: 300 requests per 60 seconds (Req 1.2). */
export const DEFAULT_USER_LIMIT: RateLimit = {
  requests: 300,
  window: 60,
  keyPrefix: 'gw:rl:user:',
};

/** Login endpoint rate limit: 5 requests per 60 seconds (Req 1.3). */
export const LOGIN_LIMIT: RateLimit = {
  requests: 5,
  window: 60,
  keyPrefix: 'gw:rl:endpoint:',
};

/** Signup endpoint rate limit: 3 requests per 60 seconds (Req 1.3). */
export const SIGNUP_LIMIT: RateLimit = {
  requests: 3,
  window: 60,
  keyPrefix: 'gw:rl:endpoint:',
};

/** Default endpoint-specific rate limits (Req 1.3). */
export const DEFAULT_ENDPOINT_LIMITS: Map<string, RateLimit> = new Map([
  ['/api/auth/login', LOGIN_LIMIT],
  ['/api/auth/signup', SIGNUP_LIMIT],
]);

// ─── Sliding Window Rate Limiter ─────────────────────────────────────────────

/**
 * Check whether a request is allowed under the sliding window rate limit.
 *
 * Algorithm (Req 1.5 — sliding window using Redis sorted sets):
 * 1. Remove entries older than (now - window) from the sorted set.
 * 2. Count remaining entries.
 * 3. If count < limit, add a new entry scored by current timestamp.
 * 4. Set TTL on the key to auto-expire after the window.
 * 5. Return the result with remaining count and reset time.
 */
export async function checkRateLimit(
  redis: Redis,
  key: string,
  limit: RateLimit,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = limit.window * 1000;
  const windowStart = now - windowMs;
  const member = `${now}:${Math.random().toString(36).slice(2)}`;

  const luaScript = `
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
    local count = redis.call('ZCARD', KEYS[1])
    if count < tonumber(ARGV[2]) then
      redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
      redis.call('EXPIRE', KEYS[1], ARGV[5])
      return count
    end
    redis.call('EXPIRE', KEYS[1], ARGV[5])
    return count
  `;

  const currentCount = (await redis.eval(
    luaScript,
    1,
    key,
    windowStart.toString(),
    limit.requests.toString(),
    now.toString(),
    member,
    limit.window.toString(),
  )) as number;

  const allowed = currentCount < limit.requests;
  const remaining = allowed ? limit.requests - currentCount - 1 : 0;
  const resetAt = new Date(now + windowMs);
  const retryAfter = allowed ? undefined : Math.ceil(windowMs / 1000);

  return { allowed, remaining, resetAt, retryAfter };
}

/**
 * Get the number of remaining requests for a key within its current window.
 */
export async function getRemaining(redis: Redis, key: string, limit: RateLimit): Promise<number> {
  const now = Date.now();
  const windowStart = now - limit.window * 1000;

  await redis.zremrangebyscore(key, '-inf', windowStart);
  const count = await redis.zcard(key);

  return Math.max(0, limit.requests - count);
}

/**
 * Reset the rate limit for a given key.
 */
export async function resetRateLimit(redis: Redis, key: string): Promise<void> {
  await redis.del(key);
}

// ─── Key Builders ────────────────────────────────────────────────────────────

/** Build a rate limit key for an IP address. */
export function buildIPKey(prefix: string, ip: string): string {
  return `${prefix}${ip}`;
}

/** Build a rate limit key for an authenticated user. */
export function buildUserKey(prefix: string, userId: string): string {
  return `${prefix}${userId}`;
}

/** Build a rate limit key for an endpoint-specific limit (keyed by path + IP). */
export function buildEndpointKey(prefix: string, path: string, ip: string): string {
  return `${prefix}${path}:${ip}`;
}

// ─── Middleware Factory ──────────────────────────────────────────────────────

/**
 * Create an Express middleware that enforces gateway rate limits.
 *
 * - Internal services with API key bypass rate limiting (Req 1.6).
 * - Endpoint-specific limits take precedence (Req 1.3).
 * - Unauthenticated requests are limited per-IP (Req 1.1).
 * - Authenticated requests are limited per-user (Req 1.2).
 * - Uses sliding window algorithm (Req 1.5).
 * - Returns HTTP 429 with Retry-After header when limited (Req 1.4).
 * - Sets X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset headers.
 *
 * @param redis - Redis client instance (dependency injection)
 * @param config - Optional rate limiter configuration overrides
 */
export function createRateLimiterMiddleware(
  redis: Redis,
  config?: Partial<RateLimiterConfig>,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const ipLimit = config?.ipLimit ?? DEFAULT_IP_LIMIT;
  const userLimit = config?.userLimit ?? DEFAULT_USER_LIMIT;
  const endpointLimits = config?.endpointLimits ?? DEFAULT_ENDPOINT_LIMITS;
  const apiKeyBypass = config?.apiKeyBypass ?? true;
  const bypassHeader = config?.bypassHeader ?? 'x-api-key';
  const onViolation = config?.onViolation;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Bypass rate limiting for internal service calls with API key (Req 1.6)
      if (apiKeyBypass && req.headers[bypassHeader]) {
        next();
        return;
      }
      const clientIP = req.context?.clientIP ?? req.ip ?? 'unknown';
      const requestPath = req.path;

      // Check endpoint-specific limit first (Req 1.3)
      const endpointLimit = endpointLimits.get(requestPath);
      if (endpointLimit) {
        const endpointKey = buildEndpointKey(endpointLimit.keyPrefix, requestPath, clientIP);
        const endpointResult = await checkRateLimit(redis, endpointKey, endpointLimit);

        res.setHeader('X-RateLimit-Limit', endpointLimit.requests);
        res.setHeader('X-RateLimit-Remaining', endpointResult.remaining);
        res.setHeader('X-RateLimit-Reset', Math.ceil(endpointResult.resetAt.getTime() / 1000));

        if (!endpointResult.allowed) {
          if (endpointResult.retryAfter !== undefined) {
            res.setHeader('Retry-After', endpointResult.retryAfter);
          }

          const correlationId = req.context?.correlationId ?? 'unknown';

          // Log rate limit violation for security monitoring (Req 1.7)
          onViolation?.({
            clientIP,
            path: requestPath,
            correlationId,
            userId: req.context?.userId,
            limitType: 'endpoint',
            timestamp: new Date(),
          });

          res.status(429).json({
            success: false,
            error: {
              code: GATEWAY_ERROR_CODES.RATE_LIMITED,
              message: 'Too many requests. Please try again later.',
              correlationId,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        next();
        return;
      }

      // Fall through to default IP/user limits
      const userId = req.context?.userId;
      const isAuthenticated = !!userId;

      const limit = isAuthenticated ? userLimit : ipLimit;
      const identifier = isAuthenticated
        ? buildUserKey(userLimit.keyPrefix, userId)
        : buildIPKey(ipLimit.keyPrefix, clientIP);

      const result = await checkRateLimit(redis, identifier, limit);

      // Set rate limit headers on all responses
      res.setHeader('X-RateLimit-Limit', limit.requests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt.getTime() / 1000));

      if (!result.allowed) {
        if (result.retryAfter !== undefined) {
          res.setHeader('Retry-After', result.retryAfter);
        }

        const correlationId = req.context?.correlationId ?? 'unknown';

        // Log rate limit violation for security monitoring (Req 1.7)
        onViolation?.({
          clientIP,
          path: requestPath,
          correlationId,
          userId,
          limitType: isAuthenticated ? 'user' : 'ip',
          timestamp: new Date(),
        });

        res.status(429).json({
          success: false,
          error: {
            code: GATEWAY_ERROR_CODES.RATE_LIMITED,
            message: 'Too many requests. Please try again later.',
            correlationId,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      next();
    } catch (_error) {
      // On Redis failure, allow the request through (fail-open)
      next();
    }
  };
}
