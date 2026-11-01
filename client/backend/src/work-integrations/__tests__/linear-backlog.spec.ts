import { afterEach, expect, it, vi } from 'vitest';
import { LinearWorkProviderDriver } from '../linear-driver';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppBackendServer } from '../../server';
import { WorkIntegrationManager } from '../manager';
import { readyRemoteConnection } from '../../__tests__/server-test-fixtures';

const token: WorkProviderToken = { provider: 'linear', accessToken: 'test', tokenType: 'Bearer', accountLabel: 'Alex · Acme', connectedAt: '2026-01-01' };
const driver = new LinearWorkProviderDriver(() => ({}));
const page = (nodes: unknown[], endCursor: string | null = null) => ({ nodes, pageInfo: { hasNextPage: Boolean(endCursor), endCursor } });
const issue = (id: string, type = 'started') => ({ id, identifier: `ENG-${id}`, number: Number(id), title: 'Fix login', description: 'Details', url: `https://linear.app/acme/issue/ENG-${id}`, state: { type, name: type }, team: { id: 'team', name: 'Engineering' }, project: null, assignee: { id: 'viewer', name: 'Alex' }, creator: { name: 'Sam' }, labels: page([{ name: 'bug', color: '#ff0000' }]), createdAt: '2026-01-01', updatedAt: '2026-01-02' });
afterEach(() => vi.unstubAllGlobals());

it('round trips a remote Linear issue through the app-owned protocol and owning host driver', async () => {
  const snapshot = createInitialSnapshot();
  const remoteSnapshot = createInitialSnapshot();
  const connection = readyRemoteConnection();
  snapshot.remoteConnections.connections = [connection];
  const manager = new WorkIntegrationManager({ drivers: [driver], getSnapshot: () => remoteSnapshot, saveSnapshot: async () => {}, tokenStore: { canStoreTokens: () => true, get: async () => token, set: async () => {}, delete: async () => {} } });
  const remote = new AppBackendServer({ version: 'test', snapshot: remoteSnapshot, workIntegrations: manager });
  const request = vi.fn(async (_connection: unknown, method: string, params: unknown) => {
    const reply = await remote.handleMessage({ jsonrpc: '2.0', id: 2, method, params }) as { result: unknown; error?: unknown };
    if (reply.error) throw new Error(JSON.stringify(reply.error));
    return reply.result;
  });
  const local = new AppBackendServer({ version: 'test', snapshot, remoteClients: { request, close: async () => {} } as never });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { query } = JSON.parse(init.body);
    if (query.includes('viewer')) return Response.json({ data: { viewer: { id: 'viewer' } } });
    if (query.includes('team(id:')) return Response.json({ data: { team: { id: 'team' } } });
    return Response.json({ data: { issues: page([issue('1')]) } });
  }));
  try {
    expect(await remote.handleMessage({ jsonrpc: '2.0', id: 'configure', method: 'workProvider/backlog/configure', params: { input: { provider: 'linear', configuration: { sourceId: 'linear:team', tagName: 'bug' } } } })).toMatchObject({ result: { workBacklog: { providerConfigurations: { linear: { sourceId: 'linear:team', tagName: 'bug' } } } } });
    await expect(remote.handleMessage({ jsonrpc: '2.0', id: 'invalid', method: 'workProvider/backlog/configure', params: { input: { provider: '__proto__', configuration: {} } } })).rejects.toThrow('Unsupported work provider');
    const result = await local.handleMessage({ jsonrpc: '2.0', id: 1, method: 'workProvider/items/list', params: { provider: 'linear', sourceId: 'linear:team', location: { kind: 'remote', remoteConnectionId: connection.id }, query: { kind: 'issue', state: 'all' } } });
    expect(result).toMatchObject({ result: [{ provider: 'linear', id: 'linear:1', identifier: 'ENG-1', body: 'Details' }] });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ id: connection.id }), 'workProvider/items/list', expect.objectContaining({ provider: 'linear', sourceId: 'linear:team', query: { kind: 'issue', state: 'all' } }), expect.any(Function));
    expect(snapshot.workBacklog.providerConfigurations).toEqual({});
  } finally { await local.close(); await remote.close(); }
});

it('loads team and project scopes across pages without equating them to code repositories', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    if (query.includes('teams(')) return Response.json({ data: { teams: variables.after ? page([{ id: 'other', name: 'Other', key: 'OTH', organization: { urlKey: 'acme' } }]) : page([{ id: 'team', name: 'Engineering', key: 'ENG', organization: { urlKey: 'acme' } }], 'next') } });
    return Response.json({ data: { team: { projects: page([{ id: 'project', name: 'Release', url: 'https://linear.app/acme/project/release' }]) } } });
  }));
  const sources = await driver.listSources(token);
  expect(sources.map(s => s.id)).toEqual(['linear:team', 'linear:team:project', 'linear:other', 'linear:other:project']);
  expect(sources[1]).toMatchObject({ id: 'linear:team:project', fullName: 'Engineering / Release' });
});

it('scopes issues by stable IDs, follows every cursor, maps states and retains native identity and details', async () => {
  const filters: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    if (query.includes('viewer')) return Response.json({ data: { viewer: { id: 'viewer' } } });
    if (query.includes('team(id:')) return Response.json({ data: { team: { id: 'team' }, project: { id: 'project' } } });
    filters.push(variables.filter);
    return Response.json({ data: { issues: variables.after ? page([issue('2', 'completed'), issue('3', 'canceled')]) : page([issue('1')], 'next') } });
  }));
  const items = await driver.listItems(token, 'linear:team:project', { state: 'all' });
  expect(filters).toEqual([{ team: { id: { eq: 'team' } }, project: { id: { eq: 'project' } } }, { team: { id: { eq: 'team' } }, project: { id: { eq: 'project' } } }]);
  expect(items.map(i => [i.id, i.identifier, i.state])).toEqual([['linear:1', 'ENG-1', 'open'], ['linear:2', 'ENG-2', 'closed'], ['linear:3', 'ENG-3', 'closed']]);
  expect(items[0]).toMatchObject({ sourceId: 'linear:team:project', body: 'Details', assignees: ['Alex'], assignedToViewer: true, labels: [{ name: 'bug', color: 'ff0000' }], nativeState: 'started' });
  expect(await driver.listItems(token, 'linear:team', { kind: 'pullRequest' })).toEqual([]);
});

it('loads only the requested cursor page and filters on the viewer ID without requiring a total', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    if (query.includes('viewer')) return Response.json({ data: { viewer: { id: 'viewer' } } });
    expect(variables.filter).toEqual({ assignee: { id: { eq: 'viewer' } }, state: { type: { nin: ['completed', 'canceled'] } } });
    return Response.json({ data: { issues: variables.after ? page([issue('3')]) : page([issue('1'), issue('2')], 'next') } });
  }));
  const first = await driver.listGlobalItems(token, { assignment: 'viewer', pageSize: 2 });
  expect(first).toMatchObject({ items: [{ identifier: 'ENG-1' }, { identifier: 'ENG-2' }], nextCursor: 'next' });
  expect(first.totalItems).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(2);
  const second = await driver.listGlobalItems(token, { assignment: 'viewer', cursor: first.nextCursor, pageSize: 2 });
  expect(second).toMatchObject({ items: [{ identifier: 'ENG-3' }] });
  expect(second.nextCursor).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(4);
});

it.each([{ errors: [{ message: 'denied' }] }, { data: { teams: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } }, { data: { teams: page([{ name: 'missing id' }]) } }])('rejects API errors and malformed pages instead of reporting an empty success', async response => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response)));
  await expect(driver.listSources(token)).rejects.toThrow(/Linear/);
});
