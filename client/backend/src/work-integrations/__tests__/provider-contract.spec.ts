import { afterEach, expect, it, vi } from 'vitest';
import type { GlobalWorkItemQuery, WorkProviderKind } from '@workspace/core/contracts';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { mockWorkProvider as provider, mockWorkSource, mockWorkItem, registerMockWorkProvider } from '@workspace/core/__tests__/fixtures/mock-work-provider';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { workBacklogAssignmentFromWorkItem } from '@workspace/core/work-assignments';
import { workItemAssignmentPrompt, workItemBranchName } from '@workspace/core/work-item-prompts';
import { AppBackendServer } from '../../server';
import { WorkIntegrationManager } from '../manager';
import type { WorkProviderDriver } from '../types';

let unregister: (() => void) | undefined;
afterEach(() => { unregister?.(); });

it('routes a registered third source with opaque IDs through the protocol, assignments and prompts', async () => {
  unregister = registerMockWorkProvider();
  const source = mockWorkSource;
  const item = mockWorkItem;
  const token = { provider, accessToken: 'test-token', tokenType: 'Bearer', connectedAt: 'now' };
  const driver: WorkProviderDriver = {
    provider, configured: () => true, startAuthorization: vi.fn(), pollAuthorization: vi.fn(),
    currentAccountLabel: async () => 'Viewer', listSources: async () => [source],
    listItems: vi.fn(async () => [item]),
    listGlobalItems: vi.fn(async (_token: WorkProviderToken, query?: GlobalWorkItemQuery) => query?.cursor === 'opaque-next'
      ? { items: [] } : { items: [item], nextCursor: 'opaque-next' }),
  };
  const snapshot = createInitialSnapshot();
  const getToken = vi.fn(async (_provider: WorkProviderKind) => token);
  const manager = new WorkIntegrationManager({
    drivers: [driver], getSnapshot: () => snapshot, saveSnapshot: async () => {},
    tokenStore: { canStoreTokens: () => true, get: getToken, set: async () => {}, delete: async () => {} },
  });
  const server = new AppBackendServer({ version: 'test', snapshot, workIntegrations: manager });
  try {
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'workProvider/sources/list', params: { provider } })).toMatchObject({ result: [source] });
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'workProvider/items/list', params: { provider, sourceId: source.id, query: { state: 'all' } } })).toMatchObject({ result: [item] });
    expect(driver.listItems).toHaveBeenCalledWith(token, source.id, { state: 'all' });
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'workProvider/globalItems/list', params: { provider, query: { cursor: 'opaque-current', pageSize: 10 } } })).toMatchObject({ result: { items: [item], nextCursor: 'opaque-next' } });
    expect(driver.listGlobalItems).toHaveBeenCalledWith(token, { cursor: 'opaque-current', pageSize: 10 });
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'workProvider/globalItems/list', params: { provider, query: { cursor: 'opaque-next', pageSize: 10 } } })).toMatchObject({ result: { items: [] } });
    expect(getToken.mock.calls.every(([kind]) => kind === provider)).toBe(true);
    expect(workBacklogAssignmentFromWorkItem(item, 'agent', 'now').item).toEqual({
      provider, id: item.id, sourceId: source.id, sourceName: source.fullName,
      identifier: 'TASK-blue', title: item.title, body: item.body, url: item.url,
    });
    expect(workItemAssignmentPrompt(item)).toContain('this Mock work source issue');
    expect(workItemAssignmentPrompt(item)).toContain('Backlog source: Product');
    expect(workItemBranchName(item)).toBe('fix/task-blue');
  } finally { await server.close(); }
});
