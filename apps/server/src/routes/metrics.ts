import { Router } from 'express';
import { demoNodeMetrics, demoPodMetrics, isDemoContext } from '@mjolnir/demo';
import type { ClusterRegistry } from '../clusters.ts';
import { handle, param } from '../http.ts';

/**
 * Metrics for charts.
 *
 * A real cluster answers from metrics.k8s.io, which many clusters do not have
 * installed. The response therefore always carries `available`, so the UI can
 * say "metrics-server is not installed" rather than drawing an empty chart and
 * letting someone conclude their workloads use no CPU.
 */
export function metricRoutes(registry: ClusterRegistry): Router {
  const router = Router();

  router.get(
    '/:context/nodes',
    handle(async (req, res) => {
      const context = param(req, 'context');
      if (isDemoContext(context)) {
        res.json({ available: true, series: demoNodeMetrics() });
        return;
      }
      registry.connect(context);
      res.json({ available: false, reason: 'metrics-server not yet wired for live clusters', series: [] });
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
      registry.connect(context);
      res.json({ available: false, reason: 'metrics-server not yet wired for live clusters', series: [] });
    }),
  );

  return router;
}
