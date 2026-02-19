/**
 * Sentry Integration
 *
 * Provides an abstraction layer for exporting errors to Sentry. The adapter
 * plugs into the error tracker's `onError` callback and formats errors with
 * context, fingerprint, and severity mapping suitable for Sentry ingestion.
 *
 * The design uses a `SentryTransport` interface so the real Sentry SDK can be
 * swapped in for production while tests use a lightweight in-memory transport.
 *
 * Requirements: 5.6 (integrate with error tracking service - Sentry)
 *
 * @module logging/sentryIntegration
 */

import type { ErrorSeverity, TrackedError } from './errorTracker.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Sentry severity levels as defined by the Sentry protocol. */
export type SentrySeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

/** Configuration for the Sentry integration. */
export interface SentryConfig {
  /** Sentry DSN (Data Source Name) for the project. */
  dsn: string;
  /** Deployment environment (e.g. 'production', 'staging', 'development'). */
  environment: string;
  /** Application release/version identifier. */
  release?: string;
  /** Whether the integration is enabled. Defaults to true. */
  enabled?: boolean;
}

/** A Sentry event payload ready for transport. */
export interface SentryEvent {
  /** Error message. */
  message: string;
  /** Sentry severity level. */
  level: SentrySeverity;
  /** Fingerprint used by Sentry for grouping. */
  fingerprint: string[];
  /** Error name / type. */
  errorType: string;
  /** Full stack trace. */
  stackTrace: string;
  /** Deployment environment. */
  environment: string;
  /** Application release. */
  release?: string;
  /** Structured tags for filtering in Sentry. */
  tags: Record<string, string>;
  /** Extra context data attached to the event. */
  extra: Record<string, unknown>;
  /** Timestamp of the event (ISO 8601). */
  timestamp: string;
}

/**
 * Transport interface that abstracts the actual Sentry SDK.
 * Implement this with the real `@sentry/node` SDK for production,
 * or use the in-memory transport for testing.
 */
export interface SentryTransport {
  /** Send an event to Sentry. Returns true if accepted. */
  sendEvent(event: SentryEvent): boolean;
}

/** The Sentry adapter that can be used as an `onError` callback. */
export interface SentryAdapter {
  /** Handle a tracked error — formats and sends it to Sentry. */
  handleError(tracked: TrackedError): SentryEvent | null;
  /** Get the current configuration. */
  readonly config: Readonly<SentryConfig>;
  /** Whether the adapter is currently enabled. */
  readonly enabled: boolean;
}

// ─── Severity Mapping ────────────────────────────────────────────────────────

/** Map internal ErrorSeverity to Sentry severity levels. */
export function mapSeverity(severity: ErrorSeverity): SentrySeverity {
  switch (severity) {
    case 'critical':
      return 'fatal';
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
      return 'info';
    default:
      return 'error';
  }
}

// ─── Event Formatting ────────────────────────────────────────────────────────

/** Build a Sentry event from a TrackedError and config. */
export function formatSentryEvent(tracked: TrackedError, config: SentryConfig): SentryEvent {
  const tags: Record<string, string> = {
    errorType: tracked.name,
    severity: tracked.severity,
  };

  const extra: Record<string, unknown> = {
    count: tracked.count,
    firstOccurrence: tracked.firstOccurrence.toISOString(),
    lastOccurrence: tracked.lastOccurrence.toISOString(),
  };

  if (tracked.lastContext) {
    if (tracked.lastContext.correlationId) {
      tags['correlationId'] = tracked.lastContext.correlationId;
    }
    if (tracked.lastContext.userId) {
      tags['userId'] = tracked.lastContext.userId;
    }
    if (tracked.lastContext.businessId) {
      tags['businessId'] = tracked.lastContext.businessId;
    }
    if (tracked.lastContext.service) {
      tags['service'] = tracked.lastContext.service;
    }
    if (tracked.lastContext.operation) {
      tags['operation'] = tracked.lastContext.operation;
    }
    if (tracked.lastContext.request) {
      extra['request'] = tracked.lastContext.request;
    }
  }

  return {
    message: tracked.message,
    level: mapSeverity(tracked.severity),
    fingerprint: [tracked.fingerprint],
    errorType: tracked.name,
    stackTrace: tracked.stack,
    environment: config.environment,
    release: config.release,
    tags,
    extra,
    timestamp: tracked.lastOccurrence.toISOString(),
  };
}

// ─── In-Memory Transport (for testing) ───────────────────────────────────────

/** A simple in-memory transport that stores events for inspection. */
export function createInMemoryTransport(): SentryTransport & { events: SentryEvent[] } {
  const events: SentryEvent[] = [];
  return {
    events,
    sendEvent(event: SentryEvent): boolean {
      events.push(event);
      return true;
    },
  };
}

// ─── Adapter Factory ─────────────────────────────────────────────────────────

/**
 * Validate a Sentry DSN format. A valid DSN looks like:
 * `https://<key>@<host>/<project-id>`
 */
export function isValidDsn(dsn: string): boolean {
  try {
    const url = new URL(dsn);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username.length > 0 &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

/**
 * Create a Sentry adapter that formats and sends errors via the provided transport.
 *
 * Usage with the error tracker:
 * ```ts
 * const transport = createInMemoryTransport(); // or real Sentry SDK transport
 * const adapter = createSentryAdapter(config, transport);
 * const tracker = createErrorTracker({ onError: adapter.handleError });
 * ```
 */
export function createSentryAdapter(
  config: SentryConfig,
  transport: SentryTransport,
): SentryAdapter {
  if (!isValidDsn(config.dsn)) {
    throw new Error(`Invalid Sentry DSN: ${config.dsn}`);
  }

  const isEnabled = config.enabled !== false;

  return {
    handleError(tracked: TrackedError): SentryEvent | null {
      if (!isEnabled) return null;
      const event = formatSentryEvent(tracked, config);
      transport.sendEvent(event);
      return event;
    },

    get config(): Readonly<SentryConfig> {
      return config;
    },

    get enabled(): boolean {
      return isEnabled;
    },
  };
}
