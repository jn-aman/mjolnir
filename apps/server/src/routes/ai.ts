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
export function aiRoutes(context: ToolContext, flags: { value(id: string): boolean }): Router {
  const router = Router();

  router.get(
    '/tools',
    handle(async (_req, res) => {
      // The assistant is told about the tools it may actually run. Listing
      // one it is not allowed to call would make the model promise something
      // and then fail, which reads as the assistant being broken.
      const canCall = flags.value('assistant.tool-calls');
      const canWrite = flags.value('assistant.writes') && context.settings.get().ai.allowWrites;
      const allowed = canCall ? TOOLS.filter((tool) => canWrite || tool.kind !== 'write') : [];
      res.json({ tools: allowed.map((tool) => ({ name: tool.name, description: tool.description, kind: tool.kind })), canCall, canWrite });
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
      /*
       * The response closing means the reader left. The request closing does
       * not mean anything of the sort.
       *
       * This listened on `req`, and an IncomingMessage emits `close` once its
       * body has been read, which `express.json()` does before this handler
       * even runs. So the signal fired immediately on every call and aborted
       * the model mid-sentence: "Test failed: This operation was aborted",
       * every time, for a provider that was answering perfectly well.
       *
       * `writableEnded` is what tells a client that hung up apart from a
       * stream that finished normally, which also closes the response.
       */
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      const emit = (event: AgentEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      try {
        const run = config.provider === 'anthropic' ? runAnthropic : runOpenAi;
        await run(config, parsed.data.messages, context, parsed.data.context ?? null, emit, controller.signal);
      } catch (error) {
        emit({ type: 'error', message: describe(error) });
      }
      res.end();
    }),
  );

  return router;
}

/**
 * A failure in words somebody can act on.
 *
 * An AbortError's own message is "This operation was aborted", which says
 * nothing about what to do and reads like a bug in this app rather than a
 * provider that did not answer.
 */
function describe(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'The provider did not answer in time, or the request was cancelled. Check the base URL and try again.';
  }
  if (error instanceof Error && /fetch failed|ENOTFOUND|ECONNREFUSED/i.test(error.message)) {
    return 'Could not reach the provider. Check the base URL and that this machine can reach it.';
  }
  return error instanceof Error ? error.message : String(error);
}
