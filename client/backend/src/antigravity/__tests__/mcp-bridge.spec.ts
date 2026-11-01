import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { AcpConnection } from '../acp-connection';
import { sessionMcpServer } from '../mcp-bridge';
import { AppMcpService } from '../../mcp/service';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';

describe('Antigravity session MCP bridge', () => {
  it('binds real collaboration calls to two different agents in the same repository', async () => {
    const snapshot = createEmptySnapshot();
    snapshot.agents = ['one', 'two'].map(id => ({ id, name: id, folder: '/fixture/repo', backend: 'antigravity', status: { type: 'idle' }, createdAt: '', updatedAt: '' }));
    const service = new AppMcpService({ snapshot });
    const endpoint = await service.start();
    const connections = snapshot.agents.map(agent => {
      const config = sessionMcpServer(`${endpoint}?agentId=${agent.id}`);
      const connection = new AcpConnection({ ...config, cwd: process.cwd(), env: { ...process.env, ...Object.fromEntries(config.env.map(entry => [entry.name, entry.value])) },
        onRequest: async () => { throw new Error('unexpected'); }, onNotification: () => {}, onClose: () => {},
      });
      connection.start(); return connection;
    });
    try {
      for (const connection of connections) {
        expect(await connection.request('server/discover', {})).toEqual({});
        expect(await connection.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'native-fixture', version: '1' } })).toMatchObject({ capabilities: { tools: {} } });
        connection.notify('notifications/initialized', {});
      }
      const lists = await Promise.all(connections.map(connection => connection.request('tools/list', {})));
      for (const list of lists) expect(list).toMatchObject({ tools: expect.arrayContaining([expect.objectContaining({ name: 'set-status' })]) });
      await Promise.all(connections.map((connection, index) => connection.request('tools/call', { name: 'set-status', arguments: { status: `isolated-${index}` } })));
      expect(snapshot.agents.map(agent => agent.statusText)).toEqual(['isolated-0', 'isolated-1']);
    } finally { await Promise.all(connections.map(connection => connection.close())); await service.stop(); }
  });
  it('keeps concurrent same-host identities isolated for regular and review discovery', async () => {
    const calls: string[] = [];
    const server = createServer(async (request, response) => {
      let text = ''; for await (const chunk of request) text += chunk;
      const input = JSON.parse(text);
      const url = new URL(request.url!, 'http://localhost');
      const identity = `${url.searchParams.get('agentId')}:${url.searchParams.get('reviewContextId') ?? 'regular'}`;
      calls.push(identity);
      response.setHeader('Content-Type', identity.endsWith('regular') ? 'application/json' : 'text/event-stream');
      const body = JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { tools: [{ name: identity.endsWith('regular') ? 'list-agents' : 'report-review-finding' }], identity } });
      response.end(identity.endsWith('regular') ? body : `event: message\ndata: ${body}\n\n`);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address() as { port: number };
    const endpoints = [`http://127.0.0.1:${address.port}/mcp?agentId=one`, `http://127.0.0.1:${address.port}/mcp?agentId=two&reviewContextId=review`];
    const connections = endpoints.map(endpoint => {
      const config = sessionMcpServer(endpoint);
      expect(config.name).toBe('korus');
      expect(config.args).not.toContain(endpoint);
      const connection = new AcpConnection({ ...config, cwd: process.cwd(), env: { ...process.env, ...Object.fromEntries(config.env.map(entry => [entry.name, entry.value])) },
        onRequest: async () => { throw new Error('unexpected'); }, onNotification: () => {}, onClose: () => {},
      });
      connection.start(); return connection;
    });
    try {
      const [regular, review] = await Promise.all(connections.map(connection => connection.request('tools/list', {})));
      expect(regular).toMatchObject({ identity: 'one:regular', tools: [{ name: 'list-agents' }] });
      expect(review).toMatchObject({ identity: 'two:review', tools: [{ name: 'report-review-finding' }] });
      expect(calls.sort()).toEqual(['one:regular', 'two:review']);
    } finally { await Promise.all(connections.map(connection => connection.close())); server.close(); await once(server, 'close'); }
  });
});
