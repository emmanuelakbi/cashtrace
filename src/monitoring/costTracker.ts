/**
 * Cost Tracker
 *
 * Tracks usage and costs for Gemini API calls, email sends, and storage.
 * Supports budget thresholds with alerts and simple linear cost forecasting.
 *
 * @module monitoring/costTracker
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CostService = 'gemini' | 'email' | 'storage';

export interface UsageEvent {
  service: CostService;
  operation: string;
  quantity: number;
  unitCost: number;
  cost: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface CostBreakdown {
  service: CostService;
  totalCost: number;
  totalQuantity: number;
  operations: Record<string, { cost: number; quantity: number }>;
}

export interface BudgetThreshold {
  service: CostService | 'all';
  limit: number;
  /** Period in milliseconds (e.g. 30 days). Events within this window are summed. */
  periodMs: number;
}

export interface BudgetAlert {
  threshold: BudgetThreshold;
  currentCost: number;
  percentUsed: number;
  exceeds: boolean;
  timestamp: Date;
}

export interface CostForecast {
  service: CostService | 'all';
  currentCost: number;
  projectedCost: number;
  periodMs: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface CostTrackerConfig {
  budgets?: BudgetThreshold[];
  /** Callback invoked when a budget threshold is exceeded */
  onBudgetAlert?: (alert: BudgetAlert) => void;
}

export interface CostTracker {
  record(event: Omit<UsageEvent, 'cost' | 'timestamp'>): UsageEvent;
  getEvents(service?: CostService): UsageEvent[];
  getBreakdown(since?: Date): CostBreakdown[];
  getServiceBreakdown(service: CostService, since?: Date): CostBreakdown;
  checkBudgets(): BudgetAlert[];
  forecast(periodMs: number, service?: CostService): CostForecast;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCostTracker(config: CostTrackerConfig = {}): CostTracker {
  const events: UsageEvent[] = [];
  const budgets: BudgetThreshold[] = [...(config.budgets ?? [])];

  function filterEvents(service?: CostService, since?: Date): UsageEvent[] {
    return events.filter((e) => {
      if (service && e.service !== service) return false;
      if (since && e.timestamp < since) return false;
      return true;
    });
  }

  function buildBreakdown(service: CostService, filtered: UsageEvent[]): CostBreakdown {
    const serviceEvents = filtered.filter((e) => e.service === service);
    const operations: Record<string, { cost: number; quantity: number }> = {};
    let totalCost = 0;
    let totalQuantity = 0;

    for (const ev of serviceEvents) {
      totalCost += ev.cost;
      totalQuantity += ev.quantity;
      const op = operations[ev.operation] ?? { cost: 0, quantity: 0 };
      op.cost += ev.cost;
      op.quantity += ev.quantity;
      operations[ev.operation] = op;
    }

    return { service, totalCost, totalQuantity, operations };
  }

  return {
    record(input): UsageEvent {
      const event: UsageEvent = {
        ...input,
        cost: input.quantity * input.unitCost,
        timestamp: new Date(),
      };
      events.push(event);

      // Check budgets after recording
      for (const budget of budgets) {
        if (budget.service !== 'all' && budget.service !== event.service) continue;
        const since = new Date(Date.now() - budget.periodMs);
        const svc = budget.service === 'all' ? undefined : budget.service;
        const periodEvents = filterEvents(svc, since);
        const currentCost = periodEvents.reduce((sum, e) => sum + e.cost, 0);
        const percentUsed = (currentCost / budget.limit) * 100;
        if (currentCost > budget.limit && config.onBudgetAlert) {
          config.onBudgetAlert({
            threshold: budget,
            currentCost,
            percentUsed,
            exceeds: true,
            timestamp: new Date(),
          });
        }
      }

      return event;
    },

    getEvents(service?: CostService): UsageEvent[] {
      return filterEvents(service);
    },

    getBreakdown(since?: Date): CostBreakdown[] {
      const filtered = filterEvents(undefined, since);
      const services = new Set(filtered.map((e) => e.service));
      return [...services].map((s) => buildBreakdown(s, filtered));
    },

    getServiceBreakdown(service: CostService, since?: Date): CostBreakdown {
      const filtered = filterEvents(service, since);
      return buildBreakdown(service, filtered);
    },

    checkBudgets(): BudgetAlert[] {
      const alerts: BudgetAlert[] = [];
      for (const budget of budgets) {
        const since = new Date(Date.now() - budget.periodMs);
        const svc = budget.service === 'all' ? undefined : budget.service;
        const periodEvents = filterEvents(svc, since);
        const currentCost = periodEvents.reduce((sum, e) => sum + e.cost, 0);
        const percentUsed = (currentCost / budget.limit) * 100;
        alerts.push({
          threshold: budget,
          currentCost,
          percentUsed,
          exceeds: currentCost > budget.limit,
          timestamp: new Date(),
        });
      }
      return alerts;
    },

    forecast(periodMs: number, service?: CostService): CostForecast {
      const allEvents = filterEvents(service);
      const svcLabel = service ?? 'all';

      if (allEvents.length === 0) {
        return { service: svcLabel, currentCost: 0, projectedCost: 0, periodMs, confidence: 'low' };
      }

      const sorted = [...allEvents].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const earliest = sorted[0]!.timestamp.getTime();
      const latest = sorted[sorted.length - 1]!.timestamp.getTime();
      const spanMs = latest - earliest;
      const totalCost = sorted.reduce((sum, e) => sum + e.cost, 0);

      // Not enough time span to project
      if (spanMs === 0) {
        return {
          service: svcLabel,
          currentCost: totalCost,
          projectedCost: totalCost,
          periodMs,
          confidence: 'low',
        };
      }

      // Linear projection: cost per ms * period
      const costPerMs = totalCost / spanMs;
      const projectedCost = costPerMs * periodMs;

      // Confidence based on data points and span coverage
      let confidence: 'low' | 'medium' | 'high' = 'low';
      if (sorted.length >= 10 && spanMs >= periodMs * 0.5) {
        confidence = 'high';
      } else if (sorted.length >= 3 && spanMs >= periodMs * 0.1) {
        confidence = 'medium';
      }

      return { service: svcLabel, currentCost: totalCost, projectedCost, periodMs, confidence };
    },
  };
}
