import { describe, it, expect } from 'vitest';
import {
  createSloTracker,
  createAvailabilitySloConfig,
  createLatencySloConfig,
  type SloConfig,
} from './sloTracking.js';

// --- Helpers ---

function makeConfig(overrides?: Partial<SloConfig>): SloConfig {
  return {
    name: 'Test SLO',
    type: 'availability',
    target: 0.999,
    windowSeconds: 2592000,
    totalQuery: 'sum(http_requests_total)',
    goodQuery: 'sum(http_requests_ok)',
    ...overrides,
  };
}

// --- SLO Definition & Configuration ---

describe('SLO definition and configuration', () => {
  it('stores and returns config via getConfig()', () => {
    const config = makeConfig({ name: 'My SLO', target: 0.95 });
    const tracker = createSloTracker(config);
    expect(tracker.getConfig()).toEqual(config);
  });

  it('createAvailabilitySloConfig returns sensible defaults', () => {
    const config = createAvailabilitySloConfig();
    expect(config.type).toBe('availability');
    expect(config.target).toBe(0.999);
    expect(config.windowSeconds).toBe(30 * 24 * 60 * 60);
    expect(config.totalQuery).toContain('http_requests_total');
    expect(config.goodQuery).toContain('status_code!~"5.."');
  });

  it('createLatencySloConfig returns sensible defaults', () => {
    const config = createLatencySloConfig();
    expect(config.type).toBe('latency');
    expect(config.target).toBe(0.99);
    expect(config.goodQuery).toContain('le="500"');
  });

  it('preset configs accept overrides', () => {
    const config = createAvailabilitySloConfig({ target: 0.95, name: 'Custom' });
    expect(config.target).toBe(0.95);
    expect(config.name).toBe('Custom');
  });
});

// --- Error Budget Calculation ---

describe('error budget calculation', () => {
  it('calculates error budget correctly for 99.9% target', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.999 }));
    const status = tracker.evaluate(10000, 9995);
    // Budget = (1 - 0.999) * 10000 = 10
    expect(status.errorBudget).toBeCloseTo(10, 5);
    // Bad = 5, remaining = 10 - 5 = 5
    expect(status.errorBudgetRemaining).toBeCloseTo(5, 5);
    expect(status.errorBudgetConsumed).toBeCloseTo(0.5, 5);
  });

  it('shows negative remaining when budget is exhausted', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.999 }));
    const status = tracker.evaluate(10000, 9980);
    // Budget = 10, bad = 20, remaining = -10
    expect(status.errorBudgetRemaining).toBeCloseTo(-10, 5);
    expect(status.errorBudgetConsumed).toBeCloseTo(2, 5);
  });

  it('returns full budget when no errors', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.99 }));
    const status = tracker.evaluate(1000, 1000);
    expect(status.errorBudget).toBeCloseTo(10, 5);
    expect(status.errorBudgetRemaining).toBeCloseTo(10, 5);
    expect(status.errorBudgetConsumed).toBeCloseTo(0, 5);
  });
});

// --- Burn Rate Calculation ---

describe('burn rate calculation', () => {
  it('burn rate is 1.0 when consuming budget at exactly the allowed rate', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.99 }));
    // Allowed error rate = 1%, actual = 1%
    const status = tracker.evaluate(10000, 9900);
    expect(status.burnRate).toBeCloseTo(1.0, 5);
  });

  it('burn rate > 1 when consuming faster than allowed', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.99 }));
    // Allowed = 1%, actual = 2%
    const status = tracker.evaluate(10000, 9800);
    expect(status.burnRate).toBeCloseTo(2.0, 5);
  });

  it('burn rate is 0 when no errors', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.99 }));
    const status = tracker.evaluate(10000, 10000);
    expect(status.burnRate).toBeCloseTo(0, 5);
  });

  it('burn rate is 0 when no requests', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.99 }));
    const status = tracker.evaluate(0, 0);
    expect(status.burnRate).toBe(0);
  });
});

// --- Compliance & isMet ---

describe('compliance and isMet', () => {
  it('isMet is true when compliance >= target', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.99 }));
    const status = tracker.evaluate(10000, 9900);
    expect(status.compliance).toBeCloseTo(0.99, 5);
    expect(status.isMet).toBe(true);
  });

  it('isMet is false when compliance < target', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.99 }));
    const status = tracker.evaluate(10000, 9899);
    expect(status.isMet).toBe(false);
  });

  it('compliance is 1 when no requests (vacuously true)', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.999 }));
    const status = tracker.evaluate(0, 0);
    expect(status.compliance).toBe(1);
    expect(status.isMet).toBe(true);
  });
});

// --- Edge Cases ---

describe('edge cases', () => {
  it('handles 100% target (zero error budget)', () => {
    const tracker = createSloTracker(makeConfig({ target: 1.0 }));
    const perfect = tracker.evaluate(1000, 1000);
    expect(perfect.errorBudget).toBe(0);
    expect(perfect.errorBudgetRemaining).toBe(0);
    expect(perfect.errorBudgetConsumed).toBe(0);
    expect(perfect.burnRate).toBe(0);
    expect(perfect.isMet).toBe(true);

    const imperfect = tracker.evaluate(1000, 999);
    expect(imperfect.errorBudgetRemaining).toBe(-1);
    expect(imperfect.errorBudgetConsumed).toBe(Infinity);
    expect(imperfect.burnRate).toBe(Infinity);
    expect(imperfect.isMet).toBe(false);
  });

  it('handles 0% compliance (all requests bad)', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.99 }));
    const status = tracker.evaluate(1000, 0);
    expect(status.compliance).toBe(0);
    expect(status.isMet).toBe(false);
    expect(status.burnRate).toBeCloseTo(100, 5);
    expect(status.errorBudgetConsumed).toBeCloseTo(100, 5);
  });

  it('clamps goodRequests to not exceed totalRequests', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.99 }));
    const status = tracker.evaluate(100, 200);
    expect(status.goodRequests).toBe(100);
    expect(status.compliance).toBe(1);
  });

  it('clamps negative totalRequests to 0', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.99 }));
    const status = tracker.evaluate(-10, -5);
    expect(status.totalRequests).toBe(0);
    expect(status.goodRequests).toBe(0);
    expect(status.compliance).toBe(1);
  });
});

// --- Grafana Panel Generation ---

describe('Grafana panel generation', () => {
  it('generates 3 panels per SLO (compliance, budget, burn rate)', () => {
    const tracker = createSloTracker(makeConfig());
    const panels = tracker.generatePanels(1, 0);
    expect(panels).toHaveLength(3);
  });

  it('assigns sequential IDs starting from startId', () => {
    const tracker = createSloTracker(makeConfig());
    const panels = tracker.generatePanels(10, 0);
    expect(panels[0].id).toBe(10);
    expect(panels[1].id).toBe(11);
    expect(panels[2].id).toBe(12);
  });

  it('positions panels at the given yOffset', () => {
    const tracker = createSloTracker(makeConfig());
    const panels = tracker.generatePanels(1, 16);
    for (const p of panels) {
      expect(p.gridPos.y).toBe(16);
    }
  });

  it('compliance panel is a gauge with correct thresholds', () => {
    const tracker = createSloTracker(makeConfig({ target: 0.999 }));
    const panels = tracker.generatePanels(1, 0);
    const compliance = panels[0];
    expect(compliance.type).toBe('gauge');
    expect(compliance.title).toContain('Compliance');
    expect(compliance.fieldConfig).toBeDefined();
  });

  it('burn rate panel is a stat panel', () => {
    const tracker = createSloTracker(makeConfig());
    const panels = tracker.generatePanels(1, 0);
    const burnRate = panels[2];
    expect(burnRate.type).toBe('stat');
    expect(burnRate.title).toContain('Burn Rate');
  });

  it('panel targets reference the configured queries', () => {
    const config = makeConfig({
      totalQuery: 'sum(my_total)',
      goodQuery: 'sum(my_good)',
    });
    const tracker = createSloTracker(config);
    const panels = tracker.generatePanels(1, 0);
    const allExprs = panels.flatMap((p) => p.targets.map((t) => t.expr));
    const joined = allExprs.join(' ');
    expect(joined).toContain('sum(my_total)');
    expect(joined).toContain('sum(my_good)');
  });

  it('panels are JSON-serializable', () => {
    const tracker = createSloTracker(makeConfig());
    const panels = tracker.generatePanels(1, 0);
    const json = JSON.stringify(panels);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].id).toBe(1);
  });
});
