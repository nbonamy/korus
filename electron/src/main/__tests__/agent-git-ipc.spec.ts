import { describe, expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { ipcChannels } from '@workspace/core/ipc';
import { registerAgentGitIpcHandlers } from '../agent-git-ipc';
import type { AppBackendClientPort } from '../backend-client';
import { decodeAppErrorDescriptor } from '@workspace/core/app-error';

describe('agent Git IPC', () => {
  it('forwards the selected Git diff target', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: vi.fn((registeredChannel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(registeredChannel, handler);
      }),
    } as unknown as Parameters<typeof registerAgentGitIpcHandlers>[0];
    const backend = {
      request: vi.fn().mockResolvedValue({ target: { type: 'staged' }, diff: 'staged diff', sections: [], summary: { addedLines: 1, removedLines: 0, changedFiles: 1 } }),
    } as unknown as AppBackendClientPort;
    registerAgentGitIpcHandlers(ipc, () => backend);

    const handler = handlers.get(ipcChannels.getAgentGitDiff);
    expect(handler).toBeDefined();
    await expect(handler?.({}, 'agent-1', { type: 'staged' })).resolves.toStrictEqual({
      target: { type: 'staged' }, diff: 'staged diff', sections: [], summary: { addedLines: 1, removedLines: 0, changedFiles: 1 },
    });
    expect(backend.request).toHaveBeenCalledWith(backendMethods.agentGitDiffGet, {
      agentId: 'agent-1',
      target: { type: 'staged' },
    });
  });

  it('opts into request discovery only for the selected agent', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) } as never;
    const request = vi.fn(async () => ({ repository: 'gitlab.com/group/repo' }));
    registerAgentGitIpcHandlers(ipc, () => ({ request }) as never);
    await handlers.get(ipcChannels.getAgentGitWorkflow)!({}, 'agent', { includePullRequest: true });
    expect(request).toHaveBeenCalledExactlyOnceWith(backendMethods.agentGitWorkflowGet, { agentId: 'agent', includePullRequest: true });
  });

  it.each([
    [ipcChannels.getAgentGitLog, backendMethods.agentGitLogGet, [{ search: 'fix', cursor: { head: 'head', offset: 50, search: 'fix' } }], { branch: 'main', commits: [] }],
    [ipcChannels.getAgentGitLogCommit, backendMethods.agentGitLogCommitGet, [{ head: 'head', sha: 'sha' }], { message: 'full', files: [] }],
    [ipcChannels.getAgentGitLogFile, backendMethods.agentGitLogFileGet, [{ head: 'head', sha: 'sha', path: 'file.ts' }], { diff: 'patch' }],
    [ipcChannels.previewBranchCurrentWork, backendMethods.agentGitBranchWorkPreview, [], { folder: '/repo', head: 'head', snapshotId: 'snapshot' }],
    [ipcChannels.branchCurrentWork, backendMethods.agentGitBranchWork, [{ confirmed: true, requestId: 'request', snapshotId: 'snapshot', branchName: 'feature' }], { state: 'recovery', branchName: 'feature', folder: '/worktree', retainedPaths: ['file.ts'] }],
    [ipcChannels.getAgentGitWorkflow, backendMethods.agentGitWorkflowGet, [], { repository: 'repo' }],
    [ipcChannels.getAgentGitPrune, backendMethods.agentGitPruneGet, [], { repository: 'repo', baseBranch: 'main', groups: [], unavailableRemotes: [] }],
    [ipcChannels.pruneAgentGit, backendMethods.agentGitPrune, [{ targets: [{ id: 'refs/heads/feat/web', revision: 'checked' }], confirmed: true }], { deleted: ['refs/heads/feat/web'], failed: [] }],
    [ipcChannels.generateAgentGitMessage, backendMethods.agentGitMessageGenerate, [{ kind: 'commit' }], { kind: 'commit', message: 'Subject' }],
    [ipcChannels.stageAgentGitFiles, backendMethods.agentGitStage, [{ paths: ['file.ts'], confirmed: true }], { repository: 'repo' }],
    [ipcChannels.revertAgentGitChanges, backendMethods.agentGitRevert, [{ includeUntracked: false, confirmed: true }], { repository: 'repo' }],
    [ipcChannels.commitAgentGitChanges, backendMethods.agentGitCommit, [{ message: 'Subject', confirmed: true }], { repository: 'repo' }],
    [ipcChannels.pushAgentGitBranch, backendMethods.agentGitPush, [{ confirmed: true }], { repository: 'repo' }],
    [ipcChannels.pullAgentGitBranch, backendMethods.agentGitPull, [{ confirmed: true }], { upstream: 'origin/feature', branch: 'feature', conflicts: [], workflow: { repository: 'repo' } }],
    [ipcChannels.createAgentGitBranch, backendMethods.agentGitBranchCreate, [{ name: 'feat/test', confirmed: true }], { repository: 'repo' }],
    [ipcChannels.createAgentGitPullRequest, backendMethods.agentGitPullRequestCreate, [{ title: 'Title', body: 'Body', confirmed: true }], { repository: 'repo' }],
    [ipcChannels.mergeAgentGitBranch, backendMethods.agentGitMerge, [{ strategy: 'merge', deleteBranch: false, deleteWorktree: false, confirmed: true }], { repository: 'repo' }],
    [ipcChannels.updateAgentGitBranchFromBase, backendMethods.agentGitUpdateFromBase, [{ confirmed: true }], { baseBranch: 'main', branch: 'feature', conflicts: [] }],
  ] as const)('maps %s to %s with the exact backend payload', async (channel, method, inputArguments, result) => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: vi.fn((registeredChannel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(registeredChannel, handler);
      }),
    } as unknown as Parameters<typeof registerAgentGitIpcHandlers>[0];
    const backend = {
      request: vi.fn().mockResolvedValue(result ?? true),
    } as unknown as AppBackendClientPort;
    registerAgentGitIpcHandlers(ipc, () => backend);

    const handler = handlers.get(channel);
    expect(handler).toBeDefined();
    await expect(handler?.({}, 'agent-1', ...inputArguments)).resolves.toBe(result);
    expect(backend.request).toHaveBeenCalledWith(method, {
      agentId: 'agent-1',
      ...(inputArguments.length > 0 ? { input: inputArguments[0] } : {}),
    });
  });

  it.each([
    ipcChannels.generateAgentGitMessage,
    ipcChannels.createAgentGitPullRequest,
  ])('preserves structured app errors through %s', async (channel) => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: vi.fn((registeredChannel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(registeredChannel, handler);
      }),
    } as unknown as Parameters<typeof registerAgentGitIpcHandlers>[0];
    const backend = {
      request: vi.fn().mockRejectedValue(Object.assign(new Error('Commit your work first.'), {
        data: { kind: 'appError', code: 'git.pullRequestChangesRequired' },
      })),
    } as unknown as AppBackendClientPort;
    registerAgentGitIpcHandlers(ipc, () => backend);

    const handler = handlers.get(channel);
    const input = channel === ipcChannels.generateAgentGitMessage
      ? { kind: 'pullRequest' }
      : { title: 'Title', body: '', confirmed: true };
    expect(handler).toBeDefined();
    const rejection = await Promise.resolve(handler!({}, 'agent-1', input)).catch((error: unknown) => error);

    expect(decodeAppErrorDescriptor(rejection)).toStrictEqual({
      kind: 'appError',
      code: 'git.pullRequestChangesRequired',
    });
  });
});
