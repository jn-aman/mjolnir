import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS, runTool, toolText, type ToolContext } from '../tools/index.ts';

/**
 * The MCP face of the operations registry. Every tool is registered with its
 * schema; write tools are refused unless the caller was allowed them.
 */
export function createMcpServer(context: ToolContext, allowWrites: boolean): McpServer {
  const server = new McpServer({ name: 'mjolnir', version: '0.1.0' });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: `${tool.description}${tool.kind === 'write' ? ' (write)' : ''}`,
        inputSchema: tool.input.shape,
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await runTool(tool.name, args, context, allowWrites);
          return { content: [{ type: 'text', text: toolText(result) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
        }
      },
    );
  }
  return server;
}
