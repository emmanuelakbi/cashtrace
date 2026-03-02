/**
 * Property-based tests for Health Check Accuracy.
 *
 * **Property 9: Health Check Accuracy**
 * For any combination of dependency health states, the /health/ready endpoint
 * SHALL return HTTP 200 only when ALL dependencies are healthy, and HTTP 503
 * otherwise. The /health liveness endpoint SHALL always return HTTP 200
 * regardless of dependency state. Response times SHALL always be non-negative.
 *
 * **Validates: Requirements 7.3, 7.4, 7.5**
 *
 * @module routes/health.property.test
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';

import { createHealthRouter, type HealthCheckDeps, type HealthResponse } from './health.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a random boolean pair representing [dbHealthy, redisHealthy]. */
const depHealthArb = fc.tuple(fc.boolean(), fc.boolean());

/**
 * Generate a dependency check function that resolves to the given value.
 */
function makeCheck(healthy: boolean): () => Promise<boolean> {
  return () => Promise.resolve(healthy);
}

/**
 * Generate a dependency check function that rejects with an error.
 */
function makeFailingCheck(): () => Promise<boolean> {
  return () => Promise.reject(new Error('connection lost'));
}

/** Arbitrary that produces either a resolving or rejecting check function. */
const checkBehaviorArb = fc.oneof(
  fc.boolean().map((healthy) => ({ healthy, check: makeCheck(healthy) })),
  fc.constant({ healthy: false, check: makeFailingCheck() }),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTestApp(deps: HealthCheckDeps): express.Express {
  const app = express();
  app.use(createHealthRouter(deps));
  return app;
}

/**
 * Make a request and parse the JSON body manually to avoid intermittent
 * supertest body-parsing issues under high concurrency.
 */
async function getHealthReady(
  deps: HealthCheckDeps,
): Promise<{ status: number; body: HealthResponse }> {
  const app = createTestApp(deps);
  const res = await request(app).get('/health/ready').set('Accept', 'application/json');
  const body = (
    typeof res.body === 'object' && res.body !== null && 'status' in res.body
      ? res.body
      : JSON.parse(res.text)
  ) as HealthResponse;
  return { status: res.status, body };
}

async function getHealth(deps: HealthCheckDeps): Promise<{ status: number; body: HealthResponse }> {
  const app = createTestApp(deps);
  const res = await request(app).get('/health').set('Accept', 'application/json');
  const body = (
    typeof res.body === 'object' && res.body !== null && 'status' in res.body
      ? res.body
      : JSON.parse(res.text)
  ) as HealthResponse;
  return { status: res.status, body };
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Health Check Accuracy (Property 9)', { timeout: 60_000 }, () => {
  /**
   * **Validates: Requirements 7.3, 7.4, 7.5**
   * For any combination of dependency health states, /health/ready returns
   * 200 only when ALL dependencies are healthy, 503 otherwise.
   */
  it('returns 200 iff all dependencies are healthy, 503 otherwise', () => {
    return fc.assert(
      fc.asyncProperty(depHealthArb, async ([dbHealthy, redisHealthy]) => {
        const deps: HealthCheckDeps = {
          checkDatabase: makeCheck(dbHealthy),
          checkRedis: makeCheck(redisHealthy),
        };

        const { status, body } = await getHealthReady(deps);
        const allHealthy = dbHealthy && redisHealthy;

        expect(status).toBe(allHealthy ? 200 : 503);
        expect(body.status).toBe(allHealthy ? 'healthy' : 'unhealthy');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.5**
   * The /health liveness endpoint always returns 200 regardless of
   * dependency state.
   */
  it('/health always returns 200 regardless of dependency state', () => {
    return fc.assert(
      fc.asyncProperty(depHealthArb, async ([dbHealthy, redisHealthy]) => {
        const deps: HealthCheckDeps = {
          checkDatabase: makeCheck(dbHealthy),
          checkRedis: makeCheck(redisHealthy),
        };

        const { status, body } = await getHealth(deps);

        expect(status).toBe(200);
        expect(body.status).toBe('healthy');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.5, 7.6**
   * Response times in dependency status are always non-negative numbers.
   */
  it('dependency response times are always non-negative', () => {
    return fc.assert(
      fc.asyncProperty(depHealthArb, async ([dbHealthy, redisHealthy]) => {
        const deps: HealthCheckDeps = {
          checkDatabase: makeCheck(dbHealthy),
          checkRedis: makeCheck(redisHealthy),
        };

        const { body } = await getHealthReady(deps);

        expect(Array.isArray(body.dependencies)).toBe(true);
        expect(body.dependencies).toHaveLength(2);
        for (const dep of body.dependencies!) {
          expect(typeof dep.responseTime).toBe('number');
          expect(dep.responseTime).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.3, 7.4, 7.5**
   * When dependency checks throw errors, they are treated as unhealthy
   * and the endpoint returns 503.
   */
  it('treats throwing dependency checks as unhealthy', () => {
    return fc.assert(
      fc.asyncProperty(checkBehaviorArb, checkBehaviorArb, async (dbBehavior, redisBehavior) => {
        const deps: HealthCheckDeps = {
          checkDatabase: dbBehavior.check,
          checkRedis: redisBehavior.check,
        };

        const { status, body } = await getHealthReady(deps);
        const allHealthy = dbBehavior.healthy && redisBehavior.healthy;

        expect(status).toBe(allHealthy ? 200 : 503);
        expect(body.status).toBe(allHealthy ? 'healthy' : 'unhealthy');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.2, 7.6**
   * The readiness response always includes a valid ISO timestamp and
   * non-negative uptime.
   */
  it('/health/ready always includes valid timestamp and uptime', () => {
    return fc.assert(
      fc.asyncProperty(depHealthArb, async ([dbHealthy, redisHealthy]) => {
        const deps: HealthCheckDeps = {
          checkDatabase: makeCheck(dbHealthy),
          checkRedis: makeCheck(redisHealthy),
        };

        const { body } = await getHealthReady(deps);

        expect(typeof body.timestamp).toBe('string');
        expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
        expect(typeof body.uptime).toBe('number');
        expect(body.uptime).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });
});
