/**
 * Async local storage for RequestContext propagation.
 *
 * Provides request context access anywhere in the call stack without
 * threading it through function arguments. Uses Node.js AsyncLocalStorage
 * which is stable in Node >= 16.
 *
 * @module gateway/asyncContext
 * @see Requirements: 9.6
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { RequestContext } from './types.js';

/**
 * Singleton AsyncLocalStorage instance for RequestContext.
 * Exported for advanced use cases (e.g. custom middleware).
 */
export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Run a callback within an async context bound to the given RequestContext.
 * All code executed inside the callback (including async continuations)
 * can retrieve the context via {@link getCurrentContext}.
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

/**
 * Retrieve the current RequestContext from async local storage.
 * Returns `undefined` when called outside a `runWithContext` scope.
 */
export function getCurrentContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}
