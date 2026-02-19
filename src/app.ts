/**
 * Express application factory with dependency injection.
 *
 * Creates a fully configured Express app with middleware wired in order:
 * 1. JSON body parser
 * 2. Cookie parser
 * 3. CSRF protection (double-submit cookie pattern)
 * 4. Auth routes with rate limiting applied per-endpoint
 * 5. Global error handling
 *
 * The factory accepts all dependencies (repositories, services, middleware)
 * to enable easy testing and modular composition.
 *
 * @module app
 * @see Requirements: All
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import type { Redis } from 'ioredis';

import { csrfProtection } from './middleware/csrfProtection.js';
import { checkLimit, passwordLoginKey, magicLinkKey } from './middleware/rateLimiter.js';
import { formatInternalError, getHttpStatusForError } from './utils/responses.js';
import { REFRESH_TOKEN_COOKIE } from './utils/cookies.js';
import { AUTH_ERROR_CODES } from './types/index.js';

import type {
  SignupDependencies,
  LoginDependencies,
  MagicLinkDependencies,
  PasswordResetRequestDependencies,
  ResetPasswordDependencies,
  RefreshDependencies,
  LogoutDependencies,
  LogoutAllDependencies,
  RequestContext,
} from './controllers/authController.js';

import {
  signup,
  login,
  requestMagicLink,
  verifyMagicLink,
  requestPasswordReset,
  resetPassword,
  refresh,
  logout,
  logoutAll,
} from './controllers/authController.js';

// ─── Dependency Types ────────────────────────────────────────────────────────

/** All dependencies required to create the Express application. */
export interface AppDependencies {
  /** Redis client for rate limiting. */
  redis: Redis;

  /** Dependencies for the signup controller. */
  signup: SignupDependencies;

  /** Dependencies for the login controller. */
  login: LoginDependencies;

  /** Dependencies for the magic link controllers. */
  magicLink: MagicLinkDependencies;

  /** Dependencies for the password reset request controller. */
  passwordResetRequest: PasswordResetRequestDependencies;

  /** Dependencies for the reset password controller. */
  resetPassword: ResetPasswordDependencies;

  /** Dependencies for the refresh controller. */
  refresh: RefreshDependencies;

  /** Dependencies for the logout controller. */
  logout: LogoutDependencies;

  /** Dependencies for the logout-all controller. */
  logoutAll: LogoutAllDependencies;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safely extract the HTTP status from a result that may be a success or error response. */
function getResultStatus(result: { success: boolean }, successStatus: number): number {
  if (result.success) return successStatus;
  if ('error' in result && typeof result.error === 'object' && result.error !== null) {
    const err = result.error as { code?: string };
    if (err.code) return getHttpStatusForError(err.code);
  }
  return 500;
}

/** Extract request context (IP, user agent) from an Express request. */
function getRequestContext(req: Request): RequestContext {
  return {
    ipAddress: req.ip ?? req.socket.remoteAddress ?? 'unknown',
    userAgent: req.get('user-agent') ?? 'unknown',
  };
}

// ─── Rate Limit Middleware Factory ───────────────────────────────────────────

/**
 * Create an Express middleware that applies rate limiting using the given
 * key builder function. Returns 429 with Retry-After header when exceeded.
 */
function rateLimitMiddleware(redis: Redis, keyBuilder: (ip: string) => string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const result = await checkLimit(redis, keyBuilder(ip));

    if (!result.allowed) {
      const retryAfterSeconds = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);
      res.set('Retry-After', String(Math.max(retryAfterSeconds, 1)));
      res.status(429).json({
        success: false,
        error: {
          code: AUTH_ERROR_CODES.RATE_LIMITED,
          message: 'Too many attempts. Please try again later.',
        },
      });
      return;
    }

    next();
  };
}

// ─── Application Factory ────────────────────────────────────────────────────

/**
 * Create a configured Express application with all auth routes and middleware.
 *
 * @param deps - All injected dependencies
 * @returns A fully configured Express application
 */
export function createApp(deps: AppDependencies): express.Express {
  const app = express();

  // ── Global Middleware (order matters) ──────────────────────────────────

  // 1. JSON body parser
  app.use(express.json());

  // 2. Cookie parser
  app.use(cookieParser());

  // 3. CSRF protection (double-submit cookie pattern)
  app.use(csrfProtection() as express.RequestHandler);

  // ── Auth Routes ───────────────────────────────────────────────────────

  const router = express.Router();

  // Rate limit middleware instances
  const passwordRateLimit = rateLimitMiddleware(deps.redis, passwordLoginKey);
  const magicLinkRateLimit = rateLimitMiddleware(deps.redis, magicLinkKey);

  // POST /api/auth/signup
  router.post('/signup', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await signup(req.body, getRequestContext(req), deps.signup);
      const status = getResultStatus(result, 201);
      res.status(status).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/login (rate limited)
  router.post(
    '/login',
    passwordRateLimit as express.RequestHandler,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await login(req.body, getRequestContext(req), deps.login);
        const status = getResultStatus(result, 200);
        res.status(status).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/auth/magic-link/request (rate limited)
  router.post(
    '/magic-link/request',
    magicLinkRateLimit as express.RequestHandler,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await requestMagicLink(req.body, getRequestContext(req), deps.magicLink);
        const status = getResultStatus(result, 200);
        res.status(status).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/auth/magic-link/verify
  router.post('/magic-link/verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await verifyMagicLink(req.body, getRequestContext(req), deps.magicLink);
      const status = getResultStatus(result, 200);
      res.status(status).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/password/reset-request
  router.post(
    '/password/reset-request',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await requestPasswordReset(
          req.body,
          getRequestContext(req),
          deps.passwordResetRequest,
        );
        const status = getResultStatus(result, 200);
        res.status(status).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /api/auth/password/reset
  router.post('/password/reset', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await resetPassword(req.body, getRequestContext(req), deps.resetPassword);
      const status = getResultStatus(result, 200);
      res.status(status).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/refresh
  router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
      const result = await refresh(req.body, refreshToken, getRequestContext(req), deps.refresh);
      const status = getResultStatus(result, 200);
      res.status(status).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/logout
  router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
      const result = await logout(refreshToken, getRequestContext(req), deps.logout, res);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/logout-all
  router.post('/logout-all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.body?.userId as string;
      const result = await logoutAll(userId, getRequestContext(req), deps.logoutAll, res);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // Mount auth routes under /api/auth
  app.use('/api/auth', router);

  // ── Global Error Handler ──────────────────────────────────────────────

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    const errorResponse = formatInternalError();
    res.status(500).json(errorResponse);
  });

  return app;
}
