/**
 * Mock providers for notification system testing.
 *
 * Provides in-memory mock implementations of email, push, and Redis
 * providers with tracking capabilities for assertions.
 *
 * @module notifications/test/mockProviders
 */

import { v4 as uuidv4 } from 'uuid';

import type { DeliveryResult, DeliveryStatus, EmailMessage } from '../types/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SentEmail {
  message: EmailMessage;
  result: DeliveryResult;
  sentAt: Date;
}

export interface SentPush {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
  result: DeliveryResult;
  sentAt: Date;
}

export interface MockEmailProvider {
  send(message: EmailMessage): Promise<DeliveryResult>;
  getSentEmails(): SentEmail[];
  getLastEmail(): SentEmail | undefined;
  clear(): void;
  setShouldFail(fail: boolean): void;
}

export interface MockPushProvider {
  send(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<DeliveryResult>;
  getSentPushes(): SentPush[];
  getLastPush(): SentPush | undefined;
  clear(): void;
  setShouldFail(fail: boolean): void;
  setInvalidTokens(tokens: Set<string>): void;
}

export interface MockRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: string[]): Promise<string>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  zadd(key: string, score: string, member: string): Promise<number>;
  zpopmin(key: string, count: number): Promise<string[]>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zcard(key: string): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  pipeline(): MockRedisPipeline;
  clear(): void;
}

export interface MockRedisPipeline {
  set(key: string, value: string): MockRedisPipeline;
  del(...keys: string[]): MockRedisPipeline;
  zadd(key: string, score: string, member: string): MockRedisPipeline;
  srem(key: string, ...members: string[]): MockRedisPipeline;
  exec(): Promise<Array<[Error | null, unknown]>>;
}

// ─── Mock Email Provider ─────────────────────────────────────────────────────

/** Create a mock email provider that tracks sent emails in memory. */
export function createMockEmailProvider(): MockEmailProvider {
  const sentEmails: SentEmail[] = [];
  let shouldFail = false;

  return {
    async send(message: EmailMessage): Promise<DeliveryResult> {
      const status: DeliveryStatus = shouldFail ? 'failed' : 'sent';
      const result: DeliveryResult = {
        messageId: uuidv4(),
        status,
        timestamp: new Date(),
      };
      sentEmails.push({ message, result, sentAt: new Date() });
      return result;
    },

    getSentEmails(): SentEmail[] {
      return [...sentEmails];
    },

    getLastEmail(): SentEmail | undefined {
      return sentEmails[sentEmails.length - 1];
    },

    clear(): void {
      sentEmails.length = 0;
    },

    setShouldFail(fail: boolean): void {
      shouldFail = fail;
    },
  };
}

// ─── Mock Push Provider ──────────────────────────────────────────────────────

/** Create a mock push provider that tracks sent pushes in memory. */
export function createMockPushProvider(): MockPushProvider {
  const sentPushes: SentPush[] = [];
  let shouldFail = false;
  let invalidTokens = new Set<string>();

  return {
    async send(
      token: string,
      title: string,
      body: string,
      data: Record<string, string> = {},
    ): Promise<DeliveryResult> {
      const isInvalid = invalidTokens.has(token);
      const status: DeliveryStatus = shouldFail || isInvalid ? 'failed' : 'sent';
      const result: DeliveryResult = {
        messageId: uuidv4(),
        status,
        timestamp: new Date(),
      };
      sentPushes.push({ token, title, body, data, result, sentAt: new Date() });
      return result;
    },

    getSentPushes(): SentPush[] {
      return [...sentPushes];
    },

    getLastPush(): SentPush | undefined {
      return sentPushes[sentPushes.length - 1];
    },

    clear(): void {
      sentPushes.length = 0;
    },

    setShouldFail(fail: boolean): void {
      shouldFail = fail;
    },

    setInvalidTokens(tokens: Set<string>): void {
      invalidTokens = tokens;
    },
  };
}

// ─── Mock Redis ──────────────────────────────────────────────────────────────

/** Create a minimal in-memory Redis mock for queue testing. */
export function createMockRedis(): MockRedis {
  const store = new Map<string, string>();
  const sortedSets = new Map<string, Array<{ score: number; member: string }>>();
  const sets = new Map<string, Set<string>>();

  function getSortedSet(key: string): Array<{ score: number; member: string }> {
    if (!sortedSets.has(key)) {
      sortedSets.set(key, []);
    }
    return sortedSets.get(key)!;
  }

  function getSet(key: string): Set<string> {
    if (!sets.has(key)) {
      sets.set(key, new Set());
    }
    return sets.get(key)!;
  }

  function createPipeline(): MockRedisPipeline {
    const ops: Array<() => void> = [];

    const pipeline: MockRedisPipeline = {
      set(key: string, value: string): MockRedisPipeline {
        ops.push(() => store.set(key, value));
        return pipeline;
      },

      del(...keys: string[]): MockRedisPipeline {
        ops.push(() => {
          for (const key of keys) {
            store.delete(key);
          }
        });
        return pipeline;
      },

      zadd(key: string, score: string, member: string): MockRedisPipeline {
        ops.push(() => {
          const ss = getSortedSet(key);
          ss.push({ score: parseFloat(score), member });
          ss.sort((a, b) => a.score - b.score);
        });
        return pipeline;
      },

      srem(key: string, ...members: string[]): MockRedisPipeline {
        ops.push(() => {
          const s = getSet(key);
          for (const m of members) {
            s.delete(m);
          }
        });
        return pipeline;
      },

      async exec(): Promise<Array<[Error | null, unknown]>> {
        const results: Array<[Error | null, unknown]> = [];
        for (const op of ops) {
          op();
          results.push([null, 'OK']);
        }
        return results;
      },
    };

    return pipeline;
  }

  return {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },

    async set(key: string, value: string): Promise<string> {
      store.set(key, value);
      return 'OK';
    },

    async del(...keys: string[]): Promise<number> {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    },

    async incr(key: string): Promise<number> {
      const current = parseInt(store.get(key) ?? '0', 10);
      const next = current + 1;
      store.set(key, next.toString());
      return next;
    },

    async expire(_key: string, _seconds: number): Promise<number> {
      // No-op for in-memory mock; key exists check only
      return store.has(_key) ? 1 : 0;
    },

    async zadd(key: string, score: string, member: string): Promise<number> {
      const ss = getSortedSet(key);
      ss.push({ score: parseFloat(score), member });
      ss.sort((a, b) => a.score - b.score);
      return 1;
    },

    async zpopmin(key: string, count: number): Promise<string[]> {
      const ss = getSortedSet(key);
      const popped = ss.splice(0, count);
      const result: string[] = [];
      for (const item of popped) {
        result.push(item.member, item.score.toString());
      }
      return result;
    },

    async zrange(key: string, start: number, stop: number): Promise<string[]> {
      const ss = getSortedSet(key);
      const end = stop < 0 ? ss.length + stop + 1 : stop + 1;
      return ss.slice(start, end).map((item) => item.member);
    },

    async zcard(key: string): Promise<number> {
      return getSortedSet(key).length;
    },

    async sadd(key: string, ...members: string[]): Promise<number> {
      const s = getSet(key);
      let added = 0;
      for (const m of members) {
        if (!s.has(m)) {
          s.add(m);
          added++;
        }
      }
      return added;
    },

    async srem(key: string, ...members: string[]): Promise<number> {
      const s = getSet(key);
      let removed = 0;
      for (const m of members) {
        if (s.delete(m)) removed++;
      }
      return removed;
    },

    pipeline(): MockRedisPipeline {
      return createPipeline();
    },

    clear(): void {
      store.clear();
      sortedSets.clear();
      sets.clear();
    },
  };
}
