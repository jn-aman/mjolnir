import { Router } from 'express';
import { z } from 'zod';
import type { ToolContext } from '../tools/index.ts';
import { TOOLS } from '../tools/index.ts';
import { runAnthropic, runOpenAi, type AgentEvent } from '../ai/providers.ts';
import { HttpError, handle } from '../http.ts';

const ChatRequest = z.object({
  context: z.string().nullable().optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1),
});

/**
 * POST /api/ai/chat streams the agent's events as SSE: text deltas, tool
 * calls, tool results, done. The key never leaves the server.
 */
export function aiRoutes(context: ToolContext): Router {
  const router = Router();

  router.get(
    '/tools',
    handle(async (_req, res) => {
      res.json({ tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, kind: tool.kind })) });
    }),
  );

  router.post(
    '/chat',
    handle(async (req, res) => {
      const parsed = ChatRequest.safeParse(req.body);
      if (!parsed.success) throw HttpError.badRequest(parsed.error.message);
      const config = context.settings.get().ai;
      if (!config.apiKey && config.provider === 'anthropic') {
        throw HttpError.badRequest('No API key. Add one in Settings › AI assistant.');
      }
      if (!config.model) throw HttpError.badRequest('No model set. Choose one in Settings › AI assistant.');

      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('x-accel-buffering', 'no');
      res.flushHeaders();
      const controller = new AbortController();
      req.on('close', () => controller.abort());
      const emit = (event: AgentEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      try {
        const run = config.provider === 'anthropic' ? runAnthropic : runOpenAi;
        await run(config, parsed.data.messages, context, parsed.data.context ?? null, emit, controller.signal);
      } catch (error) {
        emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      res.end();
    }),
  );

  return router;
}
