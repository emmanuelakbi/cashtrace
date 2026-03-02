/**
 * Type-safe environment configuration for CashTrace frontend.
 *
 * All NEXT_PUBLIC_ variables are validated at import time so missing or
 * invalid values surface immediately rather than at runtime deep in a
 * component tree.
 */

type AppEnv = 'development' | 'staging' | 'production';

interface EnvConfig {
  /** Current environment name */
  appEnv: AppEnv;
  /** Public URL of this frontend app (no trailing slash) */
  appUrl: string;
  /** Base URL for the CashTrace Express backend API (no trailing slash) */
  apiBaseUrl: string;
  /** Feature flags */
  features: {
    pwa: boolean;
    offline: boolean;
    darkMode: boolean;
  };
  /** Convenience booleans derived from appEnv */
  isDevelopment: boolean;
  isStaging: boolean;
  isProduction: boolean;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function parseAppEnv(value: string): AppEnv {
  const valid: AppEnv[] = ['development', 'staging', 'production'];
  if (valid.includes(value as AppEnv)) return value as AppEnv;
  throw new Error(
    `Invalid NEXT_PUBLIC_APP_ENV "${value}". Expected one of: ${valid.join(', ')}`,
  );
}

function buildEnvConfig(): EnvConfig {
  const appEnv = parseAppEnv(requireEnv('NEXT_PUBLIC_APP_ENV'));
  const appUrl = requireEnv('NEXT_PUBLIC_APP_URL');
  const apiBaseUrl = requireEnv('NEXT_PUBLIC_API_BASE_URL');

  return {
    appEnv,
    appUrl,
    apiBaseUrl,
    features: {
      pwa: parseBool(process.env['NEXT_PUBLIC_FEATURE_PWA'], false),
      offline: parseBool(process.env['NEXT_PUBLIC_FEATURE_OFFLINE'], false),
      darkMode: parseBool(process.env['NEXT_PUBLIC_FEATURE_DARK_MODE'], true),
    },
    isDevelopment: appEnv === 'development',
    isStaging: appEnv === 'staging',
    isProduction: appEnv === 'production',
  };
}

export const env: EnvConfig = buildEnvConfig();
