/**
 * Health Monitor
 *
 * Monitors service health via health check endpoints, database connection
 * pool health, and Redis connection health. Supports registering arbitrary
 * health checks, running them with timeouts, and aggregating results into
 * an overall system health status.
 *
 * @module monitoring/healthMonitor
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export type ComponentType = 'service' | 'database' | 'redis' | 'external';

export interface ComponentHealth {
  name: string;
  type: ComponentType;
  status: HealthStatus;
  message?: string;
  latencyMs?: number;
  lastChecked: Date;
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  status: HealthStatus;
  message?: string;
  details?: Record<string, unknown>;
}

export type HealthCheckFn = () => Promise<HealthCheckResult>;

export interface HealthCheck {
  name: string;
  type: ComponentType;
  check: HealthCheckFn;
  timeoutMs: number;
}

export interface HealthReport {
  status: HealthStatus;
  components: ComponentHealth[];
  timestamp: Date;
}

export interface HealthMonitor {
  register(check: HealthCheck): void;
  unregister(name: string): boolean;
  getRegistered(): HealthCheck[];
  check(): Promise<HealthReport>;
  checkComponent(name: string): Promise<ComponentHealth>;
}

export interface HealthMonitorOptions {
  /** Default timeout for health checks in ms (default: 5000) */
  defaultTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateHealthCheck(hc: HealthCheck): void {
  if (!hc.name || hc.name.trim().length === 0) {
    throw new Error('Health check must have a non-empty name');
  }
  const validTypes: ComponentType[] = ['service', 'database', 'redis', 'external'];
  if (!validTypes.includes(hc.type)) {
    throw new Error(`Invalid component type: ${String(hc.type)}`);
  }
  if (typeof hc.check !== 'function') {
    throw new Error('Health check must have a check function');
  }
  if (hc.timeoutMs <= 0) {
    throw new Error('Health check timeout must be positive');
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Health check timed out')), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function aggregateStatus(components: ComponentHealth[]): HealthStatus {
  if (components.length === 0) return 'healthy';
  if (components.some((c) => c.status === 'unhealthy')) return 'unhealthy';
  if (components.some((c) => c.status === 'degraded')) return 'degraded';
  return 'healthy';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Creates a HealthMonitor instance.
 */
export function createHealthMonitor(options: HealthMonitorOptions = {}): HealthMonitor {
  const defaultTimeout = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const checks = new Map<string, HealthCheck>();

  async function runCheck(hc: HealthCheck): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      const result = await withTimeout(hc.check(), hc.timeoutMs);
      const latencyMs = Date.now() - start;
      return {
        name: hc.name,
        type: hc.type,
        status: result.status,
        message: result.message,
        latencyMs,
        lastChecked: new Date(),
        details: result.details,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        name: hc.name,
        type: hc.type,
        status: 'unhealthy',
        message,
        latencyMs,
        lastChecked: new Date(),
      };
    }
  }

  return {
    register(hc: HealthCheck): void {
      validateHealthCheck(hc);
      if (checks.has(hc.name)) {
        throw new Error(`Health check already registered: ${hc.name}`);
      }
      checks.set(hc.name, { ...hc, timeoutMs: hc.timeoutMs || defaultTimeout });
    },

    unregister(name: string): boolean {
      return checks.delete(name);
    },

    getRegistered(): HealthCheck[] {
      return [...checks.values()];
    },

    async check(): Promise<HealthReport> {
      const components = await Promise.all([...checks.values()].map((hc) => runCheck(hc)));
      return {
        status: aggregateStatus(components),
        components,
        timestamp: new Date(),
      };
    },

    async checkComponent(name: string): Promise<ComponentHealth> {
      const hc = checks.get(name);
      if (!hc) {
        throw new Error(`Health check not found: ${name}`);
      }
      return runCheck(hc);
    },
  };
}
