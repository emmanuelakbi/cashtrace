import { describe, it, expect } from 'vitest';
import { createAnnotationManager, type Annotation, type AnnotationType } from './annotations.js';

// --- Helpers ---

function makeAnnotationInput(overrides?: Partial<Omit<Annotation, 'id'>>): Omit<Annotation, 'id'> {
  return {
    timestamp: Date.now(),
    type: 'deployment',
    title: 'Deploy v1.0.0',
    tags: ['production'],
    ...overrides,
  };
}

// --- Adding and querying annotations ---

describe('adding and querying annotations', () => {
  it('adds an annotation and assigns a unique id', () => {
    const mgr = createAnnotationManager();
    const result = mgr.add(makeAnnotationInput());
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
    expect(result.title).toBe('Deploy v1.0.0');
  });

  it('returns all added annotations via getAll()', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ title: 'A' }));
    mgr.add(makeAnnotationInput({ title: 'B' }));
    const all = mgr.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.title)).toEqual(['A', 'B']);
  });

  it('getAll returns a copy (not the internal array)', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput());
    const all = mgr.getAll();
    all.length = 0;
    expect(mgr.getAll()).toHaveLength(1);
  });

  it('each annotation gets a unique id', () => {
    const mgr = createAnnotationManager();
    const a = mgr.add(makeAnnotationInput());
    const b = mgr.add(makeAnnotationInput());
    expect(a.id).not.toBe(b.id);
  });

  it('query with no filter returns all annotations', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ title: 'X' }));
    mgr.add(makeAnnotationInput({ title: 'Y' }));
    expect(mgr.query()).toHaveLength(2);
  });
});

// --- Filtering by type ---

describe('filtering by type', () => {
  it('filters annotations by type', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ type: 'deployment', title: 'Deploy' }));
    mgr.add(makeAnnotationInput({ type: 'incident', title: 'Outage' }));
    mgr.add(makeAnnotationInput({ type: 'rollback', title: 'Rollback' }));
    mgr.add(makeAnnotationInput({ type: 'config_change', title: 'Config' }));

    expect(mgr.query({ type: 'deployment' })).toHaveLength(1);
    expect(mgr.query({ type: 'incident' })[0].title).toBe('Outage');
    expect(mgr.query({ type: 'rollback' })[0].title).toBe('Rollback');
    expect(mgr.query({ type: 'config_change' })[0].title).toBe('Config');
  });

  it('returns empty array when no annotations match type', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ type: 'deployment' }));
    expect(mgr.query({ type: 'incident' })).toHaveLength(0);
  });
});

// --- Filtering by time range ---

describe('filtering by time range', () => {
  it('filters by startTime', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ timestamp: 1000, title: 'Early' }));
    mgr.add(makeAnnotationInput({ timestamp: 2000, title: 'Late' }));
    const results = mgr.query({ startTime: 1500 });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Late');
  });

  it('filters by endTime', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ timestamp: 1000, title: 'Early' }));
    mgr.add(makeAnnotationInput({ timestamp: 2000, title: 'Late' }));
    const results = mgr.query({ endTime: 1500 });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Early');
  });

  it('filters by both startTime and endTime', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ timestamp: 1000 }));
    mgr.add(makeAnnotationInput({ timestamp: 2000 }));
    mgr.add(makeAnnotationInput({ timestamp: 3000 }));
    const results = mgr.query({ startTime: 1500, endTime: 2500 });
    expect(results).toHaveLength(1);
    expect(results[0].timestamp).toBe(2000);
  });

  it('combines type and time range filters', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ timestamp: 1000, type: 'deployment' }));
    mgr.add(makeAnnotationInput({ timestamp: 2000, type: 'incident' }));
    mgr.add(makeAnnotationInput({ timestamp: 3000, type: 'deployment' }));
    const results = mgr.query({ startTime: 1500, type: 'deployment' });
    expect(results).toHaveLength(1);
    expect(results[0].timestamp).toBe(3000);
  });

  it('inclusive boundaries: exact startTime and endTime match', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ timestamp: 1000 }));
    expect(mgr.query({ startTime: 1000 })).toHaveLength(1);
    expect(mgr.query({ endTime: 1000 })).toHaveLength(1);
    expect(mgr.query({ startTime: 1000, endTime: 1000 })).toHaveLength(1);
  });
});

// --- Grafana payload generation ---

describe('Grafana payload generation', () => {
  it('generates payload with time, tags, and text', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ title: 'Deploy v2', tags: ['prod'], type: 'deployment' }));
    const payloads = mgr.toGrafanaPayloads();
    expect(payloads).toHaveLength(1);
    const p = payloads[0];
    expect(p.time).toBeTypeOf('number');
    expect(p.tags).toContain('deployment');
    expect(p.tags).toContain('prod');
    expect(p.text).toContain('Deploy v2');
  });

  it('includes deployment metadata in text', () => {
    const mgr = createAnnotationManager();
    mgr.add(
      makeAnnotationInput({
        deployment: { version: '2.0.0', commitHash: 'abc123', deployer: 'ci-bot' },
      }),
    );
    const text = mgr.toGrafanaPayloads()[0].text;
    expect(text).toContain('2.0.0');
    expect(text).toContain('abc123');
    expect(text).toContain('ci-bot');
  });

  it('includes incident metadata in text', () => {
    const mgr = createAnnotationManager();
    mgr.add(
      makeAnnotationInput({
        type: 'incident',
        title: 'DB Down',
        incident: { severity: 'critical', status: 'triggered' },
      }),
    );
    const text = mgr.toGrafanaPayloads()[0].text;
    expect(text).toContain('critical');
    expect(text).toContain('triggered');
  });

  it('includes description in text when provided', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ description: 'Hotfix for login bug' }));
    const text = mgr.toGrafanaPayloads()[0].text;
    expect(text).toContain('Hotfix for login bug');
  });

  it('respects filters in toGrafanaPayloads', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ type: 'deployment', timestamp: 1000 }));
    mgr.add(makeAnnotationInput({ type: 'incident', timestamp: 2000 }));
    const payloads = mgr.toGrafanaPayloads({ type: 'incident' });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].tags).toContain('incident');
  });

  it('payloads are JSON-serializable', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput());
    const payloads = mgr.toGrafanaPayloads();
    const json = JSON.stringify(payloads);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].time).toBeTypeOf('number');
  });
});

// --- Display formatting ---

describe('display formatting', () => {
  it('formats annotations for dashboard display', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ timestamp: 1700000000000, title: 'Deploy v3' }));
    const entries = mgr.toDisplayEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].time).toBe(new Date(1700000000000).toISOString());
    expect(entries[0].type).toBe('deployment');
    expect(entries[0].title).toBe('Deploy v3');
    expect(entries[0].details).toContain('Deploy v3');
  });

  it('respects filters in toDisplayEntries', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ type: 'deployment' }));
    mgr.add(makeAnnotationInput({ type: 'incident' }));
    const entries = mgr.toDisplayEntries({ type: 'incident' });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('incident');
  });
});

// --- Deployment and incident metadata ---

describe('deployment and incident metadata', () => {
  it('stores deployment metadata on annotation', () => {
    const mgr = createAnnotationManager();
    const ann = mgr.add(
      makeAnnotationInput({
        deployment: { version: '1.2.3', commitHash: 'deadbeef', deployer: 'alice' },
      }),
    );
    expect(ann.deployment).toEqual({
      version: '1.2.3',
      commitHash: 'deadbeef',
      deployer: 'alice',
    });
  });

  it('stores deployment metadata with optional environment', () => {
    const mgr = createAnnotationManager();
    const ann = mgr.add(
      makeAnnotationInput({
        deployment: {
          version: '1.0.0',
          commitHash: 'aaa',
          deployer: 'bob',
          environment: 'staging',
        },
      }),
    );
    expect(ann.deployment?.environment).toBe('staging');
  });

  it('stores incident metadata on annotation', () => {
    const mgr = createAnnotationManager();
    const ann = mgr.add(
      makeAnnotationInput({
        type: 'incident',
        incident: { severity: 'major', status: 'acknowledged' },
      }),
    );
    expect(ann.incident).toEqual({ severity: 'major', status: 'acknowledged' });
  });
});

// --- Edge cases ---

describe('edge cases', () => {
  it('handles empty manager gracefully', () => {
    const mgr = createAnnotationManager();
    expect(mgr.getAll()).toEqual([]);
    expect(mgr.query()).toEqual([]);
    expect(mgr.toGrafanaPayloads()).toEqual([]);
    expect(mgr.toDisplayEntries()).toEqual([]);
  });

  it('handles annotation with empty tags', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ tags: [] }));
    const payload = mgr.toGrafanaPayloads()[0];
    expect(payload.tags).toContain('deployment');
    expect(payload.tags).toHaveLength(1);
  });

  it('handles annotation with no description', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ description: undefined }));
    const text = mgr.toGrafanaPayloads()[0].text;
    expect(text).toContain('Deploy v1.0.0');
  });

  it('handles annotation with no deployment or incident metadata', () => {
    const mgr = createAnnotationManager();
    const ann = mgr.add(makeAnnotationInput());
    expect(ann.deployment).toBeUndefined();
    expect(ann.incident).toBeUndefined();
  });

  it('query with impossible time range returns empty', () => {
    const mgr = createAnnotationManager();
    mgr.add(makeAnnotationInput({ timestamp: 5000 }));
    expect(mgr.query({ startTime: 6000, endTime: 4000 })).toEqual([]);
  });
});
