/**
 * API Gateway Module — Public API.
 *
 * Re-exports all gateway types, error codes, and constants.
 *
 * @module gateway
 */

export type {
  APIError,
  APIKeyPayload,
  AuthRequirement,
  CircuitBreakerConfig,
  CircuitState,
  GatewayErrorCode,
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

export { GATEWAY_ERROR_CODES, GATEWAY_ERROR_HTTP_STATUS } from './types.js';

export { asyncLocalStorage, getCurrentContext, runWithContext } from './asyncContext.js';

export type { GatewayRedisConfig, RedisEventHandlers } from './redisClient.js';
export { createGatewayRedisClient, resolveRedisConfig } from './redisClient.js';

export {
  cacheToken,
  getCachedToken,
  clearTokenCache,
  tokenCacheSize,
  DEFAULT_CACHE_TTL_MS,
} from './tokenCache.js';

export type {
  ServiceHandler,
  RouteMatch,
  APIVersion,
  RouteHandlerDeps,
} from '../routes/handler.js';
export { RouteRegistry, createRouteHandler } from '../routes/handler.js';

export type { CircuitBreakerStats, NowFn } from '../utils/circuitBreaker.js';
export { CircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker.js';

export { createTimeoutMiddleware, DEFAULT_TIMEOUT_MS } from '../middleware/requestTimeout.js';

export type { CorsConfig } from '../middleware/gatewayCors.js';
export { createCorsMiddleware, DEV_ORIGINS, PROD_ORIGINS } from '../middleware/gatewayCors.js';

export type { ErrorHandlerOptions } from '../middleware/gatewayErrorHandler.js';
export { GatewayError, createErrorHandlerMiddleware } from '../middleware/gatewayErrorHandler.js';

export type { LoggerFn } from '../middleware/gatewayLogger.js';
export { createLoggerMiddleware, redactValue, redactObject } from '../middleware/gatewayLogger.js';

export type { HealthCheckDeps, DependencyStatus, HealthResponse } from '../routes/health.js';
export { createHealthRouter } from '../routes/health.js';

export type { CompressionConfig } from '../middleware/gatewayCompression.js';
export {
  createCompressionMiddleware,
  SKIP_CONTENT_TYPES,
} from '../middleware/gatewayCompression.js';

export type { DocsRouterOptions, OpenAPISpec } from '../docs/openapi.js';
export { generateOpenAPISpec, createDocsRouter } from '../docs/openapi.js';

export type { GatewayAppDependencies } from './app.js';
export { createGatewayApp } from './app.js';

export { GATEWAY_ROUTES } from './routes.js';
