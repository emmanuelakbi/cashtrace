/**
 * Prometheus Metrics Endpoint
 *
 * Exposes a GET /metrics route handler that returns collected metrics
 * in Prometheus text exposition format for scraping.
 *
 * @module metrics/metricsEndpoint
 * @see Requirements: 3.5
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { MetricsCollector } from './collector.js';

/** Content type for Prometheus text exposition format. */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/**
 * Creates an Express Router that serves Prometheus metrics at GET /metrics.
 *
 * @param collector - The MetricsCollector instance to read metrics from
 * @returns An Express Router with the /metrics GET route
 */
export function createMetricsEndpoint(collector: MetricsCollector): Router {
  const router = Router();

  router.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const output = await collector.getMetricsOutput();
      res.set('Content-Type', PROMETHEUS_CONTENT_TYPE);
      res.status(200).send(output);
    } catch {
      res.status(500).send('# Error collecting metrics\n');
    }
  });

  return router;
}
