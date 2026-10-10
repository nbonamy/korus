import { product } from '@workspace/core/product';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../state-persistence';
import { AppStateStore } from '../persistence/store';
import { ClientPreferencesService } from '../client-preferences-service';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import { isAppSnapshot } from '@workspace/core/snapshot-guards';
import { closeAgentInSnapshot, updateWorkItemAssignmentInSnapshot } from '@workspace/core/agent-manager';
import { AppBackendServer } from '../server';
import { AutomationRunner } from '../automations/runner';
import { defaultPluginSettings, defaultThemeSettings, updateSettingsInSnapshot } from '@workspace/core/settings';
import { projectClientSnapshot } from '@workspace/core/client-preferences';
import type { RemoteConnection } from '@workspace/core/contracts';


let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('state persistence', () => {
  it('restores ordered backlog favorites after client preference updates and a fresh store restart', async () => {
    const home = await tempHome();
    const store = new AppStateStore(home);
    const snapshot = createInitialSnapshot();
    const service = new ClientPreferencesService({ snapshot: async () => snapshot, save: async (id, preferences) => {
      snapshot.clientPreferences = { ...snapshot.clientPreferences, [id]: preferences };
      await store.save(snapshot);
    } });
    for (const github of [['org/a'], ['org/a', 'org/b'], ['org/b', 'org/a']]) {
      await service.update('desktop', backendMethods.clientPreferencesUpdate, { input: { general: { backlogRepositoryFavorites: { github } } } });
    }
    const restored = await new AppStateStore(home).load();
    expect(restored.general.backlogRepositoryFavorites).toStrictEqual({ github: ['org/b', 'org/a'] });
    expect(restored.workBacklog).toStrictEqual(snapshot.workBacklog);
    await service.update('desktop', backendMethods.clientPreferencesUpdate, { input: { general: { backlogRepositoryFavorites: { github: ['org/a'] } } } });
    expect((await new AppStateStore(home).load()).general.backlogRepositoryFavorites).toStrictEqual({ github: ['org/a'] });
  });
  it('roundtrips Antigravity session identity and isolated provider preferences through disk', async () => {
    const home = await tempHome();
    const store = new AppStateStore(home);
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backend = 'antigravity';
    agent.backendSession = { kind: 'antigravity', sessionId: 'native-acp-session' };
    agent.backendDefaults = { kind: 'antigravity', model: 'gemini-3.8-flash-low', permissionMode: 'default' };
    snapshot.general.providerHomes = { antigravity: { homePath: '/private/acp', isolated: true, shareSkills: false } };
    snapshot.general.providerEnabled = { codex: true, antigravity: false };
    snapshot.general.providerModelDefaults = { antigravity: { model: 'gemini-3.8-flash-low', reasoningEffort: null, serviceTier: null } };
    snapshot.general.providerApprovalDefaults = { antigravity: 'auto_edit' };
    await store.save(snapshot);
    const restored = await store.load();
    expect(isAppSnapshot(restored)).toBe(true);
    expect(restored.agents.find(value => value.id === agent.id)).toMatchObject({ backend: 'antigravity', backendSession: agent.backendSession, backendDefaults: agent.backendDefaults });
    expect(restored.general.providerHomes).toStrictEqual(snapshot.general.providerHomes);
    expect(restored.general.providerEnabled).toStrictEqual(snapshot.general.providerEnabled);
    expect(restored.general.providerModelDefaults).toStrictEqual(snapshot.general.providerModelDefaults);
    expect(restored.general.providerApprovalDefaults).toStrictEqual(snapshot.general.providerApprovalDefaults);
    restored.agents.find(value => value.id === agent.id)!.name = 'Restored Antigravity';
    await store.save(restored);
    expect((await new AppStateStore(home).load()).agents).toStrictEqual(restored.agents);
  });

  it('defaults Pull to Git configuration and preserves explicit choices', () => {
    const fresh = createEmptySnapshot();
    expect(fresh.general.git?.pull).toBe('git-config');
    const saved = persistedStateFromSnapshot(fresh);
    delete saved.general.git;
    const restored = snapshotFromPersistedState(saved);
    expect(restored.general.git).toStrictEqual({ pull: 'git-config', update: 'merge' });
    for (const pull of ['merge', 'rebase'] as const) {
      restored.general.git!.pull = pull;
      expect(snapshotFromPersistedState(persistedStateFromSnapshot(restored)).general.git?.pull).toBe(pull);
    }
  });
  it('drops repository-based automation definitions without migrating or deleting their agents', () => {
    const snapshot = createInitialSnapshot();
    const persisted = persistedStateFromSnapshot(snapshot);
    const restored = snapshotFromPersistedState({ ...persisted, automations: [{
      id: 'old-rule', name: 'Old rule', enabled: true, teamId: snapshot.teams[0]!.id,
      backend: 'codex', repositories: [{ provider: 'github', id: 'org/repo' }],
      selectionPrompt: 'Select bugs', assignmentPrompt: 'Fix them',
      schedule: { intervalMinutes: 60 }, executionLog: [], createdAt: '', updatedAt: '',
    }] });
    expect(restored.automations).toEqual([]);
    expect(restored.agents.map(agent => agent.id)).toEqual(snapshot.agents.map(agent => agent.id));
  });
  it.each(['claude', 'antigravity'] as const)('creates, updates and runs a remote %s prompt automation, then reloads its configuration and conversation', async backend => {
    const persistence = new AppStateStore(await tempHome());
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend, installed: true, connected: true, checking: false }];
    const runner = new AutomationRunner({ getSnapshot: () => snapshot,
      sendPrompt: async () => ({ backend, sessionId: 'remote-chat', folder: null }), saveSnapshot: () => persistence.save(snapshot), notifySnapshotUpdated: () => {},
    });
    const remote = new AppBackendServer({ version: 'test', snapshot, automationRunner: runner, saveSnapshot: value => persistence.save(value) });
    const localSnapshot = createInitialSnapshot();
    localSnapshot.remoteConnections.connections = [readyRemoteConnection()];
    const server = new AppBackendServer({ version: 'test', snapshot: localSnapshot, remoteClients: {
      request: async (_connection: unknown, method: string, params: unknown) => {
        const response = await remote.handleMessage({ jsonrpc: '2.0', id: 'forwarded', method, params });
        if (!response || !('result' in response)) throw new Error('Remote request failed');
        return response.result;
      }, close: async () => {},
    } as never });
    const location = { kind: 'remote', remoteConnectionId: 'connection-devbox' };
    const input = { name: 'Engineering bugs', enabled: false,
      prompt: 'Fix and verify', target: { kind: 'newQuickChat' as const, teamId: snapshot.teams[0]!.id, backend },
        schedule: { intervalMinutes: 360 } };
    try {
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 'create', method: 'automation/create', params: { input, location } })).not.toHaveProperty('error');
      const id = snapshot.automations[0]!.id;
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 'update', method: 'automation/update', params: { input: { ...input, id, enabled: true }, location } })).not.toHaveProperty('error');
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 'run', method: 'automation/run', params: { automationId: id, location } })).not.toHaveProperty('error');
      const saved = await persistence.load();
      expect(isAppSnapshot(saved)).toBe(true);
      expect(saved.automations).toEqual([expect.objectContaining({ ...input, id, enabled: true })]);
      expect(saved.automations[0]?.executionLog[0]).toMatchObject({ status: 'working', conversationRef: { backend, sessionId: 'remote-chat', folder: null } });
      expect(localSnapshot.automations).toEqual([]);
      expect(localSnapshot.workBacklog.assignments).toEqual({});
      const invalid = { ...input, prompt: '' };
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 'invalid', method: 'automation/create', params: { input: invalid, location } })).toHaveProperty('error');
      expect(snapshot.automations).toHaveLength(1);
    } finally { await server.close(); await remote.close(); }
  });
  it(`assigns, reassigns, persists and clears Linear work with its full reference and independent ${product.name} status`, async () => {
    const persistence = new AppStateStore(await tempHome());
    const snapshot = createInitialSnapshot();
    const item = { provider: 'linear', id: 'linear:uuid', sourceId: 'linear:team', sourceName: 'Engineering', number: 12,
      identifier: 'ENG-12', title: 'Repair login', body: 'Reproduction steps', url: 'https://linear.app/acme/issue/ENG-12' };
    const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: value => persistence.save(value) });
    try {
      for (const agent of snapshot.agents.slice(0, 2)) {
        const response = await server.handleMessage({ jsonrpc: '2.0', id: 'assign', method: 'agent/workItem/assign', params: { agentId: agent.id, item } });
        expect(response).not.toHaveProperty('error');
        expect(snapshot.workBacklog.assignments['linear:linear:uuid']).toMatchObject({ agentId: agent.id, item, status: 'inProgress' });
      }
      const owner = snapshot.agents[1]!;
      for (const status of ['blocked', 'inProgress', 'readyForReview', 'completed'] as const) {
        updateWorkItemAssignmentInSnapshot(snapshot, owner.id, 'linear:linear:uuid', status, '2026-10-04T12:00:00Z', 'Context retained');
        await persistence.save(snapshot);
        const restored = await persistence.load();
        expect(isAppSnapshot(restored)).toBe(true);
        expect(restored.workBacklog.assignments).toMatchObject({ 'linear:linear:uuid': { provider: 'linear', status, item, agentId: owner.id } });
      }
      await server.handleMessage({ jsonrpc: '2.0', id: 'clear', method: 'agent/workItem/assignment/delete', params: { item } });
      expect((await persistence.load()).workBacklog.assignments).toEqual({});
    } finally { await server.close(); }
  });
  it('round trips Linear OAuth settings and public connection alongside legacy GitHub settings', async () => {
    const persistence = new AppStateStore(await tempHome());
    const snapshot = createEmptySnapshot();
    snapshot.workBacklog.providerSettings.github = { oauthClientId: 'github-client' };
    updateSettingsInSnapshot(snapshot, { workProviders: { linear: { oauthClientId: ' linear-client ' } } });
    snapshot.workBacklog.connections.push({ provider: 'linear', status: 'connected', accountLabel: 'Alex' });
    snapshot.workBacklog.providerConfigurations = { github: { sourceId: 'owner/repo' }, linear: { sourceId: 'linear:team:project', assigneeLogin: 'Alex', tagName: 'bug' } };
    await persistence.save(snapshot);
    const restored = await persistence.load();
    expect(restored.workBacklog.providerSettings).toEqual({ github: { oauthClientId: 'github-client' }, linear: { oauthClientId: 'linear-client' } });
    expect(restored.workBacklog.connections).toContainEqual({ provider: 'linear', status: 'connected', accountLabel: 'Alex' });
    expect(restored.workBacklog.providerConfigurations).toEqual(snapshot.workBacklog.providerConfigurations);
    expect(isAppSnapshot(restored)).toBe(true);
  });

  it.each([true, false])('migrates legacy Codex sharing once (%s), preserving newer choices', enabled => {
    const legacy = { ...persistedStateFromSnapshot(createEmptySnapshot()), general: { shareCodexSkillsAndPlugins: enabled } };
    const restored = snapshotFromPersistedState(legacy);
    expect(restored.general.providerHomes?.codex).toMatchObject({ isolated: true, shareSkills: enabled });
    expect(persistedStateFromSnapshot(restored).general).not.toHaveProperty('shareCodexSkillsAndPlugins');
    const newer = { isolated: true, shareSkills: !enabled, homePath: '/app/codex-home' };
    const reloaded = snapshotFromPersistedState({ ...legacy, general: { ...legacy.general, providerHomes: { codex: newer } } });
    expect(reloaded.general.providerHomes?.codex).toEqual(newer);
  });
  it('restores a user-selected model, effort, and tier after restarting', async () => {
    const persistence = new AppStateStore(await tempHome());
    const snapshot = createInitialSnapshot();
    const selection = { kind: 'codex' as const, model: 'sol', reasoningEffort: 'high', serviceTier: null, userSelectedModel: true };
    snapshot.agents[0]!.backendDefaults = selection;

    await persistence.save(snapshot);
    const restored = await persistence.load();

    expect(restored.agents[0]!.backendDefaults).toStrictEqual(selection);
  });

  it('restores a user-selected Claude model after restarting', async () => {
    const persistence = new AppStateStore(await tempHome());
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backend = 'claude';
    snapshot.agents[0]!.backendDefaults = {
      kind: 'claude', model: 'opus', reasoningEffort: 'high', userSelectedModel: true,
    };

    await persistence.save(snapshot);
    const restored = await persistence.load();

    expect(restored.agents[0]!.backendDefaults).toStrictEqual(snapshot.agents[0]!.backendDefaults);
  });

  it('restores saved prompt drafts after a restart', async () => {
    const persistence = new AppStateStore(await tempHome());
    const snapshot = createInitialSnapshot();
    const draft = { id: 'draft-1', agentId: snapshot.agents[0]!.id, text: 'Finish this after the review', createdAt: 1000 };
    snapshot.clientPreferences = { desktop: { general: { savedPromptDrafts: [draft] } } };

    await persistence.save(snapshot);
    const restored = await persistence.load();

    expect(restored.general.savedPromptDrafts).toStrictEqual([draft]);
    expect(restored.clientPreferences).toBeUndefined();
  });
  it('loads the default team with no agents when no state file exists', async () => {
    const persistence = new AppStateStore(await tempHome());

    await expect(persistence.load()).resolves.toStrictEqual(createEmptySnapshot());
  });

  it('keeps persisted empty agents empty while defaulting missing teams', () => {
    const restored = snapshotFromPersistedState({
      teams: [],
      agents: [],
      activeTeamId: null,
      activeAgentId: 'agent-dina',
      theme: defaultThemeSettings,
    });

    expect(restored.teams).toStrictEqual(createEmptySnapshot().teams);
    expect(restored.agents).toStrictEqual([]);
    expect(restored.activeTeamId).toBe('team-app');
    expect(restored.activeAgentId).toBeNull();
  });

  it('restores valid per-agent Open In choices and drops unsupported values', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].openInApplication = 'ghostty';
    const persisted = persistedStateFromSnapshot(snapshot) as unknown as {
      agents: Array<Record<string, unknown>>;
    };

    expect(snapshotFromPersistedState(persisted).agents[0].openInApplication).toBe('ghostty');
    persisted.agents[0].openInApplication = 'unknown-editor';
    expect(snapshotFromPersistedState(persisted).agents[0].openInApplication).toBeUndefined();
  });

  it('round-trips valid per-agent Git diff targets and drops invalid values', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].gitDiffTarget = { type: 'staged' };
    const persisted = persistedStateFromSnapshot(snapshot) as unknown as {
      agents: Array<Record<string, unknown>>;
    };

    expect(snapshotFromPersistedState(persisted).agents[0].gitDiffTarget).toStrictEqual({ type: 'staged' });
    persisted.agents[0].gitDiffTarget = { type: 'commit' };
    expect(snapshotFromPersistedState(persisted).agents[0].gitDiffTarget).toBeUndefined();
  });

  it('round-trips durable quick-chat identity', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].sessionKind = 'quickChat';
    snapshot.agents[0].name = null;
    snapshot.agents[0].folder = null;

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.agents[0]).toMatchObject({
      sessionKind: 'quickChat',
      name: null,
      folder: null,
    });
    expect(isAppSnapshot(restored)).toBe(true);
  });

  it('round-trips the Visualize session owned by an agent conversation', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].visualize = {
      id: 'visualize-1',
      conversationRef: { backend: 'codex', threadId: 'thread-visualize' },
      isOpen: true,
      suggestions: [{ id: 'suggestion-1', title: 'System map', description: 'Show the architecture.', visualizationId: 'visualization-1' }],
      visualizations: [{
        id: 'visualization-1',
        title: 'System map',
        content: { kind: 'mermaid', source: 'flowchart LR\n A --> B' },
        createdAt: '2026-09-21T12:00:00.000Z',
        updatedAt: '2026-09-21T12:00:00.000Z',
      }],
      selectedVisualizationId: 'visualization-1',
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T12:00:00.000Z',
    };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.agents[0].visualize).toStrictEqual(snapshot.agents[0].visualize);
    expect(restored.agents[0].visualize).not.toBe(snapshot.agents[0].visualize);
  });

  it('keeps repository diagrams after their worktree agent is deleted', async () => {
    const home = await tempHome();
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0];
    agent.folder = '/projects/app-feature';
    agent.workspace = {
      kind: 'git', folder: agent.folder, repositoryName: 'app', repositoryRoot: agent.folder,
      branch: 'feature', isLinkedWorktree: true, primaryWorktreeRoot: '/projects/app', updatedAt: agent.updatedAt,
    };
    agent.visualize = {
      id: 'visualize-feature', conversationRef: null, isOpen: true, suggestions: [],
      visualizations: [{ id: 'diagram-feature', title: 'Map', content: { kind: 'mermaid', source: 'flowchart LR; A --> B' },
        canvas: { revision: 1, elements: [], files: {}, selectedElementIds: [], preview: '' },
        createdAt: agent.createdAt, updatedAt: agent.updatedAt }],
      selectedVisualizationId: 'diagram-feature', createdAt: agent.createdAt, updatedAt: agent.updatedAt,
    };
    snapshot.repositoryVisualizations = { '/projects/app': agent.visualize.visualizations };
    await writeFile(path.join(home, 'state.json'), JSON.stringify(persistedStateFromSnapshot(snapshot)), 'utf8');

    const loaded = await new AppStateStore(home).load();
    expect(loaded.repositoryVisualizations?.['/projects/app']).toStrictEqual(agent.visualize.visualizations);
    expect(isAppSnapshot(loaded)).toBe(true);
    expect(loaded.agents[0].visualize?.visualizations).toBe(loaded.repositoryVisualizations?.['/projects/app']);
    closeAgentInSnapshot(loaded, agent.id);
    await new AppStateStore(home).save(loaded);
    const reloaded = await new AppStateStore(home).load();
    expect(reloaded.repositoryVisualizations?.['/projects/app'])
      .toStrictEqual(agent.visualize.visualizations);
    expect(reloaded.agents.some(candidate => candidate.id === agent.id)).toBe(false);
  });

  it('migrates a persisted Design session to Visualize state', () => {
    const snapshot = createInitialSnapshot();
    const persisted = structuredClone(persistedStateFromSnapshot(snapshot)) as unknown as { agents: Array<Record<string, unknown>> };
    persisted.agents[0].design = {
      id: 'legacy-design',
      conversationRef: { backend: 'codex', threadId: 'thread-design' },
      suggestions: [{ id: 'suggestion-1', title: 'System map', description: 'Show the architecture.', diagramId: 'diagram-1' }],
      diagrams: [{
        id: 'diagram-1', title: 'System map', content: { kind: 'mermaid', source: 'flowchart LR\n A --> B' }, revision: 1,
        createdAt: '2026-09-21T12:00:00.000Z', updatedAt: '2026-09-21T12:00:00.000Z',
      }],
      selectedDiagramId: 'diagram-1',
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T12:00:00.000Z',
    };

    const restored = snapshotFromPersistedState(persisted);

    expect(restored.agents[0].visualize).toMatchObject({
      id: 'legacy-design',
      isOpen: true,
      selectedVisualizationId: 'diagram-1',
      suggestions: [{ visualizationId: 'diagram-1' }],
      visualizations: [{ id: 'diagram-1' }],
    });
    expect(restored.agents[0].visualize?.visualizations[0]).not.toHaveProperty('revision');
    expect(persistedStateFromSnapshot(restored).agents[0]).not.toHaveProperty('design');
  });

  it('round-trips the agent that delegated a worker', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].delegatedByAgentId = 'agent-main';

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.agents[0].delegatedByAgentId).toBe('agent-main');
  });

  it('restores the review ledger without losing arbitration or round history', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].codeReview = {
      id: 'review-1',
      targetAgentId: snapshot.agents[0].id,
      reviewerAgentId: snapshot.agents[0].id,
      scope: { type: 'uncommitted' },
      threadMode: 'current',
      status: 'readyToFinish',
      activeRoundId: 'round-1',
      createdAt: '2026-09-19T10:00:00.000Z',
      updatedAt: '2026-09-19T10:20:00.000Z',
      rounds: [{
        id: 'round-1',
        number: 1,
        status: 'completed',
        reviewerSession: { kind: 'codex', threadId: 'reviewer-1' },
        startedAt: '2026-09-19T10:00:00.000Z',
        completedAt: '2026-09-19T10:20:00.000Z',
        findings: [{
          id: 'finding-1',
          roundId: 'round-1',
          priority: 'p1',
          title: 'Authorize before writing',
          body: 'The public path writes before checking ownership.',
          decision: { state: 'rejected', decidedAt: '2026-09-19T10:10:00.000Z', reason: 'Admin-only by contract.' },
          discussion: [{ id: 'message-1', author: 'user', body: 'This route is admin-only.', createdAt: '2026-09-19T10:09:00.000Z' }],
          remediation: { state: 'skipped', startedAt: '2026-09-19T10:10:00.000Z' },
          createdAt: '2026-09-19T10:05:00.000Z',
          updatedAt: '2026-09-19T10:10:00.000Z',
        }],
      }],
    };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.agents[0].codeReview).toStrictEqual(snapshot.agents[0].codeReview);
  });

  it('round-trips valid turn suggestions and drops invalid persisted values', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].threadFlags = {
      delegate_to_worktree: true,
      ready_for_review: true,
    };
    snapshot.agents[0].suggestedPrompt = 'Review the changes';
    const persisted = persistedStateFromSnapshot(snapshot) as unknown as {
      agents: Array<Record<string, unknown>>;
    };

    expect(snapshotFromPersistedState(persisted).agents[0].threadFlags)
      .toStrictEqual({ delegate_to_worktree: true, ready_for_review: true });
    expect(snapshotFromPersistedState(persisted).agents[0].suggestedPrompt).toBe('Review the changes');
    persisted.agents[0].suggestedPrompt = 123;
    expect(snapshotFromPersistedState(persisted).agents[0].suggestedPrompt).toBeUndefined();
    persisted.agents[0].threadFlags = { delegate_to_worktree: false };
    expect(snapshotFromPersistedState(persisted).agents[0].threadFlags).toBeUndefined();
  });

  it('round-trips tracked pull request state and rejects incomplete tracking records', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].pullRequest = {
      provider: 'github',
      repository: 'nbonamy/agent-workspace',
      branch: 'feat/pr-monitoring',
      number: 42,
      title: 'Monitor pull requests',
      url: 'https://github.com/nbonamy/agent-workspace/pull/42',
      draft: false,
      headSha: 'abc123',
      state: 'merged',
      mergedAt: '2026-09-03T12:00:00.000Z',
      createdAt: '2026-09-03T11:00:00.000Z',
      updatedAt: '2026-09-03T12:00:00.000Z',
    };

    const persisted = persistedStateFromSnapshot(snapshot);
    expect(snapshotFromPersistedState(persisted).agents[0].pullRequest).toStrictEqual(snapshot.agents[0].pullRequest);

    (persisted.agents[0] as { pullRequest?: unknown }).pullRequest = { provider: 'github', number: 42 };
    expect(snapshotFromPersistedState(persisted).agents[0].pullRequest).toBeUndefined();
  });

  it('round-trips workspace identity and ignores invalid legacy metadata', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].name = null;
    snapshot.agents[0].workspace = {
      kind: 'git',
      folder: '/Users/nbonamy/src/agent-workspace-feature',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/Users/nbonamy/src/agent-workspace-feature',
      branch: 'feat/work-routing',
      defaultBranch: 'trunk',
      isLinkedWorktree: true,
      primaryWorktreeRoot: '/Users/nbonamy/src/agent-workspace',
      originUrl: 'github.com:nbonamy/agent-workspace.git',
      updatedAt: '2026-08-27T12:00:00.000Z',
    };
    const persisted = persistedStateFromSnapshot(snapshot) as unknown as {
      agents: Array<Record<string, unknown>>;
    };

    expect(snapshotFromPersistedState(persisted).agents[0]).toMatchObject({
      name: null,
      workspace: snapshot.agents[0].workspace,
    });
    persisted.agents[0].workspace = { kind: 'git', repositoryName: 42 };
    expect(snapshotFromPersistedState(persisted).agents[0].workspace).toBeUndefined();
  });

  it('persists the observed subagent tree for backend and renderer reloads', () => {
    const snapshot = createInitialSnapshot();
    const agentId = snapshot.agents[0].id;
    snapshot.subagentTrees[agentId] = {
      rootConversationId: 'thread-root',
      nodes: {
        'thread-child': {
          conversationId: 'thread-child',
          parentConversationId: 'thread-root',
          createdAt: '2026-06-05T00:00:01.000Z',
          status: 'completed',
          agentPath: '/root/scout',
          agentNickname: 'Harvey',
          agentRole: 'worker',
          updatedAt: '2026-06-05T00:00:02.000Z',
        },
      },
      operations: {
        'followup-1': {
          id: 'followup-1',
          lifecycle: 'completed',
          kind: 'followupTask',
          status: 'interrupted',
          senderConversationId: 'thread-root',
          receiverConversationIds: ['thread-child'],
          occurredAt: '2026-06-05T00:00:01.000Z',
        },
      },
      activities: {
        'activity-child': {
          id: 'activity-child',
          lifecycle: 'completed',
          kind: 'completed',
          conversationId: 'thread-child',
          agentPath: '/root/scout',
          occurredAt: '2026-06-05T00:00:02.000Z',
        },
      },
    };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.subagentTrees).toStrictEqual(snapshot.subagentTrees);

    const legacyPersisted = persistedStateFromSnapshot(snapshot) as unknown as {
      subagentTrees: Record<string, { nodes: Record<string, { createdAt?: string }> }>;
    };
    delete legacyPersisted.subagentTrees[agentId]?.nodes['thread-child']?.createdAt;
    expect(snapshotFromPersistedState(legacyPersisted).subagentTrees[agentId]?.nodes['thread-child']?.createdAt)
      .toBe('2026-06-05T00:00:02.000Z');

    snapshot.subagentTrees[agentId]!.nodes['thread-root'] = {
      conversationId: 'thread-root',
      parentConversationId: 'thread-child',
      createdAt: '2026-06-05T00:00:03.000Z',
      status: 'running',
      agentPath: '/root',
      updatedAt: '2026-06-05T00:00:03.000Z',
    };
    snapshot.subagentTrees[agentId]!.activities['activity-root'] = {
      id: 'activity-root',
      lifecycle: 'completed',
      kind: 'interacted',
      conversationId: 'thread-root',
      agentPath: '/root',
      occurredAt: '2026-06-05T00:00:03.000Z',
    };
    const cleaned = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));
    expect(cleaned.subagentTrees[agentId]?.nodes['thread-root']).toBeUndefined();
    expect(cleaned.subagentTrees[agentId]?.activities['activity-root']).toBeUndefined();
  });

  it('saves metadata, backend session, context usage, and collaboration status without transcripts or runtime state', async () => {
    const home = await tempHome();
    const persistence = new AppStateStore(home);
    const snapshot = createInitialSnapshot();
    snapshot.backendRuntimes = [{ backend: 'codex', status: 'running', detail: 'connected' }];
    snapshot.accountRateLimits = {
      limitId: 'codex',
      limitName: null,
      primary: {
        usedPercent: 62,
        windowDurationMins: 300,
        resetsAt: 1_780_756_682,
      },
      secondary: {
        usedPercent: 50,
        windowDurationMins: 10_080,
        resetsAt: 1_781_140_878,
      },
      credits: null,
      individualLimit: null,
      planType: 'pro',
      rateLimitReachedType: null,
    };
    snapshot.agents[0] = {
      ...snapshot.agents[0],
      backendSession: { kind: 'codex', threadId: 'thread-dina' },
      backendDefaults: {
        kind: 'codex',
        approvalPreset: 'approve-for-me',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        sandboxMode: 'workspace-write',
        serviceTier: 'fast',
      },
      openInApplication: 'xcode',
      contextUsage: {
        totalTokens: 1200,
        inputTokens: 900,
        cachedInputTokens: 100,
        outputTokens: 300,
        reasoningOutputTokens: 80,
        lastTotalTokens: 300,
        modelContextWindow: 10000,
        usedPercent: 12,
      },
      plan: {
        threadId: 'thread-dina',
        turnId: 'turn-plan',
        kind: 'execution',
        status: 'inProgress',
        explanation: 'Current plan',
        steps: [
          { step: 'Inspect composer', status: 'completed' },
          { step: 'Wire preview', status: 'inProgress' },
        ],
        markdown: 'Current plan\n- [x] Inspect composer\n- [ ] Wire preview',
        updatedAt: '2026-06-05T10:11:12.000Z',
      },
      goal: {
        threadId: 'thread-dina',
        objective: 'Ship the goal shelf',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 1200,
        timeUsedSeconds: 30,
        createdAt: 1_780_000_000,
        updatedAt: 1_780_000_030,
      },
      isRegistered: true,
      mcpSessionId: 'mcp-session',
      statusText: 'Registered',
      status: { type: 'working', detail: 'busy' },
      lastActivityAt: '2026-06-04T23:59:00.000Z',
      hasSubmittedPrompt: true,
    };
    snapshot.workBacklog.assignments = {
      'github:nbonamy/agent-workspace#12': {
        provider: 'github',
        itemId: 'nbonamy/agent-workspace#12',
        agentId: 'agent-dina',
        assignedAt: '2026-06-09T13:00:00.000Z',
        policy: 'review',
        status: 'completed',
        completedAt: '2026-06-09T13:30:00.000Z',
      },
    };
    await persistence.save(snapshot);

    const readData = async (name: string) => (JSON.parse(await readFile(path.join(home, name), 'utf8')) as { data: Record<string, unknown> }).data;
    const written = await readData('roster.json');
    const writtenSettings = await readData('settings.json');
    for (const data of [written, writtenSettings]) {
      expect(data).not.toHaveProperty('messages');
      expect(data).not.toHaveProperty('backendRuntimes');
      expect(data).not.toHaveProperty('appServer');
    }
    expect(written.accountRateLimits).toStrictEqual(snapshot.accountRateLimits);
    expect(written.activeTeamId).toBe('team-app');
    const writtenAgent = (written.agents as Array<Record<string, unknown>>)[0];
    expect(writtenAgent.engine).toStrictEqual({
      kind: 'codex',
      session: { threadId: 'thread-dina' },
      settings: { approvalPreset: 'approve-for-me', serviceTier: 'fast' },
    });
    expect(writtenAgent).not.toHaveProperty('backend');
    expect(writtenAgent).not.toHaveProperty('teamId');
    expect(writtenAgent.openInApplication).toBe('xcode');
    expect(writtenAgent).not.toHaveProperty('codexThreadId');
    expect(writtenAgent.contextUsage).toStrictEqual({
      totalTokens: 1200,
      inputTokens: 900,
      cachedInputTokens: 100,
      outputTokens: 300,
      reasoningOutputTokens: 80,
      lastTotalTokens: 300,
      modelContextWindow: 10000,
      usedPercent: 12,
    });
    expect(writtenAgent.plan).toStrictEqual({
      threadId: 'thread-dina',
      turnId: 'turn-plan',
      kind: 'execution',
      status: 'inProgress',
      explanation: 'Current plan',
      steps: [
        { step: 'Inspect composer', status: 'completed' },
        { step: 'Wire preview', status: 'inProgress' },
      ],
      markdown: 'Current plan\n- [x] Inspect composer\n- [ ] Wire preview',
      updatedAt: '2026-06-05T10:11:12.000Z',
    });
    expect(writtenAgent.goal).toStrictEqual({
      threadId: 'thread-dina',
      objective: 'Ship the goal shelf',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 1200,
      timeUsedSeconds: 30,
      createdAt: 1_780_000_000,
      updatedAt: 1_780_000_030,
    });
    expect(writtenAgent).not.toHaveProperty('assignedWorkItems');
    expect(written.workAssignments).toStrictEqual({
      'github:nbonamy/agent-workspace#12': {
        provider: 'github',
        itemId: 'nbonamy/agent-workspace#12',
        agentId: 'agent-dina',
        assignedAt: '2026-06-09T13:00:00.000Z',
        policy: 'review',
        status: 'completed',
        completedAt: '2026-06-09T13:30:00.000Z',
      },
    });
    expect(writtenAgent).not.toHaveProperty('isRegistered');
    expect(writtenAgent).not.toHaveProperty('mcpSessionId');
    expect(writtenAgent.statusText).toBe('Registered');
    expect(writtenAgent.lastActivityAt).toBe('2026-06-04T23:59:00.000Z');
    expect(writtenAgent.hasSubmittedPrompt).toBe(true);
    expect(writtenAgent).not.toHaveProperty('status');
  });

  it('resets transient agent fields while preserving metadata, status text, and backend session on load', () => {
    const snapshot = createInitialSnapshot();
    snapshot.accountRateLimits = {
      limitId: 'codex',
      limitName: null,
      primary: {
        usedPercent: 62,
        windowDurationMins: 300,
        resetsAt: 1_780_756_682,
      },
      secondary: {
        usedPercent: 50,
        windowDurationMins: 10_080,
        resetsAt: 1_781_140_878,
      },
      credits: null,
      individualLimit: null,
      planType: 'pro',
      rateLimitReachedType: null,
    };
    snapshot.agents[0] = {
      ...snapshot.agents[0],
      backendSession: { kind: 'codex', threadId: 'thread-dina' },
      backendDefaults: {
        kind: 'codex',
        approvalPreset: 'approve-for-me',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        sandboxMode: 'workspace-write',
        serviceTier: 'fast',
      },
      contextUsage: {
        totalTokens: 1200,
        inputTokens: 900,
        cachedInputTokens: 100,
        outputTokens: 300,
        reasoningOutputTokens: 80,
        lastTotalTokens: 300,
        modelContextWindow: 10000,
        usedPercent: 12,
      },
      plan: {
        threadId: 'thread-dina',
        turnId: 'turn-plan',
        kind: 'execution',
        status: 'inProgress',
        explanation: 'Current plan',
        steps: [
          { step: 'Inspect composer', status: 'completed' },
          { step: 'Wire preview', status: 'inProgress' },
        ],
        markdown: 'Current plan\n- [x] Inspect composer\n- [ ] Wire preview',
        updatedAt: '2026-06-05T10:11:12.000Z',
      },
      goal: {
        threadId: 'thread-dina',
        objective: 'Ship the goal shelf',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 1200,
        timeUsedSeconds: 30,
        createdAt: 1_780_000_000,
        updatedAt: 1_780_000_030,
      },
      isRegistered: true,
      mcpSessionId: 'mcp-session',
      statusText: 'Registered',
      status: { type: 'working', detail: 'busy' },
      lastActivityAt: '2026-06-04T23:59:00.000Z',
    };

    const persisted = persistedStateFromSnapshot(snapshot);
    (persisted.agents[0] as Record<string, unknown>).assignedWorkItems = [
      {
        provider: 'github',
        id: 'nbonamy/agent-workspace#12',
        sourceId: 'nbonamy/agent-workspace',
        sourceName: 'nbonamy/agent-workspace',
        number: 12,
        title: 'Fix cockpit drag target',
        url: 'https://github.com/nbonamy/agent-workspace/issues/12',
        assignedAt: '2026-06-09T13:00:00.000Z',
      },
      {
        provider: 'github',
        id: 'nbonamy/agent-workspace#12',
        sourceId: 'nbonamy/agent-workspace',
        sourceName: 'nbonamy/agent-workspace',
        number: 12,
        title: 'Duplicate should be dropped',
        url: 'https://github.com/nbonamy/agent-workspace/issues/12',
        assignedAt: '2026-06-09T13:01:00.000Z',
      },
      {
        provider: 'jira',
        id: 'TEAM-1',
        sourceId: 'TEAM',
        sourceName: 'TEAM',
        number: 1,
        title: 'Invalid provider',
        url: 'https://example.com/TEAM-1',
        assignedAt: '2026-06-09T13:02:00.000Z',
      },
    ];
    const restored = snapshotFromPersistedState(persisted);

    expect(restored.agents[0]).toStrictEqual({
      id: 'agent-dina',
      teamId: 'team-app',
      name: 'Dina',
      avatar: 'DI',
      folder: '~/src/agent-workspace',
      backend: 'codex',
      backendDefaults: {
        kind: 'codex',
        approvalPreset: 'approve-for-me',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        sandboxMode: 'workspace-write',
        serviceTier: 'fast',
      },
      backendSession: { kind: 'codex', threadId: 'thread-dina' },
      contextUsage: {
        totalTokens: 1200,
        inputTokens: 900,
        cachedInputTokens: 100,
        outputTokens: 300,
        reasoningOutputTokens: 80,
        lastTotalTokens: 300,
        modelContextWindow: 10000,
        usedPercent: 12,
      },
      plan: {
        threadId: 'thread-dina',
        turnId: 'turn-plan',
        kind: 'execution',
        status: 'inProgress',
        explanation: 'Current plan',
        steps: [
          { step: 'Inspect composer', status: 'completed' },
          { step: 'Wire preview', status: 'inProgress' },
        ],
        markdown: 'Current plan\n- [x] Inspect composer\n- [ ] Wire preview',
        updatedAt: '2026-06-05T10:11:12.000Z',
      },
      goal: {
        threadId: 'thread-dina',
        objective: 'Ship the goal shelf',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 1200,
        timeUsedSeconds: 30,
        createdAt: 1_780_000_000,
        updatedAt: 1_780_000_030,
      },
      statusText: 'Registered',
      status: { type: 'idle' },
      createdAt: '2026-06-05T00:00:00.000Z',
      lastActivityAt: '2026-06-04T23:59:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });
    expect(restored.backendRuntimes).toStrictEqual(createEmptySnapshot().backendRuntimes);
    expect(restored.accountRateLimits).toStrictEqual(snapshot.accountRateLimits);
    expect(restored.workBacklog.assignments).toStrictEqual({
      'github:nbonamy/agent-workspace#12': {
        provider: 'github',
        itemId: 'nbonamy/agent-workspace#12',
        agentId: 'agent-dina',
        assignedAt: '2026-06-09T13:00:00.000Z',
        policy: 'review',
        status: 'inProgress',
      },
    });
  });

  it('persists work integration metadata without token material', () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog = {
      connections: [{
        provider: 'github',
        status: 'connected',
        accountLabel: 'nbonamy',
        connectedAt: '2026-06-09T12:00:00.000Z',
      }],
      providerConfigurations: {
        github: {
          sourceId: 'nbonamy/agent-workspace',
          assigneeLogin: 'nbonamy',
          tagName: 'bug',
        },
      },
      providerSettings: {
        github: {
          oauthClientId: 'client-id',
        },
      },
      assignments: {
        'github:nbonamy/agent-workspace#12': {
          provider: 'github',
          itemId: 'nbonamy/agent-workspace#12',
          agentId: 'agent-dina',
          assignedAt: '2026-06-09T13:00:00.000Z',
          policy: 'complete',
          status: 'completed',
          completedAt: '2026-06-09T13:30:00.000Z',
          automationId: 'automation-bugs',
          automationExecutionId: 'automation-exec-1',
        },
      },
    };

    const persisted = persistedStateFromSnapshot(snapshot);

    expect(persisted.workBacklog).toStrictEqual({
      connections: [{
        provider: 'github',
        status: 'connected',
        accountLabel: 'nbonamy',
        connectedAt: '2026-06-09T12:00:00.000Z',
      }],
      providerConfigurations: {
        github: {
          sourceId: 'nbonamy/agent-workspace',
          assigneeLogin: 'nbonamy',
          tagName: 'bug',
        },
      },
      providerSettings: {
        github: {
          oauthClientId: 'client-id',
        },
      },
      assignments: {
        'github:nbonamy/agent-workspace#12': {
          provider: 'github',
          itemId: 'nbonamy/agent-workspace#12',
          agentId: 'agent-dina',
          assignedAt: '2026-06-09T13:00:00.000Z',
          policy: 'complete',
          status: 'completed',
          completedAt: '2026-06-09T13:30:00.000Z',
          automationId: 'automation-bugs',
          automationExecutionId: 'automation-exec-1',
        },
      },
    });
    expect(JSON.stringify(persisted)).not.toContain('accessToken');
    expect(JSON.stringify(persisted)).not.toContain('encryptedAccessToken');

    const restored = snapshotFromPersistedState(persisted);
    expect(restored.workBacklog).toStrictEqual(snapshot.workBacklog);

    const assignment = persisted.workBacklog!.assignments['github:nbonamy/agent-workspace#12']!;
    const { automationId, automationExecutionId, ...legacyAssignment } = assignment;
    const restoredLegacy = snapshotFromPersistedState({
      ...persisted,
      workBacklog: {
        ...persisted.workBacklog,
        assignments: {
          'github:nbonamy/agent-workspace#12': {
            ...legacyAssignment,
            loopId: automationId,
            loopExecutionId: automationExecutionId,
          },
        },
      },
    });
    expect(restoredLegacy.workBacklog).toStrictEqual(snapshot.workBacklog);
  });

  it('persists remote backend connections', () => {
    const snapshot = createInitialSnapshot();
    snapshot.remoteConnections.connections = [{
      id: 'connection-devbox',
      kind: 'ssh',
      name: 'devbox',
      host: 'devbox',
      hostName: 'devbox.internal',
      user: 'nicolas',
      port: 2222,
      status: 'ready',
      detail: 'Ready (daemon 0.1.0)',
      sourceFolderPath: '~/src',
      transport: {
        type: 'ssh-stdio',
        command: 'ssh',
        args: ['devbox', `node ~/${product.homeDirectory}/daemon.mjs --stdio`],
      },
      installedAt: '2026-06-14T10:00:00.000Z',
      lastCheckedAt: '2026-06-14T10:00:00.000Z',
      createdAt: '2026-06-14T09:59:00.000Z',
      updatedAt: '2026-06-14T10:00:00.000Z',
    }];

    const persisted = persistedStateFromSnapshot(snapshot);
    const restored = snapshotFromPersistedState(persisted);

    expect(persisted.remoteConnections).toStrictEqual(snapshot.remoteConnections);
    expect(restored.remoteConnections).toStrictEqual(snapshot.remoteConnections);
  });

  it('drops every work assignment when none of its assigned agents exist', () => {
    const restored = snapshotFromPersistedState({
      teams: [],
      agents: [],
      activeTeamId: null,
      activeAgentId: null,
      theme: defaultThemeSettings,
      workBacklog: {
        connections: [],
        providerConfigurations: {},
        providerSettings: {},
        assignments: {
          'github:nbonamy/agent-workspace#12': {
            provider: 'github',
            itemId: 'nbonamy/agent-workspace#12',
            agentId: 'agent-closed',
            assignedAt: '2026-06-09T13:00:00.000Z',
            status: 'completed',
            completedAt: '2026-06-09T13:30:00.000Z',
          },
          'github:nbonamy/agent-workspace#13': {
            provider: 'github',
            itemId: 'nbonamy/agent-workspace#13',
            agentId: 'agent-working-gone',
            assignedAt: '2026-06-09T13:00:00.000Z',
            status: 'working',
          },
        },
      },
    });

    expect(restored.workBacklog.assignments).toStrictEqual({});
  });

  it('persists and restores automations', () => {
    const snapshot = createInitialSnapshot();
    snapshot.automations = [{
      id: 'automation-bugs',
      name: 'GitHub bugs',
      enabled: true,
      prompt: 'Start by reproducing the issue.', target: { kind: 'newQuickChat' as const, teamId: 'team-app', backend: 'codex' as const },



      schedule: { intervalMinutes: 60 },
      createdAt: '2026-06-09T10:00:00.000Z',
      updatedAt: '2026-06-09T10:01:00.000Z',
      lastRunAt: '2026-06-09T10:02:00.000Z',

      executionLog: [{
        id: 'automation-exec-1',
        automationId: 'automation-bugs',
        startedAt: '2026-06-09T10:02:00.000Z',
        completedAt: '2026-06-09T10:03:00.000Z',
        status: 'completed',

        agentId: 'agent-dina', agentName: 'Dina', conversationRef: { backend: 'codex', threadId: 'thread-dina' },
      }, {
        id: 'automation-exec-2',
        automationId: 'automation-bugs',
        startedAt: '2026-06-09T10:04:00.000Z',
        status: 'working',

        agentId: 'agent-jesse', agentName: 'Jesse',
      }],
    }];

    const persisted = persistedStateFromSnapshot(snapshot);
    const restored = snapshotFromPersistedState(persisted);

    expect(persisted.automations).toStrictEqual(snapshot.automations);
    expect(persisted).not.toHaveProperty('loops');
    expect(restored.automations).toStrictEqual(snapshot.automations);

  });

  it('sanitizes invalid work integration metadata', () => {
    const restored = snapshotFromPersistedState({
      teams: [],
      agents: [],
      activeTeamId: null,
      activeAgentId: null,
      theme: defaultThemeSettings,
      workBacklog: {
        connections: [
          { provider: 'github', status: 'connected', accountLabel: 'nbonamy' },
          { provider: 'jira', status: 'connected', accountLabel: 'example' },
          { provider: 'github', status: 'done' },
        ],
        providerConfigurations: {
          github: {
            sourceId: ' nbonamy/agent-workspace ',
            assigneeLogin: ' nbonamy ',
            tagName: ' bug ',
          },
          jira: {
            repositoryId: 'TEAM-1',
          },
        },
        providerSettings: {
          github: { oauthClientId: ' client-id ' },
          jira: { oauthClientId: 'jira-client-id' },
        },
        assignments: {
          'github:nbonamy/agent-workspace#12': {
            provider: 'github',
            itemId: 'nbonamy/agent-workspace#12',
            agentId: 'missing-agent',
            assignedAt: '2026-06-09T13:00:00.000Z',
          },
          'jira:TEAM-1': {
            provider: 'jira',
            itemId: 'TEAM-1',
            agentId: 'missing-agent',
            assignedAt: '2026-06-09T13:00:00.000Z',
          },
        },
      },
    });

    expect(restored.workBacklog).toStrictEqual({
      connections: [{
        provider: 'github',
        status: 'connected',
        accountLabel: 'nbonamy',
      }],
      providerConfigurations: {
        github: {
          sourceId: 'nbonamy/agent-workspace',
          assigneeLogin: 'nbonamy',
          tagName: 'bug',
        },
      },
      providerSettings: {
        github: {
          oauthClientId: 'client-id',
        },
      },
      assignments: {},
    });
  });

  it('drops invalid persisted plan state', () => {
    const restored = snapshotFromPersistedState({
      teams: [{ id: 'team-app', name: product.name, agentIds: ['agent-dina'] }],
      agents: [{
        id: 'agent-dina',
        teamId: 'team-app',
        name: 'Dina',
        folder: '~/src/agent-workspace',
        backend: 'codex',
        backendSession: { kind: 'codex', threadId: 'thread-dina' },
        plan: {
          threadId: 'thread-dina',
          turnId: 'turn-plan',
          explanation: 'Current plan',
          steps: [{ step: 'Inspect composer', status: 'done' }],
          markdown: 'Current plan',
          updatedAt: '2026-06-05T10:11:12.000Z',
        },
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
      }],
      activeTeamId: 'team-app',
      activeAgentId: 'agent-dina',
      theme: defaultThemeSettings,
    });

    expect(restored.agents[0].plan).toMatchObject({
      kind: 'execution',
      status: 'incomplete',
      steps: [],
    });
  });

  it('drops invalid persisted context usage', () => {
    const restored = snapshotFromPersistedState({
      teams: [{ id: 'team-app', name: product.name, agentIds: ['agent-dina'] }],
      agents: [{
        id: 'agent-dina',
        teamId: 'team-app',
        name: 'Dina',
        folder: '~/src/agent-workspace',
        backend: 'codex',
        backendSession: { kind: 'codex', threadId: 'thread-dina' },
        contextUsage: {
          totalTokens: 1200,
          inputTokens: 900,
          cachedInputTokens: 100,
          outputTokens: 300,
          reasoningOutputTokens: 80,
          lastTotalTokens: 300,
          modelContextWindow: '10000',
          usedPercent: 12,
        },
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
      }],
      activeTeamId: 'team-app',
      activeAgentId: 'agent-dina',
      theme: defaultThemeSettings,
    });

    expect(restored.agents[0].contextUsage).toBeUndefined();
  });

  it('drops backend sessions and defaults that do not match the agent backend', () => {
    const restored = snapshotFromPersistedState({
      teams: [{ id: 'team-app', name: product.name, agentIds: ['agent-dina'] }],
      agents: [{
        id: 'agent-dina',
        teamId: 'team-app',
        name: 'Dina',
        folder: '~/src/agent-workspace',
        backend: 'claude',
        backendSession: { kind: 'codex', threadId: 'thread-dina' },
        backendDefaults: { kind: 'codex', model: 'gpt-5.1-codex' },
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
      }],
      activeTeamId: 'team-app',
      activeAgentId: 'agent-dina',
      theme: defaultThemeSettings,
    });

    expect(restored.agents[0].backend).toBe('claude');
    expect(restored.agents[0].backendSession).toBeUndefined();
    expect(restored.agents[0].backendDefaults).toBeUndefined();
  });

  it('persists Claude thread and fallback model selections', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0] = {
      ...snapshot.agents[0],
      backend: 'claude',
      backendSession: {
        kind: 'claude',
        sessionId: 'claude-session-1',
        transport: 'stdio',
        transcriptSessionId: 'claude-session-1',
        model: 'claude-sonnet-5',
        reasoningEffort: 'xhigh',
      },
      backendDefaults: {
        kind: 'claude',
        model: 'sonnet',
        reasoningEffort: 'high',
        permissionMode: 'acceptEdits',
      },
    };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.agents[0].backendSession).toStrictEqual(snapshot.agents[0].backendSession);
    expect(restored.agents[0].backendDefaults).toStrictEqual(snapshot.agents[0].backendDefaults);
  });

  it('repairs team membership and selected agent when persisted ids drift', async () => {
    const home = await tempHome();
    await writeFile(path.join(home, 'state.json'), JSON.stringify({
      teams: [{ id: 'team-app', name: product.name, agentIds: [] }],
      agents: [{ id: 'agent-jules', teamId: 'team-app', name: 'Jules', folder: '/tmp/jules', createdAt: 'now', updatedAt: 'now' }],
      activeTeamId: 'missing-team',
      activeAgentId: 'missing-agent',
      theme: defaultThemeSettings,
    }), 'utf8');

    const restored = await new AppStateStore(home).load();

    expect(restored.activeAgentId).toBe('agent-jules');
    expect(restored.activeTeamId).toBe('team-app');
    expect(restored.teams[0].color).toBe('#1B4FB2');
    expect(restored.teams[0].agentIds).toStrictEqual(['agent-jules']);
    expect(restored.agents[0].lastActivityAt).toBe('now');
  });

  it('persists and restores normalized appearance settings', () => {
    const snapshot = createInitialSnapshot();
    snapshot.theme = {
      id: 'github-dark',
      mode: 'dark',
      uiFontSize: 15,
      chatFontSize: 17,
      codeFontSize: 14,
    };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.theme).toStrictEqual(snapshot.theme);
  });

  it('persists and restores normalized general settings', () => {
    const snapshot = createInitialSnapshot();
    snapshot.general = {
      commitMessageInstructions: 'Use conventional commits.',
      pullRequestInstructions: 'Include a testing section.',
      preventSleepWhenAgentsRun: false,
      preventSleepWhenRemoteAccessEnabled: true,
      celebrationsEnabled: false,
      followUpBehavior: 'queue',
      spokenAnnouncementsEnabled: true,
      spokenAnnouncementsMuted: true,
      spokenAnnouncementsOnlyForDictatedPrompts: true,
      spokenAnnouncementsOnlyWhenFocused: true,
      spokenAnnouncementScope: 'all',
      spokenAnnouncementVoice: 'af_bella',
      codexBinaryPath: '/opt/homebrew/bin/codex',
      claudeCodeEnabled: true,
      agentListCompact: true,
      cockpitAgentViewMode: 'recent',
      collapsedRepositoryKeys: ['remote:github.com/nbonamy/agent-workspace'],
      modelFavorites: [{
        backend: 'codex',
        modelId: 'gpt-5.6-terra',
        reasoningEffort: 'high',
        serviceTier: 'priority',
      }],
      backlogRepositoryFavorites: {},
      savedPromptDrafts: [],
      providerHomes: { codex: { isolated: true, shareSkills: false, homePath: "/app/codex-home" } },
      sessionCompressionWarningEnabled: false,
      worktreeInitializationMode: 'repository',
      repositoryIcons: { '/src/agent-workspace': '🦞' },
      appshots: {
        hotkey: 'option',
        destination: 'active-agent',
        playSound: false,
      },
      plugins: { ...defaultPluginSettings },
    };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.general).toStrictEqual({ ...snapshot.general, git: { pull: 'git-config', update: 'merge' } });
  });

  it('removes credentials from restored workspace origins', () => {
    const snapshot = createInitialSnapshot();
    const persisted = persistedStateFromSnapshot(snapshot);
    persisted.agents[0]!.workspace = {
      kind: 'git',
      folder: '/src/agent-workspace',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/src/agent-workspace',
      branch: 'main',
      isLinkedWorktree: false,
      primaryWorktreeRoot: '/src/agent-workspace',
      originUrl: 'https://oauth2:secret@github.com/openai/agent-workspace.git?token=secret',
      updatedAt: '2026-08-29T00:00:00.000Z',
    };

    expect(snapshotFromPersistedState(persisted).agents[0]?.workspace).toMatchObject({
      originUrl: 'https://github.com/openai/agent-workspace.git',
    });
  });

  it('persists the current conversation title separately from the agent name', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.name = null;
    snapshot.agents[0]!.conversationTitle = 'work-routing';

    expect(snapshotFromPersistedState(persistedStateFromSnapshot(snapshot)).agents[0]).toMatchObject({
      name: null,
      conversationTitle: 'work-routing',
    });
  });

  it('persists and restores source folder settings', () => {
    const snapshot = createInitialSnapshot();
    snapshot.sourceFolder = {
      path: '~/src',
      initialized: true,
      recentRepoNames: ['agent-workspace', 'skwad'],
    };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.sourceFolder).toStrictEqual(snapshot.sourceFolder);
  });

  it('drops persisted work assignments whose local agent no longer exists', () => {
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.assignments = {
      'github:nbonamy/agent-workspace#12': {
        provider: 'github',
        itemId: 'nbonamy/agent-workspace#12',
        agentId: 'agent-dina',
        assignedAt: '2026-06-14T10:00:00.000Z',
        policy: 'review',
        status: 'inProgress',
      },
      'github:nbonamy/agent-workspace#13': {
        provider: 'github',
        itemId: 'nbonamy/agent-workspace#13',
        agentId: 'agent-closed',
        assignedAt: '2026-06-14T11:00:00.000Z',
        policy: 'review',
        status: 'completed',
      },
    };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.workBacklog.assignments).toStrictEqual({
      'github:nbonamy/agent-workspace#12': snapshot.workBacklog.assignments['github:nbonamy/agent-workspace#12'],
    });
  });

  it('restores remote teams as pointer-only state when the connection exists', () => {
    const snapshot = createInitialSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams[0].remoteConnectionId = 'connection-devbox';
    snapshot.teams[0].remoteTeamId = 'team-remote';
    snapshot.workBacklog.assignments = {
      'github:nbonamy/agent-workspace#12': {
        provider: 'github',
        itemId: 'nbonamy/agent-workspace#12',
        agentId: 'agent-dina',
        assignedAt: '2026-06-14T10:00:00.000Z',
        policy: 'review',
        status: 'inProgress',
      },
    };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.teams[0].remoteConnectionId).toBe('connection-devbox');
    expect(restored.teams[0].remoteTeamId).toBe('team-remote');
    expect(restored.teams[0].agentIds).toStrictEqual([]);
    expect(restored.teams[0].activeAgentId).toBeUndefined();
    expect(restored.agents).toStrictEqual([]);
    expect(restored.activeAgentId).toBeNull();
    expect(restored.workBacklog.assignments).toStrictEqual({});
  });

  it('does not treat a remote team id collision as local team membership', () => {
    const restored = snapshotFromPersistedState({
      teams: [
        {
          id: 'team-remote-pointer',
          name: 'Remote Pointer',
          remoteConnectionId: 'connection-devbox',
          remoteTeamId: 'team-app',
          agentIds: ['agent-stale-remote'],
          activeAgentId: 'agent-stale-remote',
        },
        {
          id: 'team-app',
          name: 'Local',
          agentIds: ['agent-local'],
          activeAgentId: 'agent-local',
        },
      ],
      agents: [
        {
          id: 'agent-stale-remote',
          teamId: 'team-remote-pointer',
          name: 'Stale Remote',
          folder: '/home/nicolas/src/remote',
          backend: 'codex',
          createdAt: '2026-06-14T10:00:00.000Z',
          updatedAt: '2026-06-14T10:00:00.000Z',
        },
        {
          id: 'agent-local',
          teamId: 'team-app',
          name: 'Local',
          folder: '/Users/nicolas/src/local',
          backend: 'codex',
          createdAt: '2026-06-14T10:00:00.000Z',
          updatedAt: '2026-06-14T10:00:00.000Z',
        },
      ],
      activeTeamId: 'team-app',
      activeAgentId: 'agent-local',
      remoteConnections: { connections: [readyRemoteConnection()] },
      theme: defaultThemeSettings,
    });

    expect(restored.teams.find((team) => team.id === 'team-remote-pointer')?.agentIds).toStrictEqual([]);
    expect(restored.teams.find((team) => team.id === 'team-app')?.agentIds).toStrictEqual(['agent-local']);
    expect(restored.agents.map((agent) => agent.id)).toStrictEqual(['agent-local']);
    expect(restored.activeTeamId).toBe('team-app');
    expect(restored.activeAgentId).toBe('agent-local');
  });

  it('repairs orphaned local agents to a local team instead of a remote pointer', () => {
    const restored = snapshotFromPersistedState({
      teams: [
        {
          id: 'team-remote-pointer',
          name: 'Remote Pointer',
          remoteConnectionId: 'connection-devbox',
          remoteTeamId: 'team-remote',
          agentIds: [],
        },
        {
          id: 'team-local',
          name: 'Local',
          agentIds: [],
        },
      ],
      agents: [{
        id: 'agent-orphan',
        teamId: 'team-missing',
        name: 'Orphan',
        folder: '/Users/nicolas/src/local',
        backend: 'codex',
        createdAt: '2026-06-14T10:00:00.000Z',
        updatedAt: '2026-06-14T10:00:00.000Z',
      }],
      activeTeamId: 'team-local',
      activeAgentId: 'agent-orphan',
      remoteConnections: { connections: [readyRemoteConnection()] },
      theme: defaultThemeSettings,
    });

    expect(restored.teams.find((team) => team.id === 'team-remote-pointer')?.agentIds).toStrictEqual([]);
    expect(restored.teams.find((team) => team.id === 'team-local')?.agentIds).toStrictEqual(['agent-orphan']);
    expect(restored.agents[0].teamId).toBe('team-local');
    expect(restored.activeTeamId).toBe('team-local');
    expect(restored.activeAgentId).toBe('agent-orphan');
  });

  it('drops remote team connection ids when the connection is missing', () => {
    const restored = snapshotFromPersistedState({
      teams: [{
        id: 'team-remote',
        name: 'Remote',
        remoteConnectionId: 'missing-connection',
        remoteTeamId: 'team-remote',
        agentIds: ['agent-remote'],
      }],
      agents: [{
        id: 'agent-remote',
        name: 'Remote',
        folder: '/home/nicolas/src/agent-workspace',
        backend: 'codex',
        createdAt: '2026-06-14T10:00:00.000Z',
        updatedAt: '2026-06-14T10:00:00.000Z',
      }],
      activeTeamId: null,
      activeAgentId: 'agent-remote',
      theme: defaultThemeSettings,
      remoteConnections: { connections: [] },
    });

    expect(restored.teams[0].remoteConnectionId).toBeUndefined();
    expect(restored.teams[0].remoteTeamId).toBeUndefined();
  });

  it('sanitizes invalid source folder settings', () => {
    const restored = snapshotFromPersistedState({
      teams: [],
      agents: [],
      activeTeamId: null,
      activeAgentId: null,
      theme: defaultThemeSettings,
      sourceFolder: {
        path: 42,
        initialized: 'yes',
        recentRepoNames: [' agent-workspace ', '', 12, 'skwad', 'agent-workspace'],
      },
    });

    expect(restored.sourceFolder).toStrictEqual({
      path: '',
      initialized: false,
      recentRepoNames: ['agent-workspace', 'skwad'],
    });
  });
});

async function tempHome(): Promise<string> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-state-'));
  return tempDir;
}

function readyRemoteConnection(): RemoteConnection {
  return {
    id: 'connection-devbox',
    kind: 'ssh' as const,
    name: 'devbox',
    host: 'devbox',
    status: 'ready' as const,
    transport: {
      type: 'ssh-stdio' as const,
      command: 'ssh',
      args: ['devbox', `node ~/${product.homeDirectory}/daemon.mjs --stdio`],
    },
    createdAt: '2026-06-14T10:00:00.000Z',
    updatedAt: '2026-06-14T10:00:00.000Z',
  };
}
