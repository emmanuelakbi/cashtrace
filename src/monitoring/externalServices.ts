/**
 * External Service Health Checks
 *
 * Factory functions that create HealthCheck objects for monitoring
 * external service availability (Gemini API, email provider).
 *
 * @module monitoring/externalServices
 */

import type { HealthCheck, HealthCheckResult } from './healthMonitor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Probe function that checks if an external service is reachable. */
export type ServiceProbe = () => Promise<{ ok: boolean; latencyMs?: number; message?: string }>;

export interface GeminiHealthCheckConfig {
  /** Custom probe — defaults to a no-op healthy stub. */
  probe: ServiceProbe;
  /** Timeout in ms (default: 5000). */
  timeoutMs?: number;
}

export interface EmailProviderHealthCheckConfig {
  /** Custom probe — defaults to a no-op healthy stub. */
  probe: ServiceProbe;
  /** Timeout in ms (default: 5000). */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5000;

function probeToHealthCheck(probe: ServiceProbe): () => Promise<HealthCheckResult> {
  return async (): Promise<HealthCheckResult> => {
    const result = await probe();
    return {
      status: result.ok ? 'healthy' : 'unhealthy',
      message: result.message,
      details: result.latencyMs != null ? { latencyMs: result.latencyMs } : undefined,
    };
  };
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Creates a health check for the Gemini API.
 */
export function createGeminiHealthCheck(config: GeminiHealthCheckConfig): HealthCheck {
  return {
    name: 'gemini-api',
    type: 'external',
    check: probeToHealthCheck(config.probe),
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Creates a health check for the email provider.
 */
export function createEmailProviderHealthCheck(
  config: EmailProviderHealthCheckConfig,
): HealthCheck {
  return {
    name: 'email-provider',
    type: 'external',
    check: probeToHealthCheck(config.probe),
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}
