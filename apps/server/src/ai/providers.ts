import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { TOOLS, runTool, toolText, type ToolContext } from '../tools/index.ts';
import type { AiSettings } from '../settings.ts';

/**
 * One agent loop, two wire formats.
 *
 * Anthropic's Messages API and the OpenAI chat/completions shape that nearly
 * every other provider speaks (OpenAI, Azure, Gemini's compatible endpoint,
 * Ollama, OpenRouter, Groq, Mistral, xAI). The loop is the same: send the
 * conversation with the tools, run whatever the model calls, send the results
 * back, until it answers in prose. Events go to the caller as they happen.
 */

export type AiConfig = z.infer<typeof AiSettings>;

export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; text: string }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string };

const MAX_STEPS = 12;

export function systemPrompt(config: AiConfig, contextName: string | null): string {
  return [
    'You are the assistant inside Mjolnir, a Kubernetes desktop app. You investigate clusters with the tools provided and answer like a senior SRE: specific, short, and honest about uncertainty.',
    contextName ? `The user is currently looking at the cluster context "${contextName}". Use it unless they name another.` : '',
    'Start with get_cluster_summary or whats_wrong when asked what is wrong. Read logs with previous=true for crashed containers. Quote the exact reason, exit code and message you found.',
    config.allowWrites
      ? 'You may change the cluster with write tools. Say what you are about to change and why, in one line, before calling a write tool. Never delete a namespace or a node.'
      : 'Write tools are disabled. If a fix needs a change, give the exact kubectl command or YAML and say the user can enable writes in Settings.',
    'Use plain sentences and short lists. No em dashes. Do not restate the question.',
    config.instructions,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function toolSchema(tool: (typeof TOOLS)[number]): Record<string, unknown> {
  return z.toJSONSchema(tool.input) as Record<string, unknown>;
}

export async function runAnthropic(
  config: AiConfig,
  messages: ChatMessage[],
  context: ToolContext,
  contextName: string | null,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const client = new Anthropic({ apiKey: config.apiKey, ...(config.baseUrl ? { baseURL: config.baseUrl } : {}) });
  const tools = TOOLS.map((tool) => ({ name: tool.name, description: tool.description, input_schema: toolSchema(tool) as Anthropic.Tool['input_schema'] }));
  const history: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (signal.aborted) return;
    const stream = client.messages.stream(
      { model: config.model, max_tokens: 4096, system: systemPrompt(config, contextName), tools, messages: history },
      { signal },
    );
    stream.on('text', (text) => emit({ type: 'text', text }));
    const message = await stream.finalMessage();
    history.push({ role: 'assistant', content: message.content });

    const calls = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    if (message.stop_reason !== 'tool_use' || calls.length === 0) {
      emit({ type: 'done', stopReason: message.stop_reason ?? 'end_turn' });
      return;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      emit({ type: 'tool_call', id: call.id, name: call.name, input: call.input });
      const outcome = await execute(call.name, call.input, context, config.allowWrites);
      emit({ type: 'tool_result', id: call.id, name: call.name, ok: outcome.ok, text: outcome.text });
      results.push({ type: 'tool_result', tool_use_id: call.id, content: outcome.text, is_error: !outcome.ok });
    }
    history.push({ role: 'user', content: results });
  }
  emit({ type: 'done', stopReason: 'max_steps' });
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export async function runOpenAi(
  config: AiConfig,
  messages: ChatMessage[],
  context: ToolContext,
  contextName: string | null,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const base = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const tools = TOOLS.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: toolSchema(tool) } }));
  const history: OpenAiMessage[] = [
    { role: 'system', content: systemPrompt(config, contextName) },
    ...messages.map((m): OpenAiMessage => ({ role: m.role, content: m.content })),
  ];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (signal.aborted) return;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}`, 'api-key': config.apiKey } : {}) },
      body: JSON.stringify({ model: config.model, messages: history, tools, tool_choice: 'auto', max_tokens: 4096 }),
      signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 400)}`);
    const body = (await response.json()) as { choices?: Array<{ message: OpenAiMessage; finish_reason?: string }> };
    const choice = body.choices?.[0];
    if (!choice) throw new Error('the provider returned no choices');
    const message = choice.message;
    history.push(message);
    if (message.content) emit({ type: 'text', text: message.content });

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      emit({ type: 'done', stopReason: choice.finish_reason ?? 'stop' });
      return;
    }
    for (const call of calls) {
      let input: unknown = {};
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        input = {};
      }
      emit({ type: 'tool_call', id: call.id, name: call.function.name, input });
      const outcome = await execute(call.function.name, input, context, config.allowWrites);
      emit({ type: 'tool_result', id: call.id, name: call.function.name, ok: outcome.ok, text: outcome.text });
      history.push({ role: 'tool', tool_call_id: call.id, content: outcome.text });
    }
  }
  emit({ type: 'done', stopReason: 'max_steps' });
}

async function execute(name: string, input: unknown, context: ToolContext, allowWrites: boolean): Promise<{ ok: boolean; text: string }> {
  try {
    return { ok: true, text: toolText(await runTool(name, input, context, allowWrites)) };
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
}
