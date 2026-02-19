import { describe, it, expect, vi } from 'vitest';
import { createCostTracker, type CostService, type BudgetAlert } from './costTracker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;

function recordMany(
  tracker: ReturnType<typeof createCostTracker>,
  service: CostService,
  operation: string,
  count: number,
  unitCost: number,
) {
  for (let i = 0; i < count; i++) {
    tracker.record({ service, operation, quantity: 1, unitCost });
  }
}

// ---------------------------------------------------------------------------
// Recording usage events
// ---------------------------------------------------------------------------

describe('costTracker – recording', () => {
  it('records an event and computes cost from quantity * unitCost', () => {
    const tracker = createCostTracker();
    const ev = tracker.record({
      service: 'gemini',
      operation: 'parse',
      quantity: 5,
      unitCost: 0.01,
    });
    expect(ev.cost).toBeCloseTo(0.05);
    expect(ev.service).toBe('gemini');
    expect(ev.timestamp).toBeInstanceOf(Date);
  });

  it('returns all events via getEvents()', () => {
    const tracker = createCostTracker();
    tracker.record({ service: 'gemini', operation: 'parse', quantity: 1, unitCost: 0.01 });
    tracker.record({ service: 'email', operation: 'send', quantity: 2, unitCost: 0.005 });
    expect(tracker.getEvents()).toHaveLength(2);
  });

  it('filters events by service', () => {
    const tracker = createCostTracker();
    tracker.record({ service: 'gemini', operation: 'parse', quantity: 1, unitCost: 0.01 });
    tracker.record({ service: 'email', operation: 'send', quantity: 1, unitCost: 0.005 });
    tracker.record({ service: 'storage', operation: 'upload', quantity: 1, unitCost: 0.001 });
    expect(tracker.getEvents('email')).toHaveLength(1);
    expect(tracker.getEvents('gemini')).toHaveLength(1);
  });

  it('attaches metadata when provided', () => {
    const tracker = createCostTracker();
    const ev = tracker.record({
      service: 'gemini',
      operation: 'parse',
      quantity: 1,
      unitCost: 0.01,
      metadata: { model: 'gemini-pro' },
    });
    expect(ev.metadata).toEqual({ model: 'gemini-pro' });
  });
});

// ---------------------------------------------------------------------------
// Cost breakdown
// ---------------------------------------------------------------------------

describe('costTracker – breakdown', () => {
  it('returns breakdown grouped by service', () => {
    const tracker = createCostTracker();
    recordMany(tracker, 'gemini', 'parse', 3, 0.01);
    recordMany(tracker, 'email', 'send', 2, 0.005);

    const breakdowns = tracker.getBreakdown();
    expect(breakdowns).toHaveLength(2);

    const gemini = breakdowns.find((b) => b.service === 'gemini')!;
    expect(gemini.totalCost).toBeCloseTo(0.03);
    expect(gemini.totalQuantity).toBe(3);
    expect(gemini.operations['parse'].quantity).toBe(3);
  });

  it('returns breakdown for a single service', () => {
    const tracker = createCostTracker();
    tracker.record({ service: 'storage', operation: 'upload', quantity: 10, unitCost: 0.001 });
    tracker.record({ service: 'storage', operation: 'download', quantity: 5, unitCost: 0.0005 });

    const bd = tracker.getServiceBreakdown('storage');
    expect(bd.totalCost).toBeCloseTo(0.0125);
    expect(Object.keys(bd.operations)).toEqual(expect.arrayContaining(['upload', 'download']));
  });

  it('returns empty breakdown when no events exist', () => {
    const tracker = createCostTracker();
    const bd = tracker.getServiceBreakdown('gemini');
    expect(bd.totalCost).toBe(0);
    expect(bd.totalQuantity).toBe(0);
  });

  it('respects since filter', () => {
    const tracker = createCostTracker();
    tracker.record({ service: 'gemini', operation: 'parse', quantity: 1, unitCost: 0.01 });

    // All events are "now", so a future since should exclude them
    const future = new Date(Date.now() + 100_000);
    const breakdowns = tracker.getBreakdown(future);
    expect(breakdowns).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Budget alerts
// ---------------------------------------------------------------------------

describe('costTracker – budget alerts', () => {
  it('fires onBudgetAlert callback when cost exceeds limit', () => {
    const alerts: BudgetAlert[] = [];
    const tracker = createCostTracker({
      budgets: [{ service: 'gemini', limit: 0.02, periodMs: MONTH_MS }],
      onBudgetAlert: (a) => alerts.push(a),
    });

    tracker.record({ service: 'gemini', operation: 'parse', quantity: 1, unitCost: 0.01 });
    expect(alerts).toHaveLength(0);

    tracker.record({ service: 'gemini', operation: 'parse', quantity: 1, unitCost: 0.02 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].exceeds).toBe(true);
    expect(alerts[0].currentCost).toBeGreaterThan(0.02);
  });

  it('does not fire for unrelated services', () => {
    const alerts: BudgetAlert[] = [];
    const tracker = createCostTracker({
      budgets: [{ service: 'gemini', limit: 0.01, periodMs: MONTH_MS }],
      onBudgetAlert: (a) => alerts.push(a),
    });

    tracker.record({ service: 'email', operation: 'send', quantity: 100, unitCost: 1 });
    expect(alerts).toHaveLength(0);
  });

  it('supports "all" service budget', () => {
    const alerts: BudgetAlert[] = [];
    const tracker = createCostTracker({
      budgets: [{ service: 'all', limit: 0.05, periodMs: MONTH_MS }],
      onBudgetAlert: (a) => alerts.push(a),
    });

    tracker.record({ service: 'gemini', operation: 'parse', quantity: 3, unitCost: 0.01 });
    expect(alerts).toHaveLength(0);

    tracker.record({ service: 'email', operation: 'send', quantity: 3, unitCost: 0.01 });
    expect(alerts).toHaveLength(1);
  });

  it('checkBudgets returns status for all budgets', () => {
    const tracker = createCostTracker({
      budgets: [
        { service: 'gemini', limit: 1, periodMs: MONTH_MS },
        { service: 'email', limit: 0.01, periodMs: MONTH_MS },
      ],
    });

    tracker.record({ service: 'email', operation: 'send', quantity: 5, unitCost: 0.01 });

    const results = tracker.checkBudgets();
    expect(results).toHaveLength(2);

    const emailBudget = results.find((r) => r.threshold.service === 'email')!;
    expect(emailBudget.exceeds).toBe(true);
    expect(emailBudget.percentUsed).toBeGreaterThan(100);

    const geminiBudget = results.find((r) => r.threshold.service === 'gemini')!;
    expect(geminiBudget.exceeds).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cost forecasting
// ---------------------------------------------------------------------------

describe('costTracker – forecasting', () => {
  it('returns zero projection when no events exist', () => {
    const tracker = createCostTracker();
    const fc = tracker.forecast(MONTH_MS);
    expect(fc.projectedCost).toBe(0);
    expect(fc.confidence).toBe('low');
    expect(fc.service).toBe('all');
  });

  it('projects cost linearly based on usage rate', () => {
    const tracker = createCostTracker();

    // Simulate events spread over time by manipulating timestamps
    const now = Date.now();
    // Record events then manually adjust timestamps for spread
    for (let i = 0; i < 10; i++) {
      const ev = tracker.record({
        service: 'gemini',
        operation: 'parse',
        quantity: 1,
        unitCost: 0.01,
      });
      // Spread events over 15 days
      (ev as any).timestamp = new Date(now - 15 * DAY_MS + i * (1.5 * DAY_MS));
    }

    const fc = tracker.forecast(MONTH_MS, 'gemini');
    // 10 events * 0.01 = 0.10 over ~13.5 days → ~0.222 over 30 days
    expect(fc.projectedCost).toBeGreaterThan(0.1);
    expect(fc.service).toBe('gemini');
  });

  it('returns low confidence with single event', () => {
    const tracker = createCostTracker();
    tracker.record({ service: 'gemini', operation: 'parse', quantity: 1, unitCost: 0.01 });
    const fc = tracker.forecast(MONTH_MS, 'gemini');
    expect(fc.confidence).toBe('low');
  });

  it('returns higher confidence with more data points and span', () => {
    const tracker = createCostTracker();
    const now = Date.now();

    for (let i = 0; i < 15; i++) {
      const ev = tracker.record({
        service: 'email',
        operation: 'send',
        quantity: 1,
        unitCost: 0.005,
      });
      (ev as any).timestamp = new Date(now - 20 * DAY_MS + i * (1.3 * DAY_MS));
    }

    const fc = tracker.forecast(MONTH_MS, 'email');
    expect(fc.confidence).toBe('high');
  });

  it('forecasts across all services when no service specified', () => {
    const tracker = createCostTracker();
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      const ev1 = tracker.record({
        service: 'gemini',
        operation: 'parse',
        quantity: 1,
        unitCost: 0.01,
      });
      (ev1 as any).timestamp = new Date(now - 10 * DAY_MS + i * (2 * DAY_MS));
      const ev2 = tracker.record({
        service: 'email',
        operation: 'send',
        quantity: 1,
        unitCost: 0.005,
      });
      (ev2 as any).timestamp = new Date(now - 10 * DAY_MS + i * (2 * DAY_MS));
    }

    const fc = tracker.forecast(MONTH_MS);
    expect(fc.service).toBe('all');
    expect(fc.currentCost).toBeCloseTo(0.075);
    expect(fc.projectedCost).toBeGreaterThan(fc.currentCost);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('costTracker – edge cases', () => {
  it('handles zero quantity', () => {
    const tracker = createCostTracker();
    const ev = tracker.record({
      service: 'gemini',
      operation: 'parse',
      quantity: 0,
      unitCost: 0.01,
    });
    expect(ev.cost).toBe(0);
  });

  it('handles zero unit cost', () => {
    const tracker = createCostTracker();
    const ev = tracker.record({
      service: 'storage',
      operation: 'list',
      quantity: 100,
      unitCost: 0,
    });
    expect(ev.cost).toBe(0);
  });

  it('works with no budgets configured', () => {
    const tracker = createCostTracker();
    tracker.record({ service: 'gemini', operation: 'parse', quantity: 1, unitCost: 0.01 });
    expect(tracker.checkBudgets()).toEqual([]);
  });

  it('handles large number of events', () => {
    const tracker = createCostTracker();
    for (let i = 0; i < 1000; i++) {
      tracker.record({ service: 'gemini', operation: 'parse', quantity: 1, unitCost: 0.001 });
    }
    const bd = tracker.getServiceBreakdown('gemini');
    expect(bd.totalCost).toBeCloseTo(1.0);
    expect(bd.totalQuantity).toBe(1000);
  });
});
