import { afterEach, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { decodeAppSnapshot } from '@workspace/core/snapshot-guards';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import { GitLabWorkProviderDriver } from '../gitlab-driver';
import { GitHubWorkProviderDriver } from '../github-driver';
import { WorkIntegrationManager } from '../manager';
import { MemoryWorkIntegrationTokenStore } from '../memory-token-store';
import { AppBackendServer } from '../../server';

// External response failures: lost continuation, wrong namespace/kind, merged-state
// loss, secret-bearing failures, accidental native mutations and cross-provider state.
afterEach(() => vi.restoreAllMocks());
const source = 'gitlab.com/group/sub/repo';
function native(kind: 'issues' | 'merge_requests', iid = 7, state = 'opened') {
  return { id: kind === 'issues' ? 70 : 80, iid, project_id: 12, title: `${kind} ${iid}`, state,
    web_url: `https://gitlab.com/group/sub/repo/-/${kind}/${iid}`, description: 'Private details',
    labels: ['bug'], author: { username: 'author' }, assignees: [{ username: 'alice' }],
    source_branch: 'review/topic', created_at: '2026-01-01', updated_at: '2026-02-01' };
}
async function fixture() {
  const snapshot = createInitialSnapshot();
  const tokenStore = new MemoryWorkIntegrationTokenStore();
  for (const provider of ['github', 'gitlab'] as const) await tokenStore.set({ provider, accessToken: 'secret', tokenType: 'Bearer', accountLabel: 'alice', connectedAt: 'then' });
  const manager = new WorkIntegrationManager({ drivers: [new GitLabWorkProviderDriver('client'), new GitHubWorkProviderDriver('client')], tokenStore, getSnapshot: () => snapshot, saveSnapshot: async () => {} });
  return { manager, snapshot };
}
it('reads complete project issues and MRs with distinct native identities, details and persisted assignments', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input));
    const kind = url.pathname.endsWith('/issues') ? 'issues' : 'merge_requests';
    expect(url.pathname).toContain('group%2Fsub%2Frepo');
    expect(url.searchParams.get('scope')).toBe('all');
    return Response.json([native(kind, url.searchParams.get('page') === '2' ? 8 : 7, kind === 'issues' ? 'opened' : 'merged')], { headers: { 'x-next-page': url.searchParams.get('page') === '1' ? '2' : '' } });
  });
  const { manager, snapshot } = await fixture();
  const server = new AppBackendServer({ version: 'test', snapshot, workIntegrations: manager });
  try {
    const response = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'workProvider/items/list', params: { provider: 'gitlab', sourceId: source, query: { state: 'all' } } });
    const items = (response as { result: import('@workspace/core/contracts').WorkItem[] }).result;
    expect(items).toHaveLength(4);
    expect(items[0]).toStrictEqual({ provider: 'gitlab', id: `${source}#7`, kind: 'issue', sourceId: source, sourceName: 'group/sub/repo', number: 7, identifier: '#7', nativeState: 'opened', assignedToViewer: true, title: 'issues 7', url: 'https://gitlab.com/group/sub/repo/-/issues/7', state: 'open', body: 'Private details', authorName: 'author', assignees: ['alice'], labels: [{ name: 'bug' }], createdAt: '2026-01-01', updatedAt: '2026-02-01' });
    expect(items[2]).toMatchObject({ id: `${source}!7`, identifier: '!7', kind: 'pullRequest', state: 'closed', nativeState: 'merged', branchName: 'review/topic' });
    for (const item of [items[0]!, items[2]!]) {
      await server.handleMessage({ jsonrpc: '2.0', id: item.id, method: 'agent/workItem/assign', params: { agentId: snapshot.agents[0]!.id, item } });
      expect(snapshot.workBacklog.assignments[workItemAssignmentKey(item)]).toMatchObject({ provider: 'gitlab', itemId: item.id, status: 'inProgress' });
    }
    await manager.configureBacklog({ provider: 'gitlab', configuration: { sourceId: source, assigneeLogin: 'alice', tagName: 'bug' } });
    await manager.configureBacklog({ provider: 'github', configuration: { sourceId: 'org/repo' } });
    const restored = decodeAppSnapshot(JSON.parse(JSON.stringify(snapshot)))!.value;
    expect(Object.keys(restored.workBacklog.assignments)).toStrictEqual([`gitlab:${source}#7`, `gitlab:${source}!7`]);
    expect(restored.workBacklog.providerConfigurations.gitlab).toStrictEqual({ sourceId: source, assigneeLogin: 'alice', tagName: 'bug' });
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  } finally { await server.close(); }
});
it.each(['network', 'non-json', 'foreign item', 'changed pagination filters'])('sanitizes %s failures at the GitLab read boundary', async failure => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (failure === 'network') throw new Error('secret upstream diagnostic');
    if (failure === 'non-json') return new Response('secret upstream diagnostic');
    if (failure === 'foreign item') return Response.json([{ ...native('issues'), web_url: 'https://attacker.test/group/repo/-/issues/7' }]);
    return Response.json([native('issues')], { headers: { link: '<https://gitlab.com/api/v4/projects/group%2Fsub%2Frepo/issues?scope=created_by_me&page=2>; rel="next"' } });
  });
  const { manager } = await fixture();
  try {
    await expect(manager.listItems('gitlab', source, { kind: 'issue' })).rejects.toThrow(/GitLab/);
    await expect(manager.listItems('gitlab', source, { kind: 'issue' })).rejects.not.toThrow('secret upstream diagnostic');
  } finally { manager.close(); }
});
it('pages assigned global issues and MRs without truncation or reusing a cursor with different filters', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input));
    expect(url.searchParams.get('scope')).toBe('assigned_to_me');
    const kind = url.pathname.endsWith('/issues') ? 'issues' : 'merge_requests';
    return Response.json([native(kind)], { headers: { 'x-next-page': '' } });
  });
  const { manager } = await fixture();
  try {
    const first = await manager.listGlobalItems('gitlab', { assignment: 'viewer', pageSize: 1 });
    expect(first.items.map(item => item.identifier)).toStrictEqual(['#7']);
    expect(first.nextCursor).toBeTruthy();
    const second = await manager.listGlobalItems('gitlab', { assignment: 'viewer', pageSize: 1, cursor: first.nextCursor });
    expect(second.items.map(item => item.identifier)).toStrictEqual(['!7']);
    expect(second.nextCursor).toBeUndefined();
    await expect(manager.listGlobalItems('gitlab', { kind: 'issue', cursor: first.nextCursor })).rejects.toThrow(/page|cursor/i);
    expect((await manager.listAssignedItems('gitlab')).map(item => item.identifier)).toStrictEqual(['#7', '!7']);
  } finally { manager.close(); }
});
it('browses all accessible project work without the restricted GitLab.com global scope=all endpoint', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v4/projects') return Response.json([{ path: 'repo', path_with_namespace: 'group/sub/repo', web_url: 'https://gitlab.com/group/sub/repo', visibility: 'private' }]);
    expect(url.pathname).toContain('/projects/group%2Fsub%2Frepo/');
    return Response.json([native('issues')], { headers: { 'x-next-page': '' } });
  });
  const { manager } = await fixture();
  try { expect((await manager.listGlobalItems('gitlab', { kind: 'issue' })).items[0]?.sourceId).toBe(source); }
  finally { manager.close(); }
});
it('advances past empty issue streams to the first accessible merge request in a global feed', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/projects')) return Response.json([{ path: 'repo', path_with_namespace: 'group/sub/repo', web_url: 'https://gitlab.com/group/sub/repo', visibility: 'private' }]);
    return Response.json(url.pathname.endsWith('/issues') ? [] : [native('merge_requests')], { headers: { 'x-next-page': '' } });
  });
  const { manager } = await fixture();
  try {
    const page = await manager.listGlobalItems('gitlab');
    expect(page.items.map(item => item.identifier)).toStrictEqual(['!7']);
    expect(page.nextCursor).toBeUndefined();
  } finally { manager.close(); }
});
it('accepts GitLab pagination links with server-added defaults while preserving the original request scope', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input));
    expect(url.searchParams.get('scope')).toBe('all');
    expect(url.searchParams.get('state')).toBe('all');
    expect(url.searchParams.has('with_labels_details')).toBe(false);
    const second = url.searchParams.get('page') === '2';
    return Response.json([native('merge_requests', second ? 8 : 7, 'merged')], { headers: second ? { 'x-next-page': '' } : {
      link: '<https://gitlab.com/api/v4/projects/group%2Fsub%2Frepo/merge_requests?id=group%2Fsub%2Frepo&order_by=updated_at&page=2&per_page=100&scope=all&sort=desc&state=all&with_labels_details=false&with_merge_status_recheck=false>; rel="next"',
    } });
  });
  const { manager } = await fixture();
  try {
    expect((await manager.listItems('gitlab', source, { kind: 'pullRequest', state: 'all' })).map(item => item.identifier)).toStrictEqual(['!7', '!8']);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { manager.close(); }
});
it.each([403, 404, 429])('keeps GitHub usable after a sanitized GitLab %s response', async status => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('gitlab.com') ? new Response('secret diagnostic', { status }) : Response.json([]));
  const { manager } = await fixture();
  try {
    await expect(manager.listItems('gitlab', source)).rejects.toThrow(/GitLab/);
    await expect(manager.listItems('gitlab', source)).rejects.not.toThrow('secret diagnostic');
    expect(await manager.listItems('github', 'org/repo')).toStrictEqual([]);
  } finally { manager.close(); }
});
