import type { z } from 'zod';
import type { ClusterRegistry } from '../clusters.ts';
import type { ForwardManager } from '../forwards.ts';
import type { SettingsStore } from '../settings.ts';
import { K8S_TOOLS } from './k8s.ts';

/**
 * Operations, declared once.
 *
 * The MCP server, the in-app assistant and any future automation call the
 * same list. A tool is a name, a sentence, a schema and a function; whether
 * it is read or write decides who may call it. Adding one here adds it to
 * every agent at once.
 */

export interface ToolContext {
  readonly registry: ClusterRegistry;
  readonly forwards: ForwardManager;
  readonly settings: SettingsStore;
}

export interface ToolDefinition<I = unknown> {
  readonly name: string;
  readonly description: string;
  readonly kind: 'read' | 'write';
  readonly input: z.ZodObject<z.ZodRawShape>;
  readonly run: (input: I, context: ToolContext) => Promise<unknown>;
}

export const TOOLS: readonly ToolDefinition[] = [...K8S_TOOLS] as readonly ToolDefinition[];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/** Bounded text for a model: an agent does not need 4 MB of managedFields. */
export function toolText(result: unknown, limit = 24_000): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters truncated)` : text;
}

export async function runTool(name: string, rawInput: unknown, context: ToolContext, allowWrites: boolean): Promise<unknown> {
  const tool = toolByName(name);
  if (!tool) throw new Error(`no such tool: ${name}`);
  if (tool.kind === 'write' && !allowWrites) {
    throw new Error(`${name} changes the cluster and writes are not allowed for this agent. Turn on "Allow writes" in Settings to permit it.`);
  }
  const input = tool.input.parse(rawInput ?? {});
  return tool.run(input, context);
}
