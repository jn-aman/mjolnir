import { Router } from 'express';
import { demoNodeMetrics, demoPodMetrics, isDemoContext } from '@mjolnir/demo';
import type { MetricsCollector } from '../metrics.ts';
import { handle, param } from '../http.ts';

/**
 * Metrics for charts.
 *
 * A real cluster answers from metrics.k8s.io, which many clusters do not have
 * installed, and which keeps no history even when they do. The collector
 * accumulates it; this route hands over what there is.
 *
 * `available` is always in the response, so the UI can say what is actually
 * wrong rather than drawing an empty chart and letting someone conclude their
 * workloads use no CPU.
 */
export function metricRoutes(collector: MetricsCollector): Router {
  const router = Router();

  router.get(
    '/:context/nodes',
    handle(async (req, res) => {
      const context = param(req, 'context');
      if (isDemoContext(context)) {
        res.json({ available: true, series: demoNodeMetrics() });
        return;
      }
      res.json(collector.nodes(context));
    }),
  );

  router.get(
    '/:context/pods',
    handle(async (req, res) => {
      const context = param(req, 'context');
      if (isDemoContext(context)) {
        res.json({ available: true, series: demoPodMetrics() });
        return;
      }
      res.json(collector.pods(context));
    }),
  );

  return router;
}
