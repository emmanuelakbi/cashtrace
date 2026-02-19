/**
 * OpenTelemetry Span Exporters
 *
 * Concrete exporter implementations for Jaeger (HTTP) and X-Ray (AWS SDK format).
 * Includes batching and retry logic for reliable span delivery.
 *
 * Requirements: 4.5 (support OpenTelemetry trace format)
 */

import type { SpanData, SpanExporter, SpanKind, SpanStatusCode } from './opentelemetryConfig.js';

// ─── Shared Types ────────────────────────────────────────────────────────────

export interface ExporterConfig {
  /** HTTP endpoint to send spans to */
  endpoint: string;
  /** Service name for resource attribution */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Environment (e.g. 'production', 'staging') */
  environment?: string;
  /** Max retry attempts for failed exports (default: 3) */
  maxRetries?: number;
  /** Base delay in ms between retries, doubled each attempt (default: 1000) */
  retryDelayMs?: number;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Optional headers to include in export requests */
  headers?: Record<string, string>;
}

export interface BatchConfig {
  /** Max spans to accumulate before flushing (default: 512) */
  maxBatchSize: number;
  /** Interval in ms between automatic flushes (default: 5000) */
  flushIntervalMs: number;
}

export interface ExportResult {
  success: boolean;
  spanCount: number;
  error?: string;
}

/**
 * HTTP transport abstraction for testability.
 * In production, this wraps fetch/http. In tests, it can be replaced.
 */
export interface HttpTransport {
  send(
    url: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<HttpResponse>;
}

export interface HttpResponse {
  status: number;
  statusText: string;
}

// ─── OTLP Formatting ────────────────────────────────────────────────────────

/** OTLP span kind numeric values per OpenTelemetry spec */
const SPAN_KIND_MAP: Record<SpanKind, number> = {
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
};

/** OTLP status code numeric values */
const STATUS_CODE_MAP: Record<SpanStatusCode, number> = {
  unset: 0,
  ok: 1,
  error: 2,
};

/**
 * Converts internal SpanData to OTLP-compatible JSON format.
 * This is the standard OpenTelemetry Protocol format used by
 * Jaeger, Zipkin, and other OTLP-compatible backends.
 */
export function formatSpanToOTLP(
  span: SpanData,
  serviceName: string,
  serviceVersion?: string,
  environment?: string,
): OTLPSpan {
  return {
    traceId: span.context.traceId,
    spanId: span.context.spanId,
    parentSpanId: span.parentSpanId ?? '',
    name: span.name,
    kind: SPAN_KIND_MAP[span.kind] ?? 1,
    startTimeUnixNano: span.startTime * 1_000_000,
    endTimeUnixNano: (span.endTime ?? span.startTime) * 1_000_000,
    attributes: objectToOTLPAttributes({
      ...span.attributes,
      'service.name': serviceName,
      ...(serviceVersion != null && { 'service.version': serviceVersion }),
      ...(environment != null && { 'deployment.environment': environment }),
    }),
    status: {
      code: STATUS_CODE_MAP[span.status] ?? 0,
    },
    events: span.events.map((e) => ({
      name: e.name,
      timeUnixNano: e.timestamp * 1_000_000,
      attributes: e.attributes ? objectToOTLPAttributes(e.attributes) : [],
    })),
  };
}

export interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  attributes: OTLPAttribute[];
  status: { code: number };
  events: OTLPEvent[];
}

export interface OTLPAttribute {
  key: string;
  value: OTLPAttributeValue;
}

export interface OTLPAttributeValue {
  stringValue?: string;
  intValue?: number;
  boolValue?: boolean;
}

export interface OTLPEvent {
  name: string;
  timeUnixNano: number;
  attributes: OTLPAttribute[];
}

function objectToOTLPAttributes(attrs: Record<string, string | number | boolean>): OTLPAttribute[] {
  return Object.entries(attrs).map(([key, value]) => {
    const attr: OTLPAttribute = { key, value: {} };
    if (typeof value === 'string') {
      attr.value = { stringValue: value };
    } else if (typeof value === 'number') {
      attr.value = { intValue: value };
    } else if (typeof value === 'boolean') {
      attr.value = { boolValue: value };
    }
    return attr;
  });
}

/**
 * Wraps OTLP spans in the standard OTLP/HTTP JSON envelope.
 */
export function buildOTLPExportPayload(
  otlpSpans: OTLPSpan[],
  serviceName: string,
  serviceVersion?: string,
  environment?: string,
): OTLPExportRequest {
  const resourceAttributes: OTLPAttribute[] = [
    { key: 'service.name', value: { stringValue: serviceName } },
  ];
  if (serviceVersion) {
    resourceAttributes.push({ key: 'service.version', value: { stringValue: serviceVersion } });
  }
  if (environment) {
    resourceAttributes.push({ key: 'deployment.environment', value: { stringValue: environment } });
  }

  return {
    resourceSpans: [
      {
        resource: { attributes: resourceAttributes },
        scopeSpans: [
          {
            scope: { name: serviceName, version: serviceVersion ?? '' },
            spans: otlpSpans,
          },
        ],
      },
    ],
  };
}

export interface OTLPExportRequest {
  resourceSpans: Array<{
    resource: { attributes: OTLPAttribute[] };
    scopeSpans: Array<{
      scope: { name: string; version: string };
      spans: OTLPSpan[];
    }>;
  }>;
}

// ─── X-Ray Formatting ─────────────────────────────────

// ─── X-Ray Formatting ───────────────────────────────────────────────────────

/**
 * Converts internal SpanData to AWS X-Ray segment format.
 * X-Ray uses a different trace ID format and segment structure.
 */
export function formatSpanToXRay(span: SpanData, serviceName: string): XRaySegment {
  const startTimeSec = span.startTime / 1000;
  const endTimeSec = (span.endTime ?? span.startTime) / 1000;

  // X-Ray trace ID format: 1-<8 hex epoch>-<24 hex random>
  const xrayTraceId = convertToXRayTraceId(span.context.traceId, span.startTime);

  const segment: XRaySegment = {
    name: serviceName,
    id: span.context.spanId,
    trace_id: xrayTraceId,
    start_time: startTimeSec,
    end_time: endTimeSec,
    annotations: {},
    metadata: {},
  };

  if (span.parentSpanId) {
    segment.parent_id = span.parentSpanId;
    segment.type = 'subsegment';
  }

  if (span.status === 'error') {
    segment.fault = true;
  }

  // Map span attributes to X-Ray annotations (indexed) and metadata (not indexed)
  for (const [key, value] of Object.entries(span.attributes)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      // X-Ray annotations are indexed and searchable
      segment.annotations[key.replace(/\./g, '_')] = value;
    }
  }

  // Add operation name as annotation
  segment.annotations['operation'] = span.name;

  // Map events to X-Ray metadata
  if (span.events.length > 0) {
    segment.metadata['events'] = span.events.map((e) => ({
      name: e.name,
      timestamp: e.timestamp / 1000,
      attributes: e.attributes ?? {},
    }));
  }

  return segment;
}

export interface XRaySegment {
  name: string;
  id: string;
  trace_id: string;
  start_time: number;
  end_time: number;
  parent_id?: string;
  type?: string;
  fault?: boolean;
  annotations: Record<string, string | number | boolean>;
  metadata: Record<string, unknown>;
}

/**
 * Converts a 32-char hex trace ID to X-Ray format: 1-<8 hex epoch>-<24 hex random>.
 * Uses the span start time for the epoch portion.
 */
export function convertToXRayTraceId(traceId: string, startTimeMs: number): string {
  const epochHex = Math.floor(startTimeMs / 1000)
    .toString(16)
    .padStart(8, '0');
  const randomPart = traceId.substring(0, 24);
  return `1-${epochHex}-${randomPart}`;
}

// ─── Retry Logic ─────────────────────────────────────────────────────────────

/**
 * Executes an async operation with exponential backoff retry.
 * Retries on transient failures (5xx, network errors).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  isRetryable: (error: unknown) => boolean,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determines if an HTTP error is retryable (server errors, timeouts).
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpExportError) {
    return error.status >= 500 || error.status === 429;
  }
  // Network errors are retryable
  return true;
}

export class HttpExportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'HttpExportError';
  }
}

// ─── Default HTTP Transport ──────────────────────────────────────────────────

/**
 * Default HTTP transport using the global fetch API.
 */
export function createDefaultHttpTransport(): HttpTransport {
  return {
    async send(
      url: string,
      body: string,
      headers: Record<string, string>,
      timeoutMs: number,
    ): Promise<HttpResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
        return { status: response.status, statusText: response.statusText };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ─── Jaeger Exporter ─────────────────────────────────────────────────────────

/**
 * Exports spans to Jaeger via OTLP/HTTP JSON protocol.
 * Jaeger natively supports OTLP ingestion at /v1/traces.
 *
 * Features:
 * - OTLP-compatible JSON formatting
 * - Automatic retry with exponential backoff
 * - Configurable timeouts and headers
 */
export function createJaegerExporter(
  config: ExporterConfig,
  transport?: HttpTransport,
): SpanExporter {
  const maxRetries = config.maxRetries ?? 3;
  const retryDelayMs = config.retryDelayMs ?? 1000;
  const timeoutMs = config.timeoutMs ?? 30000;
  const httpTransport = transport ?? createDefaultHttpTransport();
  let isShutdown = false;

  return {
    async export(spans: SpanData[]): Promise<void> {
      if (isShutdown || spans.length === 0) return;

      const otlpSpans = spans.map((s) =>
        formatSpanToOTLP(s, config.serviceName, config.serviceVersion, config.environment),
      );
      const payload = buildOTLPExportPayload(
        otlpSpans,
        config.serviceName,
        config.serviceVersion,
        config.environment,
      );
      const body = JSON.stringify(payload);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...config.headers,
      };

      await withRetry(
        async () => {
          const response = await httpTransport.send(config.endpoint, body, headers, timeoutMs);
          if (response.status >= 400) {
            throw new HttpExportError(
              `Jaeger export failed: ${response.status} ${response.statusText}`,
              response.status,
            );
          }
        },
        maxRetries,
        retryDelayMs,
        isRetryableError,
      );
    },

    async shutdown(): Promise<void> {
      isShutdown = true;
    },
  };
}

// ─── X-Ray Exporter ──────────────────────────────────────────────────────────

/**
 * Exports spans to AWS X-Ray via the PutTraceSegments API.
 * Converts OTLP spans to X-Ray segment documents.
 *
 * Features:
 * - X-Ray segment format conversion
 * - Automatic retry with exponential backoff
 * - AWS SigV4-compatible headers support
 */
export function createXRayExporter(
  config: ExporterConfig,
  transport?: HttpTransport,
): SpanExporter {
  const maxRetries = config.maxRetries ?? 3;
  const retryDelayMs = config.retryDelayMs ?? 1000;
  const timeoutMs = config.timeoutMs ?? 30000;
  const httpTransport = transport ?? createDefaultHttpTransport();
  let isShutdown = false;

  return {
    async export(spans: SpanData[]): Promise<void> {
      if (isShutdown || spans.length === 0) return;

      const segments = spans.map((s) => formatSpanToXRay(s, config.serviceName));
      const body = JSON.stringify({
        TraceSegmentDocuments: segments.map((seg) => JSON.stringify(seg)),
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...config.headers,
      };

      await withRetry(
        async () => {
          const response = await httpTransport.send(config.endpoint, body, headers, timeoutMs);
          if (response.status >= 400) {
            throw new HttpExportError(
              `X-Ray export failed: ${response.status} ${response.statusText}`,
              response.status,
            );
          }
        },
        maxRetries,
        retryDelayMs,
        isRetryableError,
      );
    },

    async shutdown(): Promise<void> {
      isShutdown = true;
    },
  };
}

// ─── Batching Exporter Wrapper ───────────────────────────────────────────────

/**
 * Wraps a SpanExporter with batching logic.
 * Accumulates spans and flushes them either when the batch is full
 * or when the flush interval elapses.
 */
export function createBatchingExporter(
  inner: SpanExporter,
  batchConfig?: Partial<BatchConfig>,
): SpanExporter & { flush(): Promise<void>; pendingCount(): number } {
  const maxBatchSize = batchConfig?.maxBatchSize ?? 512;
  const flushIntervalMs = batchConfig?.flushIntervalMs ?? 5000;
  const buffer: SpanData[] = [];
  let isShutdown = false;
  let flushTimer: ReturnType<typeof setInterval> | null = null;

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    await inner.export(batch);
  }

  // Start periodic flush
  flushTimer = setInterval(() => {
    void flushBuffer();
  }, flushIntervalMs);

  // Prevent the timer from keeping the process alive
  if (flushTimer && typeof flushTimer === 'object' && 'unref' in flushTimer) {
    flushTimer.unref();
  }

  return {
    async export(spans: SpanData[]): Promise<void> {
      if (isShutdown) return;
      buffer.push(...spans);
      if (buffer.length >= maxBatchSize) {
        await flushBuffer();
      }
    },

    async flush(): Promise<void> {
      await flushBuffer();
    },

    pendingCount(): number {
      return buffer.length;
    },

    async shutdown(): Promise<void> {
      isShutdown = true;
      if (flushTimer !== null) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      await flushBuffer();
      await inner.shutdown();
    },
  };
}
