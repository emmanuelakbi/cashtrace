import { describe, it, expect } from 'vitest';
import {
  createGeminiHealthCheck,
  createEmailProviderHealthCheck,
  type ServiceProbe,
} from './externalServices.js';
import { createHealthMonitor } from './healthMonitor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const healthyProbe: ServiceProbe = async () => ({ ok: true, latencyMs: 42, message: 'OK' });
const unhealthyProbe: ServiceProbe = async () => ({ ok: false, message: 'connection refused' });
const throwingProbe: ServiceProbe = async () => {
  throw new Error('network error');
};

// ---------------------------------------------------------------------------
// createGeminiHealthCheck
// ---------------------------------------------------------------------------

describe('createGeminiHealthCheck', () => {
  it('returns a HealthCheck with correct name and type', () => {
    const hc = createGeminiHealthCheck({ probe: healthyProbe });
    expect(hc.name).toBe('gemini-api');
    expect(hc.type).toBe('external');
    expect(hc.timeoutMs).toBe(5000);
  });

  it('respects custom timeoutMs', () => {
    const hc = createGeminiHealthCheck({ probe: healthyProbe, timeoutMs: 3000 });
    expect(hc.timeoutMs).toBe(3000);
  });

  it('reports healthy when probe succeeds', async () => {
    const hc = createGeminiHealthCheck({ probe: healthyProbe });
    const result = await hc.check();
    expect(result.status).toBe('healthy');
    expect(result.message).toBe('OK');
    expect(result.details).toEqual({ latencyMs: 42 });
  });

  it('reports unhealthy when probe returns ok: false', async () => {
    const hc = createGeminiHealthCheck({ probe: unhealthyProbe });
    const result = await hc.check();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('connection refused');
  });

  it('propagates probe errors', async () => {
    const hc = createGeminiHealthCheck({ probe: throwingProbe });
    await expect(hc.check()).rejects.toThrow('network error');
  });
});

// ---------------------------------------------------------------------------
// createEmailProviderHealthCheck
// ---------------------------------------------------------------------------

describe('createEmailProviderHealthCheck', () => {
  it('returns a HealthCheck with correct name and type', () => {
    const hc = createEmailProviderHealthCheck({ probe: healthyProbe });
    expect(hc.name).toBe('email-provider');
    expect(hc.type).toBe('external');
    expect(hc.timeoutMs).toBe(5000);
  });

  it('reports healthy when probe succeeds', async () => {
    const hc = createEmailProviderHealthCheck({ probe: healthyProbe });
    const result = await hc.check();
    expect(result.status).toBe('healthy');
  });

  it('reports unhealthy when probe fails', async () => {
    const hc = createEmailProviderHealthCheck({ probe: unhealthyProbe });
    const result = await hc.check();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('connection refused');
  });
});

// ---------------------------------------------------------------------------
// Integration with HealthMonitor
// ---------------------------------------------------------------------------

describe('integration with HealthMonitor', () => {
  it('registers and runs external health checks', async () => {
    const monitor = createHealthMonitor();
    monitor.register(createGeminiHealthCheck({ probe: healthyProbe }));
    monitor.register(createEmailProviderHealthCheck({ probe: unhealthyProbe }));

    const report = await monitor.check();
    expect(report.components).toHaveLength(2);

    const gemini = report.components.find((c) => c.name === 'gemini-api');
    expect(gemini?.status).toBe('healthy');
    expect(gemini?.type).toBe('external');

    const email = report.components.find((c) => c.name === 'email-provider');
    expect(email?.status).toBe('unhealthy');

    // One unhealthy component → overall unhealthy
    expect(report.status).toBe('unhealthy');
  });

  it('can check a single external component', async () => {
    const monitor = createHealthMonitor();
    monitor.register(createGeminiHealthCheck({ probe: healthyProbe }));

    const result = await monitor.checkComponent('gemini-api');
    expect(result.status).toBe('healthy');
    expect(result.type).toBe('external');
  });
});
