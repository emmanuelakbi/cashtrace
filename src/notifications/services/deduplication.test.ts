/**
 * Deduplication Service — Unit Tests
 *
 * Validates dedup key generation, duplicate detection within the 1-hour
 * window, expiry of stale entries, and the clear() helper.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDeduplicationService,
  generateDedupKey,
  type DeduplicationService,
} from './deduplication.js';

describe('generateDedupKey', () => {
  it('should produce a deterministic SHA-256 hex string', () => {
    const key1 = generateDedupKey('user-1', 'tpl-a', { amount: 100 });
    const key2 = generateDedupKey('user-1', 'tpl-a', { amount: 100 });
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should produce different keys for different userIds', () => {
    const key1 = generateDedupKey('user-1', 'tpl-a', { amount: 100 });
    const key2 = generateDedupKey('user-2', 'tpl-a', { amount: 100 });
    expect(key1).not.toBe(key2);
  });

  it('should produce different keys for different templateIds', () => {
    const key1 = generateDedupKey('user-1', 'tpl-a', { amount: 100 });
    const key2 = generateDedupKey('user-1', 'tpl-b', { amount: 100 });
    expect(key1).not.toBe(key2);
  });

  it('should produce different keys for different variables', () => {
    const key1 = generateDedupKey('user-1', 'tpl-a', { amount: 100 });
    const key2 = generateDedupKey('user-1', 'tpl-a', { amount: 200 });
    expect(key1).not.toBe(key2);
  });
});

describe('createDeduplicationService', () => {
  let service: DeduplicationService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = createDeduplicationService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not flag a notification as duplicate when never sent', () => {
    expect(service.isDuplicate('user-1', 'tpl-a', { x: 1 })).toBe(false);
  });

  it('should flag a notification as duplicate after recordSent', () => {
    service.recordSent('user-1', 'tpl-a', { x: 1 });
    expect(service.isDuplicate('user-1', 'tpl-a', { x: 1 })).toBe(true);
  });

  it('should not flag different notifications as duplicates', () => {
    service.recordSent('user-1', 'tpl-a', { x: 1 });
    expect(service.isDuplicate('user-1', 'tpl-b', { x: 1 })).toBe(false);
    expect(service.isDuplicate('user-2', 'tpl-a', { x: 1 })).toBe(false);
    expect(service.isDuplicate('user-1', 'tpl-a', { x: 2 })).toBe(false);
  });

  it('should expire entries after the dedup window (1 hour)', () => {
    service.recordSent('user-1', 'tpl-a', { x: 1 });
    expect(service.isDuplicate('user-1', 'tpl-a', { x: 1 })).toBe(true);

    // Advance time by 1 hour
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(service.isDuplicate('user-1', 'tpl-a', { x: 1 })).toBe(false);
  });

  it('should keep entries that are still within the window', () => {
    service.recordSent('user-1', 'tpl-a', { x: 1 });

    // Advance time by 59 minutes — still within window
    vi.advanceTimersByTime(59 * 60 * 1000);

    expect(service.isDuplicate('user-1', 'tpl-a', { x: 1 })).toBe(true);
  });

  it('should support a custom window duration', () => {
    const shortWindow = createDeduplicationService(5000); // 5 seconds
    shortWindow.recordSent('user-1', 'tpl-a', { x: 1 });
    expect(shortWindow.isDuplicate('user-1', 'tpl-a', { x: 1 })).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(shortWindow.isDuplicate('user-1', 'tpl-a', { x: 1 })).toBe(false);
  });

  it('should clear all records', () => {
    service.recordSent('user-1', 'tpl-a', { x: 1 });
    service.recordSent('user-2', 'tpl-b', { y: 2 });

    service.clear();

    expect(service.isDuplicate('user-1', 'tpl-a', { x: 1 })).toBe(false);
    expect(service.isDuplicate('user-2', 'tpl-b', { y: 2 })).toBe(false);
  });

  it('should allow re-recording after expiry', () => {
    service.recordSent('user-1', 'tpl-a', { x: 1 });
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(service.isDuplicate('user-1', 'tpl-a', { x: 1 })).toBe(false);

    service.recordSent('user-1', 'tpl-a', { x: 1 });
    expect(service.isDuplicate('user-1', 'tpl-a', { x: 1 })).toBe(true);
  });

  it('should handle empty variables object', () => {
    service.recordSent('user-1', 'tpl-a', {});
    expect(service.isDuplicate('user-1', 'tpl-a', {})).toBe(true);
    expect(service.isDuplicate('user-1', 'tpl-a', { x: 1 })).toBe(false);
  });
});
