import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AgentGitDiff, AgentGitDiffTarget } from '@workspace/core/contracts';
import { createGitDiffStatsToolModuleProvider } from '../git-diff-stats-tools';
import { AppMcpService } from '../service';

const stats = (addedLines: number, removedLines: number, changedFiles: number) => ({ addedLines, removedLines, changedFiles });

describe('get-diff-stats tool', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

  async function setup(prepare?: (snapshot: ReturnType<typeof createInitialSnapshot>) => void) {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.folder = '/repo';
    prepare?.(snapshot);
    const diff = vi.fn(async (_folder: string, target: AgentGitDiffTarget): Promise<AgentGitDiff> => ({
      target, diff: '', sections: [],
      summary: { ...stats(43, 4, 4), byKind: { code: stats(30, 4, 2), test: stats(12, 0, 1), docs: stats(0, 0, 0), other: stats(1, 0, 1) } },
    }));
    const service = new AppMcpService({ snapshot, toolModuleProviders: [createGitDiffStatsToolModuleProvider({ snapshot, diff })] });
    cleanups.push(() => service.stop());
    const url = await service.start();
    const request = async (method: string, params: unknown) => {
      const response = await fetch(`${url}?agentId=${snapshot.agents[0]!.id}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      return (await response.json() as { result: { tools: { name: string }[]; isError?: boolean; content: { text?: string }[]; structuredContent: Record<string, unknown> } }).result;
    };
    return { diff, request, call: (args: unknown) => request('tools/call', { name: 'get-diff-stats', arguments: args }) };
  }

  it('reports the uncommitted changes by file type unless another scope is asked for', async () => {
    const { diff, request, call } = await setup();
    expect((await request('tools/list', {})).tools.map(tool => tool.name)).toContain('get-diff-stats');
    const result = await call({});
    expect(result.isError).toBe(false);
    expect(diff).toHaveBeenCalledExactlyOnceWith('/repo', { type: 'uncommitted' });
    expect(result.structuredContent).toStrictEqual({
      scope: 'uncommitted', ...stats(43, 4, 4),
      byKind: { code: stats(30, 4, 2), test: stats(12, 0, 1), docs: stats(0, 0, 0), other: stats(1, 0, 1) },
    });
  });

  it.each([
    [{ scope: 'staged' }, { type: 'staged' }],
    [{ scope: 'unstaged' }, { type: 'unstaged' }],
    [{ scope: 'branch' }, { type: 'branch' }],
    [{ scope: 'branch', baseRef: 'origin/develop' }, { type: 'branch', baseRef: 'origin/develop' }],
    [{ scope: 'commit', sha: 'abc1234' }, { type: 'commit', sha: 'abc1234' }],
  ])('maps %j to the matching diff target', async (args, target) => {
    const { diff, call } = await setup();
    const result = await call(args);
    expect(result.isError).toBe(false);
    expect(diff).toHaveBeenCalledExactlyOnceWith('/repo', target);
    expect(result.structuredContent).toMatchObject({ scope: args.scope });
  });

  it('names the base the branch was compared with and zero-fills kinds the diff does not report', async () => {
    const { diff, call } = await setup();
    diff.mockResolvedValueOnce({ target: { type: 'branch', baseRef: 'origin/main' }, diff: '', sections: [], summary: stats(0, 0, 0) });
    const result = await call({ scope: 'branch' });
    expect(result.structuredContent).toStrictEqual({
      scope: 'branch', baseRef: 'origin/main', ...stats(0, 0, 0),
      byKind: { code: stats(0, 0, 0), test: stats(0, 0, 0), docs: stats(0, 0, 0), other: stats(0, 0, 0) },
    });
  });

  it('rejects unknown scopes, a commit without sha, and surfaces git failures as tool errors', async () => {
    const { diff, call } = await setup();
    expect((await call({ scope: 'everything' })).isError).toBe(true);
    expect((await call({ scope: 'commit' })).isError).toBe(true);
    expect(diff).not.toHaveBeenCalled();
    diff.mockRejectedValueOnce(new Error('Check out a branch before viewing branch changes.'));
    const failed = await call({ scope: 'branch' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0]!.text).toContain('Check out a branch');
  });

  it('measures what the agent changed in its latest turn from the recorded turn diff', async () => {
    const file = (path: string, added: number) => [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '@@ -0,0 +1 @@', ...Array.from({ length: added }, () => '+line')].join('\n');
    const { diff, call } = await setup(snapshot => {
      const agentId = snapshot.agents[0]!.id;
      snapshot.turnGitDiffs = {
        old: { agentId, turnId: 'old', addedLines: 9, removedLines: 0, diff: file('src/old.ts', 9), updatedAt: '2026-06-05T00:00:01.000Z' },
        latest: { agentId, turnId: 'latest', addedLines: 4, removedLines: 0, diff: [file('src/app.ts', 3), file('src/app.test.ts', 1)].join('\n'), updatedAt: '2026-06-05T00:00:09.000Z' },
        other: { agentId: 'someone-else', turnId: 'other', addedLines: 50, removedLines: 0, diff: file('src/x.ts', 50), updatedAt: '2026-06-05T00:00:99.000Z' },
      };
    });
    const result = await call({ scope: 'lastTurn' });
    expect(result.isError).toBe(false);
    expect(diff).not.toHaveBeenCalled();
    expect(result.structuredContent).toStrictEqual({
      scope: 'lastTurn', ...stats(4, 0, 2),
      byKind: { code: stats(3, 0, 1), test: stats(1, 0, 1), docs: stats(0, 0, 0), other: stats(0, 0, 0) },
    });
  });

  it('says so when no turn changes were recorded yet', async () => {
    const { call } = await setup();
    const result = await call({ scope: 'lastTurn' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('No turn changes');
  });

  it('is not offered to agents without a folder', async () => {
    const { request } = await setup(snapshot => { Reflect.deleteProperty(snapshot.agents[0]!, 'folder'); });
    expect((await request('tools/list', {})).tools.map(tool => tool.name)).not.toContain('get-diff-stats');
  });
});
