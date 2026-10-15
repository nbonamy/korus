import { product } from '@workspace/core/product';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { logMain, warnMain } from '../log';
import type { AppMcpAgentCoordinator } from './agent-coordinator';
import { createAppMcpServer } from './tools';
import type { ComputerUseClient } from './computer-use-tools';
import type { InAppBrowserClient } from './browser-tools';
import type { HostedMcpGateway, HostedMcpServerId } from './hosted-mcp-gateway';
import type { ReviewToolRegistry } from '../review/review-tool-registry';
import { createCollaborationToolModuleProvider } from './collaboration-tools';
import { createMissionToolModuleProvider } from './mission-tools';
import { createSkillToolModuleProvider } from './skill-tools';
import { createMissionReviewToolModuleProvider } from './mission-review-tools';
import {
  createBrowserToolModuleProvider,
  createComputerUseToolModuleProvider,
  createReviewToolModuleProvider,
} from './adapter-tool-modules';
import { resolveAppMcpToolModules, type AppMcpToolModuleProvider } from './tool-modules';

const maxBodyBytes = 1024 * 1024;

export type AppMcpHttpServerOptions = {
  coordinator: AppMcpAgentCoordinator;
  computerUse?: ComputerUseClient;
  computerUseEnabled?: () => boolean;
  browser?: InAppBrowserClient;
  hostedMcpGateway?: HostedMcpGateway;
  reviewTools?: ReviewToolRegistry;
  toolModuleProviders?: readonly AppMcpToolModuleProvider[];
  host?: string;
  port?: number;
};

export class AppMcpHttpServer {
  private readonly coordinator: AppMcpAgentCoordinator;
  private readonly hostedMcpGateway: HostedMcpGateway | undefined;
  private readonly toolModuleProviders: readonly AppMcpToolModuleProvider[];
  private readonly host: string;
  private readonly port: number;
  private server: http.Server | null = null;
  private url: string | null = null;

  constructor(options: AppMcpHttpServerOptions) {
    this.coordinator = options.coordinator;
    this.hostedMcpGateway = options.hostedMcpGateway;
    const computerUseEnabled = options.computerUseEnabled ?? (() => true);
    const providers = [
      createCollaborationToolModuleProvider(this.coordinator),
      createMissionToolModuleProvider(this.coordinator),
      createMissionReviewToolModuleProvider(this.coordinator),
      createComputerUseToolModuleProvider(options.computerUse, computerUseEnabled),
      createBrowserToolModuleProvider(options.browser),
      createReviewToolModuleProvider(options.reviewTools),
      ...(options.toolModuleProviders ?? []),
    ];
    this.toolModuleProviders = [
      ...providers,
      createSkillToolModuleProvider(this.coordinator, request =>
        resolveAppMcpToolModules(providers, request).map(module => module.id)),
    ];
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
  }

  async start(): Promise<string> {
    if (this.url) {
      return this.url;
    }

    const server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    const address = server.address() as AddressInfo;
    this.server = server;
    this.url = `http://${this.host}:${address.port}/mcp`;
    logMain('mcp-http', 'listening', { url: this.url });
    return this.url;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }

    this.server = null;
    this.url = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  hostedMcpServerUrls(): Record<string, string> {
    if (!this.url || !this.hostedMcpGateway) return {};
    return this.hostedMcpGateway.enabledServerUrls(this.url);
  }

  reviewMcpServerUrl(agentId: string, reviewContextId: string): string {
    if (!this.url) throw new Error('MCP server has not started.');
    const url = new URL(this.url);
    url.searchParams.set('agentId', agentId);
    url.searchParams.set('reviewContextId', reviewContextId);
    return url.toString();
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${this.host}`);

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        writeText(response, 200, 'OK');
        return;
      }

      if (request.method === 'GET' && url.pathname === '/') {
        writeJson(response, 200, this.coordinator.debugAgents());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/mcp') {
        await this.handleMcpPost(request, response, url);
        return;
      }

      const hostedServerId = hostedMcpServerId(url.pathname);
      if (hostedServerId && this.hostedMcpGateway?.hasServer(hostedServerId)) {
        await this.handleHostedMcpRequest(request, response, url, hostedServerId);
        return;
      }

      if ((request.method === 'GET' || request.method === 'DELETE') && url.pathname === '/mcp') {
        writeJsonRpcError(response, 405, -32000, 'Method not allowed.');
        return;
      }

      writeText(response, 404, 'Not found');
    } catch (error) {
      warnMain('mcp-http', 'request failed', {
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!response.headersSent) {
        writeJsonRpcError(response, 500, -32603, error instanceof Error ? error.message : 'Internal server error');
      } else {
        response.end();
      }
    }
  }

  private async handleMcpPost(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const body = await readJsonBody(request);
    const agentId = url.searchParams.get('agentId');
    const requestSummary = summarizeMcpRequest(body, agentId ?? undefined);
    const startedAt = Date.now();
    logMain('mcp-http', 'request', requestSummary);
    if (!agentId) {
      writeJsonRpcError(response, 400, -32000, `Bad Request: missing ${product.name} agent identity`);
      warnMain('mcp-http', 'rejected request', requestSummary);
      return;
    }
    if (!request.headers['mcp-session-id'] && !isInitializeRequest(body) && !isStatelessMcpRequest(body)) {
      writeJsonRpcError(response, 400, -32000, 'Bad Request: invalid MCP request');
      warnMain('mcp-http', 'rejected request', requestSummary);
      return;
    }

    this.coordinator.connectAgent(agentId);
    const mcpServer = createAppMcpServer({ agentId, url }, this.toolModuleProviders);
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
    });
    let closed = false;
    const closeTransport = async () => {
      if (closed) {
        return;
      }
      closed = true;
      await transport.close();
      await mcpServer.close();
    };

    await mcpServer.connect(transport);
    response.on('close', () => {
      void closeTransport();
    });
    try {
      await transport.handleRequest(request, response, body);
      logMain('mcp-http', 'response', {
        ...requestSummary,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      await closeTransport();
    }
  }

  private async handleHostedMcpRequest(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    serverId: HostedMcpServerId,
  ): Promise<void> {
    const gateway = this.hostedMcpGateway;
    if (!gateway) {
      writeText(response, 404, 'Not found');
      return;
    }
    const agentId = url.searchParams.get('agentId');
    if (!agentId) {
      writeJsonRpcError(response, 400, -32000, `Bad Request: missing ${product.name} agent identity`);
      return;
    }

    // Apply the same known-agent boundary as the collaboration endpoint.
    this.coordinator.connectAgent(agentId);
    const body = request.method === 'POST' ? await readBody(request) : undefined;
    const startedAt = Date.now();
    logMain('mcp-http', 'hosted request', { serverId, agentId, method: request.method });
    const upstream = await gateway.forward(serverId, {
      method: request.method ?? 'POST',
      headers: new Headers(request.headers as Record<string, string>),
      ...(body ? { body } : {}),
    });
    await writeUpstreamResponse(response, upstream);
    logMain('mcp-http', 'hosted response', {
      serverId,
      agentId,
      method: request.method,
      status: upstream.status,
      durationMs: Date.now() - startedAt,
    });
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const raw = (await readBody(request)).toString('utf8');
  if (!raw.trim()) {
    return undefined;
  }

  return JSON.parse(raw) as unknown;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBodyBytes) {
      throw new Error('MCP request body is too large');
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function hostedMcpServerId(pathname: string): string | null {
  const match = /^\/mcp\/providers\/([^/]+)$/.exec(pathname);
  return match?.[1] ?? null;
}

async function writeUpstreamResponse(response: ServerResponse, upstream: Response): Promise<void> {
  const headers: Record<string, string> = {};
  for (const name of ['cache-control', 'content-type', 'mcp-session-id'] as const) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  response.writeHead(upstream.status, headers);
  if (!upstream.body) {
    response.end();
    return;
  }
  for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
    response.write(Buffer.from(chunk));
  }
  response.end();
}

function isStatelessMcpRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const method = (body as { method?: unknown }).method;
  return method === 'tools/list' || method === 'tools/call' || method === 'notifications/initialized' || method === 'shutdown';
}

function summarizeMcpRequest(body: unknown, urlAgentId?: string): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    return { method: 'unknown', agentId: urlAgentId };
  }

  const record = body as {
    id?: unknown;
    method?: unknown;
    params?: {
      name?: unknown;
      arguments?: Record<string, unknown>;
    };
  };
  const toolArgs = record.params?.arguments && typeof record.params.arguments === 'object'
    ? record.params.arguments
    : undefined;

  return {
    id: typeof record.id === 'string' || typeof record.id === 'number' ? record.id : undefined,
    method: typeof record.method === 'string' ? record.method : 'unknown',
    tool: typeof record.params?.name === 'string' ? record.params.name : undefined,
    agentId: urlAgentId,
    to: typeof toolArgs?.to === 'string' ? toolArgs.to : undefined,
  };
}

function writeText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/plain' });
  response.end(body);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function writeJsonRpcError(response: ServerResponse, httpStatus: number, code: number, message: string): void {
  writeJson(response, httpStatus, {
    jsonrpc: '2.0',
    error: {
      code,
      message,
    },
    id: null,
  });
}
