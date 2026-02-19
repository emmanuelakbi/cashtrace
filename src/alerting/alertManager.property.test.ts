/**
 * Property-based tests for Alert Timeliness
 *
 * **Property 5: Alert Timeliness**
 * For any metric exceeding alert threshold for the defined duration,
 * an alert SHALL be triggered within 1 minute.
 *
 * **Validates: Requirements 6.1**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createAlertManager,
  type AlertComparison,
  type AlertSeverity,
  type AlertChannel,
  type AlertDefinition,
} from './alertManager.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid alert comparison operator. */
const comparisonArb = fc.constantFrom<AlertComparison>('gt', 'lt', 'eq', 'gte', 'lte');

/** Generate a valid alert severity. */
const severityArb = fc.constantFrom<AlertSeverity>('critical', 'warning', 'info');

/** Generate a valid alert channel. */
const channelArb = fc.constantFrom<AlertChannel>('email', 'slack', 'pagerduty');

/** Generate a non-empty array of channels. */
const channelsArb = fc.uniqueArray(channelArb, { minLength: 1, maxLength: 3 });

/** Generate a finite numeric threshold. */
const thresholdArb = fc.double({
  min: -1_000_000,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Generate a non-empty metric name. */
const metricNameArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,19}$/);

/** Generate a non-empty alert name. */
const alertNameArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,19}$/);

/** Generate a duration string. */
const durationArb = fc.constantFrom('1m', '5m', '10m', '15m', '30m', '1h');

/**
 * Given a comparison operator and threshold, produce a metric value that
 * breaches the threshold.
 */
function breachingValue(comparison: AlertComparison, threshold: number): number {
  switch (comparison) {
    case 'gt':
      return threshold + 1;
    case 'gte':
      return threshold;
    case 'lt':
      return threshold - 1;
    case 'lte':
      return threshold;
    case 'eq':
      return threshold;
  }
}

/**
 * Given a comparison operator and threshold, produce a metric value that
 * does NOT breach the threshold.
 */
function nonBreachingValue(comparison: AlertComparison, threshold: number): number {
  switch (comparison) {
    case 'gt':
      return threshold;
    case 'gte':
      return threshold - 1;
    case 'lt':
      return threshold;
    case 'lte':
      return threshold + 1;
    case 'eq':
      return threshold + 1;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 5: Alert Timeliness', () => {
  /**
   * **Validates: Requirements 6.1**
   *
   * For any alert definition with arbitrary threshold, comparison, and severity,
   * when the metric value breaches the threshold, an alert is fired immediately
   * (within the checkAlerts call) — well within the 1-minute requirement.
   */
  it('fires an alert immediately when metric breaches threshold for any definition', async () => {
    await fc.assert(
      fc.asyncProperty(
        alertNameArb,
        metricNameArb,
        thresholdArb,
        comparisonArb,
        severityArb,
        channelsArb,
        durationArb,
        async (name, query, threshold, comparison, severity, channels, duration) => {
          const metricValue = breachingValue(comparison, threshold);
          const queryFn = async (q: string) => (q === query ? metricValue : undefined);
          const manager = createAlertManager(queryFn);

          const definition: AlertDefinition = {
            name,
            query,
            threshold,
            comparison,
            duration,
            severity,
            channels,
          };

          manager.defineAlert(definition);

          const before = Date.now();
          const fired = await manager.checkAlerts();
          const elapsed = Date.now() - before;

          // An alert must have been fired
          expect(fired).toHaveLength(1);

          const alert = fired[0]!;
          // Alert metadata matches the definition
          expect(alert.definitionName).toBe(name);
          expect(alert.severity).toBe(severity);
          expect(alert.status).toBe('firing');
          expect(alert.threshold).toBe(threshold);
          expect(alert.comparison).toBe(comparison);
          expect(alert.value).toBe(metricValue);

          // The alert was triggered within 1 minute (60_000ms).
          // In practice it completes in <1ms since it's in-process.
          expect(elapsed).toBeLessThan(60_000);

          // firedAt timestamp is present and recent
          expect(alert.firedAt).toBeInstanceOf(Date);
          expect(alert.firedAt.getTime()).toBeGreaterThanOrEqual(before);
          expect(alert.firedAt.getTime()).toBeLessThanOrEqual(Date.now());
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * For any alert definition, when the metric value does NOT breach the
   * threshold, no alert should be fired. This is the complement property
   * ensuring alerts only fire when thresholds are actually exceeded.
   */
  it('does not fire an alert when metric does not breach threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        alertNameArb,
        metricNameArb,
        thresholdArb,
        comparisonArb,
        severityArb,
        channelsArb,
        durationArb,
        async (name, query, threshold, comparison, severity, channels, duration) => {
          const metricValue = nonBreachingValue(comparison, threshold);
          const queryFn = async (q: string) => (q === query ? metricValue : undefined);
          const manager = createAlertManager(queryFn);

          const definition: AlertDefinition = {
            name,
            query,
            threshold,
            comparison,
            duration,
            severity,
            channels,
          };

          manager.defineAlert(definition);

          const fired = await manager.checkAlerts();

          // No alert should fire when threshold is not breached
          expect(fired).toHaveLength(0);
          expect(manager.getActiveAlerts()).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * For any set of alert definitions where all metrics breach their thresholds,
   * every definition produces exactly one alert in a single checkAlerts call.
   * This validates that alert evaluation is timely across multiple definitions.
   */
  it('fires alerts for all breached definitions in a single check cycle', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(
            alertNameArb,
            metricNameArb,
            thresholdArb,
            comparisonArb,
            severityArb,
            channelsArb,
            durationArb,
          ),
          { minLength: 1, maxLength: 10 },
        ),
        async (definitions) => {
          // Deduplicate by name AND query to avoid conflicts where
          // two definitions share the same metric query but different
          // thresholds/comparisons, causing the metricValues map to
          // overwrite with a value that doesn't breach both.
          const seenNames = new Set<string>();
          const seenQueries = new Set<string>();
          const unique = definitions.filter(([name, query]) => {
            if (seenNames.has(name) || seenQueries.has(query)) return false;
            seenNames.add(name);
            seenQueries.add(query);
            return true;
          });

          if (unique.length === 0) return;

          const metricValues = new Map<string, number>();
          const defs: AlertDefinition[] = unique.map(
            ([name, query, threshold, comparison, severity, channels, duration]) => {
              metricValues.set(query, breachingValue(comparison, threshold));
              return { name, query, threshold, comparison, duration, severity, channels };
            },
          );

          const queryFn = async (q: string) => metricValues.get(q);
          const manager = createAlertManager(queryFn);

          for (const def of defs) {
            manager.defineAlert(def);
          }

          const before = Date.now();
          const fired = await manager.checkAlerts();
          const elapsed = Date.now() - before;

          // All definitions should have fired
          expect(fired).toHaveLength(defs.length);

          // All alerts fired within 1 minute
          expect(elapsed).toBeLessThan(60_000);

          // Each fired alert corresponds to a definition
          const firedNames = new Set(fired.map((a) => a.definitionName));
          for (const def of defs) {
            expect(firedNames.has(def.name)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
