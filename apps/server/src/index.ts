import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@mjolnir/logger';
import { setSchemaReporter } from '@mjolnir/schemas';
import { ClusterRegistry } from './clusters.ts';
import { errorHandler } from './http.ts';
import type { WebSocketServer } from 'ws';
import { attachLogSocket } from './log-socket.ts';
import { attachExecSocket } from './exec-socket.ts';
import { attachWatchSocket } from './watch-socket.ts';
import { clusterRoutes } from './routes/clusters.ts';
import { logRoutes } from './routes/logs.ts';
import { metricRoutes } from './routes/metrics.ts';
import { diagnoseRoutes } from './routes/diagnose.ts';
import { certificateRoutes } from './routes/certificates.ts';
import { resourceRoutes } from './routes/resources.ts';
import { forwardRoutes } from './routes/forwards.ts';
import { settingsRoutes } from './routes/settings.ts';
import { aiRoutes } from './routes/ai.ts';
import { mcpRoutes } from './routes/mcp.ts';
import { licenceRoutes } from './routes/licence.ts';
import { dockerRoutes } from './routes/docker.ts';
import { scanRoutes } from './routes/scan.ts';
import { helmRoutes } from './routes/helm.ts';
import { storageRoutes } from './routes/storage.ts';
import { accountRoutes } from './routes/account.ts';
import { AccountStore } from './account.ts';
import { MetricsCollector } from './metrics.ts';
import { flagRoutes } from './routes/flags.ts';
import { updateRoutes } from './routes/updates.ts';
import { telemetryRoutes } from './routes/telemetry.ts';
import { CrdCatalogue } from './crds.ts';
import { FlagStore } from './flags.ts';
import { Telemetry } from './telemetry.ts';
import { APP_VERSION } from './version.ts';
import { SettingsStore } from './settings.ts';
import { ForwardManager } from './forwards.ts';


const log = logger.child('server');

export { setDesktopBridge, type DesktopBridge } from './desktop-bridge.ts';
export { APP_VERSION } from './version.ts';

export interface ServerHandle {
  readonly port: number;
  close(): Promise<void>;
}

export async function startServer(port = Number(process.env['MJOLNIR_PORT'] ?? 0)): Promise<ServerHandle> {
  // Route schema mismatches into the app log rather than losing them.
  setSchemaReporter((message, detail) => {
    log.child('schema').warn(message, { context: detail.context });
  });

  const registry = new ClusterRegistry();

  const forwards = new ForwardManager(registry);

  const settings = new SettingsStore();

  registry.extraKubeconfigs = settings.get().clusters.kubeconfigs;

  if (registry.extraKubeconfigs.length) await registry.reload();

  const crds = new CrdCatalogue(registry);

  // Kubernetes keeps no usage history, so something has to accumulate it.
  const metrics = new MetricsCollector(registry);

  const flags = new FlagStore(settings, APP_VERSION);
  flags.start();

  // The account is what a subscription hangs off. It is never on the path to
  // reaching a cluster: every call it makes can fail forever and the app still
  // opens, still connects, and still honours the lease it already has.
  const account = new AccountStore(APP_VERSION);
  account.start();

  // Flags can then be aimed at a customer or at a paid plan, decided on the
  // server rather than compiled in.
  flags.setAccountSource(() => account.identityForFlags());

  const telemetry = new Telemetry(settings, APP_VERSION);
  telemetry.start();
  telemetry.record('app.launch', { channel: settings.get().updates.channel });

  const toolContext = { registry, forwards, settings };
  await registry.reload();

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, contexts: registry.contexts.length });
  });

  app.use('/api/clusters', clusterRoutes(registry, settings));
  app.use('/api/settings', settingsRoutes(settings));
  app.use('/api/flags', flagRoutes(flags, settings));
  app.use('/api/telemetry', telemetryRoutes(telemetry, settings));
  app.use('/api/updates', updateRoutes(settings));
  app.use('/api/licence', licenceRoutes(settings));
  app.use('/api/account', accountRoutes(account));
  app.use('/api/docker', dockerRoutes(flags));
  app.use('/api/scan', scanRoutes(registry, flags));
  app.use('/api/helm', helmRoutes(registry));
  app.use('/api/storage', storageRoutes(settings, forwards, registry));
  app.use('/api/ai', aiRoutes(toolContext, flags));
  app.use('/mcp', mcpRoutes(toolContext, flags));
  app.use('/api/resources', resourceRoutes(registry, crds));
  app.use('/api/forwards', forwardRoutes(forwards, registry));
  app.use('/api/logs', logRoutes(registry));
  app.use('/api/metrics', metricRoutes(metrics));
  app.use('/api/diagnose', diagnoseRoutes(registry, flags));
  app.use('/api/certificates', certificateRoutes(registry, flags));
  app.use(errorHandler);

  /**
   * The built client, when there is one.
   *
   * The desktop app ships the client beside itself and says where with
   * MJOLNIR_WEB_DIST, because inside an app bundle nothing sits where the
   * repository put it. Everywhere else the sibling build is right.
   */
  const webDist =
    process.env['MJOLNIR_WEB_DIST'] ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false }));
    // Client-side routing: anything that is not an API call gets the shell.
    app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
    log.info('serving the built client', { from: webDist });
  } else {
    log.info('no built client found; API only', { expected: webDist });
  }

  const server = createServer(app);
  // One upgrade handler routes by path. Two servers each bound to the HTTP
  // server would both answer, and the one whose path did not match would
  // reject the handshake with a 400.
  const sockets: Record<string, WebSocketServer> = {
    '/ws/logs': attachLogSocket(registry),
    '/ws/exec': attachExecSocket(registry),
    '/ws/watch': attachWatchSocket(registry, crds),
  };
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const wss = sockets[pathname];
    if (!wss) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  // Bind to loopback only. This server exists for the desktop app's renderer;
  // exposing a process that holds every one of the user's cluster credentials
  // on all interfaces would be an unpleasant surprise on a shared network.
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  log.info('server listening', { port: boundPort });

  return {
    port: boundPort,
    close: async () => {
      flags.stop();
      telemetry.stop();
      await telemetry.flush();
      account.stop();
      metrics.stop();
      await registry.shutdown();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

// Started directly rather than embedded in Electron.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  startServer().catch((error: unknown) => {
    log.error('server failed to start', { error });
    process.exitCode = 1;
  });
}
