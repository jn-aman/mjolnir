import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ToolContext } from '../tools/index.ts';
import { createMcpServer } from '../mcp/server.ts';
import { HttpError, handle } from '../http.ts';

/**
 * MCP over HTTP at /mcp, for agents on this machine that speak Streamable
 * HTTP. Off by default; when on, every request needs the bearer token from
 * Settings. Stateless: each request gets its own server instance.
 */
export function mcpRoutes(context: ToolContext, flags: { value(id: string): boolean }): Router {
  const router = Router();

  const guard = (authorization: string | undefined) => {
    const mcp = context.settings.get().mcp;
    // Two gates, and they mean different things. The flag says whether this
    // build has the feature; the setting says whether this person turned it
    // on. A flag that only changed what a settings page looked like, while
    // the port kept answering, would be worse than no flag.
    if (!flags.value('mcp.http')) throw HttpError.notFound('MCP over HTTP is not available in this build.');
    if (!mcp.http) throw HttpError.notFound('MCP over HTTP is off. Turn it on in Settings › MCP server.');
    const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
    if (!mcp.token || token !== mcp.token) throw new HttpError(401, 'auth', 'invalid MCP token');
    return mcp.allowWrites;
  };

  router.all(
    '/',
    handle(async (req, res) => {
      const allowWrites = guard(req.header('authorization'));
      const server = createMcpServer(context, allowWrites);
      // No session id generator: stateless, one server per request.
      const transport = new StreamableHTTPServerTransport({});
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
      await transport.handleRequest(req, res, req.body);
    }),
  );

  return router;
}
