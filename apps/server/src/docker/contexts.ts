import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DockerClient } from './client.ts';

/**
 * Where the engines are: DOCKER_HOST, the default socket, and every context
 * in ~/.docker/contexts (OrbStack, Colima, Docker Desktop, rootless). Only
 * unix sockets for now; tcp and ssh endpoints are listed but not opened.
 */
export interface DockerContext {
  readonly name: string;
  readonly endpoint: string;
  readonly supported: boolean;
}

function fromEnv(): DockerContext[] {
  const host = process.env['DOCKER_HOST'];
  if (host) return [{ name: 'DOCKER_HOST', endpoint: host, supported: host.startsWith('unix://') }];
  return [];
}

export function listDockerContexts(): { contexts: DockerContext[]; current: string } {
  const contexts: DockerContext[] = [...fromEnv()];
  if (existsSync('/var/run/docker.sock')) contexts.push({ name: 'default', endpoint: 'unix:///var/run/docker.sock', supported: true });

  const meta = join(homedir(), '.docker', 'contexts', 'meta');
  if (existsSync(meta)) {
    for (const dir of readdirSync(meta)) {
      try {
        const file = JSON.parse(readFileSync(join(meta, dir, 'meta.json'), 'utf8')) as { Name?: string; Endpoints?: { docker?: { Host?: string } } };
        const endpoint = file.Endpoints?.docker?.Host;
        if (file.Name && endpoint && !contexts.some((c) => c.endpoint === endpoint)) {
          contexts.push({ name: file.Name, endpoint, supported: endpoint.startsWith('unix://') });
        }
      } catch {
        // A broken context file is not our problem to report here.
      }
    }
  }

  let current = contexts[0]?.name ?? '';
  try {
    const config = JSON.parse(readFileSync(join(homedir(), '.docker', 'config.json'), 'utf8')) as { currentContext?: string };
    if (config.currentContext && contexts.some((c) => c.name === config.currentContext)) current = config.currentContext;
  } catch {
    // No config, or none we can read: the first context is current.
  }
  return { contexts, current };
}

const clients = new Map<string, DockerClient>();

export function dockerClient(contextName: string): DockerClient {
  const { contexts } = listDockerContexts();
  const context = contexts.find((c) => c.name === contextName);
  if (!context) throw new Error(`unknown Docker context: ${contextName}`);
  if (!context.supported) throw new Error(`${contextName} is at ${context.endpoint}; only unix sockets are supported yet`);
  const socketPath = context.endpoint.replace(/^unix:\/\//, '');
  let client = clients.get(socketPath);
  if (!client) {
    client = new DockerClient(socketPath);
    clients.set(socketPath, client);
  }
  return client;
}
