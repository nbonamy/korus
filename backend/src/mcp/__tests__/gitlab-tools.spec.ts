import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { WorkItem } from '@workspace/core/contracts';
import { createGitLabToolModuleProvider, type GitLabToolPort } from '../gitlab-tools';
import { AppMcpService } from '../service';

const item = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  provider: 'gitlab', id: 'gitlab.com/group/project#7', kind: 'issue', sourceId: 'gitlab.com/group/project', sourceName: 'group/project', number: 7, identifier: '#7',
  title: 'Broken login', url: 'https://gitlab.com/group/project/-/issues/7', state: 'open', authorName: 'alice', assignees: ['nbonamy'],
  labels: [{ name: 'bug', color: '#f00' }], body: 'Steps to reproduce', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', ...overrides,
});

describe('GitLab MCP tools', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

  async function setup(connected = true) {
    const port: GitLabToolPort = {
      connected: vi.fn(() => connected),
      listItems: vi.fn(async () => [item(), item({ number: 8, id: 'gitlab.com/group/project#8', title: 'Second' }), item({ number: 9, id: 'gitlab.com/group/project#9', title: 'Third' })]),
      getItemDetail: vi.fn(async () => ({ item: item({ body: 'x'.repeat(30_000) }), notes: [{ author: 'bob', createdAt: '2026-10-03T00:00:00Z', body: 'First comment' }],
        request: { sourceBranch: 'feature/login', targetBranch: 'main', draft: true, mergeStatus: 'mergeable', pipeline: { status: 'success' } } })),
      addItemNote: vi.fn(async () => ({ id: '55', url: 'https://gitlab.com/group/project/-/issues/7#note_55' })),
      createMergeRequest: vi.fn(async () => ({ number: 12, title: 'Draft: Fix login', url: 'https://gitlab.com/group/project/-/merge_requests/12', draft: true, headSha: 'abc', state: 'open' as const })),
    };
    const snapshot = createInitialSnapshot();
    const service = new AppMcpService({ snapshot, toolModuleProviders: [createGitLabToolModuleProvider(port)] });
    cleanups.push(() => service.stop());
    const url = await service.start();
    const request = async (method: string, params: unknown) => {
      const response = await fetch(`${url}?agentId=${snapshot.agents[0]!.id}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      return (await response.json() as { result: { tools: { name: string }[]; isError?: boolean; content: { text?: string }[]; structuredContent: any } }).result;
    };
    const call = (name: string, args: unknown) => request('tools/call', { name, arguments: args });
    return { port, request, call };
  }

  it('is offered only while GitLab is connected', async () => {
    const names = async (connected: boolean) => (await (await setup(connected)).request('tools/list', {})).tools.map(tool => tool.name).filter(name => name.startsWith('gitlab-'));
    expect(await names(true)).toStrictEqual(['gitlab-list-issues', 'gitlab-list-merge-requests', 'gitlab-get-issue', 'gitlab-get-merge-request', 'gitlab-comment', 'gitlab-create-merge-request']);
    expect(await names(false)).toStrictEqual([]);
  });

  it('lists issues for any spelling of the project and honours the limit', async () => {
    const { port, call } = await setup();
    for (const project of ['group/project', 'gitlab.com/group/project', 'https://gitlab.com/group/project/-/issues/3', 'git@gitlab.com:group/project.git']) {
      const result = await call('gitlab-list-issues', { project, state: 'closed', limit: 2 });
      expect(result.isError).toBe(false);
      expect(port.listItems).toHaveBeenLastCalledWith('gitlab.com/group/project', { kind: 'issue', state: 'closed' });
      expect(result.structuredContent.items).toHaveLength(2);
      expect(result.structuredContent.items[0]).toStrictEqual({ number: 7, title: 'Broken login', state: 'open', url: 'https://gitlab.com/group/project/-/issues/7',
        author: 'alice', assignees: ['nbonamy'], labels: ['bug'], updatedAt: '2026-10-02T00:00:00Z' });
    }
    expect((await call('gitlab-list-issues', { project: 'group/project' })).structuredContent.truncated).toBe(false);
    expect((await call('gitlab-list-issues', { project: 'group/project', limit: 2 })).structuredContent.truncated).toBe(true);
  });

  it('lists merge requests as pull requests', async () => {
    const { port, call } = await setup();
    await call('gitlab-list-merge-requests', { project: 'group/project' });
    expect(port.listItems).toHaveBeenCalledWith('gitlab.com/group/project', { kind: 'pullRequest', state: 'open' });
  });

  it('returns an issue with its comments and bounds very long text', async () => {
    const { port, call } = await setup();
    const detail = await port.getItemDetail('gitlab.com/group/project', 'issue', 7);
    vi.mocked(port.getItemDetail).mockResolvedValueOnce({ item: detail.item, notes: detail.notes });
    const result = await call('gitlab-get-issue', { project: 'group/project', iid: 7 });
    expect(port.getItemDetail).toHaveBeenCalledWith('gitlab.com/group/project', 'issue', 7);
    expect(result.structuredContent).toMatchObject({ number: 7, title: 'Broken login', comments: [{ author: 'bob', body: 'First comment' }] });
    expect(result.structuredContent.description.length).toBeLessThan(21_000);
    expect(result.structuredContent.descriptionTruncated).toBe(true);
    expect(result.structuredContent.request).toBeUndefined();
  });

  it('returns merge request branches, draft state and pipeline', async () => {
    const { port, call } = await setup();
    const result = await call('gitlab-get-merge-request', { project: 'group/project', iid: 9 });
    expect(port.getItemDetail).toHaveBeenCalledWith('gitlab.com/group/project', 'pullRequest', 9);
    expect(result.structuredContent.request).toStrictEqual({ sourceBranch: 'feature/login', targetBranch: 'main', draft: true, mergeStatus: 'mergeable', pipeline: { status: 'success' } });
  });

  it('comments on an issue or merge request and creates a draft merge request', async () => {
    const { port, call } = await setup();
    const note = await call('gitlab-comment', { project: 'group/project', kind: 'merge_request', iid: 9, body: 'Looks good' });
    expect(port.addItemNote).toHaveBeenCalledWith('gitlab.com/group/project', 'pullRequest', 9, 'Looks good');
    expect(note.structuredContent).toStrictEqual({ success: true, id: '55', url: 'https://gitlab.com/group/project/-/issues/7#note_55' });
    await call('gitlab-comment', { project: 'group/project', kind: 'issue', iid: 7, body: 'On it' });
    expect(port.addItemNote).toHaveBeenLastCalledWith('gitlab.com/group/project', 'issue', 7, 'On it');
    const created = await call('gitlab-create-merge-request', { project: 'group/project', sourceBranch: 'feature/login', title: 'Fix login', description: 'Details' });
    expect(port.createMergeRequest).toHaveBeenCalledWith('gitlab.com/group/project', { branch: 'feature/login', title: 'Fix login', body: 'Details' });
    expect(created.structuredContent).toMatchObject({ success: true, number: 12, draft: true, url: 'https://gitlab.com/group/project/-/merge_requests/12' });
  });

  it('rejects other hosts and reports provider failures as tool errors', async () => {
    const { port, call } = await setup();
    const other = await call('gitlab-get-issue', { project: 'https://github.com/owner/repo', iid: 1 });
    expect(other.isError).toBe(true);
    expect(other.content[0]!.text).toContain('gitlab.com');
    expect(port.getItemDetail).not.toHaveBeenCalled();
    vi.mocked(port.getItemDetail).mockRejectedValueOnce(new Error('GitLab denied access.'));
    const denied = await call('gitlab-get-issue', { project: 'group/project', iid: 1 });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]!.text).toContain('GitLab denied access.');
  });
});
