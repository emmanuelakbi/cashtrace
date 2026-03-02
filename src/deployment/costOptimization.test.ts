import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BUDGET_ALERT_THRESHOLDS,
  getRecommendedStrategy,
  hasRequiredTags,
  MAX_SPOT_PERCENTAGE,
  REQUIRED_TAGS,
  VALID_INSTANCE_STRATEGIES,
  validateBudgetAlert,
  validateCostOptimizationConfig,
  validateInstanceStrategy,
  validateResourceTags,
} from './costOptimization.js';
import type {
  BudgetAlert,
  CostOptimizationConfig,
  InstanceStrategy,
  ResourceTag,
} from './costOptimization.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeAllTags = (overrides: Partial<Record<string, string>> = {}): ResourceTag[] =>
  REQUIRED_TAGS.map((key) => ({ key, value: overrides[key] ?? `${key}-value` }));

const makeValidStrategy = (overrides: Partial<InstanceStrategy> = {}): InstanceStrategy => ({
  workloadType: 'web-server',
  strategy: 'reserved',
  ...overrides,
});

const makeValidAlert = (overrides: Partial<BudgetAlert> = {}): BudgetAlert => ({
  name: 'monthly-budget',
  budgetAmount: 1000,
  thresholds: [50, 75, 90, 100],
  notificationEmail: 'team@example.com',
  ...overrides,
});

// ─── validateResourceTags ────────────────────────────────────────────────────

describe('validateResourceTags', () => {
  it('returns valid when all required tags are present', () => {
    const result = validateResourceTags(makeAllTags());
    expect(result.valid).toBe(true);
    expect(result.missingTags).toEqual([]);
  });

  it('reports missing tags when some are absent', () => {
    const tags: ResourceTag[] = [
      { key: 'project', value: 'cashtrace' },
      { key: 'environment', value: 'prod' },
    ];
    const result = validateResourceTags(tags);
    expect(result.valid).toBe(false);
    expect(result.missingTags).toContain('team');
    expect(result.missingTags).toContain('cost-center');
  });

  it('reports all tags missing when given an empty array', () => {
    const result = validateResourceTags([]);
    expect(result.valid).toBe(false);
    expect(result.missingTags).toEqual([...REQUIRED_TAGS]);
  });

  it('ignores extra tags beyond the required set', () => {
    const tags = [...makeAllTags(), { key: 'owner', value: 'alice' }];
    const result = validateResourceTags(tags);
    expect(result.valid).toBe(true);
  });
});

// ─── validateInstanceStrategy ────────────────────────────────────────────────

describe('validateInstanceStrategy', () => {
  it.each([...VALID_INSTANCE_STRATEGIES])('accepts valid strategy "%s"', (strategy) => {
    const input = makeValidStrategy({
      strategy,
      spotPercentage: strategy === 'spot' ? 50 : undefined,
    });
    const result = validateInstanceStrategy(input);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an invalid strategy name', () => {
    const result = validateInstanceStrategy(makeValidStrategy({ strategy: 'preemptible' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid strategy');
  });

  it('rejects spot strategy without spotPercentage', () => {
    const result = validateInstanceStrategy(
      makeValidStrategy({ strategy: 'spot', spotPercentage: undefined }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('spotPercentage must be > 0');
  });

  it('rejects spot strategy with spotPercentage of 0', () => {
    const result = validateInstanceStrategy(
      makeValidStrategy({ strategy: 'spot', spotPercentage: 0 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('spotPercentage must be > 0');
  });

  it('rejects spot strategy exceeding MAX_SPOT_PERCENTAGE', () => {
    const result = validateInstanceStrategy(
      makeValidStrategy({ strategy: 'spot', spotPercentage: MAX_SPOT_PERCENTAGE + 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain(`<= ${MAX_SPOT_PERCENTAGE}`);
  });

  it('accepts spot strategy at exactly MAX_SPOT_PERCENTAGE', () => {
    const result = validateInstanceStrategy(
      makeValidStrategy({ strategy: 'spot', spotPercentage: MAX_SPOT_PERCENTAGE }),
    );
    expect(result.valid).toBe(true);
  });
});

// ─── validateBudgetAlert ─────────────────────────────────────────────────────

describe('validateBudgetAlert', () => {
  it('accepts a valid budget alert', () => {
    const result = validateBudgetAlert(makeValidAlert());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects empty name', () => {
    const result = validateBudgetAlert(makeValidAlert({ name: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('name must not be empty');
  });

  it('rejects whitespace-only name', () => {
    const result = validateBudgetAlert(makeValidAlert({ name: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('name must not be empty');
  });

  it('rejects zero budgetAmount', () => {
    const result = validateBudgetAlert(makeValidAlert({ budgetAmount: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('budgetAmount must be > 0');
  });

  it('rejects negative budgetAmount', () => {
    const result = validateBudgetAlert(makeValidAlert({ budgetAmount: -500 }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('budgetAmount must be > 0');
  });

  it('rejects thresholds below 1', () => {
    const result = validateBudgetAlert(makeValidAlert({ thresholds: [0, 50, 100] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('between 1 and 100');
  });

  it('rejects thresholds above 100', () => {
    const result = validateBudgetAlert(makeValidAlert({ thresholds: [50, 150] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('between 1 and 100');
  });

  it('rejects email without @', () => {
    const result = validateBudgetAlert(makeValidAlert({ notificationEmail: 'not-an-email' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('must contain @');
  });

  it('collects multiple errors at once', () => {
    const result = validateBudgetAlert(
      makeValidAlert({ name: '', budgetAmount: -1, notificationEmail: 'bad' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── validateCostOptimizationConfig ──────────────────────────────────────────

describe('validateCostOptimizationConfig', () => {
  const makeValidConfig = (
    overrides: Partial<CostOptimizationConfig> = {},
  ): CostOptimizationConfig => ({
    resourceTags: makeAllTags(),
    instanceStrategies: [makeValidStrategy()],
    budgetAlerts: [makeValidAlert()],
    ...overrides,
  });

  it('accepts a fully valid configuration', () => {
    const result = validateCostOptimizationConfig(makeValidConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports missing resource tags', () => {
    const result = validateCostOptimizationConfig(makeValidConfig({ resourceTags: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Missing required tags');
  });

  it('reports invalid instance strategies', () => {
    const result = validateCostOptimizationConfig(
      makeValidConfig({
        instanceStrategies: [makeValidStrategy({ strategy: 'invalid' })],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid strategy');
  });

  it('reports invalid budget alerts', () => {
    const result = validateCostOptimizationConfig(
      makeValidConfig({
        budgetAlerts: [makeValidAlert({ budgetAmount: -1 })],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('budgetAmount');
  });

  it('aggregates errors from all sub-validations', () => {
    const result = validateCostOptimizationConfig({
      resourceTags: [],
      instanceStrategies: [makeValidStrategy({ strategy: 'bad' })],
      budgetAlerts: [makeValidAlert({ name: '' })],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── hasRequiredTags ─────────────────────────────────────────────────────────

describe('hasRequiredTags', () => {
  it('returns true when all required tags are present', () => {
    expect(hasRequiredTags(makeAllTags())).toBe(true);
  });

  it('returns false when tags are missing', () => {
    expect(hasRequiredTags([{ key: 'project', value: 'cashtrace' }])).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(hasRequiredTags([])).toBe(false);
  });
});

// ─── getRecommendedStrategy ──────────────────────────────────────────────────

describe('getRecommendedStrategy', () => {
  it.each(['web-server', 'database', 'api'])(
    'recommends "reserved" for predictable workload "%s"',
    (workload) => {
      expect(getRecommendedStrategy(workload)).toBe('reserved');
    },
  );

  it.each(['batch', 'worker'])('recommends "spot" for non-critical workload "%s"', (workload) => {
    expect(getRecommendedStrategy(workload)).toBe('spot');
  });

  it.each(['analytics', 'cron', 'unknown'])(
    'recommends "on-demand" for other workload "%s"',
    (workload) => {
      expect(getRecommendedStrategy(workload)).toBe('on-demand');
    },
  );
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('REQUIRED_TAGS contains expected tags', () => {
    expect(REQUIRED_TAGS).toEqual(['project', 'environment', 'team', 'cost-center']);
  });

  it('VALID_INSTANCE_STRATEGIES contains expected strategies', () => {
    expect(VALID_INSTANCE_STRATEGIES).toEqual(['on-demand', 'reserved', 'spot']);
  });

  it('MAX_SPOT_PERCENTAGE is 80', () => {
    expect(MAX_SPOT_PERCENTAGE).toBe(80);
  });

  it('DEFAULT_BUDGET_ALERT_THRESHOLDS are [50, 75, 90, 100]', () => {
    expect(DEFAULT_BUDGET_ALERT_THRESHOLDS).toEqual([50, 75, 90, 100]);
  });
});
