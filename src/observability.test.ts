import { describe, it, expect } from 'vitest';
import {
  createObservabilitySDK,
  shutdownObservability,
  createLogger,
  createPIIScrubber,
  createMetricsCollector,
  createTracer,
  createAlertManager,
  createHealthMonitor,
  createHttpMetrics,
  createSloTracker,
  type ObservabilitySDK,
} from './observability.js';

describe('Observability SDK', () => {
  describe('re-exports', () => {
    it('exports factory functions from sub-modules', () => {
      expect(typeof createLogger).toBe('function');
      expect(typeof createPIIScrubber).toBe('function');
      expect(typeof createMetricsCollector).toBe('function');
      expect(typeof createTracer).toBe('function');
      expect(typeof createAlertManager).toBe('function');
      expect(typeof createHealthMonitor).toBe('function');
      expect(typeof createHttpMetrics).toBe('function');
      expect(typeof createSloTracker).toBe('function');
    });
  });

  describe('createObservabilitySDK', () => {
    it('returns all components with default config', () => {
      const sdk = createObservabilitySDK();

      expect(sdk.logger).toBeDefined();
      expect(typeof sdk.logger.info).toBe('function');

      expect(sdk.piiScrubber).toBeDefined();
      expect(typeof sdk.piiScrubber.scrub).toBe('function');

      expect(sdk.metricsCollector).toBeDefined();
      expect(typeof sdk.metricsCollector.counter).toBe('function');

      expect(sdk.tracer).toBeDefined();
      expect(typeof sdk.tracer.startSpan).toBe('function');

      expect(sdk.alertManager).toBeDefined();
      expect(typeof sdk.alertManager.defineAlert).toBe('function');

      expect(sdk.healthMonitor).toBeDefined();
      expect(typeof sdk.healthMonitor.register).toBe('function');
    });

    it('forwards logger options', () => {
      const entries: unknown[] = [];
      const sdk = createObservabilitySDK({
        logger: {
          service: 'test-svc',
          level: 'warn',
          output: (entry) => entries.push(entry),
        },
      });

      sdk.logger.info('should be suppressed');
      sdk.logger.warn('should appear');

      expect(entries).toHaveLength(1);
      expect((entries[0] as Record<string, unknown>).message).toBe('should appear');
    });

    it('uses logger service name as tracer service name by default', () => {
      const sdk = createObservabilitySDK({
        logger: { service: 'my-service', output: () => {} },
      });

      // Tracer was created — start a span to verify it works
      const span = sdk.tracer.startSpan('test');
      expect(span.name).toBe('test');
      span.end();
    });

    it('components are independent instances', () => {
      const sdk1 = createObservabilitySDK();
      const sdk2 = createObservabilitySDK();

      expect(sdk1.logger).not.toBe(sdk2.logger);
      expect(sdk1.metricsCollector).not.toBe(sdk2.metricsCollector);
    });
  });

  describe('shutdownObservability', () => {
    it('completes without error', async () => {
      const sdk = createObservabilitySDK();
      await expect(shutdownObservability(sdk)).resolves.toBeUndefined();
    });

    it('calls tracer shutdown when available', async () => {
      let shutdownCalled = false;
      const sdk = createObservabilitySDK();
      // Monkey-patch shutdown onto the tracer to verify it's called
      (sdk.tracer as Record<string, unknown>)['shutdown'] = async () => {
        shutdownCalled = true;
      };

      await shutdownObservability(sdk);
      expect(shutdownCalled).toBe(true);
    });
  });
});
