import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ClusterRegistry } from '../clusters.ts';
import { ForwardManager } from '../forwards.ts';
import { SettingsStore } from '../settings.ts';
import { createMcpServer } from './server.ts';

/**
 * `mjolnir-mcp`: the same tools over stdio, for Claude Code, Cursor, Zed and
 * any other MCP client that launches a command. Writes follow the MCP
 * setting in ~/.mjolnir/settings.json, or MJOLNIR_MCP_WRITES=1.
 */
export async function runStdio(): Promise<void> {
  const registry = new ClusterRegistry();
  await registry.reload();
  const settings = new SettingsStore();
  const forwards = new ForwardManager(registry);
  const allowWrites = process.env['MJOLNIR_MCP_WRITES'] === '1' || settings.get().mcp.allowWrites;
  const server = createMcpServer({ registry, forwards, settings }, allowWrites);
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && /mcp[\\/](stdio|index)\.(ts|js)$/.test(process.argv[1])) {
  runStdio().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
