/**
 * Gateway-specific Express application factory.
 *
 * Wires up all gateway middleware in the correct order and mounts
 * public routers (health, docs) before auth-protected routes.
 *
 * @module gateway/app
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import type { Redis } from 'ioredis';

import type { APIKeyPayload, RouteConfig } from './types.js';
import { createCorsMiddleware, DEV_ORIGINS, PROD_ORIGINS } from '../middleware/gatewayCors.js';
import { createCompressionMiddleware } from '../middleware/gatewayCompression.js';
import { contextBuilderMiddleware } from '../middleware/contextBuilder.js';
import { createLoggerMiddleware } from '../middleware/gatewayLogger.js';
import type { LoggerFn } from '../middleware/gatewayLogger.js';
import { createSizeLimitMiddleware } from '../middleware/sizeLimit.js';
import { createSanitizerMiddleware } from '../middleware/sanitizer.js';
import { createRateLimiterMiddleware } from '../middleware/gatewayRateLimiter.js';
import { createAuthMiddleware } from '../middleware/gatewayAuth.js';
import { createTimeoutMiddleware } from '../middleware/requestTimeout.js';
import { RouteRegistry, createRouteHandler } from '../routes/handler.js';
import type { ServiceHandler } from '../routes/handler.js';
import { createErrorHandlerMiddleware } from '../middleware/gatewayErrorHandler.js';
import { createHealthRouter } from '../routes/health.js';
import type { HealthCheckDeps } from '../routes/health.js';
import { createDocsRouter } from '../docs/openapi.js';

/** Dependencies required to create the gateway Express application. */
export interface GatewayAppDependencies {
  redis: Redis;
  jwtSecret: string;
  issuer: string;
  apiKeys?: Map<string, APIKeyPayload>;
  routes: RouteConfig[];
  handlers: Map<string, ServiceHandler>;
  healthChecks: HealthCheckDeps;
  logger?: LoggerFn;
  corsOrigins?: string[];
  env?: 'development' | 'production';
}

/**
 * Create a gateway-specific Express application with all middleware
 * wired in the correct order.
 *
 * Middleware order:
 * 1. CORS → 2. Compression → 3. JSON body parser → 4. Cookie parser →
 * 5. Context builder → 6. Request logger → 7. Size limit → 8. Sanitizer →
 * 9. Rate limiter → 10. Auth → 11. Request timeout → 12. Route handler →
 * 13. Error handler (last)
 *
 * Health and docs routers are mounted before rate limiting/auth so they
 * remain publicly accessible.
 */
export function createGatewayApp(deps: GatewayAppDependencies): express.Express {
  const {
    redis,
    jwtSecret,
    issuer,
    apiKeys,
    routes,
    handlers,
    healthChecks,
    logger = () => {},
    corsOrigins = [...DEV_ORIGINS, ...PROD_ORIGINS],
    env = 'production',
  } = deps;

  const app = express();

  // Disable x-powered-by for security
  app.disable('x-powered-by');

  // ── 1. CORS ──────────────────────────────────────────────────────────────
  app.use(createCorsMiddleware({ allowedOrigins: corsOrigins }));

  // ── 2. Compression ───────────────────────────────────────────────────────
  app.use(createCompressionMiddleware());

  // ── 3. JSON body parser ──────────────────────────────────────────────────
  app.use(express.json());

  // ── 4. Cookie parser ─────────────────────────────────────────────────────
  app.use(cookieParser());

  // ── 5. Context builder ───────────────────────────────────────────────────
  app.use(contextBuilderMiddleware());

  // ── 6. Request logger ────────────────────────────────────────────────────
  app.use(createLoggerMiddleware(logger));

  // ── 7. Size limit ────────────────────────────────────────────────────────
  app.use(createSizeLimitMiddleware());

  // ── 8. Sanitizer ─────────────────────────────────────────────────────────
  app.use(createSanitizerMiddleware());

  // ── Public routers (before rate limiting and auth) ───────────────────────
  app.use(createHealthRouter(healthChecks));
  app.use(createDocsRouter({ routes }));

  // ── 9. Rate limiter ──────────────────────────────────────────────────────
  app.use(createRateLimiterMiddleware(redis));

  // ── 10. Auth middleware ──────────────────────────────────────────────────
  app.use(createAuthMiddleware({ jwtSecret, issuer, apiKeys }));

  // ── 11. Request timeout ──────────────────────────────────────────────────
  app.use(createTimeoutMiddleware());

  // ── 12. Route handler ────────────────────────────────────────────────────
  const registry = new RouteRegistry();
  registry.registerAll(routes);
  app.use(createRouteHandler({ registry, handlers }));

  // ── 13. Error handler (must be last) ─────────────────────────────────────
  app.use(createErrorHandlerMiddleware({ exposeErrors: env === 'development' }));

  return app;
}
