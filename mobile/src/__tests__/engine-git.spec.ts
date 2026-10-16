import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { AgentGitDiff, AgentGitDiffTarget } from '@workspace/core/contracts';
import { projectCompanionWorkspace } from '@workspace/core/companion-projection';
import { createDemoConnector } from '../demo-connector';
import { createEngine, type EngineEvent } from '../engine';

async function fixture() {
  const connector = createDemoConnector(); const connect = connector.connect;
  const summary = { changedFiles: 2, addedLines: 8, removedLines: 3 };
  const sha = 'a'.repeat(40);
  const catalog = { defaultTarget: { type: 'uncommitted' as const }, uncommitted: summary, unstaged: summary, staged: summary,
    branch: { ...summary, baseRef: 'origin/main' }, commits: [{ ...summary, sha, shortSha: 'aaaaaaa', subject: 'Recent commit' }] };
  const gitDiff = vi.fn(async (_agentId: string, target: AgentGitDiffTarget): Promise<AgentGitDiff> => ({ target, summary, diff: `patch:${target.type}`, sections: [] }));
  connector.connect = async id => {
    const session = await connect(id); const workspace = await session.getWorkspace();
    return { ...session, gitDiff, getWorkspace: async () => projectCompanionWorkspace({ ...workspace,
      gitStatuses: { 'demo-reviewer': { state: 'unknown', changedFiles: 0, addedLines: 0, removedLines: 0 }, 'demo-agent': { branch: 'feature', state: 'dirty', ...summary, diffCatalog: catalog,
        lastTurn: { turnId: 'turn', addedLines: 4, removedLines: 1 } } } }) };
  };
  const events: EngineEvent[] = [];
  const engine = createEngine({ connector, post: event => events.push(event) }); await engine.start();
  return { engine, events, gitDiff, summary, sha };
}

describe('mobile Changes', () => {
  it('shows uncommitted counts without fetching patches, then loads the chosen desktop scope', async () => {
    const f = await fixture();
    try {
      expect(f.engine.snapshot().git.uncommitted).toMatchObject({ state: 'dirty', ...f.summary });
      expect(f.gitDiff).not.toHaveBeenCalled();
      await f.engine.dispatch({ type: 'loadChanges' });
      expect(f.engine.snapshot().git).toMatchObject({ status: 'loaded', scopeId: 'uncommitted', summary: f.summary });
      expect(f.engine.snapshot().git.choices.map(choice => choice.id)).toStrictEqual(['branch', 'uncommitted', 'unstaged', 'staged', 'turn:turn', `commit:${f.sha}`]);
      for (const [scopeId, target] of [['branch', { type: 'branch', baseRef: 'origin/main' }], ['staged', { type: 'staged' }],
        ['unstaged', { type: 'unstaged' }], ['turn:turn', { type: 'turn', turnId: 'turn' }], [`commit:${f.sha}`, { type: 'commit', sha: f.sha }]] as const) {
        await f.engine.dispatch({ type: 'loadChanges', scopeId });
        expect(f.gitDiff).toHaveBeenLastCalledWith('demo-agent', target);
      }
      await nextTick();
      expect(f.events.filter(event => event.type === 'gitDiff').at(-1)).toMatchObject({ diff: `patch:commit` });
      const count = f.gitDiff.mock.calls.length;
      await f.engine.dispatch({ type: 'loadChanges', scopeId: 'branch:foreign' });
      expect(f.gitDiff).toHaveBeenCalledTimes(count);
    } finally { f.engine.dispose(); }
  });

  it('rejects stale patches after scope or conversation changes, and permits retrying read failures', async () => {
    const f = await fixture(); let release!: (diff: AgentGitDiff) => void;
    try {
      f.gitDiff.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const first = f.engine.dispatch({ type: 'loadChanges' });
      await f.engine.dispatch({ type: 'loadChanges', scopeId: 'staged' });
      release({ target: { type: 'uncommitted' }, summary: f.summary, diff: 'stale', sections: [] }); await first;
      expect(f.engine.snapshot().git).toMatchObject({ status: 'loaded', scopeId: 'staged' });
      f.gitDiff.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const changing = f.engine.dispatch({ type: 'loadChanges' });
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      release({ target: { type: 'uncommitted' }, summary: f.summary, diff: 'foreign', sections: [] }); await changing;
      expect(f.engine.snapshot().git).toMatchObject({ available: false, status: 'idle', uncommitted: { state: 'unknown', changedFiles: 0, addedLines: 0, removedLines: 0 } });
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      f.gitDiff.mockRejectedValueOnce(new Error('Offline'));
      await f.engine.dispatch({ type: 'loadChanges' }); expect(f.engine.snapshot().git.status).toBe('failed');
      await f.engine.dispatch({ type: 'loadChanges' }); expect(f.engine.snapshot().git.status).toBe('loaded');
      await f.engine.dispatch({ type: 'dismissChanges' }); expect(f.engine.snapshot().git.status).toBe('idle');
      expect(f.events.filter(event => event.type === 'gitDiff').some(event => event.diff === 'foreign' || event.diff === 'stale')).toBe(false);
    } finally { f.engine.dispose(); }
  });
});
