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
  it('restores a Cursor roster, settings and delegation identity exactly after disk restart', async () => {
    const home = await tempHome();
    const snapshot = createInitialSnapshot();
    for (const item of snapshot.agents) item.lastActivityAt = item.createdAt;
    const agent = snapshot.agents[0]!;
    agent.provider = 'cursor';
    agent.providerSession = { kind: 'cursor', conversationId: 'cursor-native-session' };
    agent.providerDefaults = { kind: 'cursor', model: 'composer-fixture', reasoningEffort: 'high', serviceTier: null, permission: 'allowlist', userSelectedModel: true };
    agent.userDelegationOverrides = { startingContext: 'handoff', instructions: 'Synthetic constraint', execution: { provider: 'cursor', conversationId: 'cursor-native-session', turnId: 'turn-1' } };
    agent.handoff = { operationId: 'cursor-handoff', sourceAgentId: agent.id, sourceTitle: 'Cursor source',
      sourceRef: { provider: 'cursor', folder: agent.folder, conversationId: 'cursor-source' }, phase: 'complete',
      selection: { provider: 'codex', model: null, reasoningEffort: null, serviceTier: null } };
    agent.visualize = { id: 'cursor-viz', conversationRef: { provider: 'cursor', folder: agent.folder, conversationId: 'cursor-native-session' },
      isOpen: true, suggestions: [], visualizations: [], selectedVisualizationId: null, createdAt: '', updatedAt: '' };
    snapshot.general.preferredProviders = { local: 'cursor' };
    snapshot.general.providerHomes = { cursor: { homePath: '/cursor', isolated: false, shareSkills: false } };
    snapshot.general.providerEnabled = { codex: true, cursor: false };
    snapshot.general.providerModelDefaults = { cursor: { provider: 'cursor', model: 'composer-fixture', reasoningEffort: 'high', serviceTier: null } };
    await new AppStateStore(home).save(snapshot);
    const rosterBefore = JSON.parse(await readFile(path.join(home, 'roster.json'), 'utf8'));
    const restored = await new AppStateStore(home).load();
    expect(isAppSnapshot(restored)).toBe(true);
    expect(restored.agents.find(item => item.id === agent.id)).toStrictEqual(agent);
    expect(restored.general.providerHomes).toStrictEqual(snapshot.general.providerHomes);
    expect(restored.general.providerEnabled).toStrictEqual(snapshot.general.providerEnabled);
    expect(restored.general.providerModelDefaults).toStrictEqual(snapshot.general.providerModelDefaults);
    expect(restored.general.preferredProviders).toStrictEqual(snapshot.general.preferredProviders);
    await new AppStateStore(home).save(restored);
    expect(JSON.parse(await readFile(path.join(home, 'roster.json'), 'utf8'))).toStrictEqual(rosterBefore);
  });

  it.each(['codex', 'claude', 'antigravity'] as const)('drops mismatched %s session/defaults from a Cursor agent', backend => {
    const snapshot = createInitialSnapshot();
    const persisted = persistedStateFromSnapshot(snapshot);
    persisted.agents[0]!.provider = 'cursor';
    persisted.agents[0]!.providerSession = backend === 'codex' ? { kind: backend, conversationId: 'other' } : backend === 'claude' ? { kind: backend, conversationId: 'other', transport: 'stdio' } : { kind: backend, conversationId: 'other' };
    persisted.agents[0]!.providerDefaults = { kind: backend, model: 'other-only' };
    const restored = snapshotFromPersistedState(persisted);
    expect(restored.agents[0]!.provider).toBe('cursor');
    expect(restored.agents[0]!.providerSession).toBeUndefined();
    expect(restored.agents[0]!.providerDefaults).toBeUndefined();
  });

  it('retains a guest display name saved through settings update after restart', async () => {
    const home = await tempHome();
    const store = new AppStateStore(home);
    const server = new AppBackendServer({ version: 'test', snapshot: createInitialSnapshot(), saveSnapshot: snapshot => store.save(snapshot) });
    try {
      const result = await server.handleMessage({ jsonrpc: '2.0', id: 'save-name', method: backendMethods.settingsUpdate, params: { input: { general: { guestDisplayName: ' Nicolas ' } } } });
      expect(result).not.toHaveProperty('error');
    } finally { await server.close(); }
    const restored = await new AppStateStore(home).load();
    expect(restored.general.guestDisplayName).toBe('Nicolas');
  });
  it('retains read revisions across a fresh store restart', async () => {
    const home = await tempHome();
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.readState = { revision: 7, readRevision: 5 };
    await new AppStateStore(home).save(snapshot);
    const restored = await new AppStateStore(home).load();
    expect(restored.agents[0]!.readState).toStrictEqual({ revision: 7, readRevision: 5 });
    expect(isAppSnapshot(restored)).toBe(true);
  });
  it.each([true, false])('retains plan and review workflow toggles after a host restart: %s', async useInteractivePlans => {
    const home = await tempHome();
    const snapshot = createInitialSnapshot();
    updateSettingsInSnapshot(snapshot, { general: { useInteractivePlans, codeReviewDiscussWithOriginalThread: useInteractivePlans } });
    await new AppStateStore(home).save(snapshot);
    const restored = await new AppStateStore(home).load();
    expect(restored.general.useInteractivePlans).toBe(useInteractivePlans);
    expect(restored.general.codeReviewDiscussWithOriginalThread).toBe(useInteractivePlans);
  });
  it.each([false, true])('retains workflow preferences and worker context after reload (execution bound: %s)', async bound => {
    const home = await tempHome();
    const snapshot = createInitialSnapshot();
    updateSettingsInSnapshot(snapshot, { general: { worktreeDelegationStartingContext: 'handoff', worktreeDelegationInstructions: 'Keep commits local.\nRun focused tests.', codeReviewInstructions: 'Check authorization.\nKeep findings actionable.', missionInstructions: 'Keep tickets small.\nInclude acceptance criteria.' } });
    snapshot.agents[0]!.delegationContext = { requested: 'conversation', effective: 'handoff', reason: 'cross-provider' };
    snapshot.agents[0]!.userDelegationOverrides = { startingContext: 'handoff', instructions: 'User-entered directions', ...(bound ? { execution: { provider: 'codex' as const, conversationId: 'thread-dina', turnId: 'turn-dina' } } : {}) };
    snapshot.agents[1]!.delegationUserInstructions = { saved: 'Saved user constraint', taskSpecific: 'Explicit user override' };
    snapshot.agents[1]!.provider = 'claude';
    snapshot.agents[1]!.providerDefaults = { kind: 'claude' };
    snapshot.agents[1]!.providerSession = { kind: 'claude', conversationId: 'native-worker', transport: 'stdio', transcriptFolder: '/source-provider-store' };
    await new AppStateStore(home).save(snapshot);
    const restored = await new AppStateStore(home).load();
    expect(restored.general.codeReviewInstructions).toBe('Check authorization.\nKeep findings actionable.');
    expect(restored.general.missionInstructions).toBe('Keep tickets small.\nInclude acceptance criteria.');
    expect(restored.general.worktreeDelegationStartingContext).toBe('handoff');
    expect(restored.general.worktreeDelegationInstructions).toBe('Keep commits local.\nRun focused tests.');
    expect(restored.agents[0]!.delegationContext).toStrictEqual(snapshot.agents[0]!.delegationContext);
    expect(restored.agents[0]!.userDelegationOverrides).toStrictEqual(snapshot.agents[0]!.userDelegationOverrides);
    expect(restored.agents[1]!.delegationUserInstructions).toStrictEqual(snapshot.agents[1]!.delegationUserInstructions);
    expect(restored.agents[1]!.providerSession).toStrictEqual(snapshot.agents[1]!.providerSession);
    expect(isAppSnapshot(restored)).toBe(true);
  });
  it('restores failed setup and reports interrupted background worktree initialization after restart', async () => {
    const home = await tempHome();
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.worktreeInitialization = { state: 'running', command: 'npm ci' };
    snapshot.agents[1]!.worktreeInitialization = { state: 'error', command: 'uv sync', error: 'Setup failed' };
    await new AppStateStore(home).save(snapshot);
    const restored = await new AppStateStore(home).load();
    expect(restored.agents[0]!.worktreeInitialization).toMatchObject({ state: 'error', command: 'npm ci' });
    expect(restored.agents[0]!.worktreeInitialization!.error).toContain('interrupted');
    expect(restored.agents[1]!.worktreeInitialization).toStrictEqual(snapshot.agents[1]!.worktreeInitialization);
    expect(isAppSnapshot(restored)).toBe(true);
  });

  it('restores ordered backlog favorites after client preference updates and a fresh store restart', async () => {
    const home = await tempHome();
    const store = new AppStateStore(home);
    const snapshot = createInitialSnapshot();
    const service = new ClientPreferencesService({ snapshot: async () => snapshot, save: async (id, preferences) => {
      snapshot.clientPreferences = { ...snapshot.clientPreferences, [id]: preferences };
      await store.save(snapshot);
    } });
    const linear = ['team-b-uuid', 'team-a-uuid'];
    for (const github of [['org/a'], ['org/a', 'org/b'], ['org/b', 'org/a']]) {
      await service.update('desktop', backendMethods.clientPreferencesUpdate, { input: { general: { backlogRepositoryFavorites: { github, linear } } } });
    }
    const restored = await new AppStateStore(home).load();
    expect(restored.general.backlogRepositoryFavorites).toStrictEqual({ github: ['org/b', 'org/a'], linear });
    expect(restored.workBacklog).toStrictEqual(snapshot.workBacklog);
    await service.update('desktop', backendMethods.clientPreferencesUpdate, { input: { general: { backlogRepositoryFavorites: { github: ['org/a'], linear: [...linear].reverse() } } } });
    expect((await new AppStateStore(home).load()).general.backlogRepositoryFavorites).toStrictEqual({ github: ['org/a'], linear: ['team-a-uuid', 'team-b-uuid'] });
  });
  it('roundtrips Antigravity session identity and isolated provider preferences through disk', async () => {
    const home = await tempHome();
    const store = new AppStateStore(home);
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.provider = 'antigravity';
    agent.providerSession = { kind: 'antigravity', conversationId: 'native-acp-session' };
    agent.providerDefaults = { kind: 'antigravity', model: 'gemini-3.8-flash-low', permission: 'default' };
    snapshot.general.providerHomes = { antigravity: { homePath: '/private/acp', isolated: true, shareSkills: false } };
    snapshot.general.providerEnabled = { codex: true, antigravity: false };
    snapshot.general.providerModelDefaults = { antigravity: {provider: 'antigravity',  model: 'gemini-3.8-flash-low', reasoningEffort: null, serviceTier: null } };
    snapshot.general.providerApprovalDefaults = { antigravity: 'accept-edits' };
    await store.save(snapshot);
    const restored = await store.load();
    expect(isAppSnapshot(restored)).toBe(true);
    expect(restored.agents.find(value => value.id === agent.id)).toMatchObject({ provider: 'antigravity', providerSession: agent.providerSession, providerDefaults: agent.providerDefaults });
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
      provider: 'codex', repositories: [{ provider: 'github', id: 'org/repo' }],
      selectionPrompt: 'Select bugs', assignmentPrompt: 'Fix them',
      schedule: { intervalMinutes: 60 }, executionLog: [], createdAt: '', updatedAt: '',
    }] });
    expect(restored.automations).toEqual([]);
    expect(restored.agents.map(agent => agent.id)).toEqual(snapshot.agents.map(agent => agent.id));
  });
  it.each(['claude', 'antigravity', 'cursor'] as const)('creates, updates and runs a remote %s prompt automation, then reloads its configuration and conversation', async provider => {
    const persistence = new AppStateStore(await tempHome());
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ provider: provider, installed: true, connected: true, checking: false }];
    const runner = new AutomationRunner({ getSnapshot: () => snapshot,
      sendPrompt: async () => ({ provider: provider, conversationId: 'remote-chat', folder: null }), saveSnapshot: () => persistence.save(snapshot), notifySnapshotUpdated: () => {},
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
      prompt: 'Fix and verify', target: { kind: 'newQuickChat' as const, teamId: snapshot.teams[0]!.id, selection: { provider: provider, model: null, reasoningEffort: null, serviceTier: null } },
        schedule: { intervalMinutes: 360 } };
    try {
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 'create', method: 'automation/create', params: { input, location } })).not.toHaveProperty('error');
      const id = snapshot.automations[0]!.id;
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 'update', method: 'automation/update', params: { input: { ...input, id, enabled: true }, location } })).not.toHaveProperty('error');
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 'run', method: 'automation/run', params: { automationId: id, location } })).not.toHaveProperty('error');
      const saved = await persistence.load();
      expect(isAppSnapshot(saved)).toBe(true);
      expect(saved.automations).toEqual([expect.objectContaining({ ...input, id, enabled: true })]);
      expect(saved.automations[0]?.executionLog[0]).toMatchObject({ status: 'working', conversationRef: { provider: provider, conversationId: 'remote-chat', folder: null } });
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
    snapshot.workBacklog.connections.push({ provider: 'gitlab', status: 'connected', source: 'api', accountLabel: 'gl-user', hostedMcp: { status: 'unavailable' } });
    snapshot.workBacklog.providerConfigurations = { github: { sourceId: 'owner/repo' }, linear: { sourceId: 'linear:team:project', assigneeLogin: 'Alex', tagName: 'bug' } };
    await persistence.save(snapshot);
    const restored = await persistence.load();
    expect(restored.workBacklog.providerSettings).toEqual({ github: { oauthClientId: 'github-client' }, linear: { oauthClientId: 'linear-client' } });
    expect(restored.workBacklog.connections).toContainEqual({ provider: 'linear', status: 'connected', accountLabel: 'Alex' });
    expect(restored.workBacklog.connections).toContainEqual({ provider: 'gitlab', status: 'connected', source: 'api', accountLabel: 'gl-user', hostedMcp: { status: 'unavailable' } });
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
    snapshot.agents[0]!.providerDefaults = selection;

    await persistence.save(snapshot);
    const restored = await persistence.load();

    expect(restored.agents[0]!.providerDefaults).toStrictEqual(selection);
  });

  it('restores a user-selected Claude model after restarting', async () => {
    const persistence = new AppStateStore(await tempHome());
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.provider = 'claude';
    snapshot.agents[0]!.providerDefaults = {
      kind: 'claude', model: 'opus', reasoningEffort: 'high', serviceTier: 'fast', userSelectedModel: true,
    };

    await persistence.save(snapshot);
    const restored = await persistence.load();

    expect(restored.agents[0]!.providerDefaults).toStrictEqual(snapshot.agents[0]!.providerDefaults);
    expect(isAppSnapshot(restored)).toBe(true);
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
    snapshot.agents[0].sharedConversation = { joinId: 'a'.repeat(64) };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.agents[0]).toMatchObject({
      sessionKind: 'quickChat',
      sharedConversation: { joinId: 'a'.repeat(64) },
      name: null,
      folder: null,
    });
    expect(isAppSnapshot(restored)).toBe(true);
  });

  it('round-trips the Visualize session owned by an agent conversation', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].visualize = {
      id: 'visualize-1',
      conversationRef: { provider: 'codex', conversationId: 'thread-visualize' },
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

  describe('Design undo and redo history', () => {
    const content = { title: 'Launch', css: '', comments: [], artboards: [{ id: 'desktop', title: 'Desktop', width: 960, height: 640, root: { id: 'root', tag: 'main', children: [{ id: 'heading', tag: 'h1', text: 'Hello' }] } }] };
    const workspace = () => ({
      conversationRef: null, isOpen: true, selectedArtboardId: null, selectedNodeId: null,
      document: { id: 'design-1', revision: 3, content },
      undo: [content, content], redo: [content], checkpoints: [{ id: 'checkpoint-1', title: 'Saved', revision: 2, content }],
    });
    it('never writes history carried by an older workspace', () => {
      const snapshot = createInitialSnapshot();
      snapshot.agents[0]!.designWorkspaces = [workspace()];
      const persisted = persistedStateFromSnapshot(snapshot).agents[0]!.designWorkspaces![0]!;
      expect(persisted.undo).toEqual([]);
      expect(persisted).not.toHaveProperty('redo');
      expect(persisted.document).toStrictEqual(snapshot.agents[0]!.designWorkspaces![0]!.document);
      expect(persisted.checkpoints).toHaveLength(1);
      expect(snapshot.agents[0]!.designWorkspaces![0]!.undo).toHaveLength(2);
      expect((snapshot.agents[0]!.designWorkspaces![0] as { redo?: unknown[] }).redo).toHaveLength(1);
    });
    it('is dropped from files saved by earlier versions, which are rewritten without it', async () => {
      const home = await tempHome();
      const snapshot = createInitialSnapshot();
      snapshot.agents[0]!.designWorkspaces = [workspace()];
      const store = new AppStateStore(home);
      await store.save(snapshot);
      const roster = path.join(home, 'roster.json');
      const legacy = JSON.parse(await readFile(roster, 'utf8'));
      Object.assign(legacy.data.agents[0].designWorkspaces[0], { undo: [content, content], redo: [content] });
      await writeFile(roster, JSON.stringify(legacy));
      const reloadedStore = new AppStateStore(home);
      const reloaded = await reloadedStore.load();
      expect(reloaded.agents[0]!.designWorkspaces![0]).toMatchObject({ undo: [], document: { revision: 3 } });
      expect(reloaded.agents[0]!.designWorkspaces![0]).not.toHaveProperty('redo');
      await reloadedStore.save(reloaded);
      expect(await readFile(roster, 'utf8')).not.toContain('"redo"');
      expect(JSON.parse(await readFile(roster, 'utf8')).data.agents[0].designWorkspaces![0]!.undo).toEqual([]);
    });
  });

  it('migrates the earlier keep-unlocked switch to the Always lock prevention mode and rewrites it on the next save', async () => {
    const home = await tempHome();
    const store = new AppStateStore(home);
    await store.save(createInitialSnapshot());
    const file = path.join(home, 'settings.json');
    const legacy = JSON.parse(await readFile(file, 'utf8'));
    legacy.data.settings.plugins = { computerUseEnabled: true, chromeEnabled: false, computerUseKeepUnlocked: true };
    await writeFile(file, JSON.stringify(legacy));
    const reloadedStore = new AppStateStore(home);
    const reloaded = await reloadedStore.load();
    expect(reloaded.general.plugins).toStrictEqual({ computerUseEnabled: true, chromeEnabled: false, computerUseLockPrevention: 'always', computerUseLockHold: false });
    await reloadedStore.save(reloaded);
    const written = JSON.parse(await readFile(file, 'utf8')).data.settings.plugins;
    expect(written).toMatchObject({ computerUseLockPrevention: 'always' });
    expect(written).not.toHaveProperty('computerUseKeepUnlocked');
  });
  it('keeps an on-demand hold through a restart', async () => {
    const home = await tempHome();
    const snapshot = createInitialSnapshot();
    snapshot.general.plugins = { computerUseEnabled: true, chromeEnabled: false, computerUseLockPrevention: 'onDemand', computerUseLockHold: { until: 1_800_000_000_000 } };
    await new AppStateStore(home).save(snapshot);
    expect((await new AppStateStore(home).load()).general.plugins).toStrictEqual(snapshot.general.plugins);
  });

  it('migrates a persisted Design session to Visualize state', () => {
    const snapshot = createInitialSnapshot();
    const persisted = structuredClone(persistedStateFromSnapshot(snapshot)) as unknown as { agents: Array<Record<string, unknown>> };
    persisted.agents[0].design = {
      id: 'legacy-design',
      conversationRef: { provider: 'codex', conversationId: 'thread-design' },
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
        reviewerSession: { kind: 'codex', conversationId: 'reviewer-1' },
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
      work_proposed: true,
      ready_for_review: true,
    };
    snapshot.agents[0].suggestedPrompt = 'Review the changes';
    const persisted = persistedStateFromSnapshot(snapshot) as unknown as {
      agents: Array<Record<string, unknown>>;
    };

    expect(snapshotFromPersistedState(persisted).agents[0].threadFlags)
      .toStrictEqual({ work_proposed: true, ready_for_review: true });
    expect(snapshotFromPersistedState(persisted).agents[0].suggestedPrompt).toBe('Review the changes');
    persisted.agents[0].suggestedPrompt = 123;
    expect(snapshotFromPersistedState(persisted).agents[0].suggestedPrompt).toBeUndefined();
    persisted.agents[0].threadFlags = { work_proposed: false };
    expect(snapshotFromPersistedState(persisted).agents[0].threadFlags).toBeUndefined();
  });

  it.each(['github', 'gitlab'] as const)('round-trips %s tracked request state through disk restart and rejects incomplete records', async provider => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].pullRequest = {
      provider,
      repository: provider === 'gitlab' ? 'gitlab.com/group/sub/repo' : 'nbonamy/agent-workspace',
      branch: 'feat/pr-monitoring',
      number: 42,
      title: 'Monitor pull requests',
      url: provider === 'gitlab' ? 'https://gitlab.com/group/sub/repo/-/merge_requests/42' : 'https://github.com/nbonamy/agent-workspace/pull/42',
      draft: false,
      headSha: 'abc123',
      state: 'merged',
      mergedAt: '2026-09-03T12:00:00.000Z',
      createdAt: '2026-09-03T11:00:00.000Z',
      updatedAt: '2026-09-03T12:00:00.000Z',
    };

    const home = await tempHome();
    await new AppStateStore(home).save(snapshot);
    const restored = await new AppStateStore(home).load();
    expect(restored.agents[0]!.pullRequest).toStrictEqual(snapshot.agents[0]!.pullRequest);
    expect(isAppSnapshot(restored)).toBe(true);
    const persisted = persistedStateFromSnapshot(snapshot);
    expect(snapshotFromPersistedState(persisted).agents[0].pullRequest).toStrictEqual(snapshot.agents[0].pullRequest);

    (persisted.agents[0] as { pullRequest?: unknown }).pullRequest = { provider, number: 42 };
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
    snapshot.providerRuntimes = [{ provider: 'codex', status: 'running', detail: 'connected' }];
    snapshot.providerAccountRateLimits = { codex: {
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
    } };
    snapshot.agents[0] = {
      ...snapshot.agents[0],
      providerSession: { kind: 'codex', conversationId: 'thread-dina' },
      providerDefaults: {
        kind: 'codex',
        permission: 'approve-for-me',
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
      pendingPrompts: [{ id: 'runtime-injection', text: 'Private injected prompt', createdAt: '2026-11-09T00:00:00.000Z' }],
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
      expect(data).not.toHaveProperty('providerRuntimes');
      expect(data).not.toHaveProperty('appServer');
    }
    expect(written.accountRateLimits).toStrictEqual(snapshot.providerAccountRateLimits?.codex);
    expect(written.activeTeamId).toBe('team-app');
    const writtenAgent = (written.agents as Array<Record<string, unknown>>)[0];
    expect(writtenAgent.engine).toStrictEqual({
      kind: 'codex',
      session: { conversationId: 'thread-dina' },
      settings: { permission: 'approve-for-me', serviceTier: 'fast' },
    });
    expect(writtenAgent).not.toHaveProperty('provider');
    expect(writtenAgent).not.toHaveProperty('teamId');
    expect(writtenAgent).not.toHaveProperty('pendingPrompts');
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
    snapshot.providerAccountRateLimits = { codex: {
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
    } };
    snapshot.agents[0] = {
      ...snapshot.agents[0],
      providerSession: { kind: 'codex', conversationId: 'thread-dina' },
      providerDefaults: {
        kind: 'codex',
        permission: 'approve-for-me',
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
      provider: 'codex',
      providerDefaults: {
        kind: 'codex',
        permission: 'approve-for-me',
        serviceTier: 'fast',
      },
      providerSession: { kind: 'codex', conversationId: 'thread-dina' },
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
    expect(restored.providerRuntimes).toStrictEqual(createEmptySnapshot().providerRuntimes);
    expect(restored.providerAccountRateLimits?.codex).toStrictEqual(snapshot.providerAccountRateLimits?.codex);
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
      prompt: 'Start by reproducing the issue.', target: { kind: 'newQuickChat' as const, teamId: 'team-app', selection: { provider: 'codex' as const, model: null, reasoningEffort: null, serviceTier: null } },



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

        agentId: 'agent-dina', agentName: 'Dina', conversationRef: { provider: 'codex', conversationId: 'thread-dina' },
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
        provider: 'codex',
        providerSession: { kind: 'codex', conversationId: 'thread-dina' },
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
        provider: 'codex',
        providerSession: { kind: 'codex', conversationId: 'thread-dina' },
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
        provider: 'claude',
        providerSession: { kind: 'codex', conversationId: 'thread-dina' },
        providerDefaults: { kind: 'codex', model: 'gpt-5.1-codex' },
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
      }],
      activeTeamId: 'team-app',
      activeAgentId: 'agent-dina',
      theme: defaultThemeSettings,
    });

    expect(restored.agents[0].provider).toBe('claude');
    expect(restored.agents[0].providerSession).toBeUndefined();
    expect(restored.agents[0].providerDefaults).toBeUndefined();
  });

  it('persists Claude thread and fallback model selections', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0] = {
      ...snapshot.agents[0],
      provider: 'claude',
      providerSession: { kind: 'claude',
        conversationId: 'claude-session-1',
        transport: 'stdio',
        transcriptConversationId: 'claude-session-1',
        model: 'claude-sonnet-5',
        reasoningEffort: 'xhigh',
      },
      providerDefaults: {
        kind: 'claude',
        model: 'sonnet',
        reasoningEffort: 'high',
        permission: 'acceptEdits',
      },
    };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.agents[0].providerSession).toStrictEqual(snapshot.agents[0].providerSession);
    expect(restored.agents[0].providerDefaults).toStrictEqual(snapshot.agents[0].providerDefaults);
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
      collapsedRepositoryKeys: ['remote:github.com/nbonamy/agent-workspace'],
      modelFavorites: [{
        provider: 'codex',
        modelId: 'gpt-5.6-terra',
        reasoningEffort: 'high',
        serviceTier: 'priority',
      }],
      backlogRepositoryFavorites: {},
      savedPromptDrafts: [],
      providerHomes: { codex: { isolated: true, shareSkills: false, homePath: "/app/codex-home" } },
      sessionCompressionWarningEnabled: false,
      worktreeInitializationMode: 'repository',
      worktreeDelegationStartingContext: 'handoff',
      worktreeDelegationInstructions: '',
      repositoryIcons: { '/src/agent-workspace': '🦞' },
      appshots: {
        hotkey: 'option',
        destination: 'active-agent',
        playSound: false,
      },
      plugins: { ...defaultPluginSettings },
    };

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.general).toStrictEqual({ ...snapshot.general, cursorSteeringFallbackEnabled: false, excludeLockfilesFromDiffs: false, projectFlowEnabled: false, guestDisplayName: '', codeReviewInstructions: '', codeReviewDiscussWithOriginalThread: false, missionInstructions: '', autoResumeAfterLimit: true, autoResumeOnStartup: true, useInteractivePlans: true, git: { pull: 'git-config', update: 'merge' } });
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

  it('keeps hidden remote team links next to local agents', () => {
    const snapshot = createInitialSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams[0].remoteLinks = [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }];
    const localAgentIds = [...snapshot.teams[0].agentIds];

    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

    expect(restored.teams[0].remoteLinks).toStrictEqual([{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }]);
    expect(restored.teams[0].agentIds).toStrictEqual(localAgentIds);
  });

  it('repairs orphaned local agents to a local team instead of a remote pointer', () => {
    const restored = snapshotFromPersistedState({
      teams: [
        {
          id: 'team-remote-pointer',
          name: 'Remote Pointer',
          remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
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
        provider: 'codex',
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
        remoteLinks: [{ connectionId: 'missing-connection', remoteTeamId: 'team-remote' }],
        agentIds: ['agent-remote'],
      }],
      agents: [{
        id: 'agent-remote',
        name: 'Remote',
        folder: '/home/nicolas/src/agent-workspace',
        provider: 'codex',
        createdAt: '2026-06-14T10:00:00.000Z',
        updatedAt: '2026-06-14T10:00:00.000Z',
      }],
      activeTeamId: null,
      activeAgentId: 'agent-remote',
      theme: defaultThemeSettings,
      remoteConnections: { connections: [] },
    });

    expect(restored.teams[0].remoteLinks).toBeUndefined();
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
