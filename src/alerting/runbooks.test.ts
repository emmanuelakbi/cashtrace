import { describe, it, expect } from 'vitest';
import { createRunbookRegistry, formatRunbookGuidance, type RunbookEntry } from './runbooks.js';

const sampleRunbook: RunbookEntry = {
  url: 'https://wiki.example.com/runbooks/high-cpu',
  title: 'High CPU Usage',
  steps: [
    'Check top processes with `htop`',
    'Review recent deployments',
    'Scale horizontally if needed',
  ],
};

describe('RunbookRegistry', () => {
  describe('register and get', () => {
    it('stores and retrieves a runbook by alert name', () => {
      const registry = createRunbookRegistry();
      registry.register('high_cpu', sampleRunbook);

      const result = registry.get('high_cpu');
      expect(result).toEqual(sampleRunbook);
    });

    it('overwrites an existing entry on re-register', () => {
      const registry = createRunbookRegistry();
      registry.register('high_cpu', sampleRunbook);

      const updated: RunbookEntry = {
        url: 'https://wiki.example.com/runbooks/high-cpu-v2',
        title: 'High CPU Usage v2',
        steps: ['Step A'],
      };
      registry.register('high_cpu', updated);

      expect(registry.get('high_cpu')).toEqual(updated);
    });

    it('returns undefined for unregistered alert with no default', () => {
      const registry = createRunbookRegistry();
      expect(registry.get('unknown_alert')).toBeUndefined();
    });

    it('makes a defensive copy of the entry on register', () => {
      const registry = createRunbookRegistry();
      const entry: RunbookEntry = { ...sampleRunbook, steps: [...sampleRunbook.steps] };
      registry.register('high_cpu', entry);

      entry.steps.push('Mutated step');
      expect(registry.get('high_cpu')!.steps).not.toContain('Mutated step');
    });
  });

  describe('unregister', () => {
    it('removes a registered runbook and returns true', () => {
      const registry = createRunbookRegistry();
      registry.register('high_cpu', sampleRunbook);

      expect(registry.unregister('high_cpu')).toBe(true);
      expect(registry.get('high_cpu')).toBeUndefined();
    });

    it('returns false when unregistering a non-existent entry', () => {
      const registry = createRunbookRegistry();
      expect(registry.unregister('nope')).toBe(false);
    });
  });

  describe('default / fallback', () => {
    it('returns the default runbook for unregistered alerts', () => {
      const registry = createRunbookRegistry();
      const fallback: RunbookEntry = {
        url: 'https://wiki.example.com/runbooks/general',
        title: 'General Incident Response',
        steps: ['Page on-call engineer', 'Check dashboards'],
      };
      registry.setDefault(fallback);

      expect(registry.get('unknown_alert')).toEqual(fallback);
    });

    it('prefers a specific entry over the default', () => {
      const registry = createRunbookRegistry();
      const fallback: RunbookEntry = {
        url: 'https://wiki.example.com/runbooks/general',
        title: 'General',
        steps: ['Generic step'],
      };
      registry.setDefault(fallback);
      registry.register('high_cpu', sampleRunbook);

      expect(registry.get('high_cpu')).toEqual(sampleRunbook);
    });

    it('getDefault returns undefined when no default is set', () => {
      const registry = createRunbookRegistry();
      expect(registry.getDefault()).toBeUndefined();
    });

    it('getDefault returns the set default', () => {
      const registry = createRunbookRegistry();
      const fallback: RunbookEntry = {
        url: 'https://wiki.example.com/runbooks/general',
        title: 'General',
        steps: [],
      };
      registry.setDefault(fallback);
      expect(registry.getDefault()).toEqual(fallback);
    });
  });

  describe('validation', () => {
    it('throws on empty alert name', () => {
      const registry = createRunbookRegistry();
      expect(() => registry.register('', sampleRunbook)).toThrow('non-empty');
    });

    it('throws on whitespace-only alert name', () => {
      const registry = createRunbookRegistry();
      expect(() => registry.register('   ', sampleRunbook)).toThrow('non-empty');
    });

    it('throws on empty URL', () => {
      const registry = createRunbookRegistry();
      expect(() => registry.register('x', { url: '', title: 'T', steps: [] })).toThrow(
        'non-empty URL',
      );
    });

    it('throws on empty title', () => {
      const registry = createRunbookRegistry();
      expect(() => registry.register('x', { url: 'https://x', title: '', steps: [] })).toThrow(
        'non-empty title',
      );
    });

    it('throws on empty URL for default runbook', () => {
      const registry = createRunbookRegistry();
      expect(() => registry.setDefault({ url: '', title: 'T', steps: [] })).toThrow(
        'non-empty URL',
      );
    });

    it('throws on empty title for default runbook', () => {
      const registry = createRunbookRegistry();
      expect(() => registry.setDefault({ url: 'https://x', title: '', steps: [] })).toThrow(
        'non-empty title',
      );
    });
  });
});

describe('formatRunbookGuidance', () => {
  it('formats a runbook entry with numbered steps', () => {
    const result = formatRunbookGuidance('high_cpu', sampleRunbook);

    expect(result).toContain('Runbook: High CPU Usage');
    expect(result).toContain('URL: https://wiki.example.com/runbooks/high-cpu');
    expect(result).toContain('1. Check top processes with `htop`');
    expect(result).toContain('2. Review recent deployments');
    expect(result).toContain('3. Scale horizontally if needed');
  });

  it('returns a fallback message when entry is undefined', () => {
    const result = formatRunbookGuidance('mystery_alert', undefined);
    expect(result).toContain('No runbook available');
    expect(result).toContain('mystery_alert');
  });

  it('handles a runbook with no steps', () => {
    const entry: RunbookEntry = {
      url: 'https://wiki.example.com/runbooks/empty',
      title: 'Empty Runbook',
      steps: [],
    };
    const result = formatRunbookGuidance('some_alert', entry);

    expect(result).toContain('Runbook: Empty Runbook');
    expect(result).toContain('Remediation steps:');
    // No numbered steps follow
    expect(result).not.toMatch(/\d+\./);
  });

  describe('registry.formatGuidance integration', () => {
    it('uses the registered entry', () => {
      const registry = createRunbookRegistry();
      registry.register('high_cpu', sampleRunbook);

      const result = registry.formatGuidance('high_cpu');
      expect(result).toContain('High CPU Usage');
      expect(result).toContain('1. Check top processes');
    });

    it('uses the default when no specific entry exists', () => {
      const registry = createRunbookRegistry();
      registry.setDefault({
        url: 'https://wiki.example.com/runbooks/general',
        title: 'General',
        steps: ['Page on-call'],
      });

      const result = registry.formatGuidance('unknown');
      expect(result).toContain('General');
      expect(result).toContain('1. Page on-call');
    });

    it('returns fallback text when nothing is registered', () => {
      const registry = createRunbookRegistry();
      const result = registry.formatGuidance('unknown');
      expect(result).toContain('No runbook available');
    });
  });
});
