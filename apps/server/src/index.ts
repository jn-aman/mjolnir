import express from 'express';
import { createServer } from 'node:http';
import { logger } from '@mjolnir/logger';
import { setSchemaReporter } from '@mjolnir/schemas';
import { ClusterRegistry } from './clusters.ts';
import { errorHandler } from './http.ts';
import { attachLogSocket } from './log-socket.ts';
import { clusterRoutes } from './routes/clusters.ts';
import { logRoutes } from './routes/logs.ts';
import { resourceRoutes } from './routes/resources.ts';

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
  await registry.reload();

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, contexts: registry.contexts.length });
  });

  app.use('/api/clusters', clusterRoutes(registry));
  app.use('/api/resources', resourceRoutes(registry));
  app.use('/api/logs', logRoutes(registry));
  app.use(errorHandler);

  const server = createServer(app);
  attachLogSocket(server, registry);

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
