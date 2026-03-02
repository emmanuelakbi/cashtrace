/**
 * API Gateway type definitions.
 *
 * All types are derived from the api-gateway design document.
 * These define the core interfaces for rate limiting, request validation,
 * authentication, routing, context propagation, error handling, and logging.
 *
 * @module gateway/types
 */

// ─── Rate Limiting ───────────────────────────────────────────────────────────

/** Configuration for a rate limit rule. */
export interface RateLimit {
  /** Maximum number of requests allowed within the window. */
  requests: number;
  /** Time window in seconds. */
  window: number;
  /** Redis key prefix for this limit category. */
  keyPrefix: string;
}

/** Result of a rate limit check. */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Number of requests remaining in the current window. */
  remaining: number;
  /** When the current window resets. */
  resetAt: Date;
  /** Seconds until the client should retry (present when rate limited). */
  retryAfter?: number;
}

// ─── Request Validation ──────────────────────────────────────────────────────

/** A single validation error for a request field. */
export interface ValidationError {
  /** JSON path to the invalid field (e.g. "body.email"). */
  path: string;
  /** Human-readable error message. */
  message: string;
  /** JSON Schema keyword that failed (e.g. "required", "format"). */
  keyword: string;
}

/** Result of validating a request against a schema. */
export interface ValidationResult {
  /** Whether the request passed validation. */
  valid: boolean;
  /** Validation errors, present when valid is false. */
  errors?: ValidationError[];
}

// ─── Authentication ──────────────────────────────────────────────────────────

/** Decoded JWT token payload. */
export interface JWTPayload {
  userId: string;
  email: string;
  businessId: string;
  permissions: string[];
  exp: number;
  iat: number;
}

/** Decoded API key payload for service-to-service auth. */
export interface APIKeyPayload {
  serviceId: string;
  serviceName: string;
  permissions: string[];
}

// ─── Request Context ─────────────────────────────────────────────────────────

/** Metadata attached to each request throughout its lifecycle. */
export interface RequestContext {
  /** Unique ID for distributed tracing. */
  correlationId: string;
  /** Authenticated user ID (absent for unauthenticated requests). */
  userId?: string;
  /** Active business ID (absent for unauthenticated requests). */
  businessId?: string;
  /** Client IP address (proxy-aware). */
  clientIP: string;
  /** Client user-agent string. */
  userAgent: string;
  /** Request timestamp. */
  timestamp: Date;
  /** Permissions extracted from auth token. */
  permissions: string[];
}

// ─── Routing ─────────────────────────────────────────────────────────────────

/** Supported HTTP methods. */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** Authentication requirement for a route. */
export type AuthRequirement = 'none' | 'jwt' | 'api_key' | 'jwt_or_api_key';

/** Circuit breaker state. */
export type CircuitState = 'closed' | 'open' | 'half_open';

/** Circuit breaker configuration for a backend service. */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit. */
  failureThreshold: number;
  /** Milliseconds to wait before transitioning from open to half-open. */
  resetTimeout: number;
  /** Number of requests to allow through in half-open state. */
  halfOpenRequests: number;
}

/** Configuration for a single API route. */
export interface RouteConfig {
  /** HTTP method. */
  method: HTTPMethod;
  /** URL path pattern. */
  path: string;
  /** Target backend service name. */
  service: string;
  /** Request timeout in milliseconds. */
  timeout: number;
  /** Number of retry attempts on failure. */
  retries: number;
  /** Circuit breaker settings for this route's service. */
  circuitBreaker: CircuitBreakerConfig;
  /** Optional rate limit override for this route. */
  rateLimit?: RateLimit;
  /** Authentication requirement. */
  auth: AuthRequirement;
  /** JSON Schema name for request validation. */
  validation?: string;
}

// ─── Error Handling ──────────────────────────────────────────────────────────

/** Standardized API error response body. */
export interface APIError {
  /** Machine-readable error code (e.g. "GW_RATE_LIMITED"). */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** Additional error context. */
  details?: Record<string, unknown>;
  /** Per-field validation errors. */
  fields?: Record<string, string[]>;
  /** Correlation ID for tracing. */
  correlationId: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

// ─── Request Logging ─────────────────────────────────────────────────────────

/** Audit record for an API request. */
export interface RequestLog {
  /** Unique log entry ID. */
  id: string;
  /** Correlation ID linking to the request. */
  correlationId: string;
  /** HTTP method. */
  method: string;
  /** Request path. */
  path: string;
  /** Response HTTP status code. */
  statusCode: number;
  /** Request duration in milliseconds. */
  duration: number;
  /** Authenticated user ID. */
  userId?: string;
  /** Active business ID. */
  businessId?: string;
  /** Client IP address. */
  clientIP: string;
  /** Client user-agent string. */
  userAgent: string;
  /** Request body size in bytes. */
  requestSize: number;
  /** Response body size in bytes. */
  responseSize: number;
  /** When the request was received. */
  timestamp: Date;
}

// ─── Error Codes ─────────────────────────────────────────────────────────────

/** Gateway-specific error codes. */
export const GATEWAY_ERROR_CODES = {
  RATE_LIMITED: 'GW_RATE_LIMITED',
  VALIDATION_FAILED: 'GW_VALIDATION_FAILED',
  AUTH_REQUIRED: 'GW_AUTH_REQUIRED',
  AUTH_INVALID: 'GW_AUTH_INVALID',
  FORBIDDEN: 'GW_FORBIDDEN',
  NOT_FOUND: 'GW_NOT_FOUND',
  TIMEOUT: 'GW_TIMEOUT',
  SERVICE_UNAVAILABLE: 'GW_SERVICE_UNAVAILABLE',
  CIRCUIT_OPEN: 'GW_CIRCUIT_OPEN',
  PAYLOAD_TOO_LARGE: 'GW_PAYLOAD_TOO_LARGE',
} as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[keyof typeof GATEWAY_ERROR_CODES];

/** Map gateway error codes to HTTP status codes. */
export const GATEWAY_ERROR_HTTP_STATUS: Record<GatewayErrorCode, number> = {
  [GATEWAY_ERROR_CODES.RATE_LIMITED]: 429,
  [GATEWAY_ERROR_CODES.VALIDATION_FAILED]: 400,
  [GATEWAY_ERROR_CODES.AUTH_REQUIRED]: 401,
  [GATEWAY_ERROR_CODES.AUTH_INVALID]: 401,
  [GATEWAY_ERROR_CODES.FORBIDDEN]: 403,
  [GATEWAY_ERROR_CODES.NOT_FOUND]: 404,
  [GATEWAY_ERROR_CODES.TIMEOUT]: 504,
  [GATEWAY_ERROR_CODES.SERVICE_UNAVAILABLE]: 503,
  [GATEWAY_ERROR_CODES.CIRCUIT_OPEN]: 503,
  [GATEWAY_ERROR_CODES.PAYLOAD_TOO_LARGE]: 413,
};
