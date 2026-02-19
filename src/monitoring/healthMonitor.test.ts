import { describe, it, expect, vi } from 'vitest';
import { createHealthMonitor, type HealthCheck, type HealthCheckResult } from './healthMonitor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheck(overrides: Partial<HealthCheck> = {}): HealthCheck {
  return {
    name: overrides.name ?? 'test-check',
    type: overrides.type ?? 'service',
    timeoutMs: overrides.timeoutMs ?? 5000,
    check: overrides.check ?? (async () => ({ status: 'healthy' as const })),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createHealthMonitor', () => {
  it('creates a monitor with no checks', () => {
    const monitor = createHealthMonitor();
    expect(monitor.getRegistered()).toEqual([]);
  });

  it('uses custom default timeout', () => {
    const monitor = createHealthMonitor({ defaultTimeoutMs: 3000 });
    expect(monitor).toBeDefined();
  });
});

describe('register', () => {
  it('registers a health check', () => {
    const monitor = createHealthMonitor();
    monitor.register(makeCheck({ name: 'db' }));
    expect(monitor.getRegistered()).toHaveLength(1);
    expect(monitor.getRegistered()[0]!.name).toBe('db');
  });

  it('rejects duplicate names', () => {
    const monitor = createHealthMonitor();
    monitor.register(makeCheck({ name: 'db' }));
    expect(() => monitor.register(makeCheck({ name: 'db' }))).toThrow(
      'Health check already registered: db',
    );
  });

  it('rejects empty name', () => {
    const monitor = createHealthMonitor();
    expect(() => monitor.register(makeCheck({ name: '' }))).toThrow(
      'Health check must have a non-empty name',
    );
  });

  it('rejects invalid component type', () => {
    const monitor = createHealthMonitor();
    expect(() => monitor.register(makeCheck({ type: 'invalid' as never }))).toThrow(
      'Invalid component type',
    );
  });

  it('rejects non-positive timeout', () => {
    const monitor = createHealthMonitor();
    expect(() => monitor.register(makeCheck({ timeoutMs: 0 }))).toThrow(
      'Health check timeout must be positive',
    );
  });

  it('accepts all valid component types', () => {
    const monitor = createHealthMonitor();
    const types = ['service', 'database', 'redis', 'external'] as const;
    types.forEach((type, i) => {
      monitor.register(makeCheck({ name: `check-${i}`, type }));
    });
    expect(monitor.getRegistered()).toHaveLength(4);
  });
});

describe('unregister', () => {
  it('removes a registered check', () => {
    const monitor = createHealthMonitor();
    monitor.register(makeCheck({ name: 'db' }));
    expect(monitor.unregister('db')).toBe(true);
    expect(monitor.getRegistered()).toHaveLength(0);
  });

  it('returns false for unknown check', () => {
    const monitor = createHealthMonitor();
    expect(monitor.unregister('nope')).toBe(false);
  });
});

describe('check', () => {
  it('returns healthy when no checks registered', async () => {
    const monitor = createHealthMonitor();
    const report = await monitor.check();
    expect(report.status).toBe('healthy');
    expect(report.components).toEqual([]);
    expect(report.timestamp).toBeInstanceOf(Date);
  });

  it('returns healthy when all checks pass', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'api',
        type: 'service',
        check: async () => ({ status: 'healthy' }),
      }),
    );
    monitor.register(
      makeCheck({
        name: 'db',
        type: 'database',
        check: async () => ({ status: 'healthy' }),
      }),
    );

    const report = await monitor.check();
    expect(report.status).toBe('healthy');
    expect(report.components).toHaveLength(2);
    report.components.forEach((c) => {
      expect(c.status).toBe('healthy');
      expect(c.latencyMs).toBeGreaterThanOrEqual(0);
      expect(c.lastChecked).toBeInstanceOf(Date);
    });
  });

  it('returns degraded when any check is degraded', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'api',
        check: async () => ({ status: 'healthy' }),
      }),
    );
    monitor.register(
      makeCheck({
        name: 'redis',
        type: 'redis',
        check: async () => ({ status: 'degraded', message: 'high latency' }),
      }),
    );

    const report = await monitor.check();
    expect(report.status).toBe('degraded');
  });

  it('returns unhealthy when any check is unhealthy', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'db',
        type: 'database',
        check: async () => ({ status: 'unhealthy', message: 'connection refused' }),
      }),
    );
    monitor.register(
      makeCheck({
        name: 'api',
        check: async () => ({ status: 'healthy' }),
      }),
    );

    const report = await monitor.check();
    expect(report.status).toBe('unhealthy');
  });

  it('unhealthy takes precedence over degraded', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'redis',
        type: 'redis',
        check: async () => ({ status: 'degraded' }),
      }),
    );
    monitor.register(
      makeCheck({
        name: 'db',
        type: 'database',
        check: async () => ({ status: 'unhealthy' }),
      }),
    );

    const report = await monitor.check();
    expect(report.status).toBe('unhealthy');
  });

  it('marks component unhealthy when check throws', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'db',
        type: 'database',
        check: async () => {
          throw new Error('connection lost');
        },
      }),
    );

    const report = await monitor.check();
    expect(report.status).toBe('unhealthy');
    expect(report.components[0]!.status).toBe('unhealthy');
    expect(report.components[0]!.message).toBe('connection lost');
  });

  it('marks component unhealthy on timeout', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'slow-service',
        timeoutMs: 50,
        check: async () => {
          await delay(200);
          return { status: 'healthy' };
        },
      }),
    );

    const report = await monitor.check();
    expect(report.status).toBe('unhealthy');
    expect(report.components[0]!.message).toBe('Health check timed out');
  });

  it('includes details and message from check result', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'db',
        type: 'database',
        check: async () => ({
          status: 'healthy',
          message: 'pool active',
          details: { activeConnections: 5, maxConnections: 20 },
        }),
      }),
    );

    const report = await monitor.check();
    const comp = report.components[0]!;
    expect(comp.message).toBe('pool active');
    expect(comp.details).toEqual({ activeConnections: 5, maxConnections: 20 });
  });

  it('measures latency of checks', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'slow',
        timeoutMs: 500,
        check: async () => {
          await delay(30);
          return { status: 'healthy' };
        },
      }),
    );

    const report = await monitor.check();
    expect(report.components[0]!.latencyMs).toBeGreaterThanOrEqual(20);
  });
});

describe('checkComponent', () => {
  it('checks a single component by name', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'redis',
        type: 'redis',
        check: async () => ({ status: 'healthy', message: 'connected' }),
      }),
    );

    const result = await monitor.checkComponent('redis');
    expect(result.name).toBe('redis');
    expect(result.type).toBe('redis');
    expect(result.status).toBe('healthy');
    expect(result.message).toBe('connected');
  });

  it('throws for unknown component', async () => {
    const monitor = createHealthMonitor();
    await expect(monitor.checkComponent('nope')).rejects.toThrow('Health check not found: nope');
  });

  it('handles check failure for single component', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'db',
        type: 'database',
        check: async () => {
          throw new Error('pool exhausted');
        },
      }),
    );

    const result = await monitor.checkComponent('db');
    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('pool exhausted');
  });
});

describe('service health endpoint monitoring (Req 11.1)', () => {
  it('monitors service via HTTP-like health check', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'api-service',
        type: 'service',
        check: async () => ({ status: 'healthy', details: { uptime: 3600 } }),
      }),
    );

    const report = await monitor.check();
    expect(report.status).toBe('healthy');
    expect(report.components[0]!.type).toBe('service');
  });
});

describe('database connection pool monitoring (Req 11.2)', () => {
  it('monitors database pool health', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'postgres',
        type: 'database',
        check: async () => ({
          status: 'healthy',
          message: 'pool healthy',
          details: { active: 3, idle: 7, max: 20 },
        }),
      }),
    );

    const report = await monitor.check();
    const db = report.components.find((c) => c.type === 'database');
    expect(db).toBeDefined();
    expect(db!.status).toBe('healthy');
    expect(db!.details).toEqual({ active: 3, idle: 7, max: 20 });
  });

  it('reports degraded when pool is near capacity', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'postgres',
        type: 'database',
        check: async () => ({
          status: 'degraded',
          message: 'pool near capacity',
          details: { active: 18, idle: 0, max: 20 },
        }),
      }),
    );

    const report = await monitor.check();
    expect(report.status).toBe('degraded');
  });
});

describe('Redis connection monitoring (Req 11.3)', () => {
  it('monitors Redis connection health', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'redis-cache',
        type: 'redis',
        check: async () => ({
          status: 'healthy',
          message: 'PONG',
          details: { connectedClients: 12, usedMemoryMb: 64 },
        }),
      }),
    );

    const report = await monitor.check();
    const redis = report.components.find((c) => c.type === 'redis');
    expect(redis).toBeDefined();
    expect(redis!.status).toBe('healthy');
  });

  it('reports unhealthy when Redis is down', async () => {
    const monitor = createHealthMonitor();
    monitor.register(
      makeCheck({
        name: 'redis-cache',
        type: 'redis',
        check: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    );

    const report = await monitor.check();
    expect(report.status).toBe('unhealthy');
    const redis = report.components.find((c) => c.type === 'redis');
    expect(redis!.status).toBe('unhealthy');
    expect(redis!.message).toBe('ECONNREFUSED');
  });
});
