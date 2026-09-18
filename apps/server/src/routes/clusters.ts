import { Router } from 'express';
import type { ClusterRegistry } from '../clusters.ts';
import { HttpError, handle, param, query } from '../http.ts';
import type { SettingsStore } from '../settings.ts';
import { removeContextFromFile } from '../kubeconfig-edit.ts';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function clusterRoutes(registry: ClusterRegistry, settings: SettingsStore): Router {
  const router = Router();
  const visible = () => {
    const hidden = new Set(settings.get().clusters.hidden);
    return registry.contexts.filter((context) => !hidden.has(context.name));
  };

  router.get(
    '/',
    handle(async (_req, res) => {
      res.json({
        contexts: visible(),
        hidden: settings.get().clusters.hidden,
        currentContext: registry.currentContext,
        // Surfaced rather than swallowed: if one kubeconfig in KUBECONFIG is
        // unreadable, the user should be told which, not silently shown fewer
        // clusters than they have.
        failures: registry.failures,
      });
    }),
  );

  /** Extra kubeconfig files: added by path, or pasted and kept under ~/.mjolnir/kubeconfigs. */
  router.get(
    '/kubeconfigs',
    handle(async (_req, res) => {
      res.json({ files: settings.get().clusters.kubeconfigs });
    }),
  );
  router.post(
    '/kubeconfigs',
    handle(async (req, res) => {
      const body = req.body as { path?: unknown; name?: unknown; content?: unknown };
      let file: string;
      if (typeof body.content === 'string' && body.content.trim()) {
        const name = String(body.name ?? 'pasted').replace(/[^A-Za-z0-9_.-]/g, '-') || 'pasted';
        const dir = join(homedir(), '.mjolnir', 'kubeconfigs');
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        file = join(dir, `${name}.yaml`);
        writeFileSync(file, body.content, { mode: 0o600 });
      } else if (typeof body.path === 'string' && body.path.trim()) {
        file = resolve(body.path.trim().replace(/^~(?=$|\/)/, homedir()));
        if (!existsSync(file)) throw HttpError.badRequest(`${file} does not exist`);
      } else {
        throw HttpError.badRequest('send a path, or a name and the kubeconfig content');
      }
      const files = [...new Set([...settings.get().clusters.kubeconfigs, file])];
      settings.update({ clusters: { kubeconfigs: files } });
      registry.extraKubeconfigs = files;
      await registry.reload();
      res.status(201).json({ files, contexts: visible(), currentContext: registry.currentContext });
    }),
  );
  router.delete(
    '/kubeconfigs',
    handle(async (req, res) => {
      const file = query(req, 'path');
      if (!file) throw HttpError.badRequest('path is required');
      const files = settings.get().clusters.kubeconfigs.filter((entry) => entry !== file);
      settings.update({ clusters: { kubeconfigs: files } });
      registry.extraKubeconfigs = files;
      await registry.reload();
      res.json({ files, contexts: visible(), currentContext: registry.currentContext });
    }),
  );

  router.post(
    '/reload',
    handle(async (_req, res) => {
      await registry.reload();
      res.json({ contexts: visible(), hidden: settings.get().clusters.hidden, currentContext: registry.currentContext });
    }),
  );

  /**
   * Reachability for one cluster.
   *
   * Deliberately cheap, `/version` needs no RBAC beyond being authenticated,
   * so it distinguishes "cannot reach" from "reached but not allowed", which a
   * pod list cannot.
   */
  router.get(
    '/:context/status',
    handle(async (req, res) => {
      const name = param(req, 'context');
      const connection = registry.connect(name);
      const startedAt = Date.now();
      try {
        const version = await connection.json<{ gitVersion?: string }>('/version');
        res.json({
          reachable: true,
          version: version.gitVersion ?? null,
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        res.json({
          reachable: false,
          error: error instanceof Error ? error.message : String(error),
          latencyMs: Date.now() - startedAt,
        });
      }
    }),
  );

  /**
   * Remove a cluster. `scope=hide` (default) drops it from Mjolnir and keeps
   * the kubeconfig untouched; `scope=kubeconfig` removes the context from the
   * file it came from, after a backup beside it. The demo cannot be removed.
   */
  router.delete(
    '/:context',
    handle(async (req, res) => {
      const name = param(req, 'context');
      const scope = query(req, 'scope') ?? 'hide';
      if (name === 'demo') throw HttpError.badRequest('the demo cluster is built in');
      await registry.disconnect(name);
      if (scope === 'kubeconfig') {
        const context = registry.contexts.find((entry) => entry.name === name);
        if (!context) throw HttpError.notFound(`unknown context ${name}`);
        const { backup } = removeContextFromFile(context.source, name);
        await registry.reload();
        res.json({ removed: name, backup });
        return;
      }
      const hidden = new Set(settings.get().clusters.hidden);
      hidden.add(name);
      settings.update({ clusters: { hidden: [...hidden] } });
      res.json({ hidden: [...hidden] });
    }),
  );

  /** Bring a hidden cluster back. */
  router.post(
    '/:context/unhide',
    handle(async (req, res) => {
      const name = param(req, 'context');
      settings.update({ clusters: { hidden: settings.get().clusters.hidden.filter((entry) => entry !== name) } });
      res.json({ hidden: settings.get().clusters.hidden });
    }),
  );

  return router;
}
