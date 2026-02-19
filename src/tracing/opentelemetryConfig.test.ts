import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadOpenTelemetryConfig,
  createSpanExporter,
  createW3CPropagator,
  createContextPropagator,
} from './opentelemetryConfig.js';
import type { SpanContext, SpanData } from './opentelemetryConfig.js';

describe('OpenTelemetry Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadOpenTelemetryConfig', () => {
    it('returns defaults when no env vars set', () => {
      const config = loadOpenTelemetryConfig();
      expect(config.enabled).toBe(true);
      expect(config.serviceName).toBe('cashtrace');
      expect(config.serviceVersion).toBe('1.0.0');
      expect(config.exporterType).toBe('console');
      expect(config.samplingRate).toBe(0.1);
      expect(config.propagationFormat).toBe('w3c');
      expect(config.maxSpansPerTrace).toBe(1000);
      expect(config.spanProcessorType).toBe('batch');
      expect(config.batchExportIntervalMs).toBe(5000);
      expect(config.maxExportBatchSize).toBe(512);
    });

    it('reads values from environment variables', () => {
      process.env['OTEL_ENABLED'] = 'false';
      process.env['OTEL_SERVICE_NAME'] = 'my-service';
      process.env['OTEL_SERVICE_VERSION'] = '2.0.0';
      process.env['OTEL_EXPORTER_TYPE'] = 'jaeger';
      process.env['OTEL_EXPORTER_ENDPOINT'] = 'http://jaeger:14268';
      process.env['OTEL_SAMPLING_RATE'] = '0.5';
      process.env['OTEL_PROPAGATION_FORMAT'] = 'b3';

      const config = loadOpenTelemetryConfig();
      expect(config.enabled).toBe(false);
      expect(config.serviceName).toBe('my-service');
      expect(config.serviceVersion).toBe('2.0.0');
      expect(config.exporterType).toBe('jaeger');
      expect(config.exporterEndpoint).toBe('http://jaeger:14268');
      expect(config.samplingRate).toBe(0.5);
      expect(config.propagationFormat).toBe('b3');
    });

    it('clamps sampling rate between 0 and 1', () => {
      process.env['OTEL_SAMPLING_RATE'] = '2.0';
      let config = loadOpenTelemetryConfig();
      expect(config.samplingRate).toBe(1);

      process.env['OTEL_SAMPLING_RATE'] = '-0.5';
      config = loadOpenTelemetryConfig();
      expect(config.samplingRate).toBe(0);
    });

    it('defaults sampling rate on invalid input', () => {
      process.env['OTEL_SAMPLING_RATE'] = 'not-a-number';
      const config = loadOpenTelemetryConfig();
      expect(config.samplingRate).toBe(0.1);
    });

    it('falls back to SERVICE_NAME when OTEL_SERVICE_NAME not set', () => {
      process.env['SERVICE_NAME'] = 'fallback-service';
      delete process.env['OTEL_SERVICE_NAME'];
      const config = loadOpenTelemetryConfig();
      expect(config.serviceName).toBe('fallback-service');
    });
  });

  describe('createSpanExporter', () => {
    it('creates console exporter by default', async () => {
      const config = loadOpenTelemetryConfig();
      const exporter = createSpanExporter(config);
      // Should not throw
      await exporter.export([]);
      await exporter.shutdown();
    });

    it('creates stub exporter for jaeger', async () => {
      process.env['OTEL_EXPORTER_TYPE'] = 'jaeger';
      const config = loadOpenTelemetryConfig();
      const exporter = createSpanExporter(config);
      await exporter.export([]);
      await exporter.shutdown();
    });

    it('creates stub exporter for otlp', async () => {
      process.env['OTEL_EXPORTER_TYPE'] = 'otlp';
      const config = loadOpenTelemetryConfig();
      const exporter = createSpanExporter(config);
      await exporter.export([]);
      await exporter.shutdown();
    });

    it('creates noop exporter for none', async () => {
      process.env['OTEL_EXPORTER_TYPE'] = 'none';
      const config = loadOpenTelemetryConfig();
      const exporter = createSpanExporter(config);
      await exporter.export([]);
      await exporter.shutdown();
    });

    it('console exporter outputs span data', async () => {
      const config = loadOpenTelemetryConfig();
      const exporter = createSpanExporter(config);

      const span: SpanData = {
        name: 'test-span',
        kind: 'server',
        startTime: 1000,
        endTime: 1050,
        attributes: { 'http.method': 'GET' },
        status: 'ok',
        events: [],
        context: {
          traceId: 'abc123',
          spanId: 'def456',
          traceFlags: 1,
        },
      };

      // Should not throw when exporting spans
      await exporter.export([span]);
      await exporter.shutdown();
    });
  });

  describe('W3C Trace Context Propagator', () => {
    it('injects trace context into headers', () => {
      const propagator = createW3CPropagator();
      const context: SpanContext = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      };

      const headers = propagator.inject(context);
      expect(headers['traceparent']).toBe(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      );
    });

    it('extracts trace context from headers', () => {
      const propagator = createW3CPropagator();
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };

      const context = propagator.extract(headers);
      expect(context).not.toBeNull();
      expect(context!.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(context!.spanId).toBe('b7ad6b7169203331');
      expect(context!.traceFlags).toBe(1);
    });

    it('returns null when traceparent header is missing', () => {
      const propagator = createW3CPropagator();
      const context = propagator.extract({});
      expect(context).toBeNull();
    });

    it('returns null for malformed traceparent', () => {
      const propagator = createW3CPropagator();
      const context = propagator.extract({ traceparent: 'invalid' });
      expect(context).toBeNull();
    });
  });

  describe('createContextPropagator', () => {
    it('creates a propagator based on config', () => {
      const config = loadOpenTelemetryConfig();
      const propagator = createContextPropagator(config);

      const context: SpanContext = {
        traceId: 'abc123',
        spanId: 'def456',
        traceFlags: 0,
      };

      const headers = propagator.inject(context);
      expect(headers).toHaveProperty('traceparent');

      const extracted = propagator.extract(headers);
      expect(extracted).not.toBeNull();
      expect(extracted!.traceId).toBe('abc123');
      expect(extracted!.spanId).toBe('def456');
    });
  });
});
