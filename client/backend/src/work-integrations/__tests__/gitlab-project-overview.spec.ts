import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { GitLabWorkProviderDriver } from '../gitlab-driver';

const token: WorkProviderToken = { provider: 'gitlab', accessToken: 'secret', tokenType: 'Bearer', accountLabel: 'alice', connectedAt: '' };
const repository = 'gitlab.com/group/sub/repo';
const project = '/api/v4/projects/group%2Fsub%2Frepo';
afterEach(() => vi.restoreAllMocks());

function route(handlers: Record<string, (url: URL) => unknown>) {
  const urls: URL[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    const handler = handlers[url.pathname];
    if (!handler) return new Response('missing', { status: 404 });
    return Response.json(handler(url));
  });
  return urls;
}

describe('GitLab reads for the project overview', () => {
  it('reads issues that moved since a date with the open total, leaving malformed rows out', async () => {
    const urls = route({
      [project]: () => ({ id: 12, open_issues_count: 47 }),
      [`${project}/issues`]: () => [
        { iid: 84, title: 'Worktree delete leaves a folder', state: 'opened', created_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-10T10:00:00Z', closed_at: null, description: 'private' },
        { iid: 83, title: 'Annotations hidden', state: 'closed', created_at: '2026-10-20T10:00:00Z', updated_at: '2026-11-09T10:00:00Z', closed_at: '2026-11-09T10:00:00Z' },
        { title: 'no iid' },
      ],
    });
    await expect(new GitLabWorkProviderDriver('client').listBacklogActivity(token, repository, '2026-11-05T00:00:00.000Z')).resolves.toStrictEqual({
      open: 47,
      items: [
        { id: '#84', title: 'Worktree delete leaves a folder', state: 'open', createdAt: '2026-11-10T10:00:00Z', updatedAt: '2026-11-10T10:00:00Z' },
        { id: '#83', title: 'Annotations hidden', state: 'closed', createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-11-09T10:00:00Z', closedAt: '2026-11-09T10:00:00Z' },
      ],
    });
    const issues = urls.find(url => url.pathname.endsWith('/issues'))!;
    expect(Object.fromEntries(issues.searchParams)).toStrictEqual({ updated_after: '2026-11-05T00:00:00.000Z', order_by: 'updated_at', sort: 'desc', scope: 'all', per_page: '100' });
  });

  it('reads open merge requests with draft and conflict state, and how long recent merges took', async () => {
    route({
      [`${project}/merge_requests`]: url => url.searchParams.get('state') === 'merged'
        ? [{ created_at: '2026-11-01T10:00:00Z', merged_at: '2026-11-02T10:00:00Z' }, { created_at: '2026-11-03T10:00:00Z', merged_at: null }]
        : [
          { iid: 7, web_url: 'https://gitlab.com/group/sub/repo/-/merge_requests/7', source_branch: 'feat/a', draft: false, has_conflicts: true, created_at: '2026-11-10T10:00:00Z', source_project_id: 12, target_project_id: 12 },
          { iid: 8, web_url: 'https://gitlab.com/group/sub/repo/-/merge_requests/8', source_branch: 'feat/b', draft: true, has_conflicts: false, created_at: '2026-11-10T11:00:00Z', source_project_id: 12, target_project_id: 12 },
          // A fork's branch of the same name is not this checkout's branch.
          { iid: 9, web_url: 'https://gitlab.com/group/sub/repo/-/merge_requests/9', source_branch: 'feat/a', draft: false, has_conflicts: false, created_at: '2026-11-10T12:00:00Z', source_project_id: 99, target_project_id: 12 },
          { iid: 10, web_url: 'https://evil.example/x', source_branch: 'feat/c', draft: false, has_conflicts: false, created_at: '2026-11-10T12:00:00Z', source_project_id: 12, target_project_id: 12 },
        ],
    });
    await expect(new GitLabWorkProviderDriver('client').listPullRequestActivity(token, repository)).resolves.toStrictEqual({
      open: [
        { number: 7, url: 'https://gitlab.com/group/sub/repo/-/merge_requests/7', branch: 'feat/a', draft: false, approved: null, conflicts: true, openedAt: '2026-11-10T10:00:00Z' },
        { number: 8, url: 'https://gitlab.com/group/sub/repo/-/merge_requests/8', branch: 'feat/b', draft: true, approved: null, conflicts: false, openedAt: '2026-11-10T11:00:00Z' },
      ],
      mergeTimesMs: [86_400_000],
    });
  });

  it('reads pipelines updated since a date as results per branch', async () => {
    const urls = route({
      [`${project}/pipelines`]: () => [
        { id: 1, ref: 'main', status: 'success', created_at: '2026-11-10T10:01:00Z' },
        { id: 2, ref: 'main', status: 'failed', created_at: '2026-11-10T10:02:00Z' },
        { id: 3, ref: 'feat/a', status: 'running', created_at: '2026-11-10T10:03:00Z' },
        { id: 4, ref: 'feat/a', status: 'pending', created_at: '2026-11-10T10:04:00Z' },
        { id: 5, ref: 'feat/a', status: 'canceled', created_at: '2026-11-10T10:05:00Z' },
        { id: 6, ref: 'feat/a', status: 'skipped', created_at: '2026-11-10T10:06:00Z' },
        { id: 'bad' },
      ],
    });
    await expect(new GitLabWorkProviderDriver('client').listPipelineRuns(token, repository, '2026-11-05T00:00:00.000Z')).resolves.toStrictEqual([
      { id: '1', branch: 'main', status: 'passed', at: '2026-11-10T10:01:00Z' },
      { id: '2', branch: 'main', status: 'failed', at: '2026-11-10T10:02:00Z' },
      { id: '3', branch: 'feat/a', status: 'running', at: '2026-11-10T10:03:00Z' },
      { id: '4', branch: 'feat/a', status: 'running', at: '2026-11-10T10:04:00Z' },
      { id: '5', branch: 'feat/a', status: 'cancelled', at: '2026-11-10T10:05:00Z' },
      { id: '6', branch: 'feat/a', status: 'cancelled', at: '2026-11-10T10:06:00Z' },
    ]);
    expect(urls[0]!.searchParams.get('updated_after')).toBe('2026-11-05T00:00:00.000Z');
  });
});
