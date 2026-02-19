/**
 * Health Score Calculator
 *
 * Calculates a numeric health score (0-100) from a HealthReport by weighting
 * component statuses by type. Maps score ranges to status labels.
 *
 * @module monitoring/healthScore
 */

import type { ComponentType, HealthReport, HealthStatus } from './healthMonitor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComponentWeights {
  database: number;
  service: number;
  redis: number;
  external: number;
}

export interface ScoreThresholds {
  /** Score at or above this is 'healthy' (default: 80) */
  healthy: number;
  /** Score at or above this is 'degraded' (default: 50) */
  degraded: number;
}

export interface HealthScoreConfig {
  weights?: Partial<ComponentWeights>;
  thresholds?: Partial<ScoreThresholds>;
}

export interface HealthScoreResult {
  score: number;
  status: HealthStatus;
  componentScores: { name: string; type: ComponentType; score: number }[];
}

export interface HealthScoreCalculator {
  calculate(report: HealthReport): HealthScoreResult;
  getWeights(): ComponentWeights;
  getThresholds(): ScoreThresholds;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS: ComponentWeights = {
  database: 40,
  service: 30,
  redis: 20,
  external: 10,
};

const DEFAULT_THRESHOLDS: ScoreThresholds = {
  healthy: 80,
  degraded: 50,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_SCORES: Record<HealthStatus, number> = {
  healthy: 1,
  degraded: 0.5,
  unhealthy: 0,
};

function statusToScore(status: HealthStatus): number {
  return STATUS_SCORES[status] ?? 0;
}

function scoreToStatus(score: number, thresholds: ScoreThresholds): HealthStatus {
  if (score >= thresholds.healthy) return 'healthy';
  if (score >= thresholds.degraded) return 'degraded';
  return 'unhealthy';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHealthScoreCalculator(config: HealthScoreConfig = {}): HealthScoreCalculator {
  const weights: ComponentWeights = { ...DEFAULT_WEIGHTS, ...config.weights };
  const thresholds: ScoreThresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };

  return {
    calculate(report: HealthReport): HealthScoreResult {
      const { components } = report;

      if (components.length === 0) {
        return { score: 100, status: 'healthy', componentScores: [] };
      }

      // Group components by type and compute per-component scores
      const componentScores = components.map((c) => ({
        name: c.name,
        type: c.type,
        score: statusToScore(c.status) * 100,
      }));

      // Collect which types are present and their average scores
      const typeAverages = new Map<ComponentType, number>();
      const typeCounts = new Map<ComponentType, number>();

      for (const cs of componentScores) {
        typeCounts.set(cs.type, (typeCounts.get(cs.type) ?? 0) + 1);
        typeAverages.set(cs.type, (typeAverages.get(cs.type) ?? 0) + cs.score);
      }

      for (const [type, total] of typeAverages) {
        typeAverages.set(type, total / typeCounts.get(type)!);
      }

      // Weighted aggregate across present types only
      let totalWeight = 0;
      let weightedSum = 0;

      for (const [type, avg] of typeAverages) {
        const w = weights[type];
        totalWeight += w;
        weightedSum += avg * w;
      }

      const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 100;
      const status = scoreToStatus(score, thresholds);

      return { score, status, componentScores };
    },

    getWeights(): ComponentWeights {
      return { ...weights };
    },

    getThresholds(): ScoreThresholds {
      return { ...thresholds };
    },
  };
}
