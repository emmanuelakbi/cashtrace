/**
 * API Gateway route definitions.
 *
 * Defines all CashTrace API routes with per-route configuration for
 * authentication, rate limiting, timeouts, retries, and circuit breakers.
 *
 * @module gateway/routes
 */

import type { CircuitBreakerConfig, RateLimit, RouteConfig } from './types.js';

/** Default circuit breaker configuration for all routes. */
const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30_000,
  halfOpenRequests: 2,
};

/** Default request timeout in milliseconds. */
const DEFAULT_TIMEOUT = 30_000;

/** Default retry count. */
const DEFAULT_RETRIES = 1;

/**
 * Create a rate limit configuration for a specific endpoint.
 *
 * @param endpoint - Short endpoint identifier used in the Redis key prefix.
 * @param requests - Maximum requests allowed within the window.
 * @param window - Time window in seconds.
 */
function endpointRateLimit(endpoint: string, requests: number, window: number): RateLimit {
  return {
    requests,
    window,
    keyPrefix: `gw:rl:${endpoint}:`,
  };
}

// ─── Service Names ───────────────────────────────────────────────────────────

const AUTH = 'auth-service';
const BUSINESS = 'business-service';
const TRANSACTION = 'transaction-service';
const DOCUMENT = 'document-service';
const ANALYTICS = 'analytics-service';
const INSIGHTS = 'insights-service';

// ─── Route Definitions ───────────────────────────────────────────────────────

/** All CashTrace API route configurations. */
export const GATEWAY_ROUTES: RouteConfig[] = [
  // ── Auth Service ─────────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/v1/auth/signup',
    service: AUTH,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    rateLimit: endpointRateLimit('signup', 3, 60),
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/api/v1/auth/login',
    service: AUTH,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    rateLimit: endpointRateLimit('login', 5, 60),
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/api/v1/auth/magic-link/request',
    service: AUTH,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    rateLimit: endpointRateLimit('magic-link-request', 5, 60),
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/api/v1/auth/magic-link/verify',
    service: AUTH,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/api/v1/auth/password/reset-request',
    service: AUTH,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    rateLimit: endpointRateLimit('password-reset-request', 5, 60),
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/api/v1/auth/password/reset',
    service: AUTH,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/api/v1/auth/refresh',
    service: AUTH,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/api/v1/auth/logout',
    service: AUTH,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'POST',
    path: '/api/v1/auth/logout-all',
    service: AUTH,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },

  // ── Business Service ─────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/v1/businesses',
    service: BUSINESS,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'GET',
    path: '/api/v1/businesses/:id',
    service: BUSINESS,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'PUT',
    path: '/api/v1/businesses/:id',
    service: BUSINESS,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'DELETE',
    path: '/api/v1/businesses/:id',
    service: BUSINESS,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'GET',
    path: '/api/v1/businesses',
    service: BUSINESS,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },

  // ── Transaction Service ──────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/v1/transactions',
    service: TRANSACTION,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'GET',
    path: '/api/v1/transactions/:id',
    service: TRANSACTION,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'GET',
    path: '/api/v1/transactions',
    service: TRANSACTION,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'PUT',
    path: '/api/v1/transactions/:id',
    service: TRANSACTION,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'DELETE',
    path: '/api/v1/transactions/:id',
    service: TRANSACTION,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },

  // ── Document Service ─────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/v1/documents/upload',
    service: DOCUMENT,
    timeout: 60_000,
    retries: 2,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'GET',
    path: '/api/v1/documents/:id',
    service: DOCUMENT,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'GET',
    path: '/api/v1/documents',
    service: DOCUMENT,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'DELETE',
    path: '/api/v1/documents/:id',
    service: DOCUMENT,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },

  // ── Analytics Service ────────────────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/analytics/dashboard',
    service: ANALYTICS,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'GET',
    path: '/api/v1/analytics/trends',
    service: ANALYTICS,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'GET',
    path: '/api/v1/analytics/cashflow',
    service: ANALYTICS,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },

  // ── Insights Service ─────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/v1/insights/generate',
    service: INSIGHTS,
    timeout: 45_000,
    retries: 2,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'GET',
    path: '/api/v1/insights/:id',
    service: INSIGHTS,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
  {
    method: 'GET',
    path: '/api/v1/insights',
    service: INSIGHTS,
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
    auth: 'jwt',
  },
];
