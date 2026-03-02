import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('env config', () => {
  const VALID_ENV = {
    NEXT_PUBLIC_APP_ENV: 'development',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4000',
    NEXT_PUBLIC_FEATURE_PWA: 'false',
    NEXT_PUBLIC_FEATURE_OFFLINE: 'false',
    NEXT_PUBLIC_FEATURE_DARK_MODE: 'true',
  };

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function stubEnv(overrides: Record<string, string | undefined> = {}): void {
    const merged = { ...VALID_ENV, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value === undefined) {
        vi.stubEnv(key, '');
      } else {
        vi.stubEnv(key, value);
      }
    }
  }

  async function loadEnv() {
    const mod = await import('./env');
    return mod.env;
  }

  it('parses a valid development environment', async () => {
    stubEnv();
    const env = await loadEnv();

    expect(env.appEnv).toBe('development');
    expect(env.appUrl).toBe('http://localhost:3000');
    expect(env.apiBaseUrl).toBe('http://localhost:4000');
    expect(env.isDevelopment).toBe(true);
    expect(env.isStaging).toBe(false);
    expect(env.isProduction).toBe(false);
  });

  it('parses feature flags correctly', async () => {
    stubEnv({
      NEXT_PUBLIC_FEATURE_PWA: 'true',
      NEXT_PUBLIC_FEATURE_OFFLINE: '1',
      NEXT_PUBLIC_FEATURE_DARK_MODE: 'false',
    });
    const env = await loadEnv();

    expect(env.features.pwa).toBe(true);
    expect(env.features.offline).toBe(true);
    expect(env.features.darkMode).toBe(false);
  });

  it('defaults feature flags when not set', async () => {
    stubEnv({
      NEXT_PUBLIC_FEATURE_PWA: undefined,
      NEXT_PUBLIC_FEATURE_OFFLINE: undefined,
      NEXT_PUBLIC_FEATURE_DARK_MODE: undefined,
    });
    const env = await loadEnv();

    expect(env.features.pwa).toBe(false);
    expect(env.features.offline).toBe(false);
    expect(env.features.darkMode).toBe(true);
  });

  it('throws when NEXT_PUBLIC_APP_ENV is missing', async () => {
    stubEnv({ NEXT_PUBLIC_APP_ENV: undefined });
    await expect(loadEnv()).rejects.toThrow('Missing required environment variable');
  });

  it('throws when NEXT_PUBLIC_APP_ENV is invalid', async () => {
    stubEnv({ NEXT_PUBLIC_APP_ENV: 'invalid' });
    await expect(loadEnv()).rejects.toThrow('Invalid NEXT_PUBLIC_APP_ENV');
  });

  it('throws when NEXT_PUBLIC_API_BASE_URL is missing', async () => {
    stubEnv({ NEXT_PUBLIC_API_BASE_URL: undefined });
    await expect(loadEnv()).rejects.toThrow('Missing required environment variable');
  });

  it('recognises production environment', async () => {
    stubEnv({ NEXT_PUBLIC_APP_ENV: 'production' });
    const env = await loadEnv();

    expect(env.isProduction).toBe(true);
    expect(env.isDevelopment).toBe(false);
  });

  it('recognises staging environment', async () => {
    stubEnv({ NEXT_PUBLIC_APP_ENV: 'staging' });
    const env = await loadEnv();

    expect(env.isStaging).toBe(true);
    expect(env.isDevelopment).toBe(false);
  });
});
