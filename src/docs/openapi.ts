/**
 * OpenAPI/Swagger documentation generator for the API Gateway.
 *
 * Generates an OpenAPI 3.0 spec from route configurations and serves it
 * via Express routes. No external OpenAPI libraries are used — the spec
 * is a plain JSON object served at /api/docs, with a Swagger UI page at
 * /api/docs/ui.
 *
 * @module docs/openapi
 * @see Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { Router } from 'express';

import type { AuthRequirement, RateLimit, RouteConfig } from '../gateway/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal OpenAPI 3.0 spec shape (plain object, no validation library). */
export type OpenAPISpec = Record<string, unknown>;

// ─── Auth Scheme Descriptions ────────────────────────────────────────────────

const AUTH_DESCRIPTIONS: Record<AuthRequirement, string> = {
  none: 'No authentication required.',
  jwt: 'Requires a valid JWT token in the Authorization header (Bearer) or cookie.',
  api_key: 'Requires a valid API key in the X-API-Key header.',
  jwt_or_api_key: 'Requires either a JWT token (Bearer) or an API key (X-API-Key).',
};

// ─── Spec Generator ──────────────────────────────────────────────────────────

/**
 * Build an OpenAPI 3.0 JSON spec from the given route configurations.
 *
 * For each route the spec includes:
 * - Operation summary and tags derived from the service name
 * - Authentication requirements (Req 12.4)
 * - Rate limit details in the description (Req 12.5)
 * - Basic request/response examples (Req 12.3)
 *
 * @see Requirement 12.2 — generate documentation from route definitions
 */
export function generateOpenAPISpec(routes: RouteConfig[]): OpenAPISpec {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const openApiPath = expressToOpenAPIPath(route.path);
    const method = route.method.toLowerCase();

    if (!paths[openApiPath]) {
      paths[openApiPath] = {};
    }

    paths[openApiPath][method] = buildOperation(route);
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'CashTrace API Gateway',
      description:
        'Centralized API gateway for CashTrace — an SME cashflow & compliance copilot for Nigerian small businesses.',
      version: '1.0.0',
    },
    servers: [{ url: '/', description: 'Current server' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token issued by the auth service.',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for service-to-service calls.',
        },
      },
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert Express-style path params (`:id`) to OpenAPI style (`{id}`).
 */
function expressToOpenAPIPath(path: string): string {
  return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
}

/**
 * Extract path parameter names from an Express-style path.
 */
function extractPathParams(path: string): string[] {
  const params: string[] = [];
  const regex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path)) !== null) {
    const name = match[1];
    if (name) {
      params.push(name);
    }
  }
  return params;
}

/**
 * Build a single OpenAPI operation object for a route.
 */
function buildOperation(route: RouteConfig): Record<string, unknown> {
  const tag = formatTag(route.service);
  const descriptionParts: string[] = [];

  // Auth description (Req 12.4)
  descriptionParts.push(`**Authentication:** ${AUTH_DESCRIPTIONS[route.auth]}`);

  // Rate limit description (Req 12.5)
  if (route.rateLimit) {
    descriptionParts.push(formatRateLimit(route.rateLimit));
  }

  // Timeout / retries
  descriptionParts.push(`**Timeout:** ${route.timeout}ms | **Retries:** ${route.retries}`);

  const operation: Record<string, unknown> = {
    summary: `${route.method} ${route.path}`,
    tags: [tag],
    description: descriptionParts.join('\n\n'),
    operationId: buildOperationId(route),
    parameters: buildParameters(route),
    responses: buildResponses(route),
  };

  // Security (Req 12.4)
  operation.security = buildSecurity(route.auth);

  return operation;
}

/**
 * Build the security requirement array for an auth type.
 */
function buildSecurity(auth: AuthRequirement): Record<string, string[]>[] {
  switch (auth) {
    case 'none':
      return [];
    case 'jwt':
      return [{ bearerAuth: [] }];
    case 'api_key':
      return [{ apiKeyAuth: [] }];
    case 'jwt_or_api_key':
      return [{ bearerAuth: [] }, { apiKeyAuth: [] }];
  }
}

/**
 * Build path parameters from the route path.
 */
function buildParameters(route: RouteConfig): Record<string, unknown>[] {
  return extractPathParams(route.path).map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

/**
 * Build standard response objects with examples (Req 12.3).
 */
function buildResponses(route: RouteConfig): Record<string, unknown> {
  const responses: Record<string, unknown> = {
    '200': {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: { type: 'object' },
          example: { success: true },
        },
      },
    },
  };

  // Auth-related error responses (Req 12.4)
  if (route.auth !== 'none') {
    responses['401'] = {
      description: 'Authentication required or invalid token',
      content: {
        'application/json': {
          example: {
            success: false,
            error: {
              code: 'GW_AUTH_REQUIRED',
              message: 'Authentication required',
              correlationId: '550e8400-e29b-41d4-a716-446655440000',
              timestamp: '2024-01-01T00:00:00.000Z',
            },
          },
        },
      },
    };
  }

  // Rate limit error response (Req 12.5)
  if (route.rateLimit) {
    responses['429'] = {
      description: 'Rate limit exceeded',
      content: {
        'application/json': {
          example: {
            success: false,
            error: {
              code: 'GW_RATE_LIMITED',
              message: `Rate limit exceeded: ${route.rateLimit.requests} requests per ${route.rateLimit.window}s`,
              correlationId: '550e8400-e29b-41d4-a716-446655440000',
              timestamp: '2024-01-01T00:00:00.000Z',
            },
          },
        },
      },
    };
  }

  return responses;
}

/**
 * Format a rate limit into a human-readable description.
 */
function formatRateLimit(limit: RateLimit): string {
  return `**Rate Limit:** ${limit.requests} requests per ${limit.window}s (key prefix: \`${limit.keyPrefix}\`)`;
}

/**
 * Derive a tag name from a service identifier (e.g. "auth-service" → "Auth Service").
 */
function formatTag(service: string): string {
  return service
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Build a unique operationId from the route method + path.
 */
function buildOperationId(route: RouteConfig): string {
  const pathPart = route.path
    .replace(/^\/+/, '')
    .replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, 'by')
    .replace(/[^a-zA-Z0-9]/g, '_');
  return `${route.method.toLowerCase()}_${pathPart}`;
}

// ─── Swagger UI HTML ─────────────────────────────────────────────────────────

/**
 * Generate a minimal HTML page that loads Swagger UI from CDN.
 */
function swaggerUIHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CashTrace API Docs</title>
  <link
    rel="stylesheet"
    href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
  />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '${specUrl}', dom_id: '#swagger-ui' });
  </script>
</body>
</html>`;
}

// ─── Router Factory ──────────────────────────────────────────────────────────

export interface DocsRouterOptions {
  /** Route configs to generate docs from. Defaults to empty array. */
  routes?: RouteConfig[];
}

/**
 * Create an Express Router that serves the OpenAPI spec and Swagger UI.
 *
 * - GET /api/docs    → JSON OpenAPI spec
 * - GET /api/docs/ui → Swagger UI HTML page
 *
 * @see Requirement 12.1 — expose OpenAPI/Swagger documentation at /api/docs
 */
export function createDocsRouter(options: DocsRouterOptions = {}): Router {
  const { routes = [] } = options;
  const spec = generateOpenAPISpec(routes);
  const router = Router();

  router.get('/api/docs', (_req, res) => {
    res.json(spec);
  });

  router.get('/api/docs/ui', (_req, res) => {
    res.type('html').send(swaggerUIHtml('/api/docs'));
  });

  return router;
}
