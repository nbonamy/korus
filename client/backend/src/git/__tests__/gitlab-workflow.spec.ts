import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { decodeAppSnapshot } from '@workspace/core/snapshot-guards';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { createGitWorktree } from '../../git-worktrees';
import { WorktreeManager } from '../../worktrees/worktree-manager';
import { AgentGitService } from '../agent-git-service';
import { GitLabWorkProviderDriver } from '../../work-integrations/gitlab-driver';
import { GitHubWorkProviderDriver } from '../../work-integrations/github-driver';
import { WorkIntegrationManager } from '../../work-integrations/manager';
import { MemoryWorkIntegrationTokenStore } from '../../work-integrations/memory-token-store';
import { AppBackendServer } from '../../server';
const exec = promisify(execFile);
const git = async (cwd: string, args: string[]) => exec('git', args, { cwd });
afterEach(() => vi.restoreAllMocks());
// Real Git refs, tracking and checkout are part of this provider integration.
it.each(['git@gitlab.com:group/sub/repo.git', 'https://gitlab.com/group/sub/repo.git', 'https://user:private-token@gitlab.com/group/sub/repo.git'])('routes %s to GitLab, preserves tracking, and prevents duplicate or unverifiable creation', async remote => {
  const root = await mkdtemp(join(tmpdir(), 'korus-mr-workflow-'));
  let server: AppBackendServer | undefined;
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.email', 'test@example.test']); await git(root, ['config', 'user.name', 'Test']);
    await writeFile(join(root, 'file'), 'base'); await git(root, ['add', '.']); await git(root, ['commit', '-m', 'base']);
    await git(root, ['switch', '-c', 'feature/demo']); await writeFile(join(root, 'file'), 'change'); await git(root, ['commit', '-am', 'change']);
    await git(root, ['remote', 'add', 'origin', remote]);
    await git(root, ['remote', 'add', 'other', 'git@github.com:owner/other.git']);
    const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const snapshot = createInitialSnapshot(), agent = snapshot.agents[0]!; agent.folder = root;
    const aliasAgent = { ...agent, id: 'alias-agent', folder: `${root}/.` }; snapshot.agents.push(aliasAgent);
    const tokens = new MemoryWorkIntegrationTokenStore();
    for (const provider of ['github', 'gitlab'] as const) await tokens.set({ provider, accessToken: 'secret', tokenType: 'Bearer', accountLabel: 'alice', connectedAt: '' });
    const manager = new WorkIntegrationManager({ drivers: [new GitLabWorkProviderDriver('id'), new GitHubWorkProviderDriver('id')], tokenStore: tokens, getSnapshot: () => snapshot, saveSnapshot: async () => {} });
    let created = false, failed = false, writes = 0, pushes = 0;
    const mr = { iid: 7, title: 'Draft: Work', web_url: 'https://gitlab.com/group/sub/repo/-/merge_requests/7', draft: true, sha: head, state: 'opened', source_branch: 'feature/demo', source_project_id: 12, target_project_id: 12 };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toContain('gitlab.com/api/v4/projects/group%2Fsub%2Frepo');
      if (failed) return new Response('private diagnostic', { status: 429 });
      if (init?.method === 'POST') { writes++; created = true; return Response.json(mr); }
      if (String(url).endsWith('/merge_requests/7')) return Response.json(mr);
      if (String(url).includes('/merge_requests')) return Response.json(created ? [mr] : [], { headers: { 'x-next-page': '' } });
      return Response.json({ id: 12, default_branch: 'main' });
    });
    const service = new AgentGitService(() => new Date(), async (folder, args) => {
      if (args[0] === 'push') { pushes++; return { stdout: '' }; }
      return git(folder, args);
    });
    server = new AppBackendServer({ version: 'test', snapshot, agentGitService: service, workIntegrations: manager });
    const request = (method: string, input?: object) => server!.handleMessage({ jsonrpc: '2.0', id: 'test', method, params: { agentId: agent.id, ...(input ? { input } : {}) } });
    expect(await request(backendMethods.agentGitWorkflowGet)).toMatchObject({ result: { repository: 'gitlab.com/group/sub/repo', repositoryProvider: 'gitlab', codeHostConnected: true } });
    expect(await service.status(root)).toMatchObject({ repositoryProvider: 'gitlab' });
    expect(JSON.stringify(await service.workflow(root))).not.toContain('private-token');
    const input = { confirmed: true, title: 'Work', body: 'Details' };
    const [first, second] = await Promise.allSettled([request(backendMethods.agentGitPullRequestCreate, input), server.handleMessage({ jsonrpc: '2.0', id: 'alias-create', method: backendMethods.agentGitPullRequestCreate, params: { agentId: aliasAgent.id, input } })]);
    expect([first, second].filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(writes).toBe(1); expect(pushes).toBe(1);
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 'inspect', method: backendMethods.agentGitWorkflowGet, params: { agentId: agent.id, includePullRequest: true } })).toMatchObject({ result: { existingPullRequest: { number: 7, headSha: head } } });
    expect(snapshot.agents.find(candidate => candidate.pullRequest)?.pullRequest).toMatchObject({ provider: 'gitlab', repository: 'gitlab.com/group/sub/repo', number: 7 });
    expect(decodeAppSnapshot(JSON.parse(JSON.stringify(snapshot)))?.value.agents.find(candidate => candidate.pullRequest)?.pullRequest).toMatchObject({ provider: 'gitlab', number: 7 });
    await expect(request(backendMethods.agentGitBranchCreate, { confirmed: true, name: 'review', pullRequestNumber: 7, requestRepository: 'gitlab.com/other/repo' })).rejects.toThrow(/different repository/i);
    failed = true;
    await expect(request(backendMethods.agentGitPullRequestCreate, input)).rejects.toThrow(/verify existing merge requests/i);
    expect(writes).toBe(1); expect(pushes).toBe(1);
    // The tracked upstream chooses the other host, independently of connection order.
    await git(root, ['update-ref', 'refs/remotes/other/feature/demo', head]);
    await git(root, ['config', 'branch.feature/demo.remote', 'other']); await git(root, ['config', 'branch.feature/demo.merge', 'refs/heads/feature/demo']);
    expect(await service.workflow(root)).toMatchObject({ remote: 'other', repository: 'owner/other', repositoryProvider: 'github' });
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
}, 10_000); // Real Git init, commit and remote setup per case needs headroom when the full suite runs in parallel.
it.each([
  ...['github', 'gitlab'].flatMap(provider => ['current', 'new', 'reuse'].map(mode => ({ provider, mode }))),
  { provider: undefined, mode: 'new' },
])('checks out the intended head with provider $provider and worktree mode $mode', async ({ provider, mode }) => {
  const container = await mkdtemp(join(tmpdir(), 'korus-request-ref-'));
  const root = join(container, 'repo');
  await mkdir(root);
  try {
    await git(root, ['init', '-b', 'main']); await git(root, ['config', 'user.email', 'test@example.test']); await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['commit', '--allow-empty', '-m', 'base']);
    const base = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await git(root, ['commit', '--allow-empty', '-m', 'request']);
    const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const ref = provider === 'gitlab' ? 'refs/merge-requests/7/head' : 'refs/pull/7/head';
    await git(root, ['update-ref', ref, head]); await git(root, ['reset', '--hard', base]);
    if (provider) await git(root, ['remote', 'add', 'origin', `git@${provider}.com:group/repo.git`]);
    const target = join(container, 'checkout');
    if (mode === 'reuse') await git(root, ['worktree', 'add', '-b', 'review', target, base]);
    // Only replace the network remote at the process boundary; worktree policy is real.
    const worktrees = new WorktreeManager({ createGitWorktree: input => createGitWorktree({ ...input, destinationPath: target }) });
    const service = new AgentGitService(() => new Date(), async (folder, args) => git(folder, args[0] === 'fetch' ? ['fetch', root, args[2]!] : args),
      async input => (await worktrees.create(input)).worktree);
    const folder = provider
      ? await service.createBranch(root, 'review', mode !== 'current', 7, head)
      : await service.createBranch(root, 'review', true);
    expect((await git(folder, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(provider ? head : base);
    expect(await worktrees.waitForInitialization(folder)).toEqual(mode === 'new' ? { state: 'complete' } : undefined);
    expect((await git(folder, ['branch', '--show-current'])).stdout.trim()).toBe('review');
    expect((await git(root, ['status', '--porcelain'])).stdout.trim()).toBe('');
  } finally { await rm(container, { recursive: true, force: true }); }
});

it('refuses an unexpected fetched request head before creating a local branch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'korus-mr-changed-'));
  try {
    await git(root, ['init', '-b', 'main']); await git(root, ['config', 'user.email', 'test@example.test']); await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['commit', '--allow-empty', '-m', 'base']);
    await git(root, ['update-ref', 'refs/merge-requests/7/head', 'HEAD']);
    await git(root, ['remote', 'add', 'origin', 'git@gitlab.com:group/repo.git']);
    const service = new AgentGitService(() => new Date(), async (folder, args) => git(folder, args[0] === 'fetch' ? ['fetch', root, args[2]!] : args));
    await expect(service.createBranch(root, 'review', false, 7, 'a'.repeat(40))).rejects.toThrow(/head changed/i);
    expect((await git(root, ['branch', '--show-current'])).stdout.trim()).toBe('main');
    expect((await git(root, ['branch', '--list', 'review'])).stdout.trim()).toBe('');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('keeps a fork PR linked after updating its local worktree from main and restoring the workspace', async () => {
  const container = await mkdtemp(join(tmpdir(), 'korus-fork-pr-'));
  const root = join(container, 'repo'), target = join(container, 'review'), fork = join(container, 'fork.git');
  let server: AppBackendServer | undefined;
  let setupStarted!: () => void;
  const setupStartedPromise = new Promise<void>(resolve => { setupStarted = resolve; });
  let finishSetup!: () => void;
  const finishSetupPromise = new Promise<void>(resolve => { finishSetup = resolve; });
  let setupHead: string | undefined;
  const worktrees = new WorktreeManager({
    createGitWorktree: input => createGitWorktree({ ...input, destinationPath: target }),
    getInitializationMode: () => 'automatic',
    runCommand: async (command, args, { cwd }) => {
      expect([command, ...args]).toEqual(['npm', 'ci']);
      expect(cwd).toBe(target);
      setupHead = (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
      setupStarted();
      await finishSetupPromise;
      return {};
    },
  });
  try {
    await mkdir(root);
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.email', 'test@example.test']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['commit', '--allow-empty', '-m', 'base']);
    await git(root, ['branch', 'feat/project-overview']);
    await git(root, ['switch', '-c', 'contributor']);
    await writeFile(join(root, 'contributor.txt'), 'PR changes');
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'package-lock.json'), '{}');
    await git(root, ['add', '.']); await git(root, ['commit', '-m', 'PR changes']);
    const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await git(container, ['init', '--bare', fork]);
    await git(root, ['push', fork, `${head}:refs/heads/contributor-topic`]);
    await git(root, ['config', `url.${fork}.insteadOf`, 'git@github.com:contributor/repo.git']);
    await git(root, ['update-ref', 'refs/pull/87/head', head]);
    await git(root, ['switch', 'main']);
    await writeFile(join(root, 'main.txt'), 'Latest main changes');
    await git(root, ['add', '.']); await git(root, ['commit', '-m', 'Main changes']);
    await git(root, ['remote', 'add', 'origin', 'git@github.com:owner/repo.git']);
    const pr = { number: 87, title: 'Project overview', html_url: 'https://github.com/owner/repo/pull/87',
      state: 'open', draft: false, head: { sha: head, ref: 'contributor-topic', label: 'contributor:contributor-topic',
        repo: { full_name: 'contributor/repo' } as { full_name: string } | null } };
    const requests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      requests.push(String(url));
      // A branch lookup under owner:... cannot find a contributor's fork PR.
      return Response.json(String(url).endsWith('/pulls/87') ? pr : []);
    });
    const snapshot = createInitialSnapshot(), agent = snapshot.agents[0]!; agent.folder = root;
    const tokens = new MemoryWorkIntegrationTokenStore();
    await tokens.set({ provider: 'github', accessToken: 'secret', tokenType: 'Bearer', accountLabel: 'owner', connectedAt: '' });
    const manager = new WorkIntegrationManager({ drivers: [new GitHubWorkProviderDriver('id')], tokenStore: tokens, getSnapshot: () => snapshot, saveSnapshot: async () => {} });
    const service = new AgentGitService(() => new Date(), async (folder, args) => {
      if (args[0] === 'push') {
        const remote = args[1] === '--set-upstream' ? args[2]! : args[1]!;
        expect((await git(folder, ['remote', 'get-url', '--push', remote])).stdout.trim()).toBe(fork);
      }
      return git(folder, args[0] === 'fetch' ? ['fetch', root, args[2]!] : args);
    }, async input => (await worktrees.create(input)).worktree);
    server = new AppBackendServer({ version: 'test', snapshot, agentGitService: service, workIntegrations: manager,
      worktreeInitializationForFolder: folder => worktrees.getInitializationState(folder) });
    const call = (method: string, params: object = {}) => server!.handleMessage({ jsonrpc: '2.0', id: 'test', method, params: { agentId: agent.id, ...params } });
    await call(backendMethods.agentGitBranchCreate, { input: { confirmed: true, name: 'feat/project-overview', createWorktree: true, pullRequestNumber: 87 } });
    await setupStartedPromise;
    expect(setupHead).toBe(head);
    expect(agent.folder).toBe(target);
    expect(agent.worktreeInitialization?.state).toBe('running');
    finishSetup();
    await expect(worktrees.waitForInitialization(target)).resolves.toEqual({ state: 'complete' });
    expect(agent.pullRequest).toMatchObject({ provider: 'github', repository: 'owner/repo', branch: 'feat/project-overview', number: 87 });
    expect(await call(backendMethods.agentGitUpdateFromBase, { input: { confirmed: true } })).toMatchObject({ result: {
      conflicts: [], workflow: { existingPullRequest: { number: 87, headSha: head, url: pr.html_url } },
    } });
    expect(await readFile(join(target, 'contributor.txt'), 'utf8')).toBe('PR changes');
    expect(await readFile(join(target, 'main.txt'), 'utf8')).toBe('Latest main changes');
    expect((await git(target, ['rev-parse', 'HEAD'])).stdout.trim()).not.toBe(head);
    const mergedHead = (await git(target, ['rev-parse', 'HEAD'])).stdout.trim();
    const baseHead = (await git(root, ['rev-parse', 'main'])).stdout.trim();
    expect(await call(backendMethods.agentGitPush, { input: { confirmed: true } })).toMatchObject({ result: {
      repository: 'owner/repo', upstream: 'pr-87/contributor-topic', existingPullRequest: { number: 87 },
    } });
    expect((await git(container, ['--git-dir', fork, 'rev-parse', 'refs/heads/contributor-topic'])).stdout.trim()).toBe(mergedHead);
    expect((await git(root, ['rev-parse', 'main'])).stdout.trim()).toBe(baseHead);
    expect((await git(root, ['config', 'remote.origin.url'])).stdout.trim()).toBe('git@github.com:owner/repo.git');
    pr.head.sha = mergedHead;
    const restored = decodeAppSnapshot(JSON.parse(JSON.stringify(snapshot)))!.value;
    await server.close();
    server = new AppBackendServer({ version: 'test', snapshot: restored, agentGitService: service, workIntegrations: manager });
    expect(await call(backendMethods.agentGitWorkflowGet, { includePullRequest: true })).toMatchObject({ result: {
      repository: 'owner/repo', existingPullRequest: { number: 87, headSha: mergedHead, url: pr.html_url },
    } });
    expect(requests.filter(url => url.includes('/pulls'))).not.toHaveLength(0);
    expect(requests.filter(url => url.includes('/pulls')).every(url => url.endsWith('/pulls/87'))).toBe(true);
    pr.head.repo = null;
    await expect(call(backendMethods.agentGitPush, { input: { confirmed: true } })).rejects.toThrow(/source branch.*unavailable/i);
    expect((await git(container, ['--git-dir', fork, 'rev-parse', 'refs/heads/contributor-topic'])).stdout.trim()).toBe(mergedHead);
    await git(target, ['switch', '-c', 'unrelated']);
    const unrelated = await call(backendMethods.agentGitWorkflowGet, { includePullRequest: true }) as { result: { branch: string; existingPullRequest?: unknown } };
    expect(unrelated.result.branch).toBe('unrelated');
    expect(unrelated.result.existingPullRequest).toBeUndefined();
  } finally { finishSetup(); await worktrees.close(); await server?.close(); await rm(container, { recursive: true, force: true }); }
}, 5_000); // Real Git checkout/merge and backend startup/restart share this integration budget.
