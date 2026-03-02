/**
 * Gateway authentication middleware.
 *
 * Verifies JWT tokens from Authorization header or cookies,
 * validates signature, expiration, and issuer. Supports API key
 * authentication for service-to-service calls.
 *
 * @module middleware/gatewayAuth
 * @see Requirements: 3.1, 3.2
 */

import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

import type { APIKeyPayload, AuthRequirement, JWTPayload, RouteConfig } from '../gateway/types.js';
import { GATEWAY_ERROR_CODES } from '../gateway/types.js';
import { cacheToken, getCachedToken, DEFAULT_CACHE_TTL_MS } from '../gateway/tokenCache.js';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Configuration for the gateway auth middleware. */
export interface GatewayAuthConfig {
  /** Secret used to verify JWT signatures. */
  jwtSecret: string;
  /** Expected JWT issuer claim. */
  issuer: string;
  /** Cookie name to extract JWT from (optional, defaults to 'token'). */
  cookieName?: string;
  /** Map of valid API keys to their payloads. */
  apiKeys?: Map<string, APIKeyPayload>;
  /** Enable in-memory token validation caching (default: true). @see Requirement 3.6 */
  enableCache?: boolean;
  /** Cache TTL in milliseconds (default: 60 000). @see Requirement 3.6 */
  cacheTTL?: number;
  /** Callback invoked on authentication failures for security monitoring (Req 3.7). */
  onAuthFailure?: (info: AuthFailureInfo) => void;
}

/** Information about an authentication failure for security monitoring (Req 3.7). */
export interface AuthFailureInfo {
  /** Client IP address. */
  clientIP: string;
  /** Request path. */
  path: string;
  /** Correlation ID for tracing. */
  correlationId: string;
  /** Reason for the failure. */
  reason:
    | 'missing_token'
    | 'invalid_token'
    | 'missing_api_key'
    | 'invalid_api_key'
    | 'invalid_config';
  /** Auth requirement that was not met. */
  authRequirement: AuthRequirement;
  /** Timestamp of the failure. */
  timestamp: Date;
}

/** Extend Express Request to carry auth payload. */
declare global {
  namespace Express {
    interface Request {
      authPayload?: JWTPayload | APIKeyPayload;
      routeConfig?: RouteConfig;
    }
  }
}

// ─── Token Extraction ────────────────────────────────────────────────────────

/**
 * Extract a JWT token from the Authorization header (Bearer scheme)
 * or from cookies.
 *
 * @see Requirement 3.1
 */
export function extractToken(req: Request, cookieName: string = 'token'): string | null {
  // Try Authorization header first
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      return token;
    }
  }

  // Fall back to cookies
  const cookies = req.cookies as Record<string, string> | undefined;
  if (cookies) {
    const cookieToken = cookies[cookieName];
    if (typeof cookieToken === 'string' && cookieToken.length > 0) {
      return cookieToken;
    }
  }

  return null;
}

// ─── JWT Verification ────────────────────────────────────────────────────────

/**
 * Verify a JWT token's signature, expiration, and issuer.
 * Returns the decoded payload on success, or null on failure.
 *
 * @see Requirement 3.2
 */
export function verifyJWT(token: string, secret: string, issuer: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, secret, {
      issuer,
      algorithms: ['HS256'],
    });

    // jwt.verify returns string | JwtPayload; we need our JWTPayload shape
    if (typeof decoded === 'string' || !decoded) {
      return null;
    }

    const payload = decoded as Record<string, unknown>;

    // Validate required fields
    if (
      typeof payload['userId'] !== 'string' ||
      typeof payload['email'] !== 'string' ||
      typeof payload['businessId'] !== 'string' ||
      !Array.isArray(payload['permissions'])
    ) {
      return null;
    }

    return {
      userId: payload['userId'] as string,
      email: payload['email'] as string,
      businessId: payload['businessId'] as string,
      permissions: payload['permissions'] as string[],
      exp: payload['exp'] as number,
      iat: payload['iat'] as number,
    };
  } catch {
    return null;
  }
}

// ─── API Key Verification ────────────────────────────────────────────────────

/**
 * Verify an API key against the configured key map.
 * Returns the associated payload on success, or null on failure.
 */
export function verifyAPIKey(
  req: Request,
  apiKeys: Map<string, APIKeyPayload>,
): APIKeyPayload | null {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return null;
  }

  return apiKeys.get(apiKey) ?? null;
}

// ─── Error Response Helper ───────────────────────────────────────────────────

function sendAuthError(res: Response, code: string, message: string, correlationId: string): void {
  const statusCode = code === GATEWAY_ERROR_CODES.AUTH_REQUIRED ? 401 : 401;
  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      correlationId,
      timestamp: new Date().toISOString(),
    },
  });
}

// ─── Middleware Factory ──────────────────────────────────────────────────────

/**
 * Create an Express middleware that enforces authentication based on
 * the route's auth requirement.
 *
 * - auth: 'none' → skip authentication
 * - auth: 'jwt' → verify JWT token
 * - auth: 'api_key' → verify API key
 * - auth: 'jwt_or_api_key' → try JWT first, then API key
 *
 * On success, populates req.context with userId, businessId, permissions.
 * On failure, returns HTTP 401 with appropriate error code.
 *
 * @see Requirements: 3.1, 3.2
 */
export function createAuthMiddleware(config: GatewayAuthConfig) {
  const {
    jwtSecret,
    issuer,
    cookieName = 'token',
    apiKeys = new Map(),
    enableCache = true,
    cacheTTL = DEFAULT_CACHE_TTL_MS,
    onAuthFailure,
  } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    const correlationId = req.context?.correlationId ?? 'unknown';
    const clientIP = req.context?.clientIP ?? req.ip ?? 'unknown';
    const requestPath = req.originalUrl || req.url;

    // Determine auth requirement from route config or default to 'jwt'
    const authRequirement: AuthRequirement = req.routeConfig?.auth ?? 'jwt';

    // Skip auth for public routes
    if (authRequirement === 'none') {
      next();
      return;
    }

    if (authRequirement === 'jwt') {
      const result = authenticateJWT(req, jwtSecret, issuer, cookieName, enableCache, cacheTTL);
      if (result) {
        populateContext(req, result);
        next();
        return;
      }
      const hasToken = !!extractToken(req, cookieName);
      onAuthFailure?.({
        clientIP,
        path: requestPath,
        correlationId,
        reason: hasToken ? 'invalid_token' : 'missing_token',
        authRequirement,
        timestamp: new Date(),
      });
      sendAuthError(
        res,
        GATEWAY_ERROR_CODES.AUTH_REQUIRED,
        'Authentication required',
        correlationId,
      );
      return;
    }

    if (authRequirement === 'api_key') {
      const result = verifyAPIKey(req, apiKeys);
      if (result) {
        populateContext(req, result);
        next();
        return;
      }
      const hasKey =
        typeof req.headers['x-api-key'] === 'string' && req.headers['x-api-key'].length > 0;
      onAuthFailure?.({
        clientIP,
        path: requestPath,
        correlationId,
        reason: hasKey ? 'invalid_api_key' : 'missing_api_key',
        authRequirement,
        timestamp: new Date(),
      });
      sendAuthError(res, GATEWAY_ERROR_CODES.AUTH_REQUIRED, 'API key required', correlationId);
      return;
    }

    if (authRequirement === 'jwt_or_api_key') {
      // Try JWT first
      const jwtResult = authenticateJWT(req, jwtSecret, issuer, cookieName, enableCache, cacheTTL);
      if (jwtResult) {
        populateContext(req, jwtResult);
        next();
        return;
      }

      // Fall back to API key
      const apiKeyResult = verifyAPIKey(req, apiKeys);
      if (apiKeyResult) {
        populateContext(req, apiKeyResult);
        next();
        return;
      }

      onAuthFailure?.({
        clientIP,
        path: requestPath,
        correlationId,
        reason: 'invalid_token',
        authRequirement,
        timestamp: new Date(),
      });
      sendAuthError(
        res,
        GATEWAY_ERROR_CODES.AUTH_REQUIRED,
        'Authentication required',
        correlationId,
      );
      return;
    }

    // Unknown auth requirement — reject
    onAuthFailure?.({
      clientIP,
      path: requestPath,
      correlationId,
      reason: 'invalid_config',
      authRequirement,
      timestamp: new Date(),
    });
    sendAuthError(
      res,
      GATEWAY_ERROR_CODES.AUTH_INVALID,
      'Invalid auth configuration',
      correlationId,
    );
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Attempt JWT authentication: extract token, check cache, verify, and cache result.
 * Returns the payload on success, null on failure.
 *
 * @see Requirement 3.6
 */
function authenticateJWT(
  req: Request,
  secret: string,
  issuer: string,
  cookieName: string,
  useCache: boolean,
  cacheTTL: number,
): JWTPayload | null {
  const token = extractToken(req, cookieName);
  if (!token) {
    return null;
  }

  // Check cache first
  if (useCache) {
    const cached = getCachedToken(token);
    if (cached) {
      return cached;
    }
  }

  const payload = verifyJWT(token, secret, issuer);
  if (!payload) {
    return null;
  }

  // Cache the successful verification result
  if (useCache) {
    cacheToken(token, payload, cacheTTL);
  }

  return payload;
}

/**
 * Populate the request context with auth information.
 */
function populateContext(req: Request, auth: JWTPayload | APIKeyPayload): void {
  req.authPayload = auth;

  if (req.context) {
    if ('userId' in auth) {
      req.context.userId = auth.userId;
      req.context.businessId = auth.businessId;
      req.context.permissions = auth.permissions;
    } else if ('serviceId' in auth) {
      req.context.permissions = auth.permissions;
    }
  }
}
