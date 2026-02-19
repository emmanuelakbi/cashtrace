/**
 * Runbook Registry
 *
 * Maps alert names to structured runbook information (URL, title, remediation
 * steps) and provides a formatter that produces human-readable guidance text
 * for inclusion in alert notifications.
 *
 * Requirements: 6.5 (include runbook links in alert notifications)
 *
 * @module alerting/runbooks
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunbookEntry {
  /** URL to the full runbook document. */
  url: string;
  /** Short title describing the runbook. */
  title: string;
  /** Ordered remediation steps an operator should follow. */
  steps: string[];
}

export interface RunbookRegistry {
  /** Register a runbook for a given alert name. Overwrites if already present. */
  register(alertName: string, entry: RunbookEntry): void;
  /** Remove a runbook registration. Returns true if it existed. */
  unregister(alertName: string): boolean;
  /** Look up the runbook for an alert name, or the default fallback. */
  get(alertName: string): RunbookEntry | undefined;
  /** Format human-readable remediation guidance for an alert name. */
  formatGuidance(alertName: string): string;
  /** Set a default/fallback runbook used when no specific entry exists. */
  setDefault(entry: RunbookEntry): void;
  /** Return the default runbook, if one has been set. */
  getDefault(): RunbookEntry | undefined;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a RunbookEntry into human-readable remediation text.
 * Returns an empty string if entry is undefined.
 */
export function formatRunbookGuidance(alertName: string, entry: RunbookEntry | undefined): string {
  if (!entry) {
    return `No runbook available for "${alertName}". Please investigate manually.`;
  }

  const lines: string[] = [
    `Runbook: ${entry.title}`,
    `URL: ${entry.url}`,
    '',
    'Remediation steps:',
  ];

  entry.steps.forEach((step, i) => {
    lines.push(`  ${i + 1}. ${step}`);
  });

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRunbookRegistry(): RunbookRegistry {
  const entries = new Map<string, RunbookEntry>();
  let defaultEntry: RunbookEntry | undefined;

  return {
    register(alertName: string, entry: RunbookEntry): void {
      if (!alertName || alertName.trim().length === 0) {
        throw new Error('Alert name must be a non-empty string');
      }
      if (!entry.url || entry.url.trim().length === 0) {
        throw new Error('Runbook entry must have a non-empty URL');
      }
      if (!entry.title || entry.title.trim().length === 0) {
        throw new Error('Runbook entry must have a non-empty title');
      }
      entries.set(alertName, { ...entry, steps: [...entry.steps] });
    },

    unregister(alertName: string): boolean {
      return entries.delete(alertName);
    },

    get(alertName: string): RunbookEntry | undefined {
      return entries.get(alertName) ?? defaultEntry;
    },

    formatGuidance(alertName: string): string {
      const entry = entries.get(alertName) ?? defaultEntry;
      return formatRunbookGuidance(alertName, entry);
    },

    setDefault(entry: RunbookEntry): void {
      if (!entry.url || entry.url.trim().length === 0) {
        throw new Error('Default runbook must have a non-empty URL');
      }
      if (!entry.title || entry.title.trim().length === 0) {
        throw new Error('Default runbook must have a non-empty title');
      }
      defaultEntry = { ...entry, steps: [...entry.steps] };
    },

    getDefault(): RunbookEntry | undefined {
      return defaultEntry;
    },
  };
}
