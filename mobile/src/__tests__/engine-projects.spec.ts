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
  it('keeps GitLab catalogs and branches distinct, discards late GitHub results, and creates on the selected team', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let release!: (items: typeof repositories) => void;
    const githubRepositories = vi.fn(() => new Promise<typeof repositories>(resolve => { release = resolve; }));
    const repositoryCatalog = vi.fn(async () => [{ id: 'repo:opaque', name: 'org/subgroup/repo' }]);
    const repositoryBranches = vi.fn(async () => [{ name: 'main', isDefault: true }]);
    const createProject = vi.fn(async () => 'demo-reviewer');
    connector.connect = async id => ({ ...await connect(id), githubRepositories, repositoryCatalog, repositoryBranches, createProject });
    const engine = createEngine({ connector, post() {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      const old = engine.dispatch({ type: 'loadProjectRepositories', source: 'github' });
      await engine.dispatch({ type: 'loadProjectRepositories', source: 'gitlab' });
      release(repositories); await old;
      expect(engine.snapshot().projectRepositories.items).toStrictEqual([{ id: 'repo:opaque', name: 'org/subgroup/repo' }]);
      expect(repositoryCatalog).toHaveBeenCalledExactlyOnceWith('demo-team', 'gitlab');
      await engine.dispatch({ type: 'loadProjectBranches', source: 'gitlab', repositoryId: 'repo:opaque' });
      expect(repositoryBranches).toHaveBeenCalledExactlyOnceWith('demo-team', 'gitlab', 'repo:opaque');
      expect(engine.snapshot().projectBranches.items).toStrictEqual([{ name: 'main', isDefault: true }]);
      await engine.dispatch({ type: 'createProject', source: 'gitlab', value: 'repo:opaque', branch: 'main', backend: 'codex' });
      expect(createProject).toHaveBeenCalledExactlyOnceWith({ teamId: 'demo-team', source: 'gitlab', value: 'repo:opaque', branch: 'main', backend: 'codex' });
    } finally { engine.dispose(); }
  });

  it('loads local repository catalogs and branches without asking GitHub, then opens the chosen branch', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    const localRepositories = vi.fn(async () => [{ id: 'opaque-repo', name: 'Local repo' }]);
    const localBranches = vi.fn(async () => [{ name: 'main', isDefault: true }]);
    const githubRepositories = vi.fn(); const createProject = vi.fn(async () => 'demo-reviewer');
    connector.connect = async id => ({ ...await connect(id), localRepositories, localBranches, githubRepositories, createProject });
    const engine = createEngine({ connector, post() {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'loadProjectRepositories', source: 'local' });
      expect(engine.snapshot().projectRepositories.items).toStrictEqual([{ id: 'opaque-repo', name: 'Local repo' }]);
      await engine.dispatch({ type: 'loadProjectBranches', source: 'local', repositoryId: 'opaque-repo' });
      expect(engine.snapshot().projectBranches.items).toStrictEqual([{ name: 'main', isDefault: true }]);
      expect(githubRepositories).not.toHaveBeenCalled();
      await engine.dispatch({ type: 'createProject', source: 'local', value: 'opaque-repo', branch: 'main', backend: 'codex' });
      expect(createProject).toHaveBeenCalledExactlyOnceWith({ teamId: 'demo-team', source: 'local', value: 'opaque-repo', branch: 'main', backend: 'codex' });
      expect(engine.snapshot().agentId).toBe('demo-reviewer');
    } finally { engine.dispose(); }
  });

  it('opens a fresh duplicate with an engine picker and switches only the duplicate', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let created = false; let backend: 'codex' | 'claude' = 'codex';
    const duplicateAgent = vi.fn(async () => { created = true; return 'fresh-duplicate'; });
    const setBackend = vi.fn(async (_id: string, next: 'codex' | 'claude' | 'antigravity') => { backend = next as 'codex' | 'claude'; });
    connector.connect = async id => {
      const session = await connect(id);
      return { ...session, duplicateAgent, setBackend,
        loadConversation: agentId => agentId === 'fresh-duplicate' ? Promise.resolve(null) : session.loadConversation(agentId),
        getWorkspace: async () => {
          const workspace = await session.getWorkspace();
          return { ...workspace, backends: { 'demo-team': ['codex', 'claude'] }, agents: [...workspace.agents,
            ...(created ? [{ ...workspace.agents[0]!, id: 'fresh-duplicate', backend, backendSession: undefined, hasSubmittedPrompt: false }] : [])] };
        } };
    };
    const engine = createEngine({ connector, post() {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      const current = engine.snapshot().composerTarget!;
      const target = { sessionId: current.sessionId, agentId: current.agentId, teamId: current.teamId, locationId: current.locationId, hostId: current.hostId };
      await engine.dispatch({ type: 'duplicateAgent', target: { ...target, sessionId: 'replaced' }, backend: 'codex' });
      expect(duplicateAgent).not.toHaveBeenCalled();
      await engine.dispatch({ type: 'duplicateAgent', target, backend: 'antigravity' });
      expect(duplicateAgent).not.toHaveBeenCalled();
      await engine.dispatch({ type: 'duplicateAgent', target, backend: 'codex' });
      expect(duplicateAgent).toHaveBeenCalledExactlyOnceWith(target, 'codex');
      expect(engine.snapshot()).toMatchObject({ agentId: 'fresh-duplicate', backend: 'codex', canSelectBackend: true, conversationReady: true });
      await engine.dispatch({ type: 'backend', backend: 'claude' });
      expect(setBackend).toHaveBeenCalledExactlyOnceWith('fresh-duplicate', 'claude');
      expect(engine.snapshot()).toMatchObject({ agentId: 'fresh-duplicate', backend: 'claude', canSelectBackend: true });
    } finally { engine.dispose(); }
  });

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
