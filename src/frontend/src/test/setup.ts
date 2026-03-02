import '@testing-library/jest-dom/vitest';

// Polyfill localStorage for jsdom environments where the Web Storage API
// is not fully implemented (e.g., Node.js 20+ built-in localStorage leaks
// through without setItem/getItem methods).
if (typeof window !== 'undefined' && typeof window.localStorage.setItem !== 'function') {
  const store = new Map<string, string>();

  const localStoragePolyfill: Storage = {
    get length(): number {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    key(index: number): string | null {
      const keys = [...store.keys()];
      return keys[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  };

  Object.defineProperty(window, 'localStorage', {
    value: localStoragePolyfill,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStoragePolyfill,
    writable: true,
    configurable: true,
  });
}
