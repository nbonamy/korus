import { afterEach, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { GitLabWorkProviderDriver } from '../gitlab-driver';
import { GitHubWorkProviderDriver } from '../github-driver';
import { WorkIntegrationManager } from '../manager';
import { MemoryWorkIntegrationTokenStore } from '../memory-token-store';
// External API failure modes: wrong provider/project, missing pagination, foreign
// source branches, malformed successful responses, duplicate creation and leaked errors.
const repository = 'gitlab.com/group/sub/repo';
const mr = { iid: 7, title: 'Draft: Work', web_url: 'https://gitlab.com/group/sub/repo/-/merge_requests/7', draft: true, sha: 'a'.repeat(40), state: 'opened', source_branch: 'feature/demo', source_project_id: 12, target_project_id: 12 };
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const snapshot = createInitialSnapshot(), tokenStore = new MemoryWorkIntegrationTokenStore();
  for (const provider of ['github', 'gitlab'] as const) await tokenStore.set({ provider, accessToken: 'secret', accountLabel: 'alice', tokenType: 'Bearer', connectedAt: '' });
  return new WorkIntegrationManager({ drivers: [new GitLabWorkProviderDriver('client'), new GitHubWorkProviderDriver('client')], tokenStore, getSnapshot: () => snapshot, saveSnapshot: async () => {} });
}
it('routes paginated lookup, details and draft creation only to the selected GitLab project', async () => {
  const writes: unknown[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://gitlab.com');
    expect(url.pathname).toContain('/projects/group%2Fsub%2Frepo');
    if (init?.method === 'POST') { writes.push(JSON.parse(String(init.body))); return Response.json(mr); }
    if (url.pathname.endsWith('/merge_requests/7')) return Response.json({ ...mr, state: 'merged', merged_at: '2026-10-01' });
    if (url.pathname.endsWith('/merge_requests')) {
      expect(url.searchParams.get('source_branch')).toBe('feature/demo');
      return Response.json(url.searchParams.get('page') === '2' ? [mr] : [{ ...mr, source_project_id: 99 }], { headers: { 'x-next-page': url.searchParams.get('page') === '2' ? '' : '2' } });
    }
    return Response.json({ id: 12, default_branch: 'main' });
  });
  const manager = await fixture();
  try {
    expect(await manager.findPullRequest(repository, 'feature/demo')).toStrictEqual({ number: 7, title: mr.title, url: mr.web_url, draft: true, headSha: mr.sha, state: 'open' });
    expect(await manager.getPullRequest(repository, 7)).toMatchObject({ state: 'merged', mergedAt: '2026-10-01' });
    expect(await manager.createPullRequest(repository, { branch: 'feature/demo', title: 'Work', body: 'Details' })).toMatchObject({ number: 7, draft: true });
    expect(writes).toStrictEqual([{ source_branch: 'feature/demo', target_branch: 'main', title: 'Draft: Work', description: 'Details' }]);
  } finally { manager.close(); }
});
it.each([403, 404, 429, 'invalid'])('fails closed on a %s lookup and leaves GitHub readable', async status => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).includes('github.com')) return Response.json([]);
    return status === 'invalid' ? Response.json([{ ...mr, web_url: 'https://evil.test/mr/7' }]) : new Response('secret diagnostic', { status: Number(status) });
  });
  const manager = await fixture();
  try {
    await expect(manager.findPullRequest(repository, 'feature/demo')).rejects.toThrow(/GitLab/);
    expect(await manager.findPullRequest('owner/repo', 'feature/demo')).toBeNull();
  } finally { manager.close(); }
});
