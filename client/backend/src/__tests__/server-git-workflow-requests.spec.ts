import path from 'node:path';
import type { DiffVizDiagram } from '@workspace/core/git-diff-viz';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { claudeBackendCapabilities, codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import type { WorkIntegrationManager } from '../work-integrations/manager';
import type { AgentGitService } from '../git/agent-git-service';
import {
  createTestSnapshot,
  createWorkItem,
} from './server-test-fixtures';

function nativeViz(nodes: DiffVizDiagram['nodes']) {
  return { elements: nodes.map((node, i) => ({ id: node.id, type: 'rectangle', x: 0, y: i * 160, width: 260, height: 80,
    text: node.label, component: { status: node.status, paths: node.paths } })) };
}

describe('AppBackendServer', () => {
  const assets=path.resolve(import.meta.dirname,'../../../electron/assets');
  beforeEach(()=>vi.stubEnv('APP_ASSETS_PATH',assets));
  afterEach(()=>vi.unstubAllEnvs());

  it('returns git diff data without emitting presentation events', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'claude',
      backendDefaults: { kind: 'claude' },
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const getGitDiff = vi.fn().mockResolvedValue({
      target: { type: 'uncommitted' },
      summary: { addedLines: 3, removedLines: 0, changedFiles: 3 },
      diff: 'diff --git a/a.ts b/a.ts\n',
      sections: [
        { scope: 'staged', diff: 'diff --git a/staged.ts b/staged.ts\n' },
        { scope: 'unstaged', diff: 'diff --git a/a.ts b/a.ts\n' },
        { scope: 'untracked', diff: 'diff --git a/new.ts b/new.ts\n' },
      ],
    });
    const getGitStatus = vi.fn().mockResolvedValue({
      folder: '/Users/nbonamy/src/agent-workspace',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      changedFiles: 1,
      addedLines: 1,
      removedLines: 0,
      hasUntracked: false,
      state: 'dirty',
      updatedAt: '2026-08-11T00:00:00.000Z',
    });
    const driver: AgentBackendDriver = {
      backend: 'claude',
      getRuntimeStatus: () => ({ backend: 'claude', status: 'running' }),
      getCapabilities: () => claudeBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'claude', sessionId: 'session-test', transport: 'stdio' } }),
      interrupt: async () => ({ backendSession: { kind: 'claude', sessionId: 'session-test', transport: 'stdio' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const events: unknown[] = [];
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      onEvent: (event) => events.push(event),
      driverRpc: new BackendDriverRpc(new Map([['claude', driver]])),
      agentGitService: { diff: getGitDiff, status: getGitStatus } as unknown as AgentGitService,
    });

    const result = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'open-diff',
      method: 'agent/git/diff/get',
      params: { agentId: 'agent-dina' },
    });
    expect(result).toStrictEqual({ jsonrpc: '2.0', id: 'open-diff', result: await getGitDiff.mock.results[0]?.value });

    expect(getGitDiff).toHaveBeenCalledWith('/Users/nbonamy/src/agent-workspace', { type: 'uncommitted' });
    expect(getGitStatus).not.toHaveBeenCalled();
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'sidePanel.gitDiffRequested' }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'git.statusUpdated' }));
    await server.close();
  });

  it('keeps workflow detail reads side-effect free', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/repo',
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const workflow = vi.fn().mockResolvedValue({
      repository: 'owner/repo',
      folder: '/repo',
      branch: 'feature/demo',
      detached: false,
      remote: 'origin',
      upstream: 'origin/feature/demo',
      ahead: 2,
      behind: 0,
      stagedAddedLines: 0,
      stagedRemovedLines: 0,
      unstagedAddedLines: 1,
      unstagedRemovedLines: 0,
      untrackedAddedLines: 0,
      untrackedRemovedLines: 0,
      files: [{ path: 'a.ts', indexStatus: ' ', worktreeStatus: 'M' }],
      stagedFiles: [],
      unstagedFiles: ['a.ts'],
    });
    const getGitStatus = vi.fn().mockResolvedValue({
      folder: '/repo',
      branch: 'feature/demo',
      upstream: 'origin/feature/demo',
      ahead: 2,
      behind: 0,
      changedFiles: 1,
      addedLines: 1,
      removedLines: 0,
      hasUntracked: false,
      state: 'dirty',
      updatedAt: '2026-08-11T00:00:00.000Z',
    });
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const events: unknown[] = [];
    const findPullRequest = vi.fn().mockResolvedValue(null);
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      agentGitService: { workflow, status: getGitStatus } as unknown as AgentGitService,
      workIntegrations: {
        githubConnected: vi.fn().mockResolvedValue(true),
        findPullRequest,
      } as unknown as WorkIntegrationManager,
      onEvent: (event) => events.push(event),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'workflow',
      method: backendMethods.agentGitWorkflowGet,
      params: { agentId: 'agent-dina' },
    })).resolves.toMatchObject({
      result: { repository: 'owner/repo', unstagedAddedLines: 1 },
    });

    expect(getGitStatus).not.toHaveBeenCalled();
    expect(findPullRequest).not.toHaveBeenCalled();
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'git.statusUpdated' }));
    await server.close();
  });

  it.each([
    { provider: 'github', backend: 'codex' as const },
    { provider: 'github', backend: 'claude' as const },
    { provider: 'gitlab', backend: 'antigravity' as const },
  ])('generates editable $provider drafts through $backend without another provider or a conversation prompt', async ({ provider, backend }) => {
    const snapshot = createTestSnapshot();
    snapshot.general.commitMessageInstructions = 'Use lowercase conventional commits.';
    snapshot.general.pullRequestInstructions = 'Include a deployment checklist.';
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/repo',
      backend,
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const generateText = vi.fn()
      .mockResolvedValueOnce({ text: '{"message":"feat: describe selected changes"}' })
      .mockResolvedValueOnce({ text: '{"title":"Improve Git drafts","body":"## Summary\\n- Generate drafts"}' })
      .mockResolvedValueOnce({ text: JSON.stringify(nativeViz([
        { id: 'input', label: 'Request intake', status: 'unchanged', paths: [] },
        { id: 'result', label: 'Draft generation', status: 'changed', paths: ['src/output.ts', 'src/input.ts'] },
      ])) });
    const sendPrompt = vi.fn();
    const driver: AgentBackendDriver = {
      backend,
      getRuntimeStatus: () => ({ backend, status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      generateText,
      sendPrompt,
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const commitMessageContext = vi.fn().mockResolvedValue({ context: '## staged changes\ndiff' });
    const pullRequestMessageContext = vi.fn().mockResolvedValue({ baseRef: 'origin/main', context: '## Diff\nbranch diff' });
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      driverRpc: new BackendDriverRpc(new Map([[backend, driver]])),
      agentGitService: { diff: vi.fn(async (_folder, target) => ({ target, sections: [], diff: ['src/input.ts', 'src/output.ts'].map(path => `diff --git a/${path} b/${path}\n`).join('') + '+LARGE_PATCH_SENTINEL'.repeat(20_000) })), commitMessageContext, pullRequestMessageContext, workflow: async () => ({ remoteUrl: `git@${provider}.com:owner/repo.git` }) } as unknown as AgentGitService,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'commit-draft',
      method: backendMethods.agentGitMessageGenerate,
      params: { agentId: 'agent-dina', input: { kind: 'commit', includeUnstaged: false, includeUntracked: true } },
    })).resolves.toMatchObject({ result: { kind: 'commit', message: 'feat: describe selected changes' } });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'pr-draft',
      method: backendMethods.agentGitMessageGenerate,
      params: { agentId: 'agent-dina', input: { kind: 'pullRequest' } },
    })).resolves.toMatchObject({ result: { kind: 'pullRequest', title: 'Improve Git drafts', body: '## Summary\n- Generate drafts' } });

    expect(commitMessageContext).toHaveBeenCalledWith('/repo', { includeUnstaged: false, includeUntracked: true });
    expect(pullRequestMessageContext).toHaveBeenCalledWith('/repo');
    const viz = await server.handleMessage({ jsonrpc: '2.0', id: 'viz', method: backendMethods.agentGitMessageGenerate,
      params: { agentId: 'agent-dina', input: { kind: 'viz', target: { type: 'branch', baseRef: 'origin/main' } } } });
    expect(viz).toMatchObject({ result: { kind: 'viz', diagram: { nodes: [
      { label: 'Request intake', status: 'unchanged', paths: [] }, { label: 'Draft generation', status: 'changed', paths: ['src/output.ts', 'src/input.ts'] },
    ] } } });
    expect(generateText).toHaveBeenCalledTimes(3);
    expect(generateText.mock.calls[2]?.[1].prompt).not.toMatch(/LARGE_PATCH_SENTINEL|diff --git/);
    expect(generateText.mock.calls[2]?.[1]).toMatchObject({ complexity: 'normal', cwd: '/repo', tools: true, attachments:[{type:'image',path:path.join(assets,'viz/reference.png'),mimeType:'image/png'}], prompt: expect.stringContaining('origin/main'),
      developerInstructions: expect.stringMatching(/system impact.*not files/i), outputSchema: { properties: { elements: { maxItems: 80 } } } });
    generateText.mockResolvedValueOnce({ text: JSON.stringify(nativeViz([{ id: 'outside', label: 'Invented work', status: 'changed', paths: ['/outside'] }])) });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'bad-viz', method: backendMethods.agentGitMessageGenerate,
      params: { agentId: 'agent-dina', input: { kind: 'viz', target: { type: 'branch', baseRef: 'origin/main' } } } })).rejects.toThrow(/changed file/i);
    expect(generateText.mock.calls[0]?.[1].developerInstructions).toContain('Use lowercase conventional commits.');
    expect(generateText.mock.calls[0]?.[1].developerInstructions).not.toContain('deployment checklist');
    expect(generateText.mock.calls[1]?.[1].developerInstructions).toContain('Include a deployment checklist.');
    expect(generateText.mock.calls[1]?.[1].prompt).toContain(provider === 'gitlab' ? 'merge request' : 'pull request');
    expect(generateText.mock.calls[1]?.[1].developerInstructions).not.toContain('lowercase conventional commits');
    expect(generateText.mock.calls[0]?.[1]).toMatchObject({ cwd: '/repo', outputSchema: { type: 'object' } });
    expect(sendPrompt).not.toHaveBeenCalled();
    await server.close();
  });

  it('checks for an existing pull request and pushes local commits before creation', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/repo',
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const workflow = vi.fn().mockResolvedValue({
      repository: 'owner/repo',
      folder: '/repo',
      branch: 'feature/demo',
      detached: false,
      remote: 'origin',
      remoteUrl: 'git@github.com:owner/repo.git',
      upstream: null,
      ahead: 1,
      behind: 0,
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
    });
    const findPullRequest = vi.fn().mockResolvedValue(null);
    const assertPullRequestChanges = vi.fn().mockResolvedValue(undefined);
    const push = vi.fn().mockResolvedValue(undefined);
    const createPullRequest = vi.fn().mockResolvedValue({
      number: 12,
      title: 'A useful change',
      url: 'https://github.com/owner/repo/pull/12',
      draft: true,
      headSha: 'pull-request-head',
      state: 'open',
    });
    const prepareReport = vi.fn().mockResolvedValue('The complete PR handoff.');
    const deliverReport = vi.fn();
    const notifyWorker = vi.fn();
    const events: BackendEvent[] = [];
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      onEvent: (event) => events.push(event),
      agentGitService: { workflow, assertPullRequestChanges, push } as unknown as AgentGitService,
      workIntegrations: {
        githubConnected: vi.fn().mockResolvedValue(true),
        findPullRequest,
        createPullRequest,
      } as unknown as WorkIntegrationManager,
      delegatedWorkReports: {
        close: vi.fn(),
        deliver: deliverReport,
        handleEvent: vi.fn(),
        notifyWorker,
        prepare: prepareReport,
        recipientName: vi.fn(),
      },
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'create-pr',
      method: backendMethods.agentGitPullRequestCreate,
      params: {
        agentId: 'agent-dina',
        input: { title: 'A useful change', body: 'Details', reportBack: true, confirmed: true },
      },
    })).resolves.toMatchObject({ result: { repository: 'owner/repo', branch: 'feature/demo' } });

    expect(findPullRequest).toHaveBeenCalledOnce();
    expect(findPullRequest).toHaveBeenCalledWith('owner/repo', 'feature/demo');
    expect(assertPullRequestChanges).toHaveBeenCalledWith('/repo');
    expect(assertPullRequestChanges.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]!);
    expect(assertPullRequestChanges.mock.invocationCallOrder[0]).toBeLessThan(createPullRequest.mock.invocationCallOrder[0]!);
    expect(push).toHaveBeenCalledWith('/repo', 'origin', 'feature/demo', true);
    expect(createPullRequest).toHaveBeenCalledOnce();
    expect(createPullRequest).toHaveBeenCalledWith('owner/repo', {
      branch: 'feature/demo',
      title: 'A useful change',
      body: 'Details',
    });
    expect(prepareReport).toHaveBeenCalledWith(snapshot.agents[0], {
      kind: 'pullRequest',
      branch: 'feature/demo',
    });
    expect(prepareReport.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]!);
    expect(prepareReport.mock.invocationCallOrder[0]).toBeLessThan(createPullRequest.mock.invocationCallOrder[0]!);
    expect(events.filter((event) => event.type === 'git.operationProgress').map((event) => event.payload)).toStrictEqual([
      { operation: 'pullRequest', phase: 'handoff' },
      { operation: 'pullRequest', phase: 'delivery' },
    ]);
    expect(deliverReport).toHaveBeenCalledWith(snapshot.agents[0], {
      kind: 'pullRequest',
      branch: 'feature/demo',
      number: 12,
      title: 'A useful change',
      url: 'https://github.com/owner/repo/pull/12',
      draft: true,
    }, 'The complete PR handoff.');
    expect(notifyWorker).toHaveBeenCalledWith(snapshot.agents[0], {
      kind: 'pullRequest',
      branch: 'feature/demo',
      number: 12,
      title: 'A useful change',
      url: 'https://github.com/owner/repo/pull/12',
      draft: true,
    });
    expect(snapshot.agents[0]?.pullRequest).toMatchObject({
      provider: 'github',
      repository: 'owner/repo',
      branch: 'feature/demo',
      number: 12,
      headSha: 'pull-request-head',
      state: 'open',
    });
    await server.close();
  });

  it('rejects failed diff queries without emitting presentation events', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const events: unknown[] = [];
    const diff = vi.fn().mockRejectedValue(new Error('Git diff failed.'));
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      onEvent: (event) => events.push(event),
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      agentGitService: { diff } as unknown as AgentGitService,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'open-diff',
      method: 'agent/git/diff/get',
      params: { agentId: 'agent-dina' },
    })).rejects.toThrow('Git diff failed.');
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'sidePanel.gitDiffRequested' }));
    await server.close();
  });

  it('owns work item assignment mutations', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
    });
    const item = createWorkItem();

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'assign-item',
      method: 'agent/workItem/assign',
      params: { agentId: 'agent-dina', item },
    })).resolves.toMatchObject({
      result: {
        workBacklog: {
          assignments: {
            'github:github:nbonamy/agent-workspace#12': {
              agentId: 'agent-dina',
              policy: 'review',
              status: 'inProgress',
            },
          },
        },
      },
    });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remove-item',
      method: 'agent/workItem/assignment/delete',
      params: { item },
    })).resolves.toMatchObject({
      result: {
        workBacklog: { assignments: {} },
      },
    });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'invalid-item',
      method: 'agent/workItem/assign',
      params: { agentId: 'agent-dina', item: { id: 'missing-fields' } },
    })).resolves.toMatchObject({
      error: {
        message: 'Invalid work item assignment.',
      },
    });

    expect(saveSnapshot).toHaveBeenCalledTimes(2);
  });
});
