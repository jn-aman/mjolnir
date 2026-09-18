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
import { clusterRoutes } from './routes/clusters.ts';
import { logRoutes } from './routes/logs.ts';
import { metricRoutes } from './routes/metrics.ts';
import { resourceRoutes } from './routes/resources.ts';
import { forwardRoutes } from './routes/forwards.ts';
import { settingsRoutes } from './routes/settings.ts';
import { aiRoutes } from './routes/ai.ts';
import { mcpRoutes } from './routes/mcp.ts';
import { licenceRoutes } from './routes/licence.ts';
import { SettingsStore } from './settings.ts';
import { ForwardManager } from './forwards.ts';

const log = logger.child('server');

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

  const toolContext = { registry, forwards, settings };
  await registry.reload();

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, contexts: registry.contexts.length });
  });

  app.use('/api/clusters', clusterRoutes(registry, settings));
  app.use('/api/settings', settingsRoutes(settings));
  app.use('/api/licence', licenceRoutes(settings));
  app.use('/api/ai', aiRoutes(toolContext));
  app.use('/mcp', mcpRoutes(toolContext));
  app.use('/api/resources', resourceRoutes(registry));
  app.use('/api/forwards', forwardRoutes(forwards));
  app.use('/api/logs', logRoutes(registry));
  app.use('/api/metrics', metricRoutes(registry));
  app.use(errorHandler);

  /**
   * The built client, when there is one.
   *
   * In the desktop app Electron loads these files directly; this path is what
   * makes the standalone web and Docker modes work, and it is also the quickest
   * way to look at the app during development without a second dev server.
   */
  const webDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../web/dist',
  );

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
