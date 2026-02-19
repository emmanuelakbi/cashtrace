import { describe, it, expect } from 'vitest';
import { createHealthScoreCalculator } from './healthScore.js';
import type { HealthReport, ComponentHealth } from './healthMonitor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComponent(
  overrides: Partial<ComponentHealth> & Pick<ComponentHealth, 'name' | 'type' | 'status'>,
): ComponentHealth {
  return { lastChecked: new Date(), ...overrides };
}

function makeReport(components: ComponentHealth[], status?: HealthReport['status']): HealthReport {
  const s = status ?? (components.some((c) => c.status === 'unhealthy')
    ? 'unhealthy'
    : components.some((c) => c.status === 'degraded')
      ? 'degraded'
      : 'healthy');
  return { status: s, components, timestamp: new Date() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('healthScore', () => {
  describe('createHealthScoreCalculator', () => {
    it('returns score 100 for empty components', () => {
      const calc = createHealthScoreCalculator();
      const result = calc.calculate(makeReport([]));
      expect(result.score).toBe(100);
      expect(result.status).toBe('healthy');
      expect(result.componentScores).toEqual([]);
    });

    it('returns score 100 when all components are healthy', () => {
      const calc = createHealthScoreCalculator();
      const report = makeReport([
        makeComponent({ name: 'db', type: 'database', status: 'healthy' }),
        makeComponent({ name: 'api', type: 'service', status: 'healthy' }),
        makeComponent({ name: 'cache', type: 'redis', status: 'healthy' }),
      ]);
      const result = calc.calculate(report);
      expect(result.score).toBe(100);
      expect(result.status).toBe('healthy');
    });

    it('returns score 0 when all components are unhealthy', () => {
      const calc = createHealthScoreCalculator();
      const report = makeReport([
        makeComponent({ name: 'db', type: 'database', status: 'unhealthy' }),
        makeComponent({ name: 'api', type: 'service', status: 'unhealthy' }),
      ]);
      const result = calc.calculate(report);
      expect(result.score).toBe(0);
      expect(result.status).toBe('unhealthy');
    });

    it('returns score 50 when all components are degraded', () => {
      const calc = createHealthScoreCalculator();
      const report = makeReport([
        makeComponent({ name: 'db', type: 'database', status: 'degraded' }),
        makeComponent({ name: 'api', type: 'service', status: 'degraded' }),
      ]);
      const result = calc.calculate(report);
      expect(result.score).toBe(50);
      expect(result.status).toBe('degraded');
    });

    it('weights database higher than external', () => {
      const calc = createHealthScoreCalculator();

      const dbUnhealthy = calc.calculate(makeReport([
        makeComponent({ name: 'db', type: 'database', status: 'unhealthy' }),
        makeComponent({ name: 'ext', type: 'external', status: 'healthy' }),
      ]));

      const extUnhealthy = calc.calculate(makeReport([
        makeComponent({ name: 'db', type: 'database', status: 'healthy' }),
        makeComponent({ name: 'ext', type: 'external', status: 'unhealthy' }),
      ]));

      // When database is unhealthy, score should be lower than when external is unhealthy
      expect(dbUnhealthy.score).toBeLessThan(extUnhealthy.score);
    });

    it('produces per-component scores', () => {
      const calc = createHealthScoreCalculator();
      const report = makeReport([
        makeComponent({ name: 'db', type: 'database', status: 'healthy' }),
        makeComponent({ name: 'api', type: 'service', status: 'degraded' }),
      ]);
      const result = calc.calculate(report);
      expect(result.componentScores).toHaveLength(2);
      expect(result.componentScores[0]).toEqual({ name: 'db', type: 'database', score: 100 });
      expect(result.componentScores[1]).toEqual({ name: 'api', type: 'service', score: 50 });
    });

    it('averages multiple components of the same type', () => {
      const calc = createHealthScoreCalculator();
      const report = makeReport([
        makeComponent({ name: 'db-primary', type: 'database', status: 'healthy' }),
        makeComponent({ name: 'db-replica', type: 'database', status: 'unhealthy' }),
      ]);
      const result = calc.calculate(report);
      // Average of 100 and 0 = 50, only database type present, so score = 50
      expect(result.score).toBe(50);
      expect(result.status).toBe('degraded');
    });
  });

  describe('custom weights', () => {
    it('accepts custom component weights', () => {
      const calc = createHealthScoreCalculator({
        weights: { database: 10, service: 10, redis: 10, external: 10 },
      });
      expect(calc.getWeights()).toEqual({
        database: 10, service: 10, redis: 10, external: 10,
      });
    });

    it('merges partial weights with defaults', () => {
      const calc = createHealthScoreCalculator({ weights: { database: 50 } });
      const w = calc.getWeights();
      expect(w.database).toBe(50);
      expect(w.service).toBe(30); // default
    });

    it('uses custom weights in calculation', () => {
      // Equal weights: database unhealthy + external healthy = 50
      const calc = createHealthScoreCalculator({
        weights: { database: 50, service: 50, redis: 50, external: 50 },
      });
      const report = makeReport([
        makeComponent({ name: 'db', type: 'database', status: 'unhealthy' }),
        makeComponent({ name: 'ext', type: 'external', status: 'healthy' }),
      ]);
      const result = calc.calculate(report);
      expect(result.score).toBe(50);
    });
  });

  describe('custom thresholds', () => {
    it('accepts custom thresholds', () => {
      const calc = createHealthScoreCalculator({
        thresholds: { healthy: 90, degraded: 60 },
      });
      expect(calc.getThresholds()).toEqual({ healthy: 90, degraded: 60 });
    });

    it('maps score to status using custom thresholds', () => {
      const calc = createHealthScoreCalculator({
        thresholds: { healthy: 90, degraded: 60 },
      });
      // All degraded = score 50, which is below degraded threshold of 60
      const report = makeReport([
        makeComponent({ name: 'db', type: 'database', status: 'degraded' }),
      ]);
      const result = calc.calculate(report);
      expect(result.score).toBe(50);
      expect(result.status).toBe('unhealthy');
    });

    it('merges partial thresholds with defaults', () => {
      const calc = createHealthScoreCalculator({ thresholds: { healthy: 90 } });
      const t = calc.getThresholds();
      expect(t.healthy).toBe(90);
      expect(t.degraded).toBe(50); // default
    });
  });

  describe('score-to-status mapping', () => {
    it('maps score >= 80 to healthy (default)', () => {
      const calc = createHealthScoreCalculator();
      const report = makeReport([
        makeComponent({ name: 'db', type: 'database', status: 'healthy' }),
        makeComponent({ name: 'ext', type: 'external', status: 'degraded' }),
      ]);
      const result = calc.calculate(report);
      // database(100)*40 + external(50)*10 = 4500 / 50 = 90
      expect(result.score).toBe(90);
      expect(result.status).toBe('healthy');
    });

    it('maps score in [50, 80) to degraded (default)', () => {
      const calc = createHealthScoreCalculator();
      const report = makeReport([
        makeComponent({ name: 'db', type: 'database', status: 'degraded' }),
        makeComponent({ name: 'api', type: 'service', status: 'healthy' }),
      ]);
      const result = calc.calculate(report);
      // database(50)*40 + service(100)*30 = 5000 / 70 ≈ 71
      expect(result.score).toBe(71);
      expect(result.status).toBe('degraded');
    });

    it('maps score < 50 to unhealthy (default)', () => {
      const calc = createHealthScoreCalculator();
      const report = makeReport([
        makeComponent({ name: 'db', type: 'database', status: 'unhealthy' }),
        makeComponent({ name: 'api', type: 'service', status: 'degraded' }),
      ]);
      const result = calc.calculate(report);
      // database(0)*40 + service(50)*30 = 1500 / 70 ≈ 21
      expect(result.score).toBe(21);
      expect(result.status).toBe('unhealthy');
    });
  });
});
