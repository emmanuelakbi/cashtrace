import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isServiceWorkerSupported, register, unregister } from './serviceWorkerRegistration';

describe('serviceWorkerRegistration', () => {
  const originalNavigator = globalThis.navigator;
  const originalLocation = window.location;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  describe('isServiceWorkerSupported', () => {
    it('returns false when navigator is undefined', () => {
      // In jsdom navigator exists, so we simulate absence by removing serviceWorker
      const nav = { ...navigator };
      delete (nav as Record<string, unknown>).serviceWorker;
      Object.defineProperty(globalThis, 'navigator', {
        value: nav,
        writable: true,
        configurable: true,
      });
      expect(isServiceWorkerSupported()).toBe(false);
    });

    it('returns true on localhost with serviceWorker support', () => {
      const mockSW = {};
      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, serviceWorker: mockSW },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost', protocol: 'http:' },
        writable: true,
        configurable: true,
      });
      expect(isServiceWorkerSupported()).toBe(true);
    });

    it('returns true on HTTPS origins', () => {
      const mockSW = {};
      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, serviceWorker: mockSW },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'location', {
        value: { hostname: 'app.cashtrace.ng', protocol: 'https:' },
        writable: true,
        configurable: true,
      });
      expect(isServiceWorkerSupported()).toBe(true);
    });

    it('returns false on non-localhost HTTP', () => {
      const mockSW = {};
      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, serviceWorker: mockSW },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.com', protocol: 'http:' },
        writable: true,
        configurable: true,
      });
      expect(isServiceWorkerSupported()).toBe(false);
    });
  });

  describe('register', () => {
    it('calls navigator.serviceWorker.register with /sw.js', async () => {
      const mockRegistration = {
        installing: null,
        addEventListener: vi.fn(),
      };
      const registerFn = vi.fn().mockResolvedValue(mockRegistration);

      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, serviceWorker: { register: registerFn, controller: null } },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost', protocol: 'http:' },
        writable: true,
        configurable: true,
      });

      await register();

      expect(registerFn).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    });

    it('calls onError when registration fails', async () => {
      const error = new Error('Registration failed');
      const registerFn = vi.fn().mockRejectedValue(error);
      const onError = vi.fn();

      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, serviceWorker: { register: registerFn } },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost', protocol: 'http:' },
        writable: true,
        configurable: true,
      });

      await register({ onError });

      expect(onError).toHaveBeenCalledWith(error);
    });

    it('does nothing when service worker is not supported', async () => {
      const nav = { ...navigator };
      delete (nav as Record<string, unknown>).serviceWorker;
      Object.defineProperty(globalThis, 'navigator', {
        value: nav,
        writable: true,
        configurable: true,
      });

      // Should not throw
      await register({ onSuccess: vi.fn() });
    });

    it('calls onUpdate when a new worker is installed over existing controller', async () => {
      const onUpdate = vi.fn();
      let updateFoundCb: (() => void) | undefined;
      let stateChangeCb: (() => void) | undefined;

      const installingWorker = {
        state: 'installed',
        addEventListener: vi.fn((_event: string, cb: () => void) => {
          stateChangeCb = cb;
        }),
      };

      const mockRegistration = {
        installing: installingWorker,
        addEventListener: vi.fn((event: string, cb: () => void) => {
          if (event === 'updatefound') {
            updateFoundCb = cb;
          }
        }),
      };

      const registerFn = vi.fn().mockResolvedValue(mockRegistration);

      Object.defineProperty(globalThis, 'navigator', {
        value: {
          ...navigator,
          serviceWorker: { register: registerFn, controller: {} },
        },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost', protocol: 'http:' },
        writable: true,
        configurable: true,
      });

      await register({ onUpdate });

      // Simulate updatefound event
      updateFoundCb?.();
      // Simulate statechange to installed
      stateChangeCb?.();

      expect(onUpdate).toHaveBeenCalledWith(mockRegistration);
    });

    it('calls onSuccess on first install (no existing controller)', async () => {
      const onSuccess = vi.fn();
      let updateFoundCb: (() => void) | undefined;
      let stateChangeCb: (() => void) | undefined;

      const installingWorker = {
        state: 'installed',
        addEventListener: vi.fn((_event: string, cb: () => void) => {
          stateChangeCb = cb;
        }),
      };

      const mockRegistration = {
        installing: installingWorker,
        addEventListener: vi.fn((event: string, cb: () => void) => {
          if (event === 'updatefound') {
            updateFoundCb = cb;
          }
        }),
      };

      const registerFn = vi.fn().mockResolvedValue(mockRegistration);

      Object.defineProperty(globalThis, 'navigator', {
        value: {
          ...navigator,
          serviceWorker: { register: registerFn, controller: null },
        },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost', protocol: 'http:' },
        writable: true,
        configurable: true,
      });

      await register({ onSuccess });

      updateFoundCb?.();
      stateChangeCb?.();

      expect(onSuccess).toHaveBeenCalledWith(mockRegistration);
    });
  });

  describe('unregister', () => {
    it('unregisters the active service worker', async () => {
      const unregisterFn = vi.fn().mockResolvedValue(true);
      const readyPromise = Promise.resolve({ unregister: unregisterFn });

      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, serviceWorker: { ready: readyPromise } },
        writable: true,
        configurable: true,
      });

      const result = await unregister();

      expect(unregisterFn).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('returns false when no service worker support', async () => {
      const nav = { ...navigator };
      delete (nav as Record<string, unknown>).serviceWorker;
      Object.defineProperty(globalThis, 'navigator', {
        value: nav,
        writable: true,
        configurable: true,
      });

      const result = await unregister();
      expect(result).toBe(false);
    });

    it('returns false when unregister throws', async () => {
      const readyPromise = Promise.reject(new Error('fail'));

      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, serviceWorker: { ready: readyPromise } },
        writable: true,
        configurable: true,
      });

      const result = await unregister();
      expect(result).toBe(false);
    });
  });
});
