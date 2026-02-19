/**
 * Error Tracker
 *
 * Captures unhandled exceptions with full stack traces, groups similar errors
 * to reduce noise, and tracks error frequency and occurrence times.
 *
 * Requirements: 5.1 (capture unhandled exceptions with full stack traces),
 *               5.2 (group similar errors to reduce noise),
 *               5.4 (track error frequency and first/last occurrence),
 *               5.5 (support error severity classification)
 *
 * @module logging/errorTracker
 */

import { createHash } from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * HTTP request context captured alongside an error.
 * Requirements: 5.3 (include request context with error reports)
 */
export interface RequestContext {
  /** HTTP method (GET, POST, etc.) */
  method?: string;
  /** Request path / URL */
  path?: string;
  /** Sanitized request headers (sensitive headers stripped) */
  headers?: Record<string, string>;
  /** Query parameters */
  query?: Record<string, string>;
  /** Client IP address */
  ip?: string;
}

/** Headers that are stripped from request context to avoid leaking secrets. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

/**
 * Extract a sanitized {@link RequestContext} from an Express-like request object.
 * Strips sensitive headers and normalises values to plain strings.
 *
 * Requirements: 5.3
 */
export function extractRequestContext(req: {
  method?: string;
  path?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  ip?: string;
}): RequestContext {
  const headers: Record<string, string> = {};
  if (req.headers) {
    for (const [key, value] of Object.entries(req.headers)) {
      if (SENSITIVE_HEADERS.has(key.toLowerCase())) continue;
      if (value === undefined) continue;
      headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  const query: Record<string, string> = {};
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (value !== undefined && value !== null) {
        query[key] = String(value);
      }
    }
  }

  return {
    method: req.method,
    path: req.path ?? req.url,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    query: Object.keys(query).length > 0 ? query : undefined,
    ip: req.ip,
  };
}

export interface ErrorContext {
  correlationId?: string;
  userId?: string;
  businessId?: string;
  service?: string;
  operation?: string;
  /** HTTP request context captured at the time of the error */
  request?: RequestContext;
  [key: string]: unknown;
}

export interface TrackedError {
  /** Unique fingerprint used to group similar errors */
  fingerprint: string;
  /** Error name/type (e.g. TypeError, RangeError) */
  name: string;
  /** Error message */
  message: string;
  /** Full stack trace */
  stack: string;
  /** Severity classification */
  severity: ErrorSeverity;
  /** Number of times this error has occurred */
  count: number;
  /** Timestamp of first occurrence */
  firstOccurrence: Date;
  /** Timestamp of most recent occurrence */
  lastOccurrence: Date;
  /** Context from the most recent occurrence */
  lastContext?: ErrorContext;
}

export interface ErrorTrackerOptions {
  /** Maximum number of distinct error groups to track. Defaults to 1000. */
  maxGroups?: number;
  /** Default severity for errors without explicit classification. Defaults to 'medium'. */
  defaultSeverity?: ErrorSeverity;
  /** Custom severity classifier. Receives the error and returns a severity level. */
  severityClassifier?: (error: Error) => ErrorSeverity;
  /** Callback invoked when a new error is captured. */
  onError?: (tracked: TrackedError) => void;
}

export interface ErrorTracker {
  /** Capture an error with optional context and severity override. */
  capture(error: Error, context?: ErrorContext, severity?: ErrorSeverity): TrackedError;
  /** Get a tracked error group by its fingerprint. */
  get(fingerprint: string): TrackedError | undefined;
  /** Get all tracked error groups. */
  getAll(): TrackedError[];
  /** Query errors by severity. */
  getBySeverity(severity: ErrorSeverity): TrackedError[];
  /** Get the top N most frequent errors. */
  getTopErrors(limit: number): TrackedError[];
  /** Query errors whose last context matches a given correlationId. */
  getByCorrelationId(correlationId: string): TrackedError[];
  /** Query errors whose last context matches a given userId. */
  getByUserId(userId: string): TrackedError[];
  /** Query errors that occurred within a time range. */
  getByTimeRange(start: Date, end: Date): TrackedError[];
  /** Clear all tracked errors. */
  clear(): void;
  /** Total number of distinct error groups. */
  readonly size: number;
}

// ─── Fingerprinting ──────────────────────────────────────────────────────────

/**
 * Generate a fingerprint for an error by hashing its name, message, and the
 * first meaningful stack frame. This groups errors that originate from the
 * same location with the same type/message.
 */
export function generateFingerprint(error: Error): string {
  const name = error.name || 'Error';
  const message = error.message || '';
  const stackFrame = extractFirstStackFrame(error.stack ?? '');
  const raw = `${name}:${message}:${stackFrame}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * Extract the first meaningful stack frame (skipping the error message line).
 * Returns an empty string if no frame is found.
 */
export function extractFirstStackFrame(stack: string): string {
  const lines = stack.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('at ')) {
      return trimmed;
    }
  }
  return '';
}

// ─── Implementation ──────────────────────────────────────────────────────────

export function createErrorTracker(options: ErrorTrackerOptions = {}): ErrorTracker {
  const maxGroups = options.maxGroups ?? 1000;
  const defaultSeverity = options.defaultSeverity ?? 'medium';
  const severityClassifier = options.severityClassifier;
  const onError = options.onError;

  const errors = new Map<string, TrackedError>();

  function classifySeverity(error: Error, explicitSeverity?: ErrorSeverity): ErrorSeverity {
    if (explicitSeverity) return explicitSeverity;
    if (severityClassifier) return severityClassifier(error);
    return defaultSeverity;
  }

  function capture(error: Error, context?: ErrorContext, severity?: ErrorSeverity): TrackedError {
    const fingerprint = generateFingerprint(error);
    const now = new Date();
    const resolvedSeverity = classifySeverity(error, severity);

    const existing = errors.get(fingerprint);
    if (existing) {
      existing.count += 1;
      existing.lastOccurrence = now;
      existing.severity = resolvedSeverity;
      if (context) existing.lastContext = context;
      if (onError) onError(existing);
      return existing;
    }

    // Evict oldest group if at capacity
    if (errors.size >= maxGroups) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [key, tracked] of errors) {
        if (tracked.lastOccurrence.getTime() < oldestTime) {
          oldestTime = tracked.lastOccurrence.getTime();
          oldestKey = key;
        }
      }
      if (oldestKey) errors.delete(oldestKey);
    }

    const tracked: TrackedError = {
      fingerprint,
      name: error.name || 'Error',
      message: error.message || '',
      stack: error.stack ?? '',
      severity: resolvedSeverity,
      count: 1,
      firstOccurrence: now,
      lastOccurrence: now,
      lastContext: context,
    };

    errors.set(fingerprint, tracked);
    if (onError) onError(tracked);
    return tracked;
  }

  return {
    capture,

    get(fingerprint: string): TrackedError | undefined {
      return errors.get(fingerprint);
    },

    getAll(): TrackedError[] {
      return Array.from(errors.values());
    },

    getBySeverity(severity: ErrorSeverity): TrackedError[] {
      return Array.from(errors.values()).filter((e) => e.severity === severity);
    },

    getTopErrors(limit: number): TrackedError[] {
      return Array.from(errors.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    },

    getByCorrelationId(correlationId: string): TrackedError[] {
      return Array.from(errors.values()).filter(
        (e) => e.lastContext?.correlationId === correlationId,
      );
    },

    getByUserId(userId: string): TrackedError[] {
      return Array.from(errors.values()).filter((e) => e.lastContext?.userId === userId);
    },

    getByTimeRange(start: Date, end: Date): TrackedError[] {
      const startMs = start.getTime();
      const endMs = end.getTime();
      return Array.from(errors.values()).filter((e) => {
        const lastMs = e.lastOccurrence.getTime();
        return lastMs >= startMs && lastMs <= endMs;
      });
    },

    clear(): void {
      errors.clear();
    },

    get size(): number {
      return errors.size;
    },
  };
}
