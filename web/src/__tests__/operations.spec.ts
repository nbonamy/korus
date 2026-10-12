import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { invokeAppWebOperation } from '../server/operations';

it('routes document saves and layout changes through client-scoped operations', async () => {
  const request = vi.fn().mockResolvedValue({ tabs: [] });
  const input = { tabId: 'file:markdown:doc', path: '/work/proposal.md', overwrite: false };
  await invokeAppWebOperation({ request }, 'saveWorkspaceDocument', ['agent', input]);
  expect(request).toHaveBeenLastCalledWith(backendMethods.clientDocumentSave, { agentId: 'agent', input });
  await invokeAppWebOperation({ request }, 'updateDocumentWorkspace', ['agent', { close: [input.tabId] }]);
  expect(request).toHaveBeenLastCalledWith(backendMethods.clientWorkspaceApply, { agentId: 'agent', change: { close: [input.tabId] } });
});

describe(`${product.name} web operations`, () => {
  it('preserves history search options and the conversation resume target expected by the daemon', async () => {
    const target = { storageState: 'active', ref: { backend: 'antigravity', folder: '/work', sessionId: 'native-history' } } as const;
    const request = vi.fn().mockResolvedValue({ agents: [] });
    await expect(invokeAppWebOperation({ request }, 'resumeAgentConversation', ['agent', target])).resolves.toStrictEqual({ agents: [] });
    expect(request).toHaveBeenCalledExactlyOnceWith(backendMethods.agentConversationResume, { agentId: 'agent', target });
    request.mockClear();
    const input = { searchTerm: 'saved conversation', limit: 5 };
    await invokeAppWebOperation({ request }, 'listAgentConversations', ['agent', input]);
    expect(request).toHaveBeenCalledExactlyOnceWith(backendMethods.agentConversationsList, { agentId: 'agent', input });
  });

  it.each(['sendPrompt', 'steerPrompt'])('rejects untrusted Web attachments before %s dispatch and preserves text prompts', async operation => {
    const request = vi.fn().mockResolvedValue({});
    for (const attachment of [{ type: 'file', path: '/private/file' }, { type: 'image', reference: 'forged-registry-id' }]) {
      await expect(invokeAppWebOperation({ request }, operation, ['agent', 'Inspect', { attachments: [attachment] }])).rejects.toThrow('trusted upload');
    }
    expect(request).not.toHaveBeenCalled();
    await invokeAppWebOperation({ request }, operation, ['agent', 'Hello']);
    expect(request).toHaveBeenCalledOnce();
  });

  it('routes prune inventory and confirmed selections to the owning agent', async () => {
    const request = vi.fn().mockResolvedValue({ deleted: [], failed: [] });
    const input = { confirmed: true, targets: [{ id: 'refs/heads/feature', revision: 'checked' }] };
    await invokeAppWebOperation({ request }, 'getAgentGitPrune', ['agent-remote']);
    await invokeAppWebOperation({ request }, 'pruneAgentGit', ['agent-remote', input]);
    expect(request.mock.calls).toStrictEqual([
      [backendMethods.agentGitPruneGet, { agentId: 'agent-remote' }],
      [backendMethods.agentGitPrune, { agentId: 'agent-remote', input }],
    ]);
  });
  it('preserves opaque source IDs, filters and cursors at the web boundary', async () => {
    const request = vi.fn().mockResolvedValue({ items: [], nextCursor: 'native:next' });
    const location = { kind: 'remote', remoteConnectionId: 'remote-owner' };
    await invokeAppWebOperation({ request }, 'listWorkSources', ['mock-work', location]);
    await invokeAppWebOperation({ request }, 'listWorkItems', ['mock-work', 'board:opaque', location, { kind: 'issue', state: 'all' }]);
    await invokeAppWebOperation({ request }, 'listGlobalWorkItems', ['mock-work', location, { cursor: 'native:current', pageSize: 10 }]);
    expect(request.mock.calls).toEqual([
      [backendMethods.workProviderSourcesList, { provider: 'mock-work', location }],
      [backendMethods.workProviderItemsList, { provider: 'mock-work', sourceId: 'board:opaque', location, query: { kind: 'issue', state: 'all' } }],
      [backendMethods.workProviderGlobalItemsList, { provider: 'mock-work', location, query: { cursor: 'native:current', pageSize: 10 } }],
    ]);
  });
  it('separates settings policy and client preferences, including single-part and empty updates', async () => {
    const request = vi.fn().mockResolvedValue({ snapshot: { teams: [] }, marker: 'updated' });
    const backend = { request };
    await invokeAppWebOperation(backend, 'updateSettings', [{ general: { preventSleepWhenAgentsRun: false, agentListCompact: true }, theme: { mode: 'dark' } }]);
    expect(request.mock.calls).toStrictEqual([
      [backendMethods.settingsUpdate, { input: { general: { preventSleepWhenAgentsRun: false } } }],
      [backendMethods.clientPreferencesUpdate, { input: { general: { agentListCompact: true }, theme: { mode: 'dark' } } }],
    ]);
    request.mockClear();
    await invokeAppWebOperation(backend, 'updateSettings', [{ sourceFolder: { path: '/repo' } }]);
    expect(request).toHaveBeenCalledExactlyOnceWith(backendMethods.settingsUpdate, { input: { sourceFolder: { path: '/repo' } } });
    request.mockClear();
    await invokeAppWebOperation(backend, 'updateSettings', [{ theme: { mode: 'light' } }]);
    expect(request).toHaveBeenCalledExactlyOnceWith(backendMethods.clientPreferencesUpdate, { input: { theme: { mode: 'light' } } });
    request.mockClear();
    await expect(invokeAppWebOperation(backend, 'updateSettings', [{}])).resolves.toStrictEqual({ teams: [] });
    expect(request).toHaveBeenCalledExactlyOnceWith(backendMethods.snapshotGet);
  });

  it('distinguishes inspection from synchronization and connecting from creating a remote team', async () => {
    const request = vi.fn().mockResolvedValue({});
    await invokeAppWebOperation({ request }, 'checkRemoteConnection', ['devbox', true]);
    await invokeAppWebOperation({ request }, 'checkRemoteConnection', ['devbox', false]);
    const input = { name: 'Remote', remoteConnectionId: 'devbox', remoteTeamId: 'existing' };
    await invokeAppWebOperation({ request }, 'createTeam', [input]);
    expect(request.mock.calls).toStrictEqual([
      [backendMethods.connectionsRuntimeInspect, { connectionId: 'devbox' }],
      [backendMethods.connectionsRuntimeSync, { connectionId: 'devbox' }],
      [backendMethods.teamConnect, { input }],
    ]);
  });
  it('returns diff query data and preserves the selected target', async () => {
    const target = { type: 'commit', sha: 'abc123' };
    const diff = { target, summary: { addedLines: 1, removedLines: 0, changedFiles: 1 }, diff: 'patch', sections: [] };
    const request = vi.fn().mockResolvedValue(diff);
    await expect(invokeAppWebOperation({ request }, 'getAgentGitDiff', ['agent-1', target])).resolves.toStrictEqual(diff);
    expect(request).toHaveBeenCalledWith(backendMethods.agentGitDiffGet, { agentId: 'agent-1', target });
  });
  it('forwards fixed engine selection and explicit overwrite confirmation', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    await invokeAppWebOperation({ request }, 'readEngineInstructions', ['codex']);
    const input = { engine: 'claude', text: 'Rules', all: true, confirmed: true };
    await invokeAppWebOperation({ request }, 'saveEngineInstructions', [input]);
    expect(request.mock.calls).toEqual([
      [backendMethods.engineInstructionsRead, { engine: 'codex' }],
      [backendMethods.engineInstructionsSave, { input }],
    ]);
  });
  it('preserves the host and login identity for remote authentication', async () => {
    const request = vi.fn().mockResolvedValue({});
    await invokeAppWebOperation({ request }, 'getCodexAuthentication', ['wall-e']);
    await invokeAppWebOperation({ request }, 'getClaudeAuthentication', ['wall-e']);
    await invokeAppWebOperation({ request }, 'startCodexChatGptDeviceCodeLogin', ['wall-e']);
    await invokeAppWebOperation({ request }, 'cancelCodexChatGptLogin', ['wall-e', 'login-1']);
    await invokeAppWebOperation({ request }, 'getBankedResets', ['wall-e']);
    const reset = { confirmed: true, redemptionToken: 'selection', idempotencyKey: 'attempt' };
    await invokeAppWebOperation({ request }, 'useBankedReset', [reset, 'wall-e']);
    await invokeAppWebOperation({ request }, 'getProviderUsage', ['claude']);
    await invokeAppWebOperation({ request }, 'disconnectProvider', ['claude', 'wall-e']);
    await invokeAppWebOperation({ request }, 'disconnectProvider', ['codex']);
    await invokeAppWebOperation({ request }, 'authenticateProvider', ['antigravity', 'login']);
    await invokeAppWebOperation({ request }, 'authenticateProvider', ['antigravity', 'cancel']);
    expect(request.mock.calls).toEqual([
      [backendMethods.codexAuthenticationGet, { remoteConnectionId: 'wall-e' }],
      [backendMethods.claudeAuthenticationGet, { connectionId: 'wall-e' }],
      [backendMethods.codexChatGptDeviceCodeLoginStart, { remoteConnectionId: 'wall-e' }],
      [backendMethods.codexLoginCancel, { remoteConnectionId: 'wall-e', loginId: 'login-1' }],
      [backendMethods.bankedResetsGet, { remoteConnectionId: 'wall-e' }],
      [backendMethods.bankedResetUse, { input: reset, remoteConnectionId: 'wall-e' }],
      [backendMethods.providerUsageGet, { backend: 'claude' }],
      [backendMethods.providerDisconnect, { backend: 'claude', remoteConnectionId: 'wall-e' }],
      [backendMethods.providerDisconnect, { backend: 'codex' }],
      [backendMethods.providerAuthenticate, { backend: 'antigravity', action: 'login' }],
      [backendMethods.providerAuthenticate, { backend: 'antigravity', action: 'cancel' }],
    ]);
  });
  it('maps allowlisted product operations to daemon methods', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });

    await expect(invokeAppWebOperation({ request }, 'createAgent', [{ name: 'Dina' }]))
      .resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith(backendMethods.agentCreate, {
      input: { name: 'Dina' },
    });

    await invokeAppWebOperation({ request }, 'createProject', [{ name: 'new-product', teamId: 'team-one' }]);
    expect(request).toHaveBeenLastCalledWith(backendMethods.projectCreate, {
      input: { name: 'new-product', teamId: 'team-one' },
    });

    await expect(invokeAppWebOperation({ request }, 'createQuickChat', [{ teamId: 'team-one' }]))
      .resolves.toEqual({ ok: true });
    expect(request).toHaveBeenLastCalledWith(backendMethods.agentQuickChatCreate, {
      input: { teamId: 'team-one' },
    });

    await invokeAppWebOperation({ request }, 'continueInterruptedTurn', ['agent-dina']);
    expect(request).toHaveBeenLastCalledWith(backendMethods.agentTurnContinueInterrupted, { agentId: 'agent-dina' });
  });

  it('exposes mission operations through the browser operation allowlist', async () => {
    const request = vi.fn().mockResolvedValue({ missions: [] });
    const input = { outcome: 'Billing', workflowType: 'shapeAndShipFeature' };
    await invokeAppWebOperation({ request }, 'createMission', [input]);
    expect(request).toHaveBeenLastCalledWith('mission/create', { input });
    const update = { id: 'mission-1', revision: 0, action: 'save' };
    await invokeAppWebOperation({ request }, 'updateMission', [update]);
    expect(request).toHaveBeenLastCalledWith('mission/update', { input: update });
    await invokeAppWebOperation({ request }, 'readMissionArtifact', ['mission-1', 'requirements']);
    expect(request).toHaveBeenLastCalledWith('mission/artifact/read', { missionId: 'mission-1', stage: 'requirements' });
    const deletion = { id: 'mission-1', revision: 1 };
    await invokeAppWebOperation({ request }, 'deleteMission', [deletion]);
    expect(request).toHaveBeenLastCalledWith('mission/delete', { input: deletion });
  });

  it('adapts the backend snapshot envelope for the Vue client', async () => {
    const snapshot = { teams: [], agents: [], messages: [], general: {}, workBacklog: { providerSettings: {} } };
    const request = vi.fn().mockResolvedValue({ snapshot, lastEventSeq: 42, clientState: {} });

    await expect(invokeAppWebOperation({ request }, 'getSnapshotState', [])).resolves.toEqual({
      snapshot,
      lastBackendEventSeq: 42,
      connection: { status: 'connected' },
    });
  });

  it('routes snapshot variants for local and remote locations', async () => {
    const snapshot = { teams: [] };
    const request = vi.fn().mockResolvedValue({ snapshot, lastEventSeq: 2 });
    const backend = { request };

    await expect(invokeAppWebOperation(backend, 'getSnapshot', [])).resolves.toBe(snapshot);
    await expect(invokeAppWebOperation(backend, 'getAutomationSnapshot', [{ kind: 'local' }])).resolves.toBe(snapshot);
    const remote = { kind: 'remote', connectionId: 'ssh-1' };
    await invokeAppWebOperation(backend, 'getAutomationSnapshot', [remote]);

    expect(request).toHaveBeenNthCalledWith(1, backendMethods.snapshotGet);
    expect(request).toHaveBeenNthCalledWith(2, backendMethods.snapshotGet);
    expect(request).toHaveBeenNthCalledWith(3, backendMethods.snapshotAutomationsGet, { location: remote });
  });

  it('builds required, optional, and pass-through operation parameters', async () => {
    const request = vi.fn().mockResolvedValue('ok');
    const backend = { request };

    await invokeAppWebOperation(backend, 'listSourceFolders', [{ kind: 'remote' }]);
    await invokeAppWebOperation(backend, 'listSourceRepositories', []);
    await invokeAppWebOperation(backend, 'listSourceRepositories', ['ssh-1']);
    await invokeAppWebOperation(backend, 'cloneSourceRepository', [{ url: 'https://github.com/nbonamy/agent-workspace' }]);
    await invokeAppWebOperation(backend, 'forkAgent', ['agent-1', undefined]);
    await invokeAppWebOperation(backend, 'duplicateAgent', ['agent-1', { select: false }]);
    await invokeAppWebOperation(backend, 'reorderRepositories', [{ teamId: 'team-1', repositoryRoot: '/repo-b', beforeRepositoryRoot: '/repo-a' }]);
    await invokeAppWebOperation(backend, 'listWorkItems', ['github', null, { kind: 'remote' }]);
    await invokeAppWebOperation(backend, 'listGlobalWorkItems', ['github', undefined, { assignment: 'all', page: 2 }]);
    await invokeAppWebOperation(backend, 'getPluginStatus', []);
    await invokeAppWebOperation(backend, 'setAgentPermissionMode', ['agent-claude', 'acceptEdits']);
    await invokeAppWebOperation(backend, 'generateAgentGitMessage', ['agent-1', { kind: 'pullRequest' }]);
    await invokeAppWebOperation(backend, 'createAgentGitBranch', ['agent-1', { name: 'feature/demo', confirmed: true }]);
    await invokeAppWebOperation(backend, 'updateQueuedPrompt', ['agent-1', 'queued-1', 'Edited queue']);
    await invokeAppWebOperation(backend, 'steerQueuedPrompt', ['agent-1', 'queued-1', 'Edited steer']);

    expect(request.mock.calls).toStrictEqual([
      [backendMethods.sourceFoldersList, { kind: 'remote' }],
      [backendMethods.sourceRepositoriesList, undefined],
      [backendMethods.sourceRepositoriesList, { remoteConnectionId: 'ssh-1' }],
      [backendMethods.sourceRepositoryClone, { input: { url: 'https://github.com/nbonamy/agent-workspace' } }],
      [backendMethods.agentFork, { agentId: 'agent-1' }],
      [backendMethods.agentDuplicate, { agentId: 'agent-1', options: { select: false } }],
      [backendMethods.clientRepositoryOrderUpdate, { input: { teamId: 'team-1', repositoryRoot: '/repo-b', beforeRepositoryRoot: '/repo-a' } }],
      [backendMethods.workProviderItemsList, { provider: 'github', location: { kind: 'remote' } }],
      [backendMethods.workProviderGlobalItemsList, { provider: 'github', query: { assignment: 'all', page: 2 } }],
      [backendMethods.settingsPluginStatusGet, undefined],
      [backendMethods.agentPermissionModeUpdate, { agentId: 'agent-claude', mode: 'acceptEdits' }],
      [backendMethods.agentGitMessageGenerate, { agentId: 'agent-1', input: { kind: 'pullRequest' } }],
      [backendMethods.agentGitBranchCreate, { agentId: 'agent-1', input: { name: 'feature/demo', confirmed: true } }],
      [backendMethods.agentQueuedPromptUpdate, { agentId: 'agent-1', promptId: 'queued-1', prompt: 'Edited queue' }],
      [backendMethods.agentQueuedPromptSteer, { agentId: 'agent-1', promptId: 'queued-1', prompt: 'Edited steer' }],
    ]);
  });

  it('rejects desktop-only and unknown operations without forwarding them', async () => {
    const request = vi.fn();

    await expect(invokeAppWebOperation({ request }, 'browserOpen', [])).rejects.toThrow(
      `'browserOpen' is not available in ${product.name} Web.`,
    );
    await expect(invokeAppWebOperation({ request }, 'setMenuBarVisible', [true])).rejects.toThrow(
      `'setMenuBarVisible' is not available in ${product.name} Web.`,
    );
    await expect(invokeAppWebOperation({ request }, 'arbitraryBackendCall', [])).rejects.toThrow(
      `Unknown ${product.name} web operation`,
    );
    expect(request).not.toHaveBeenCalled();
  });
});
