import { describe, expect, it } from 'vitest';
import {
  assignWorkItemToAgentInSnapshot,
  createAgentInSnapshot,
  createQuickChatInSnapshot,
  closeAgentInSnapshot,
  completeWorkItemAssignmentInSnapshot,
  duplicateAgentInSnapshot,
  forkAgentInSnapshot,
  moveAgentToTeamInSnapshot,
  removeWorkItemAssignmentFromSnapshot,
  reorderAgentInTeam,
  reorderRepositoryInTeam,
  restartAgentConversation,
  resumeAgentConversationInSnapshot,
  updateWorkItemAssignmentInSnapshot,
  updateAgentFromInput,
} from '../agent-manager';
import { createAutomationInSnapshot, recordAutomationExecutionInSnapshot } from '../automation-manager';
import { createInitialSnapshot } from '../snapshot';
import { createTeamInSnapshot } from '../team-manager';
import type { Agent, WorkItem } from '../contracts';
import { workItemAssignmentKey } from '../work-assignments';

describe('agent-manager', () => {
  it('keeps Antigravity model and permission defaults isolated when creating and switching agents', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude', 'antigravity'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.general.providerModelDefaults = {
      codex: {backend: 'codex',  model: 'gpt-x', reasoningEffort: 'high', serviceTier: 'fast' },
      antigravity: {backend: 'antigravity',  model: 'gemini-3.8-flash-low', reasoningEffort: 'high', serviceTier: 'fast' },
    };
    snapshot.general.providerApprovalDefaults = { antigravity: 'auto_edit' };
    createAgentInSnapshot(snapshot, { name: 'ACP', folder: '/repo', selection: { backend: 'antigravity' } }, undefined, 'acp');
    const agent = snapshot.agents.find(value => value.id === 'acp')!;
    expect(agent.backend).toBe('antigravity');
    expect(agent.backendDefaults).toStrictEqual({ kind: 'antigravity', model: 'gemini-3.8-flash-low', userSelectedModel: true, permissionMode: 'auto_edit' });
    updateAgentFromInput(snapshot, { id: agent.id, selection: { backend: 'claude' } });
    expect(agent.backendDefaults).toStrictEqual({ kind: 'claude' });
    updateAgentFromInput(snapshot, { id: agent.id, selection: { backend: 'antigravity' } });
    expect(agent.backendDefaults).toStrictEqual({ kind: 'antigravity', model: 'gemini-3.8-flash-low', userSelectedModel: true, permissionMode: 'auto_edit' });
    updateAgentFromInput(snapshot, { id: agent.id, selection: {backend: 'antigravity',  model: 'gemini-high', reasoningEffort: 'low', serviceTier: 'fast' } });
    expect(agent.backendDefaults).toStrictEqual({ kind: 'antigravity', model: 'gemini-high', userSelectedModel: true, permissionMode: 'auto_edit' });
    expect(snapshot.general.providerModelDefaults.antigravity).toEqual({ backend: 'antigravity', model: 'gemini-high', reasoningEffort: null, serviceTier: null });
  });
  it('applies a chosen model to a new agent on top of the provider approval defaults without changing them', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.general.providerApprovalDefaults = { claude: 'acceptEdits' };
    snapshot.general.providerModelDefaults = { claude: {backend: 'claude',  model: 'sonnet', reasoningEffort: 'low', serviceTier: null } };

    createAgentInSnapshot(snapshot, { name: null, folder: '/repo', selection: { backend: 'claude', model: 'opus', reasoningEffort: 'high', serviceTier: 'fast' } }, undefined, 'picked');

    expect(snapshot.agents.find(agent => agent.id === 'picked')!.backendDefaults)
      .toStrictEqual({ kind: 'claude', model: 'opus', userSelectedModel: true, reasoningEffort: 'high', serviceTier: 'fast', permissionMode: 'acceptEdits' });
    expect(snapshot.general.providerModelDefaults?.claude).toStrictEqual({backend: 'claude',  model: 'sonnet', reasoningEffort: 'low', serviceTier: null });

    createAgentInSnapshot(snapshot, { name: null, folder: '/repo', selection: { backend: 'claude', reasoningEffort: null, serviceTier: null, model: 'haiku' } }, undefined, 'model-only');
    expect(snapshot.agents.find(agent => agent.id === 'model-only')!.backendDefaults)
      .toStrictEqual({ kind: 'claude', model: 'haiku', userSelectedModel: true, serviceTier: null, permissionMode: 'acceptEdits' });
  });
  it('seeds new agents and quick chats with per-provider approvals without overriding explicit settings or existing chats', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.general.claudeCodeEnabled = true;
    snapshot.general.providerApprovalDefaults = { codex: 'ask-for-approval', claude: 'acceptEdits' };
    const existing = structuredClone(snapshot.agents);
    for (const backend of ['codex', 'claude'] as const) {
      createAgentInSnapshot(snapshot, { name: 'New', folder: '/repo', selection: { backend } }, undefined, `agent-${backend}`);
      createQuickChatInSnapshot(snapshot, { selection: { backend } }, undefined, `quick-${backend}`);
      for (const id of [`agent-${backend}`, `quick-${backend}`]) {
        expect(snapshot.agents.find(agent => agent.id === id)?.backendDefaults).toMatchObject(backend === 'codex'
          ? { kind: 'codex', approvalPreset: 'ask-for-approval', approvalPolicy: 'on-request', sandboxMode: 'workspace-write' }
          : { kind: 'claude', permissionMode: 'acceptEdits' });
      }
    }
    createAgentInSnapshot(snapshot, { name: 'Explicit', folder: '/repo', backendDefaults: { kind: 'codex', approvalPreset: 'full-access' }, selection: { backend: 'codex' } }, undefined, 'explicit');
    expect(snapshot.agents.find(agent => agent.id === 'explicit')?.backendDefaults).toEqual({ kind: 'codex', approvalPreset: 'full-access' });
    expect(snapshot.agents.slice(0, existing.length)).toEqual(existing);
  });

  it('switches a fresh agent without carrying model or permission settings across providers', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.general.claudeCodeEnabled = true;
    const agent = snapshot.agents[0]!;
    delete agent.backendSession;
    agent.status = { type: 'idle' };
    agent.backendDefaults = { kind: 'codex', model: 'codex-model', approvalPreset: 'full-access', userSelectedModel: true };
    snapshot.general.providerApprovalDefaults = { claude: 'acceptEdits' };
    updateAgentFromInput(snapshot, { id: agent.id, selection: { backend: 'claude' } });
    expect(agent.backend).toBe('claude');
    expect(agent.backendDefaults).toStrictEqual({ kind: 'claude', permissionMode: 'acceptEdits' });
    agent.status = { type: 'working' };
    expect(() => updateAgentFromInput(snapshot, { id: agent.id, selection: { backend: 'codex' } })).toThrow('before the first prompt');
    agent.status = { type: 'idle' };
    agent.backendSession = { kind: 'claude', sessionId: 'history', transport: 'stdio' };
    expect(() => updateAgentFromInput(snapshot, { id: agent.id, selection: { backend: 'codex' } })).toThrow('before the first prompt');
    delete agent.backendSession;
    updateAgentFromInput(snapshot, { id: agent.id, selection: { backend: 'codex' } });
    agent.hasSubmittedPrompt = true;
    expect(() => updateAgentFromInput(snapshot, { id: agent.id, selection: { backend: 'claude' } })).toThrow('before the first prompt');
    delete agent.hasSubmittedPrompt;
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    expect(() => updateAgentFromInput(snapshot, { id: agent.id, selection: { backend: 'claude' } })).toThrow('not connected');
    expect(agent.backend).toBe('codex');
  });
  it('makes a chat model selection the provider default for new agents and quick chats only', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.general.claudeCodeEnabled = true;
    const first = snapshot.agents[0]!;
    updateAgentFromInput(snapshot, { id: first.id, selection: {backend: 'codex',  model: 'gpt-x', reasoningEffort: 'high', serviceTier: 'fast' } });
    expect(snapshot.general.providerModelDefaults).toStrictEqual({ codex: {backend: 'codex',  model: 'gpt-x', reasoningEffort: 'high', serviceTier: 'fast' } });

    createAgentInSnapshot(snapshot, { name: null, folder: '/tmp/a', selection: { backend: 'codex' } }, undefined, 'agent-codex');
    createAgentInSnapshot(snapshot, { name: null, folder: '/tmp/b', selection: { backend: 'claude' } }, undefined, 'agent-claude');
    createQuickChatInSnapshot(snapshot, { selection: { backend: 'codex' } }, undefined, 'quick-codex');
    createAgentInSnapshot(snapshot, { name: null, folder: '/tmp/c', backendDefaults: { kind: 'codex', model: 'explicit' }, selection: { backend: 'codex' } }, undefined, 'agent-explicit');
    const byId = (id: string) => snapshot.agents.find(agent => agent.id === id)!;
    expect(byId('agent-codex').backendDefaults).toStrictEqual({ kind: 'codex', model: 'gpt-x', reasoningEffort: 'high', serviceTier: 'fast', userSelectedModel: true });
    expect(byId('quick-codex').backendDefaults).toStrictEqual({ kind: 'codex', model: 'gpt-x', reasoningEffort: 'high', serviceTier: 'fast', userSelectedModel: true });
    expect(byId('agent-claude').backendDefaults).toStrictEqual({ kind: 'claude' });
    expect(byId('agent-explicit').backendDefaults).toStrictEqual({ kind: 'codex', model: 'explicit' });

    updateAgentFromInput(snapshot, { id: 'agent-claude', selection: {backend: 'claude',  model: 'opus', reasoningEffort: null, serviceTier: null } });
    expect(snapshot.general.providerModelDefaults).toStrictEqual({
      codex: {backend: 'codex',  model: 'gpt-x', reasoningEffort: 'high', serviceTier: 'fast' },
      claude: {backend: 'claude',  model: 'opus', reasoningEffort: null, serviceTier: null },
    });
  });
  it('duplicates an agent in the same team and selects the copy', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const duplicate = duplicateAgentInSnapshot(snapshot, 'agent-dina', '2026-06-05T10:11:12.000Z', () => 'agent-duplicate-dina');

    expect(duplicate).toStrictEqual({
      id: 'agent-duplicate-dina',
      teamId: 'team-app',
      name: 'Dina (copy)',
      avatar: 'DI',
      folder: '~/src/agent-workspace',
      backend: 'codex',
      backendDefaults: { kind: 'codex' },
      status: { type: 'idle' },
      createdAt: '2026-06-05T10:11:12.000Z',
      updatedAt: '2026-06-05T10:11:12.000Z',
    });
    expect(snapshot.activeAgentId).toBe(duplicate?.id);
    expect(snapshot.teams[0].agentIds.slice(0, 2)).toStrictEqual(['agent-dina', duplicate?.id]);
    expect(snapshot.agents.slice(0, 2).map((agent) => agent.id)).toStrictEqual(['agent-dina', duplicate?.id]);
  });

  it('duplicates an agent without changing the active agent when selection is disabled', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const activeAgentId = snapshot.activeAgentId;
    const duplicate = duplicateAgentInSnapshot(
      snapshot,
      'agent-dina',
      '2026-06-05T10:11:12.000Z',
      () => 'agent-background-copy',
      { select: false },
    );

    expect(duplicate?.id).toBe('agent-background-copy');
    expect(snapshot.activeAgentId).toBe(activeAgentId);
    expect(snapshot.teams[0].agentIds.slice(0, 2)).toStrictEqual(['agent-dina', 'agent-background-copy']);
  });

  it('duplicates an agent with a caller-provided name', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const duplicate = duplicateAgentInSnapshot(
      snapshot,
      'agent-dina',
      '2026-06-05T10:11:12.000Z',
      () => 'agent-work-item',
      { name: '  Dina gh-24  ', select: false },
    );

    expect(duplicate?.name).toBe('Dina gh-24');
    expect(snapshot.activeAgentId).toBe('agent-dina');
  });

  it('generates collision-safe ids for duplicated agents', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));

    const duplicateIds = ['agent-duplicate-dina', 'agent-duplicate-dina', 'agent-duplicate-dina-2'];
    const firstDuplicate = duplicateAgentInSnapshot(snapshot, 'agent-dina', '2026-06-05T10:11:12.000Z', () => duplicateIds.shift() ?? 'agent-fallback');
    const secondDuplicate = duplicateAgentInSnapshot(snapshot, 'agent-dina', '2026-06-05T10:11:12.000Z', () => duplicateIds.shift() ?? 'agent-fallback');
    expect(firstDuplicate?.id).toBe('agent-duplicate-dina');
    expect(secondDuplicate?.id).toBe('agent-duplicate-dina-2');
  });

  it('forks an agent conversation directly below its source and selects it', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const forked = forkAgentInSnapshot(
      snapshot,
      'agent-dina',
      { kind: 'codex', threadId: 'thread-forked' },
      '2026-06-05T10:11:12.000Z',
      () => 'agent-forked-dina',
    );

    expect(forked).toMatchObject({
      id: 'agent-forked-dina',
      name: 'Dina (fork)',
      backendSession: { kind: 'codex', threadId: 'thread-forked' },
      status: { type: 'idle' },
    });
    expect(snapshot.teams[0].agentIds.slice(0, 2)).toStrictEqual(['agent-dina', 'agent-forked-dina']);
    expect(snapshot.agents.slice(0, 2).map((agent) => agent.id)).toStrictEqual(['agent-dina', 'agent-forked-dina']);
    expect(snapshot.activeAgentId).toBe('agent-forked-dina');
  });

  it('duplicates legacy agents into the active team when they have no team id', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    delete snapshot.agents[0].teamId;

    const duplicate = duplicateAgentInSnapshot(snapshot, 'agent-dina', '2026-06-05T10:11:12.000Z', () => 'agent-duplicate-dina');

    expect(duplicate?.teamId).toBe('team-app');
    expect(snapshot.teams[0].agentIds).toContain(duplicate?.id);
  });

  it('assigns each work item key to one agent at a time', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const firstItem = workItem(12, 'Fix cockpit drag target');
    const secondItem = workItem(13, 'Polish backlog panel');

    expect(assignWorkItemToAgentInSnapshot(snapshot, 'agent-dina', firstItem, '2026-06-09T13:00:00.000Z')).toMatchObject({
      id: 'agent-dina',
      updatedAt: '2026-06-09T13:00:00.000Z',
    });
    expect(snapshot.workBacklog.assignments[workItemAssignmentKey(firstItem)]).toStrictEqual({
      provider: 'github',
      itemId: 'nbonamy/agent-workspace#12',
      item: expect.objectContaining({ id: 'nbonamy/agent-workspace#12', sourceId: 'nbonamy/agent-workspace' }),
      agentId: 'agent-dina',
      assignedAt: '2026-06-09T13:00:00.000Z',
      policy: 'review',
      status: 'inProgress',
    });

    assignWorkItemToAgentInSnapshot(snapshot, 'agent-dina', secondItem, '2026-06-09T13:05:00.000Z');
    expect(Object.keys(snapshot.workBacklog.assignments).sort()).toStrictEqual([
      'github:nbonamy/agent-workspace#12',
      'github:nbonamy/agent-workspace#13',
    ]);

    assignWorkItemToAgentInSnapshot(snapshot, 'agent-jesse', firstItem, '2026-06-09T13:10:00.000Z');

    expect(snapshot.workBacklog.assignments[workItemAssignmentKey(firstItem)]).toStrictEqual({
      provider: 'github',
      itemId: 'nbonamy/agent-workspace#12',
      item: expect.objectContaining({ id: 'nbonamy/agent-workspace#12', sourceId: 'nbonamy/agent-workspace' }),
      agentId: 'agent-jesse',
      assignedAt: '2026-06-09T13:10:00.000Z',
      policy: 'review',
      status: 'inProgress',
    });
  });

  it('marks assigned work items as completed by the owning agent', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const item = workItem(12, 'Fix cockpit drag target');
    assignWorkItemToAgentInSnapshot(snapshot, 'agent-dina', item, '2026-06-09T13:00:00.000Z');

    expect(completeWorkItemAssignmentInSnapshot(snapshot, 'agent-jesse', workItemAssignmentKey(item), '2026-06-09T13:15:00.000Z')).toBeNull();
    expect(completeWorkItemAssignmentInSnapshot(snapshot, 'agent-dina', workItemAssignmentKey(item), '2026-06-09T13:15:00.000Z')).toStrictEqual({
      provider: 'github',
      itemId: 'nbonamy/agent-workspace#12',
      item: expect.objectContaining({ id: 'nbonamy/agent-workspace#12', sourceId: 'nbonamy/agent-workspace' }),
      agentId: 'agent-dina',
      assignedAt: '2026-06-09T13:00:00.000Z',
      policy: 'review',
      status: 'completed',
      completedAt: '2026-06-09T13:15:00.000Z',
      updatedAt: '2026-06-09T13:15:00.000Z',
    });
    expect(snapshot.agents[0].updatedAt).toBe('2026-06-09T13:15:00.000Z');
  });

  it('updates assigned work through blocked, resumed, and review-ready states', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const item = workItem(12, 'Fix cockpit drag target');
    assignWorkItemToAgentInSnapshot(snapshot, 'agent-dina', item, '2026-06-09T13:00:00.000Z');
    const workItemId = workItemAssignmentKey(item);

    expect(updateWorkItemAssignmentInSnapshot(snapshot, 'agent-dina', workItemId, 'blocked', '2026-06-09T13:05:00.000Z', 'Need a fixture')).toMatchObject({
      status: 'blocked',
      note: 'Need a fixture',
      updatedAt: '2026-06-09T13:05:00.000Z',
    });
    expect(updateWorkItemAssignmentInSnapshot(snapshot, 'agent-dina', workItemId, 'inProgress', '2026-06-09T13:10:00.000Z')).toMatchObject({
      status: 'inProgress',
    });
    expect(snapshot.workBacklog.assignments[workItemId]).not.toHaveProperty('note');
    expect(updateWorkItemAssignmentInSnapshot(snapshot, 'agent-dina', workItemId, 'readyForReview', '2026-06-09T13:20:00.000Z')).toMatchObject({
      status: 'readyForReview',
      updatedAt: '2026-06-09T13:20:00.000Z',
    });
  });

  it('removes assigned work item keys', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const firstItem = workItem(12, 'Fix cockpit drag target');
    const secondItem = workItem(13, 'Polish backlog panel');

    assignWorkItemToAgentInSnapshot(snapshot, 'agent-dina', firstItem, '2026-06-09T13:00:00.000Z');
    assignWorkItemToAgentInSnapshot(snapshot, 'agent-dina', secondItem, '2026-06-09T13:05:00.000Z');

    expect(removeWorkItemAssignmentFromSnapshot(snapshot, firstItem)).toBe(true);

    expect(snapshot.workBacklog.assignments).toStrictEqual({
      'github:nbonamy/agent-workspace#13': {
        provider: 'github',
        itemId: 'nbonamy/agent-workspace#13',
        item: expect.objectContaining({ id: 'nbonamy/agent-workspace#13', sourceId: 'nbonamy/agent-workspace' }),
        agentId: 'agent-dina',
        assignedAt: '2026-06-09T13:05:00.000Z',
        policy: 'review',
        status: 'inProgress',
      },
    });
    expect(removeWorkItemAssignmentFromSnapshot(snapshot, secondItem)).toBe(true);
    expect(snapshot.workBacklog.assignments).toStrictEqual({});
    expect(removeWorkItemAssignmentFromSnapshot(snapshot, firstItem)).toBe(false);
  });

  it.each([
    { type: 'idle' },
    { type: 'working' },
    { type: 'awaitingInput' },
    { type: 'error', message: 'Turn failed' },
  ] satisfies Agent['status'][])('moves a $type agent to another team without changing its session or runtime state', (status) => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.agents[0].status = status;
    snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-running' };
    const before = structuredClone(snapshot.agents[0]);
    snapshot.teams.push({
      id: 'team-skwad',
      name: 'Skwad',
      avatar: 'SK',
      color: '#46A857',
      agentIds: [],
    });

    expect(moveAgentToTeamInSnapshot(snapshot, 'agent-dina', 'team-skwad', '2026-06-05T10:11:12.000Z')).toStrictEqual({
      ...before,
      teamId: 'team-skwad',
      updatedAt: '2026-06-05T10:11:12.000Z',
    });
    expect(snapshot.teams[0].agentIds).toStrictEqual(['agent-jesse']);
    expect(snapshot.teams[1].agentIds).toStrictEqual(['agent-dina']);
    expect(snapshot.teams[1].activeAgentId).toBe('agent-dina');
    expect(snapshot.activeTeamId).toBe('team-skwad');
    expect(snapshot.activeAgentId).toBe('agent-dina');
  });

  it('reorders agents within a team before a target or to the end', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const duplicate = duplicateAgentInSnapshot(snapshot, 'agent-dina', '2026-06-05T10:11:12.000Z', () => 'agent-abby');
    expect(duplicate?.id).toBe('agent-abby');
    expect(snapshot.teams[0].agentIds).toStrictEqual(['agent-dina', 'agent-abby', 'agent-jesse']);

    expect(reorderAgentInTeam(snapshot, 'team-app', 'agent-abby', 'agent-dina')).toStrictEqual(duplicate);
    expect(snapshot.teams[0].agentIds).toStrictEqual(['agent-abby', 'agent-dina', 'agent-jesse']);

    expect(reorderAgentInTeam(snapshot, 'team-app', 'agent-abby', null)).toStrictEqual(duplicate);
    expect(snapshot.teams[0].agentIds).toStrictEqual(['agent-dina', 'agent-jesse', 'agent-abby']);
    expect(snapshot.activeAgentId).toBe('agent-abby');
  });

  it('keeps agent order unchanged when dropping an agent onto itself', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));

    expect(reorderAgentInTeam(snapshot, 'team-app', 'agent-dina', 'agent-dina')).toStrictEqual(snapshot.agents[0]);
    expect(snapshot.teams[0].agentIds).toStrictEqual(['agent-dina', 'agent-jesse']);
  });

  it('ignores agent reorders outside the requested team', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const otherTeam = createTeamInSnapshot(snapshot, {
      name: 'Skwad Core',
      color: '#46A857',
    }, '2026-06-05T10:11:12.000Z');

    expect(reorderAgentInTeam(snapshot, otherTeam.id, 'agent-dina', null)).toBeNull();
    expect(reorderAgentInTeam(snapshot, 'team-app', 'agent-dina', 'missing-agent')).toBeNull();
    expect(reorderAgentInTeam(snapshot, 'missing-team', 'agent-dina', null)).toBeNull();
    expect(reorderAgentInTeam(snapshot, 'team-app', 'missing-agent', null)).toBeNull();
    expect(snapshot.teams[0].agentIds).toStrictEqual(['agent-dina', 'agent-jesse']);
  });

  it('keeps agent reorders inside their repository group', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.agents[0]!.workspace = gitWorkspace('app');
    snapshot.agents[1]!.workspace = gitWorkspace('sdk');
    const duplicate = duplicateAgentInSnapshot(snapshot, 'agent-dina', '2026-06-05T10:11:12.000Z', () => 'agent-abby');

    expect(reorderAgentInTeam(snapshot, 'team-app', duplicate!.id, 'agent-jesse')).toBeNull();
    expect(snapshot.teams[0]!.agentIds).toStrictEqual(['agent-dina', 'agent-abby', 'agent-jesse']);

    expect(reorderAgentInTeam(snapshot, 'team-app', 'agent-dina', null)).toStrictEqual(snapshot.agents[0]);
    expect(snapshot.teams[0]!.agentIds).toStrictEqual(['agent-abby', 'agent-dina', 'agent-jesse']);
  });

  it('reorders a repository as one block with all of its agents', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.agents[0]!.workspace = gitWorkspace('app');
    snapshot.agents[1]!.workspace = gitWorkspace('sdk');
    duplicateAgentInSnapshot(snapshot, 'agent-dina', '2026-06-05T10:11:12.000Z', () => 'agent-abby');
    const quickChat = duplicateAgentInSnapshot(snapshot, 'agent-jesse', '2026-06-05T10:11:13.000Z', () => 'quick-chat');
    quickChat!.sessionKind = 'quickChat';
    delete quickChat!.workspace;
    snapshot.teams[0]!.agentIds = ['agent-dina', 'agent-abby', 'quick-chat', 'agent-jesse'];

    expect(reorderRepositoryInTeam(snapshot, 'team-app', '/src/sdk', '/src/app')?.map((agent) => agent.id))
      .toStrictEqual(['agent-jesse']);
    expect(snapshot.teams[0]!.agentIds).toStrictEqual(['agent-jesse', 'quick-chat', 'agent-dina', 'agent-abby']);

    expect(reorderRepositoryInTeam(snapshot, 'team-app', '/src/sdk', null)?.map((agent) => agent.id))
      .toStrictEqual(['agent-jesse']);
    expect(snapshot.teams[0]!.agentIds).toStrictEqual(['agent-dina', 'agent-abby', 'quick-chat', 'agent-jesse']);
    expect(reorderRepositoryInTeam(snapshot, 'team-app', '/src/missing', null)).toBeNull();
  });

  it('moves an origin-keyed repository with its local and remote agents together', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.agents[0]!.workspace = { ...gitWorkspace('app'), originUrl: 'git@github.com:org/app.git' };
    snapshot.agents[1]!.workspace = gitWorkspace('sdk');
    const remote = duplicateAgentInSnapshot(snapshot, 'agent-dina', '2026-06-05T10:11:12.000Z', () => 'agent-remote')!;
    remote.remoteConnectionId = 'connection-devbox';
    remote.workspace = { ...gitWorkspace('app'), primaryWorktreeRoot: '/home/me/app', originUrl: 'https://github.com/org/app' };
    snapshot.teams[0]!.agentIds = ['agent-dina', 'agent-jesse', 'agent-remote'];

    expect(reorderRepositoryInTeam(snapshot, 'team-app', 'remote:github.com/org/app', null)?.map((agent) => agent.id))
      .toStrictEqual(['agent-dina', 'agent-remote']);
    expect(snapshot.teams[0]!.agentIds).toStrictEqual(['agent-jesse', 'agent-dina', 'agent-remote']);
  });

  it('restarts an idle agent by clearing conversation and runtime state', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const agent = snapshot.agents[0];
    agent.backendSession = { kind: 'codex', threadId: 'thread-old' };
    agent.suggestedPrompt = 'Continue the old work';
    agent.contextUsage = {
      totalTokens: 397_740,
      inputTokens: 320_000,
      cachedInputTokens: 80_000,
      outputTokens: 72_000,
      reasoningOutputTokens: 24_000,
      lastTotalTokens: 64_600,
      modelContextWindow: 258_400,
      usedPercent: 25,
    };
    agent.plan = {
      threadId: 'thread-old',
      turnId: 'turn-plan',
      kind: 'execution',
      status: 'inProgress',
      explanation: 'Old plan',
      steps: [{ step: 'Do old work', status: 'pending' }],
      markdown: 'Old plan\n- [ ] Do old work',
      updatedAt: '2026-06-05T00:00:00.000Z',
    };
    agent.goal = {
      threadId: 'thread-old',
      objective: 'Old goal',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 100,
      timeUsedSeconds: 5,
      createdAt: 1,
      updatedAt: 2,
    };
    agent.isRegistered = true;
    agent.mcpSessionId = 'mcp-session';
    agent.statusText = 'Registered';
    agent.visualize = {
      id: 'visualize-old', conversationRef: { backend: 'codex', threadId: 'thread-old' }, isOpen: true,
      suggestions: [], visualizations: [], selectedVisualizationId: null,
      createdAt: '2026-06-05T00:00:00.000Z', updatedAt: '2026-06-05T00:00:00.000Z',
    };

    expect(restartAgentConversation(snapshot, 'agent-dina', '2026-06-05T10:11:12.000Z')).toMatchObject({
      id: 'agent-dina',
      status: { type: 'idle' },
      updatedAt: '2026-06-05T10:11:12.000Z',
    });
    expect(snapshot.agents[0].backendSession).toBeUndefined();
    expect(snapshot.agents[0].suggestedPrompt).toBeUndefined();
    expect(snapshot.agents[0].contextUsage).toBeUndefined();
    expect(snapshot.agents[0].plan).toBeUndefined();
    expect(snapshot.agents[0].goal).toBeUndefined();
    expect(snapshot.agents[0].isRegistered).toBeUndefined();
    expect(snapshot.agents[0].mcpSessionId).toBeUndefined();
    expect(snapshot.agents[0].statusText).toBeUndefined();
    expect(snapshot.agents[0].visualize).toBeUndefined();
  });

  it('resumes an idle agent with the selected provider session', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const agent = snapshot.agents[0];
    agent.backendSession = { kind: 'codex', threadId: 'thread-old' };
    agent.contextUsage = {
      totalTokens: 397_740,
      inputTokens: 320_000,
      cachedInputTokens: 80_000,
      outputTokens: 72_000,
      reasoningOutputTokens: 24_000,
      lastTotalTokens: 64_600,
      modelContextWindow: 258_400,
      usedPercent: 25,
    };
    agent.plan = {
      threadId: 'thread-old',
      turnId: 'turn-plan',
      kind: 'execution',
      status: 'inProgress',
      explanation: 'Old plan',
      steps: [{ step: 'Do old work', status: 'pending' }],
      markdown: 'Old plan\n- [ ] Do old work',
      updatedAt: '2026-06-05T00:00:00.000Z',
    };
    agent.isRegistered = true;
    expect(resumeAgentConversationInSnapshot(snapshot, 'agent-dina', { kind: 'codex', threadId: 'thread-new' }, '2026-06-05T10:11:12.000Z')).toMatchObject({
      id: 'agent-dina',
      backendSession: { kind: 'codex', threadId: 'thread-new' },
      status: { type: 'idle' },
      updatedAt: '2026-06-05T10:11:12.000Z',
    });
    expect(snapshot.agents[0].contextUsage).toBeUndefined();
    expect(snapshot.agents[0].plan).toBeUndefined();
    expect(snapshot.agents[0].isRegistered).toBeUndefined();
  });

  it('closes an idle agent and selects the next available agent', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    assignWorkItemToAgentInSnapshot(snapshot, 'agent-dina', workItem(12, 'Fix cockpit drag target'));

    expect(closeAgentInSnapshot(snapshot, 'agent-dina')).toMatchObject({ id: 'agent-dina' });

    expect(snapshot.agents.map((agent) => agent.id)).toStrictEqual(['agent-jesse']);
    expect(snapshot.teams[0].agentIds).toStrictEqual(['agent-jesse']);
    expect(snapshot.activeAgentId).toBe('agent-jesse');
    expect(snapshot.workBacklog.assignments).toStrictEqual({});
  });

  it('disables automations targeting a closed agent and fails its active run', () => {
    const snapshot = createInitialSnapshot();
    const base = { prompt: 'Check', schedule: { intervalMinutes: 60 } };
    const targeted = createAutomationInSnapshot(snapshot, { ...base, target: { kind: 'agent', agentId: 'agent-dina' } }, 'created', () => 'targeted')!;
    const other = createAutomationInSnapshot(snapshot, { ...base, target: { kind: 'agent', agentId: 'agent-jesse' } }, 'created', () => 'other')!;
    recordAutomationExecutionInSnapshot(snapshot, 'targeted', { id: 'run', automationId: 'targeted', status: 'working', startedAt: 'started', agentId: 'agent-dina' });

    closeAgentInSnapshot(snapshot, 'agent-dina');

    expect(targeted.enabled).toBe(false);
    expect(targeted.executionLog[0]).toMatchObject({ status: 'failed' });
    expect(other.enabled).toBe(true);
  });

  it('closes the last active team agent without selecting another team agent', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const otherTeam = createTeamInSnapshot(snapshot, {
      name: 'Skwad Core',
      color: '#46A857',
    }, '2026-06-05T10:11:12.000Z');
    moveAgentToTeamInSnapshot(snapshot, 'agent-jesse', otherTeam.id);
    snapshot.activeTeamId = 'team-app';
    snapshot.activeAgentId = 'agent-dina';
    snapshot.teams[0].activeAgentId = 'agent-dina';

    expect(closeAgentInSnapshot(snapshot, 'agent-dina')).toMatchObject({ id: 'agent-dina' });

    expect(snapshot.teams[0].agentIds).toStrictEqual([]);
    expect(snapshot.teams[0].activeAgentId).toBeUndefined();
    expect(snapshot.teams[1].agentIds).toStrictEqual(['agent-jesse']);
    expect(snapshot.activeTeamId).toBe('team-app');
    expect(snapshot.activeAgentId).toBeNull();
  });

  it('closes a non-active idle agent without changing active selection', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));

    expect(closeAgentInSnapshot(snapshot, 'agent-jesse')).toMatchObject({ id: 'agent-jesse' });

    expect(snapshot.activeAgentId).toBe('agent-dina');
    expect(snapshot.activeTeamId).toBe('team-app');
    expect(snapshot.teams[0].agentIds).toStrictEqual(['agent-dina']);
  });

  it('rejects restart and resume while an agent is busy but still allows close', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.agents[0].status = { type: 'working' };
    expect(() => restartAgentConversation(snapshot, 'agent-dina')).toThrow('Agent must be idle before restarting.');
    expect(() => resumeAgentConversationInSnapshot(snapshot, 'agent-dina', { kind: 'codex', threadId: 'thread-new' })).toThrow('Agent must be idle before resuming a conversation.');
    expect(closeAgentInSnapshot(snapshot, 'agent-dina')).toMatchObject({ id: 'agent-dina' });
    expect(snapshot.agents.map((agent) => agent.id)).toStrictEqual(['agent-jesse']);
  });

  it('returns null for missing agents', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));

    expect(duplicateAgentInSnapshot(snapshot, 'missing-agent')).toBeNull();
    expect(moveAgentToTeamInSnapshot(snapshot, 'missing-agent', 'team-app')).toBeNull();
    expect(moveAgentToTeamInSnapshot(snapshot, 'agent-dina', 'missing-team')).toBeNull();
    expect(restartAgentConversation(snapshot, 'missing-agent')).toBeNull();
    expect(closeAgentInSnapshot(snapshot, 'missing-agent')).toBeNull();
    expect(assignWorkItemToAgentInSnapshot(snapshot, 'missing-agent', workItem(12, 'Fix cockpit drag target'))).toBeNull();
    expect(removeWorkItemAssignmentFromSnapshot(snapshot, workItem(12, 'Fix cockpit drag target'))).toBe(false);
  });
});

function workItem(number: number, title: string): WorkItem {
  return {
    provider: 'github',
    id: `nbonamy/agent-workspace#${number}`,
    sourceId: 'nbonamy/agent-workspace',
    sourceName: 'nbonamy/agent-workspace',
    number,
    title,
    url: `https://github.com/nbonamy/agent-workspace/issues/${number}`,
    state: 'open',
    labels: [],
    createdAt: '2026-06-09T12:00:00.000Z',
    updatedAt: '2026-06-09T12:30:00.000Z',
  };
}

function gitWorkspace(repository: string): Extract<Agent['workspace'], { kind: 'git' }> {
  return {
    kind: 'git',
    folder: `/src/${repository}`,
    repositoryName: repository,
    repositoryRoot: `/src/${repository}`,
    primaryWorktreeRoot: `/src/${repository}`,
    branch: 'main',
    isLinkedWorktree: false,
    updatedAt: '2026-06-05T00:00:00.000Z',
  };
}
