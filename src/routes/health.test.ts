import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createHealthRouter, type HealthCheckDeps, type HealthResponse } from './health.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<HealthCheckDeps> = {}): HealthCheckDeps {
  return {
    checkDatabase: vi.fn().mockResolvedValue(true),
    checkRedis: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function createTestApp(deps: HealthCheckDeps): express.Express {
  const app = express();
  app.use(createHealthRouter(deps));
  return app;
}

// ─── /health (liveness) ─────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status healthy', async () => {
    const app = createTestApp(makeDeps());

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('includes uptime and timestamp', async () => {
    const app = createTestApp(makeDeps());

    const res = await request(app).get('/health');
    const body = res.body as HealthResponse;

    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.timestamp).toBe('string');
    expect(() => new Date(body.timestamp)).not.toThrow();
  });

  it('does not include dependencies', async () => {
    const app = createTestApp(makeDeps());

    const res = await request(app).get('/health');

    expect(res.body.dependencies).toBeUndefined();
  });
});

// ─── /health/ready (readiness) ──────────────────────────────────────────────

describe('GET /health/ready', () => {
  it('returns 200 when all dependencies are healthy', async () => {
    const app = createTestApp(makeDeps());

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('returns 503 when database is unhealthy', async () => {
    const deps = makeDeps({ checkDatabase: vi.fn().mockResolvedValue(false) });
    const app = createTestApp(deps);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
  });

  it('returns 503 when Redis is unhealthy', async () => {
    const deps = makeDeps({ checkRedis: vi.fn().mockResolvedValue(false) });
    const app = createTestApp(deps);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
  });

  it('returns 503 when both dependencies are unhealthy', async () => {
    const deps = makeDeps({
      checkDatabase: vi.fn().mockResolvedValue(false),
      checkRedis: vi.fn().mockResolvedValue(false),
    });
    const app = createTestApp(deps);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
  });

  it('includes dependency response times', async () => {
    const app = createTestApp(makeDeps());

    const res = await request(app).get('/health/ready');
    const body = res.body as HealthResponse;

    expect(body.dependencies).toHaveLength(2);
    for (const dep of body.dependencies!) {
      expect(typeof dep.responseTime).toBe('number');
      expect(dep.responseTime).toBeGreaterThanOrEqual(0);
    }
  });

  it('includes dependency names', async () => {
    const app = createTestApp(makeDeps());

    const res = await request(app).get('/health/ready');
    const names = (res.body as HealthResponse).dependencies!.map((d) => d.name);

    expect(names).toContain('database');
    expect(names).toContain('redis');
  });

  it('handles dependency check errors gracefully', async () => {
    const deps = makeDeps({
      checkDatabase: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    const app = createTestApp(deps);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');

    const dbDep = (res.body as HealthResponse).dependencies!.find((d) => d.name === 'database');
    expect(dbDep?.healthy).toBe(false);
    expect(typeof dbDep?.responseTime).toBe('number');
  });

  it('includes uptime and timestamp', async () => {
    const app = createTestApp(makeDeps());

    const res = await request(app).get('/health/ready');
    const body = res.body as HealthResponse;

    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.timestamp).toBe('string');
  });
});
