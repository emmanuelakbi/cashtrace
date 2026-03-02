/**
 * Cost optimization configuration validation.
 *
 * Provides pure functions to validate cost optimization settings including
 * reserved/spot instance strategies, resource tagging for cost allocation,
 * and budget alert configurations.
 *
 * Supports Requirements 12.1–12.5.
 *
 * @module deployment/costOptimization
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Tags that must be present on every resource for cost allocation. */
export const REQUIRED_TAGS = ['project', 'environment', 'team', 'cost-center'] as const;

/** Allowed instance pricing strategies. */
export const VALID_INSTANCE_STRATEGIES = ['on-demand', 'reserved', 'spot'] as const;

/** Maximum percentage of a workload that may run on spot instances. */
export const MAX_SPOT_PERCENTAGE = 80;

/** Default budget alert thresholds (percentage of budget consumed). */
export const DEFAULT_BUDGET_ALERT_THRESHOLDS = [50, 75, 90, 100] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A key-value tag attached to a cloud resource. */
export interface ResourceTag {
  key: string;
  value: string;
}

/** Result of validating resource tags against required tags. */
export interface ResourceTagValidationResult {
  valid: boolean;
  missingTags: string[];
}

/** Instance pricing strategy for a workload. */
export interface InstanceStrategy {
  workloadType: string;
  strategy: string;
  spotPercentage?: number;
}

/** Result of validating an instance strategy. */
export interface InstanceStrategyValidationResult {
  valid: boolean;
  errors: string[];
}

/** Budget alert configuration. */
export interface BudgetAlert {
  name: string;
  budgetAmount: number;
  thresholds: number[];
  notificationEmail: string;
}

/** Result of validating a budget alert. */
export interface BudgetAlertValidationResult {
  valid: boolean;
  errors: string[];
}

/** Complete cost optimization configuration. */
export interface CostOptimizationConfig {
  resourceTags: ResourceTag[];
  instanceStrategies: InstanceStrategy[];
  budgetAlerts: BudgetAlert[];
}

/** Result of validating the full cost optimization configuration. */
export interface CostOptimizationValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate that all required resource tags are present.
 *
 * Each tag in {@link REQUIRED_TAGS} must appear as a `key` in the provided
 * array. Missing tags are reported in the result.
 */
export function validateResourceTags(tags: ResourceTag[]): ResourceTagValidationResult {
  const tagKeys = new Set(tags.map((t) => t.key));
  const missingTags = REQUIRED_TAGS.filter((required) => !tagKeys.has(required));
  return { valid: missingTags.length === 0, missingTags };
}

/**
 * Validate an instance pricing strategy.
 *
 * Checks:
 * - `strategy` is one of {@link VALID_INSTANCE_STRATEGIES}.
 * - When strategy is `'spot'`, `spotPercentage` must be > 0 and <= {@link MAX_SPOT_PERCENTAGE}.
 */
export function validateInstanceStrategy(
  strategy: InstanceStrategy,
): InstanceStrategyValidationResult {
  const errors: string[] = [];

  if (
    !VALID_INSTANCE_STRATEGIES.includes(
      strategy.strategy as (typeof VALID_INSTANCE_STRATEGIES)[number],
    )
  ) {
    errors.push(
      `Invalid strategy '${strategy.strategy}'. Must be one of: ${VALID_INSTANCE_STRATEGIES.join(', ')}`,
    );
  }

  if (strategy.strategy === 'spot') {
    if (strategy.spotPercentage === undefined || strategy.spotPercentage <= 0) {
      errors.push('spotPercentage must be > 0 when strategy is spot');
    } else if (strategy.spotPercentage > MAX_SPOT_PERCENTAGE) {
      errors.push(
        `spotPercentage must be <= ${MAX_SPOT_PERCENTAGE}, got ${strategy.spotPercentage}`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a budget alert configuration.
 *
 * Checks:
 * - `name` is non-empty.
 * - `budgetAmount` is > 0.
 * - Every threshold is between 1 and 100 (inclusive).
 * - `notificationEmail` contains an `@` character.
 */
export function validateBudgetAlert(alert: BudgetAlert): BudgetAlertValidationResult {
  const errors: string[] = [];

  if (!alert.name || alert.name.trim().length === 0) {
    errors.push('Budget alert name must not be empty');
  }

  if (alert.budgetAmount <= 0) {
    errors.push(`budgetAmount must be > 0, got ${alert.budgetAmount}`);
  }

  const invalidThresholds = alert.thresholds.filter((t) => t < 1 || t > 100);
  if (invalidThresholds.length > 0) {
    errors.push(
      `All thresholds must be between 1 and 100. Invalid: ${invalidThresholds.join(', ')}`,
    );
  }

  if (!alert.notificationEmail.includes('@')) {
    errors.push('notificationEmail must contain @');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a complete cost optimization configuration.
 *
 * Aggregates errors from resource tag, instance strategy, and budget alert
 * validations into a single result.
 */
export function validateCostOptimizationConfig(
  config: CostOptimizationConfig,
): CostOptimizationValidationResult {
  const errors: string[] = [];

  const tagResult = validateResourceTags(config.resourceTags);
  if (!tagResult.valid) {
    errors.push(`Missing required tags: ${tagResult.missingTags.join(', ')}`);
  }

  for (const strategy of config.instanceStrategies) {
    const strategyResult = validateInstanceStrategy(strategy);
    errors.push(...strategyResult.errors);
  }

  for (const alert of config.budgetAlerts) {
    const alertResult = validateBudgetAlert(alert);
    errors.push(...alertResult.errors);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check whether all required resource tags are present.
 *
 * Convenience wrapper around {@link validateResourceTags} that returns a
 * simple boolean.
 */
export function hasRequiredTags(tags: ResourceTag[]): boolean {
  return validateResourceTags(tags).valid;
}

/**
 * Return the recommended instance pricing strategy for a workload type.
 *
 * - `'web-server'`, `'database'`, `'api'` → `'reserved'` (predictable workloads).
 * - `'batch'`, `'worker'` → `'spot'` (non-critical, interruptible).
 * - Everything else → `'on-demand'`.
 */
export function getRecommendedStrategy(workloadType: string): string {
  const reservedWorkloads = ['web-server', 'database', 'api'];
  const spotWorkloads = ['batch', 'worker'];

  if (reservedWorkloads.includes(workloadType)) {
    return 'reserved';
  }
  if (spotWorkloads.includes(workloadType)) {
    return 'spot';
  }
  return 'on-demand';
}
