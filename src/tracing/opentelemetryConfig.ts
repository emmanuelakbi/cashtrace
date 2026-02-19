/**
 * OpenTelemetry Configuration
 *
 * Provides configuration and client abstraction for distributed tracing
 * using OpenTelemetry-compatible format. Configurable via environment variables.
 */

import { createJaegerExporter, createXRayExporter, createBatchingExporter } from './exporters.js';

export interface OpenTelemetryConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  environment: string;
  exporterType: TracingExporter;
  exporterEndpoint: string;
  samplingRate: number;
  propagationFormat: PropagationFormat;
  maxSpansPerTrace: number;
  spanProcessorType: SpanProcessorType;
  batchExportIntervalMs: number;
  maxExportBatchSize: number;
}

export type TracingExporter = 'jaeger' | 'xray' | 'otlp' | 'console' | 'none';
export type PropagationFormat = 'w3c' | 'b3' | 'xray';
export type SpanProcessorType = 'batch' | 'simple';

export function loadOpenTelemetryConfig(): OpenTelemetryConfig {
  const samplingRate = parseFloat(process.env['OTEL_SAMPLING_RATE'] ?? '0.1');
  return {
    enabled: process.env['OTEL_ENABLED'] !== 'false',
    serviceName: process.env['OTEL_SERVICE_NAME'] ?? process.env['SERVICE_NAME'] ?? 'cashtrace',
    serviceVersion: process.env['OTEL_SERVICE_VERSION'] ?? '1.0.0',
    environment: process.env['NODE_ENV'] ?? 'development',
    exporterType: (process.env['OTEL_EXPORTER_TYPE'] ?? 'console') as TracingExporter,
    exporterEndpoint: process.env['OTEL_EXPORTER_ENDPOINT'] ?? 'http://localhost:4318/v1/traces',
    samplingRate: Math.max(0, Math.min(1, isNaN(samplingRate) ? 0.1 : samplingRate)),
    propagationFormat: (process.env['OTEL_PROPAGATION_FORMAT'] ?? 'w3c') as PropagationFormat,
    maxSpansPerTrace: parseInt(process.env['OTEL_MAX_SPANS_PER_TRACE'] ?? '1000', 10),
    spanProcessorType: (process.env['OTEL_SPAN_PROCESSOR'] ?? 'batch') as SpanProcessorType,
    batchExportIntervalMs: parseInt(process.env['OTEL_BATCH_EXPORT_INTERVAL_MS'] ?? '5000', 10),
    maxExportBatchSize: parseInt(process.env['OTEL_MAX_EXPORT_BATCH_SIZE'] ?? '512', 10),
  };
}

/**
 * Span kind as defined by OpenTelemetry spec.
 */
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';
export type SpanStatusCode = 'ok' | 'error' | 'unset';
export type SpanAttributes = Record<string, string | number | boolean>;

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export interface SpanData {
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  attributes: SpanAttributes;
  status: SpanStatusCode;
  events: SpanEvent[];
  context: SpanContext;
  parentSpanId?: string;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

/**
 * Abstraction over an OpenTelemetry-compatible span exporter.
 * In production, this would wrap @opentelemetry/sdk-trace-base exporters.
 */
export interface SpanExporter {
  export(spans: SpanData[]): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Trace context propagator for distributed tracing.
 */
export interface ContextPropagator {
  inject(context: SpanContext): Record<string, string>;
  extract(headers: Record<string, string | undefined>): SpanContext | null;
}

export function createSpanExporter(config: OpenTelemetryConfig): SpanExporter {
  switch (config.exporterType) {
    case 'console':
      return createConsoleExporter();
    case 'jaeger':
    case 'otlp':
      return createJaegerExporterFromConfig(config);
    case 'xray':
      return createXRayExporterFromConfig(config);
    case 'none':
    default:
      return createNoopExporter();
  }
}

function createConsoleExporter(): SpanExporter {
  return {
    async export(spans: SpanData[]): Promise<void> {
      for (const span of spans) {
        const duration = span.endTime ? span.endTime - span.startTime : 0;
        console.log(
          JSON.stringify({
            type: 'span',
            traceId: span.context.traceId,
            spanId: span.context.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            kind: span.kind,
            status: span.status,
            durationMs: duration,
            attributes: span.attributes,
            events: span.events,
          }),
        );
      }
    },
    async shutdown(): Promise<void> {
      // No-op
    },
  };
}

function createJaegerExporterFromConfig(config: OpenTelemetryConfig): SpanExporter {
  const inner = createJaegerExporter({
    endpoint: config.exporterEndpoint,
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
    environment: config.environment,
  });
  if (config.spanProcessorType === 'batch') {
    return createBatchingExporter(inner, {
      maxBatchSize: config.maxExportBatchSize,
      flushIntervalMs: config.batchExportIntervalMs,
    });
  }
  return inner;
}

function createXRayExporterFromConfig(config: OpenTelemetryConfig): SpanExporter {
  const inner = createXRayExporter({
    endpoint: config.exporterEndpoint,
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
    environment: config.environment,
  });
  if (config.spanProcessorType === 'batch') {
    return createBatchingExporter(inner, {
      maxBatchSize: config.maxExportBatchSize,
      flushIntervalMs: config.batchExportIntervalMs,
    });
  }
  return inner;
}

function createNoopExporter(): SpanExporter {
  return {
    async export(_spans: SpanData[]): Promise<void> {
      // No-op
    },
    async shutdown(): Promise<void> {
      // No-op
    },
  };
}

/**
 * W3C Trace Context propagator (default).
 */
export function createW3CPropagator(): ContextPropagator {
  return {
    inject(context: SpanContext): Record<string, string> {
      const flags = context.traceFlags.toString(16).padStart(2, '0');
      return {
        traceparent: `00-${context.traceId}-${context.spanId}-${flags}`,
      };
    },
    extract(headers: Record<string, string | undefined>): SpanContext | null {
      const traceparent = headers['traceparent'];
      if (!traceparent) return null;

      const parts = traceparent.split('-');
      if (parts.length !== 4) return null;

      const [, traceId, spanId, flags] = parts;
      if (!traceId || !spanId || !flags) return null;

      return {
        traceId,
        spanId,
        traceFlags: parseInt(flags, 16),
      };
    },
  };
}

/**
 * Creates a context propagator based on the configured format.
 */
export function createContextPropagator(config: OpenTelemetryConfig): ContextPropagator {
  // For now, all formats use W3C-style propagation.
  // In production, B3 and X-Ray would have their own header formats.
  void config;
  return createW3CPropagator();
}
