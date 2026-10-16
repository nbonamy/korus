import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';
import type { CompanionProjectInput } from '@workspace/core/companion-protocol';

const repositories = [{ id: 'org/repo', name: 'org/repo' }];
function fixture(list = vi.fn(async (_team: string) => repositories)) {
  const connector = createDemoConnector(); const connect = connector.connect;
  const createProject = vi.fn(async (_input: CompanionProjectInput) => 'demo-reviewer');
  connector.connect = async id => ({ ...await connect(id), githubRepositories: list, createProject });
  const engine = createEngine({ connector, post() {} });
  return { engine, list, createProject };
}

describe('mobile project acquisition', () => {
  it.each(['new', 'github', 'url'] as const)('creates from %s in the selected team and opens the result', async source => {
    const f = fixture();
    try {
      await f.engine.start();
      await f.engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      const value = source === 'new' ? 'fresh-project' : source === 'github' ? 'org/repo' : 'https://github.com/org/repo';
      await f.engine.dispatch({ type: 'createProject', source, value, backend: 'codex' });
      expect(f.createProject).toHaveBeenCalledExactlyOnceWith({ teamId: 'demo-team', source, value, backend: 'codex' });
      expect(f.engine.snapshot().agentId).toBe('demo-reviewer');
      expect(f.engine.snapshot().chatCreation).toBe('idle');
      expect(f.list).not.toHaveBeenCalled();
    } finally { f.engine.dispose(); }
  });

  it('loads branch choices for the selected repository, ignores dismissed results, and sends the chosen branch', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let release!: (branches: { name: string; isDefault: boolean }[]) => void;
    const branches = [{ name: 'main', isDefault: true }, { name: 'feature/mobile', isDefault: false }];
    const githubBranches = vi.fn(async (_team: string, _repository: string) => branches);
    const createProject = vi.fn(async (_input: CompanionProjectInput) => 'demo-reviewer');
    connector.connect = async id => ({ ...await connect(id), githubBranches, createProject });
    const engine = createEngine({ connector, post() {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'loadProjectBranches', repositoryId: 'org/repo' });
      expect(engine.snapshot().projectBranches).toStrictEqual({ repositoryId: 'org/repo', status: 'loaded', items: branches });
      expect(createProject).not.toHaveBeenCalled();
      githubBranches.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const pending = engine.dispatch({ type: 'loadProjectBranches', repositoryId: 'other/repo' });
      await engine.dispatch({ type: 'dismissProjectBranches' }); release(branches); await pending;
      expect(engine.snapshot().projectBranches).toStrictEqual({ repositoryId: null, status: 'idle', items: [] });
      await engine.dispatch({ type: 'createProject', source: 'github', value: 'org/repo', branch: 'feature/mobile', backend: 'codex' });
      expect(createProject).toHaveBeenCalledExactlyOnceWith({ teamId: 'demo-team', source: 'github', value: 'org/repo', branch: 'feature/mobile', backend: 'codex' });
    } finally { engine.dispose(); }
  });

  it('keeps creation pending until the new branch is ready, forwarding its base and opening the result', async () => {
    const f = fixture(); let release!: (id: string) => void;
    f.createProject.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    try {
      await f.engine.start(); await f.engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      const worktree = { branchName: 'feature/new', baseBranch: 'main' };
      const pending = f.engine.dispatch({ type: 'createProject', source: 'github', value: 'org/repo', backend: 'codex', worktree });
      expect(f.engine.snapshot().chatCreation).toBe('creating');
      expect(f.createProject).toHaveBeenCalledExactlyOnceWith({ teamId: 'demo-team', source: 'github', value: 'org/repo', backend: 'codex', worktree });
      release('demo-reviewer'); await pending;
      expect(f.engine.snapshot().agentId).toBe('demo-reviewer');
      expect(f.engine.snapshot().chatCreation).toBe('idle');
    } finally { f.engine.dispose(); }
  });

  it('loads GitHub on demand, supports retry and discards results after dismissal', async () => {
    let release!: (value: typeof repositories) => void;
    const list = vi.fn(async (_team: string) => repositories).mockRejectedValueOnce(new Error('No GitHub connection'));
    const f = fixture(list);
    try {
      await f.engine.start();
      await f.engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await f.engine.dispatch({ type: 'loadProjectRepositories' });
      expect(f.engine.snapshot().projectRepositories.status).toBe('failed');
      await f.engine.dispatch({ type: 'loadProjectRepositories' });
      expect(f.engine.snapshot().projectRepositories).toStrictEqual({ status: 'loaded', items: repositories });
      list.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const pending = f.engine.dispatch({ type: 'loadProjectRepositories' });
      expect(f.engine.snapshot().projectRepositories.status).toBe('loading');
      await f.engine.dispatch({ type: 'dismissProjectRepositories' });
      release(repositories); await pending;
      expect(f.engine.snapshot().projectRepositories).toStrictEqual({ status: 'idle', items: [] });
    } finally { f.engine.dispose(); }
  });
});
