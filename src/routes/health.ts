/**
 * Health check endpoints for the API Gateway.
 *
 * Provides liveness (`/health`) and readiness (`/health/ready`) endpoints
 * with dependency status reporting and response time metrics.
 *
 * @module routes/health
 * @see Requirement 7.1 — Expose /health endpoint for basic liveness check
 * @see Requirement 7.2 — Expose /health/ready endpoint for readiness check
 * @see Requirement 7.3 — Verify database connectivity
 * @see Requirement 7.4 — Verify Redis connectivity
 * @see Requirement 7.5 — Return HTTP 200 for healthy, HTTP 503 for unhealthy
 * @see Requirement 7.6 — Include response time metrics in health response
 */

import { Router } from 'express';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Dependencies injected into the health router for connectivity checks. */
export interface HealthCheckDeps {
  checkDatabase: () => Promise<boolean>;
  checkRedis: () => Promise<boolean>;
}

/** Status of a single dependency check, including response time. */
export interface DependencyStatus {
  name: string;
  healthy: boolean;
  responseTime: number;
}

/** Shape of the health check response body. */
export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  dependencies?: DependencyStatus[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check a single dependency, measuring response time and catching errors.
 */
async function checkDependency(
  name: string,
  check: () => Promise<boolean>,
): Promise<DependencyStatus> {
  const start = performance.now();
  try {
    const healthy = await check();
    const responseTime = performance.now() - start;
    return { name, healthy, responseTime };
  } catch {
    const responseTime = performance.now() - start;
    return { name, healthy: false, responseTime };
  }
}

// ─── Router Factory ──────────────────────────────────────────────────────────

/**
 * Create an Express router with health check endpoints.
 *
 * @see Requirement 7.1 — GET /health (liveness)
 * @see Requirement 7.2 — GET /health/ready (readiness with dependency checks)
 */
export function createHealthRouter(deps: HealthCheckDeps): Router {
  const router = Router();

  /**
   * GET /health — Liveness check.
   * Always returns 200 with basic status info.
   * @see Requirement 7.1
   */
  router.get('/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
    res.status(200).json(body);
  });

  /**
   * GET /health/ready — Readiness check.
   * Checks all dependencies and returns 200 if all healthy, 503 otherwise.
   * @see Requirement 7.2, 7.3, 7.4, 7.5, 7.6
   */
  router.get('/health/ready', async (_req, res) => {
    const dependencies = await Promise.all([
      checkDependency('database', deps.checkDatabase),
      checkDependency('redis', deps.checkRedis),
    ]);

    const allHealthy = dependencies.every((d) => d.healthy);

    const body: HealthResponse = {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      dependencies,
    };

    res.status(allHealthy ? 200 : 503).json(body);
  });

  return router;
}
