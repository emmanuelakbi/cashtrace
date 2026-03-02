/**
 * Route handler for the API Gateway.
 *
 * Provides a RouteRegistry for storing and matching route configurations,
 * and a factory function that creates Express middleware to route requests
 * to the appropriate backend service handler.
 *
 * @module routes/handler
 * @see Requirements: 4.1, 4.2
 */

import type { Request, Response, NextFunction } from 'express';

import type { HTTPMethod, RouteConfig } from '../gateway/types.js';
import { GATEWAY_ERROR_CODES, GATEWAY_ERROR_HTTP_STATUS } from '../gateway/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A backend service handler function that processes a matched request. */
export type ServiceHandler = (req: Request, res: Response, next: NextFunction) => void;

/** Result of matching a route, including extracted path parameters. */
export interface RouteMatch {
  route: RouteConfig;
  params: Record<string, string>;
}

// ─── Route Registry ──────────────────────────────────────────────────────────

/** Supported API versions. */
const SUPPORTED_VERSIONS = ['v1', 'v2'] as const;
export type APIVersion = (typeof SUPPORTED_VERSIONS)[number];

/**
 * Stores route configurations and matches incoming requests.
 *
 * Routes are registered with path patterns that may contain named parameters
 * (e.g. `/api/v1/users/:id`). Versioned paths are supported — a route
 * registered under `/api/v1/users` will only match requests to that version.
 *
 * @see Requirement 4.1 — route to appropriate backend services based on path prefix
 * @see Requirement 4.2 — support versioned API paths
 */
export class RouteRegistry {
  private readonly routes: RouteConfig[] = [];

  /** Register a route configuration. */
  register(route: RouteConfig): void {
    this.routes.push(route);
  }

  /** Register multiple route configurations at once. */
  registerAll(routes: RouteConfig[]): void {
    for (const route of routes) {
      this.register(route);
    }
  }

  /** Return all registered routes (read-only copy). */
  getRoutes(): readonly RouteConfig[] {
    return [...this.routes];
  }

  /**
   * Find a matching route for the given method and path.
   * Returns the matched route and any extracted path parameters,
   * or `null` if no route matches.
   */
  match(method: HTTPMethod, path: string): RouteMatch | null {
    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }

      const params = matchPath(route.path, path);
      if (params !== null) {
        return { route, params };
      }
    }

    return null;
  }
}

// ─── Path Matching ───────────────────────────────────────────────────────────

/**
 * Match a path pattern against an actual request path.
 * Supports named parameters (`:param`) in the pattern.
 * Returns extracted params on match, or null on mismatch.
 */
function matchPath(pattern: string, actual: string): Record<string, string> | null {
  const patternSegments = trimSlashes(pattern).split('/');
  const actualSegments = trimSlashes(actual).split('/');

  if (patternSegments.length !== actualSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternSegments.length; i++) {
    const pat = patternSegments[i] as string;
    const act = actualSegments[i] as string;

    if (pat.startsWith(':')) {
      params[pat.slice(1)] = act;
    } else if (pat !== act) {
      return null;
    }
  }

  return params;
}

/** Strip leading and trailing slashes from a path. */
function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

// ─── Route Handler Factory ──────────────────────────────────────────────────

export interface RouteHandlerDeps {
  registry: RouteRegistry;
  handlers: Map<string, ServiceHandler>;
}

/**
 * Create Express middleware that matches incoming requests against the
 * route registry and delegates to the appropriate service handler.
 *
 * On match:
 * - Attaches `routeConfig` to the request for downstream middleware
 * - Merges extracted path params into `req.params`
 * - Calls the registered service handler
 *
 * On no match:
 * - Responds with 404 using the standard gateway error shape
 *
 * @see Requirement 4.1 — route to backend services based on path prefix
 * @see Requirement 4.2 — versioned API paths
 */
export function createRouteHandler(deps: RouteHandlerDeps) {
  const { registry, handlers } = deps;

  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase() as HTTPMethod;
    const result = registry.match(method, req.path);

    if (!result) {
      const correlationId = req.context?.correlationId ?? 'unknown';
      res.status(GATEWAY_ERROR_HTTP_STATUS[GATEWAY_ERROR_CODES.NOT_FOUND]).json({
        success: false,
        error: {
          code: GATEWAY_ERROR_CODES.NOT_FOUND,
          message: `No route found for ${method} ${req.path}`,
          correlationId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const { route, params } = result;

    // Attach route config for downstream middleware (auth, rate limiter, etc.)
    req.routeConfig = route;

    // Merge extracted path params into req.params
    Object.assign(req.params, params);

    const handler = handlers.get(route.service);
    if (!handler) {
      const correlationId = req.context?.correlationId ?? 'unknown';
      res.status(GATEWAY_ERROR_HTTP_STATUS[GATEWAY_ERROR_CODES.SERVICE_UNAVAILABLE]).json({
        success: false,
        error: {
          code: GATEWAY_ERROR_CODES.SERVICE_UNAVAILABLE,
          message: `Service "${route.service}" is not registered`,
          correlationId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    handler(req, res, next);
  };
}
