import { describe, it, expect, beforeEach } from 'vitest';
import type { LogEntry } from './logger.js';
import { createLogIndex } from './logIndex.js';
import type { LogIndex } from './logIndex.js';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2024-06-15T10:00:00.000Z',
    level: 'info',
    message: 'test',
    service: 'cashtrace',
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe('LogIndex', () => {
  let index: LogIndex;

  beforeEach(() => {
    index = createLogIndex();
  });

  // ─── Basic indexing ──────────────────────────────────────────────────

  it('starts empty', () => {
    expect(index.size()).toBe(0);
    expect(index.query({})).toEqual([]);
  });

  it('indexes and retrieves entries', () => {
    const entry = makeEntry();
    index.add(entry);
    expect(index.size()).toBe(1);
    expect(index.query({})).toEqual([entry]);
  });

  // ─── Query by single field ──────────────────────────────────────────

  it('queries by correlationId', () => {
    const a = makeEntry({ correlationId: 'c-1' });
    const b = makeEntry({ correlationId: 'c-2' });
    index.add(a);
    index.add(b);

    expect(index.query({ correlationId: 'c-1' })).toEqual([a]);
    expect(index.query({ correlationId: 'c-2' })).toEqual([b]);
  });

  it('queries by userId', () => {
    const a = makeEntry({ userId: 'u-1' });
    const b = makeEntry({ userId: 'u-2' });
    const c = makeEntry(); // no userId
    index.add(a);
    index.add(b);
    index.add(c);

    expect(index.query({ userId: 'u-1' })).toEqual([a]);
    expect(index.query({ userId: 'u-2' })).toEqual([b]);
  });

  it('queries by level', () => {
    const info = makeEntry({ level: 'info' });
    const err = makeEntry({ level: 'error' });
    index.add(info);
    index.add(err);

    expect(index.query({ level: 'error' })).toEqual([err]);
  });

  it('queries by service', () => {
    const a = makeEntry({ service: 'auth' });
    const b = makeEntry({ service: 'payments' });
    index.add(a);
    index.add(b);

    expect(index.query({ service: 'auth' })).toEqual([a]);
  });

  // ─── Time range queries ─────────────────────────────────────────────

  it('queries by time range', () => {
    const early = makeEntry({ timestamp: '2024-06-15T08:00:00.000Z' });
    const mid = makeEntry({ timestamp: '2024-06-15T12:00:00.000Z' });
    const late = makeEntry({ timestamp: '2024-06-15T18:00:00.000Z' });
    index.add(early);
    index.add(mid);
    index.add(late);

    const results = index.query({
      startTime: '2024-06-15T10:00:00.000Z',
      endTime: '2024-06-15T14:00:00.000Z',
    });
    expect(results).toEqual([mid]);
  });

  it('startTime is inclusive', () => {
    const entry = makeEntry({ timestamp: '2024-06-15T10:00:00.000Z' });
    index.add(entry);

    expect(index.query({ startTime: '2024-06-15T10:00:00.000Z' })).toEqual([entry]);
  });

  it('endTime is inclusive', () => {
    const entry = makeEntry({ timestamp: '2024-06-15T10:00:00.000Z' });
    index.add(entry);

    expect(index.query({ endTime: '2024-06-15T10:00:00.000Z' })).toEqual([entry]);
  });

  // ─── Compound queries ───────────────────────────────────────────────

  it('compound query: userId + time range', () => {
    const match = makeEntry({
      userId: 'u-1',
      timestamp: '2024-06-15T12:00:00.000Z',
    });
    const wrongUser = makeEntry({
      userId: 'u-2',
      timestamp: '2024-06-15T12:00:00.000Z',
    });
    const wrongTime = makeEntry({
      userId: 'u-1',
      timestamp: '2024-06-15T08:00:00.000Z',
    });
    index.add(match);
    index.add(wrongUser);
    index.add(wrongTime);

    const results = index.query({
      userId: 'u-1',
      startTime: '2024-06-15T10:00:00.000Z',
      endTime: '2024-06-15T14:00:00.000Z',
    });
    expect(results).toEqual([match]);
  });

  it('compound query: correlationId + level', () => {
    const match = makeEntry({ correlationId: 'c-1', level: 'error' });
    const wrongLevel = makeEntry({ correlationId: 'c-1', level: 'info' });
    const wrongCorr = makeEntry({ correlationId: 'c-2', level: 'error' });
    index.add(match);
    index.add(wrongLevel);
    index.add(wrongCorr);

    expect(index.query({ correlationId: 'c-1', level: 'error' })).toEqual([match]);
  });

  it('compound query: service + level + time range', () => {
    const match = makeEntry({
      service: 'auth',
      level: 'error',
      timestamp: '2024-06-15T12:00:00.000Z',
    });
    const wrongService = makeEntry({
      service: 'payments',
      level: 'error',
      timestamp: '2024-06-15T12:00:00.000Z',
    });
    index.add(match);
    index.add(wrongService);

    expect(
      index.query({
        service: 'auth',
        level: 'error',
        startTime: '2024-06-15T10:00:00.000Z',
        endTime: '2024-06-15T14:00:00.000Z',
      }),
    ).toEqual([match]);
  });

  // ─── Edge cases ─────────────────────────────────────────────────────

  it('returns empty array when no matches', () => {
    index.add(makeEntry({ correlationId: 'c-1' }));
    expect(index.query({ correlationId: 'nonexistent' })).toEqual([]);
  });

  it('returns empty for userId query when no entries have userId', () => {
    index.add(makeEntry()); // no userId
    expect(index.query({ userId: 'u-1' })).toEqual([]);
  });

  it('clear removes all entries', () => {
    index.add(makeEntry());
    index.add(makeEntry());
    expect(index.size()).toBe(2);

    index.clear();
    expect(index.size()).toBe(0);
    expect(index.query({})).toEqual([]);
  });

  it('handles multiple entries with same correlationId', () => {
    const a = makeEntry({ correlationId: 'c-1', message: 'first' });
    const b = makeEntry({ correlationId: 'c-1', message: 'second' });
    index.add(a);
    index.add(b);

    expect(index.query({ correlationId: 'c-1' })).toEqual([a, b]);
  });
});
