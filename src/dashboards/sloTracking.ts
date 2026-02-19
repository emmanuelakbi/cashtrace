/**
 * SLO Tracking Module
 *
 * Defines SLO configuration, calculates error budgets and burn rates,
 * and generates Grafana panel definitions for SLO visualization.
 *
 * Requirements:
 *   7.4 - Include SLO tracking panels for availability and latency
 */

import type { Panel } from './dashboardDefinitions.js';

// --- SLO Configuration Interfaces ---

export type SloType = 'availability' | 'latency';

export interface SloConfig {
  /** Unique identifier for this SLO */
  name: string;
  /** Type of SLO */
  type: SloType;
  /** Target as a fraction (e.g. 0.999 for 99.9%) */
  target: number;
  /** Rolling window in seconds (e.g. 30 days = 2592000) */
  windowSeconds: number;
  /** PromQL expression for total requests */
  totalQuery: string;
  /** PromQL expression for good/successful requests (availability) or requests within threshold (latency) */
  goodQuery: string;
  /** Description of the SLO */
  description?: string;
}

export interface SloStatus {
  /** The SLO configuration */
  config: SloConfig;
  /** Total number of requests in the window */
  totalRequests: number;
  /** Number of good requests in the window */
  goodRequests: number;
  /** Current compliance as a fraction (0-1) */
  compliance: number;
  /** Total error budget (allowed bad requests) */
  errorBudget: number;
  /** Remaining error budget (can be negative) */
  errorBudgetRemaining: number;
  /** Fraction of error budget consumed (0-1+) */
  errorBudgetConsumed: number;
  /** Burn rate: actual error rate / allowed error rate */
  burnRate: number;
  /** Whether the SLO is currently met */
  isMet: boolean;
}

// --- Core Calculations ---

function calculateCompliance(goodRequests: number, totalRequests: number): number {
  if (totalRequests <= 0) return 1;
  return goodRequests / totalRequests;
}

function calculateErrorBudget(target: number, totalRequests: number): number {
  return (1 - target) * totalRequests;
}

function calculateBurnRate(target: number, goodRequests: number, totalRequests: number): number {
  if (totalRequests <= 0) return 0;
  const allowedErrorRate = 1 - target;
  if (allowedErrorRate <= 0) return totalRequests > goodRequests ? Infinity : 0;
  const actualErrorRate = (totalRequests - goodRequests) / totalRequests;
  return actualErrorRate / allowedErrorRate;
}

// --- SLO Tracker ---

export interface SloTracker {
  /** Get the SLO configuration */
  getConfig(): SloConfig;
  /** Evaluate the SLO given current metric values */
  evaluate(totalRequests: number, goodRequests: number): SloStatus;
  /** Generate Grafana panels for this SLO */
  generatePanels(startId: number, yOffset: number): Panel[];
}

export function createSloTracker(config: SloConfig): SloTracker {
  return {
    getConfig(): SloConfig {
      return config;
    },

    evaluate(totalRequests: number, goodRequests: number): SloStatus {
      const clamped = Math.max(0, Math.min(goodRequests, totalRequests));
      const total = Math.max(0, totalRequests);

      const compliance = calculateCompliance(clamped, total);
      const errorBudget = calculateErrorBudget(config.target, total);
      const badRequests = total - clamped;
      const errorBudgetRemaining = errorBudget - badRequests;
      const errorBudgetConsumed =
        errorBudget > 0 ? badRequests / errorBudget : badRequests > 0 ? Infinity : 0;
      const burnRate = calculateBurnRate(config.target, clamped, total);

      return {
        config,
        totalRequests: total,
        goodRequests: clamped,
        compliance,
        errorBudget,
        errorBudgetRemaining,
        errorBudgetConsumed,
        burnRate,
        isMet: compliance >= config.target,
      };
    },

    generatePanels(startId: number, yOffset: number): Panel[] {
      const label = config.name;

      return [
        {
          id: startId,
          title: `${label} - Compliance`,
          type: 'gauge',
          gridPos: { h: 8, w: 8, x: 0, y: yOffset },
          targets: [
            {
              expr: `(${config.goodQuery}) / (${config.totalQuery})`,
              legendFormat: 'Compliance',
              refId: 'A',
            },
          ],
          fieldConfig: {
            defaults: {
              thresholds: {
                steps: [
                  { color: 'red', value: 0 },
                  { color: 'orange', value: config.target - 0.001 },
                  { color: 'green', value: config.target },
                ],
              },
              max: 1,
              unit: 'percentunit',
            },
          },
        },
        {
          id: startId + 1,
          title: `${label} - Error Budget Remaining`,
          type: 'timeseries',
          gridPos: { h: 8, w: 8, x: 8, y: yOffset },
          targets: [
            {
              expr: `(${1 - config.target}) * (${config.totalQuery}) - ((${config.totalQuery}) - (${config.goodQuery}))`,
              legendFormat: 'Budget Remaining',
              refId: 'A',
            },
          ],
        },
        {
          id: startId + 2,
          title: `${label} - Burn Rate`,
          type: 'stat',
          gridPos: { h: 8, w: 8, x: 16, y: yOffset },
          targets: [
            {
              expr: `((${config.totalQuery}) - (${config.goodQuery})) / (${config.totalQuery}) / ${1 - config.target}`,
              legendFormat: 'Burn Rate',
              refId: 'A',
            },
          ],
          fieldConfig: {
            defaults: {
              thresholds: {
                steps: [
                  { color: 'green', value: 0 },
                  { color: 'orange', value: 1 },
                  { color: 'red', value: 2 },
                ],
              },
            },
          },
        },
      ];
    },
  };
}

// --- Preset SLO Configs ---

export function createAvailabilitySloConfig(overrides?: Partial<SloConfig>): SloConfig {
  return {
    name: 'API Availability',
    type: 'availability',
    target: 0.999,
    windowSeconds: 30 * 24 * 60 * 60, // 30 days
    totalQuery:
      'sum(increase(http_requests_total{environment=~"$environment",service=~"$service"}[30d]))',
    goodQuery:
      'sum(increase(http_requests_total{environment=~"$environment",service=~"$service",status_code!~"5.."}[30d]))',
    description: '99.9% of requests return non-5xx responses over 30 days',
    ...overrides,
  };
}

export function createLatencySloConfig(overrides?: Partial<SloConfig>): SloConfig {
  return {
    name: 'API Latency P99',
    type: 'latency',
    target: 0.99,
    windowSeconds: 30 * 24 * 60 * 60, // 30 days
    totalQuery:
      'sum(increase(http_requests_total{environment=~"$environment",service=~"$service"}[30d]))',
    goodQuery:
      'sum(increase(http_request_duration_ms_bucket{environment=~"$environment",service=~"$service",le="500"}[30d]))',
    description: '99% of requests complete within 500ms over 30 days',
    ...overrides,
  };
}
