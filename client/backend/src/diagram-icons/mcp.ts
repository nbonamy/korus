import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod/v4';
import { fetchTechIcon, type DiagramIconResolver } from './resolver';

export function registerFetchIconTool(
  server: McpServer,
  fetchIcon: (icon: string) => ReturnType<typeof fetchTechIcon>,
) {
  server.registerTool(
    'fetch_tech_icon',
    {
      description:
        'Fetch a technology logo or Lucide role icon for a native diagram. Return base64 bytes, MIME type, source, contrast hints and available dark variants. Use a technology name (vue), name:slug, lucide/database or aws/lambda. Embed the returned payload directly in the saved diagram. Available for diagram authoring; Diff Viz uses an isolated job.',
      inputSchema: { icon: z.string().min(1).max(500) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ icon }) => {
      try {
        const result = await fetchIcon(icon);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Icon retrieval failed.' }],
        };
      }
    },
  );
}

/** Private capability endpoint: no agent identity, collaboration tools or shared MCP configuration. */
export async function openIconMcpScope(resolver?: DiagramIconResolver) {
  let closed = false;
  let calls = 0;
  const token = randomUUID();
  const pathname = '/mcp/' + token;
  const server = http.createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== pathname) {
        response.writeHead(404).end();
        return;
      }
      let transport: StreamableHTTPServerTransport | undefined;
      let mcp: McpServer | undefined;
      try {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > 16384) throw new Error('Icon MCP request exceeds the size limit.');
          chunks.push(Buffer.from(chunk));
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
        mcp = new McpServer({ name: 'diagram-icons', version: '1.0.0' });
        registerFetchIconTool(mcp, async (icon) => {
          if (closed) throw new Error('Icon job is closed.');
          if (++calls > 24) throw new Error('A diagram can fetch up to 24 icons.');
          return fetchTechIcon(icon, resolver);
        });
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        response.once('close', () => {
          void mcp?.close().catch(() => {});
        });
        await mcp.connect(transport);
        await transport.handleRequest(request, response, body);
      } catch {
        if (!response.headersSent && !response.destroyed)
          response.writeHead(400, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32600, message: 'Invalid icon MCP request.' },
            }),
          );
        await transport?.close().catch(() => {});
      }
    })();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    server.close();
    throw error;
  }
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${pathname}`;
  return {
    url,
    name: 'diagram_icons_' + token.replaceAll('-', ''),
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
