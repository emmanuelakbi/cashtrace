export type AppEnv = "development" | "staging" | "production";

export interface EnvConfig {
  appEnv: AppEnv;
  apiBaseUrl: string;
  appName: string;
  isDev: boolean;
  isProd: boolean;
}

function getAppEnv(): AppEnv {
  const env = process.env.NEXT_PUBLIC_APP_ENV;
  if (env === "staging" || env === "production") return env;
  return "development";
}

export function getEnvConfig(): EnvConfig {
  const appEnv = getAppEnv();
  return {
    appEnv,
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api",
    appName: process.env.NEXT_PUBLIC_APP_NAME ?? "CashTrace",
    isDev: appEnv === "development",
    isProd: appEnv === "production",
  };
}

export const env = getEnvConfig();
