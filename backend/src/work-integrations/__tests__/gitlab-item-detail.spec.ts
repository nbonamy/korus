import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { GitLabWorkProviderDriver } from '../gitlab-driver';

const credential: WorkProviderToken = { provider: 'gitlab', accessToken: 'private-access', tokenType: 'Bearer', accountLabel: 'nbonamy', connectedAt: '2026-10-25T00:00:00.000Z' };
const repositoryId = 'gitlab.com/group/sub/project';
const issue = (overrides: Record<string, unknown> = {}) => ({
  iid: 7, title: 'Broken login', state: 'opened', description: 'Steps to reproduce', labels: ['bug'], assignees: [{ username: 'nbonamy' }],
  author: { username: 'alice' }, web_url: 'https://gitlab.com/group/sub/project/-/issues/7', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', ...overrides,
});
const request = (overrides: Record<string, unknown> = {}) => issue({
  web_url: 'https://gitlab.com/group/sub/project/-/merge_requests/9', iid: 9, source_branch: 'feature/login', target_branch: 'main', draft: true,
  detailed_merge_status: 'mergeable', head_pipeline: { status: 'success', web_url: 'https://gitlab.com/group/sub/project/-/pipelines/1' }, ...overrides,
});

describe('GitLab item detail and notes', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (handler: (url: URL, init: RequestInit) => unknown) => {
    const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => Response.json(handler(new URL(String(input)), init)));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('returns an issue with human comments only, in order', async () => {
    const fetchMock = stub(url => url.pathname.endsWith('/notes')
      ? [{ id: 1, system: false, body: 'First', author: { username: 'bob' }, created_at: '2026-10-03T00:00:00Z' },
        { id: 2, system: true, body: 'added label ~bug', author: { username: 'bob' }, created_at: '2026-10-03T01:00:00Z' },
        { id: 3, system: false, body: 'Second', author: { username: 'alice' }, created_at: '2026-10-04T00:00:00Z' }]
      : issue());
    const detail = await new GitLabWorkProviderDriver('id').getItemDetail(credential, repositoryId, 'issue', 7);
    expect(detail.item).toMatchObject({ kind: 'issue', number: 7, title: 'Broken login', body: 'Steps to reproduce', state: 'open', assignees: ['nbonamy'] });
    expect(detail.notes).toStrictEqual([{ author: 'bob', createdAt: '2026-10-03T00:00:00Z', body: 'First' }, { author: 'alice', createdAt: '2026-10-04T00:00:00Z', body: 'Second' }]);
    expect(detail.request).toBeUndefined();
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toStrictEqual([
      '/api/v4/projects/group%2Fsub%2Fproject/issues/7', '/api/v4/projects/group%2Fsub%2Fproject/issues/7/notes']);
  });

  it('returns merge request branches, draft state, merge status and pipeline', async () => {
    stub(url => url.pathname.endsWith('/notes') ? [] : request());
    const detail = await new GitLabWorkProviderDriver('id').getItemDetail(credential, repositoryId, 'pullRequest', 9);
    expect(detail.item).toMatchObject({ kind: 'pullRequest', number: 9, branchName: 'feature/login' });
    expect(detail.request).toStrictEqual({ sourceBranch: 'feature/login', targetBranch: 'main', draft: true, mergeStatus: 'mergeable',
      pipeline: { status: 'success', url: 'https://gitlab.com/group/sub/project/-/pipelines/1' } });
  });

  it('rejects other hosts, bad numbers and a mismatched item', async () => {
    stub(() => issue({ iid: 8 }));
    const driver = new GitLabWorkProviderDriver('id');
    await expect(driver.getItemDetail(credential, 'github.com/a/b', 'issue', 1)).rejects.toThrow('Invalid GitLab repository identity');
    await expect(driver.getItemDetail(credential, repositoryId, 'issue', 0)).rejects.toThrow('Invalid GitLab item number');
    await expect(driver.getItemDetail(credential, repositoryId, 'issue', 7)).rejects.toThrow(/invalid work item identity|unexpected/);
  });

  it('adds a comment to an issue or merge request and returns its link', async () => {
    const fetchMock = stub(() => ({ id: 55, body: 'Looks good' }));
    const driver = new GitLabWorkProviderDriver('id');
    await expect(driver.addItemNote(credential, repositoryId, 'pullRequest', 9, 'Looks good')).resolves.toStrictEqual({
      id: '55', url: 'https://gitlab.com/group/sub/project/-/merge_requests/9#note_55' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe('/api/v4/projects/group%2Fsub%2Fproject/merge_requests/9/notes');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ body: 'Looks good' }) });
    await expect(driver.addItemNote(credential, repositoryId, 'issue', 7, '   ')).rejects.toThrow('Comment is empty');
  });
});
