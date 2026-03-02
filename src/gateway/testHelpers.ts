/**
 * Test helper factory functions for the API Gateway module.
 *
 * Provides `make*` factories for all gateway types, following the
 * project convention of `Partial<T>` overrides with sensible defaults.
 *
 * @module gateway/testHelpers
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  APIError,
  APIKeyPayload,
  AuthRequirement,
  CircuitBreakerConfig,
  HTTPMethod,
  JWTPayload,
  RateLimit,
  RateLimitResult,
  RequestContext,
  RequestLog,
  RouteConfig,
  ValidationError,
  ValidationResult,
} from './types.js';
import { GATEWAY_ERROR_CODES } from './types.js';

// ─── Rate Limiting Factories ─────────────────────────────────────────────────

/** Create a RateLimit with sensible defaults. */
export function makeRateLimit(overrides: Partial<RateLimit> = {}): RateLimit {
  return {
    requests: 100,
    window: 60,
    keyPrefix: 'rl:ip:',
    ...overrides,
  };
}

/** Create a RateLimitResult with sensible defaults. */
export function makeRateLimitResult(overrides: Partial<RateLimitResult> = {}): RateLimitResult {
  return {
    allowed: true,
    remaining: 99,
    resetAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

// ─── Authentication Factories ────────────────────────────────────────────────

/** Create a JWTPayload with sensible defaults. */
export function makeJWTPayload(overrides: Partial<JWTPayload> = {}): JWTPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    userId: uuidv4(),
    email: 'user@example.com',
    businessId: uuidv4(),
    permissions: ['read', 'write'],
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

/** Create an APIKeyPayload with sensible defaults. */
export function makeAPIKeyPayload(overrides: Partial<APIKeyPayload> = {}): APIKeyPayload {
  return {
    serviceId: uuidv4(),
    serviceName: 'transaction-engine',
    permissions: ['internal:read', 'internal:write'],
    ...overrides,
  };
}

// ─── Request Context Factories ───────────────────────────────────────────────

/** Create a RequestContext with sensible defaults. */
export function makeRequestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    correlationId: uuidv4(),
    clientIP: '192.168.1.1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
    timestamp: new Date(),
    permissions: [],
    ...overrides,
  };
}

// ─── Routing Factories ───────────────────────────────────────────────────────

/** Create a CircuitBreakerConfig with sensible defaults. */
export function makeCircuitBreakerConfig(
  overrides: Partial<CircuitBreakerConfig> = {},
): CircuitBreakerConfig {
  return {
    failureThreshold: 5,
    resetTimeout: 30_000,
    halfOpenRequests: 3,
    ...overrides,
  };
}

/** Create a RouteConfig with sensible defaults. */
export function makeRouteConfig(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    method: 'GET' as HTTPMethod,
    path: '/api/v1/health',
    service: 'auth-service',
    timeout: 30_000,
    retries: 2,
    circuitBreaker: makeCircuitBreakerConfig(
      overrides.circuitBreaker as Partial<CircuitBreakerConfig>,
    ),
    auth: 'jwt' as AuthRequirement,
    ...overrides,
  };
}

// ─── Validation Factories ────────────────────────────────────────────────────

/** Create a ValidationError with sensible defaults. */
export function makeValidationError(overrides: Partial<ValidationError> = {}): ValidationError {
  return {
    path: 'body.email',
    message: 'must be a valid email address',
    keyword: 'format',
    ...overrides,
  };
}

/** Create a ValidationResult with sensible defaults (valid). */
export function makeValidationResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return {
    valid: true,
    ...overrides,
  };
}

// ─── Error Factories ─────────────────────────────────────────────────────────

/** Create an APIError with sensible defaults. */
export function makeAPIError(overrides: Partial<APIError> = {}): APIError {
  return {
    code: GATEWAY_ERROR_CODES.VALIDATION_FAILED,
    message: 'Request validation failed',
    correlationId: uuidv4(),
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Request Log Factories ───────────────────────────────────────────────────

/** Create a RequestLog with sensible defaults. */
export function makeRequestLog(overrides: Partial<RequestLog> = {}): RequestLog {
  return {
    id: uuidv4(),
    correlationId: uuidv4(),
    method: 'GET',
    path: '/api/v1/health',
    statusCode: 200,
    duration: 42,
    clientIP: '192.168.1.1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
    requestSize: 256,
    responseSize: 1024,
    timestamp: new Date(),
    ...overrides,
  };
}
