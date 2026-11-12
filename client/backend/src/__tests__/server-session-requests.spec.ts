import { describe, expect, it, vi } from 'vitest';
import type { AgentProviderDriver, BackendEvent } from '@workspace/core/provider-driver';
import type { Agent } from '@workspace/core/contracts';
import { claudeProviderCapabilities, codexProviderCapabilities, defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import { conversationRefFromAgent } from '@workspace/core/conversation-ref';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { AppBackendServer } from '../server';
import { ProviderDriverRpc } from '../driver-rpc';
import {
  createTestSnapshot,
  createThreadGoal,
} from './server-test-fixtures';

describe('AppBackendServer', () => {
  it.each(['accept', 'revise', 'cancel'] as const)('delivers %s to a non-Cursor request-backed plan without submitting a prompt', async resolution => {
    const snapshot = createTestSnapshot();
    const agent: Agent = { id: 'plan-agent', teamId: 'team-test', name: 'Plan', folder: '/synthetic', provider: 'claude', providerSession: { kind: 'claude', sessionId: 'session', transport: 'stdio' }, status: { type: 'idle' }, createdAt: 'created', updatedAt: 'updated' };
    snapshot.agents = [agent]; snapshot.teams[0]!.agentIds = [agent.id];
    snapshot.providerConnections = [{ provider: 'claude', installed: true, connected: true, checking: false }];
    let publish!: (event: BackendEvent) => void;
    const identity = { provider: 'claude' as const, agentId: agent.id, conversationId: 'session', turnId: 'turn' };
    const proposal = (id: string) => {
      publish({ ...identity, type: 'agentRequest.created', payload: { request: { id, conversationId: 'session', turnId: 'turn', kind: 'toolConfirmation', confirmation: { toolName: 'native_plan', integrationId: 'fixture', integrationName: 'Fixture', summary: 'Review plan', argumentsPreview: '# Plan' } } } });
      publish({ ...identity, type: 'plan.readyForReview', payload: { markdown: '# Plan', itemId: id, requestId: id } });
    };
    const respondToAgentRequest = vi.fn<AgentProviderDriver['respondToAgentRequest']>(async response => {
      publish({ ...identity, type: 'agentRequest.resolved', payload: { id: response.id, outcome: response.outcome } });
      if (resolution === 'revise') proposal('revised-request');
    });
    const sendPrompt = vi.fn().mockResolvedValue({ providerSession: agent.providerSession, turnId: 'unexpected-prompt' });
    const driver: AgentProviderDriver = { provider: 'claude', getRuntimeStatus: () => ({ provider: 'claude', status: 'running' }), getCapabilities: () => claudeProviderCapabilities,
      respondToAgentRequest, sendPrompt, interrupt: vi.fn(), onEvent: listener => { publish = listener; return () => {}; }, close: async () => {} };
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new ProviderDriverRpc(new Map([['claude', driver]])) });
    try {
      proposal('native-request');
      const reviewId = agent.planReview!.id;
      const response = { reviewId, resolution, ...(resolution === 'revise' ? { feedback: 'Keep the original file.' } : {}) };
      const call = () => server.handleMessage({ jsonrpc: '2.0', id: 'respond', method: backendMethods.agentPlanReviewRespond, params: { agentId: agent.id, response } });
      await call();
      expect(respondToAgentRequest).toHaveBeenCalledExactlyOnceWith({ agentId: agent.id, id: 'native-request', outcome: resolution === 'cancel' ? { kind: 'cancelled' } : { kind: 'decision', decision: resolution === 'accept' ? 'allow' : 'deny', ...(resolution === 'revise' ? { feedback: 'Keep the original file.' } : {}) } });
      expect(sendPrompt).not.toHaveBeenCalled();
      if (resolution === 'revise') {
        expect(agent.planReview).toMatchObject({ requestId: 'revised-request', status: 'pending' });
        await expect(call()).rejects.toThrow('no longer');
      } else { expect(agent.planReview?.status).toBe(resolution); await call(); }
      expect(respondToAgentRequest).toHaveBeenCalledTimes(1);
    } finally { await server.close(); }
  });

  it('reconciles unowned Codex conversations once before serving snapshots', async () => {
    const snapshot = createTestSnapshot();
    const reconcileConversations = vi.fn().mockResolvedValue(undefined);
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-current' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-current' } }),
      respondToAgentRequest: async () => undefined,
      reconcileConversations,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version', snapshot,
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
    });

    await server.initialize();
    await server.handleMessage({ jsonrpc: '2.0', id: 'snapshot-1', method: 'snapshot/get' });
    await server.handleMessage({ jsonrpc: '2.0', id: 'snapshot-2', method: 'snapshot/get' });

    expect(reconcileConversations).toHaveBeenCalledOnce();
    expect(reconcileConversations).toHaveBeenCalledWith(snapshot.agents.filter((agent) => agent.provider === 'codex'));
    await server.close();
  });

  it('keeps the current session attached when restart archiving fails', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/repo', provider: 'codex',
      providerSession: { kind: 'codex', threadId: 'thread-current' }, status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z', updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const releaseConversation = vi.fn();
    const saveSnapshot = vi.fn();
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-current' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-current' } }),
      respondToAgentRequest: async () => undefined,
      archiveAgentConversation: async () => { throw new Error('Archive failed'); },
      releaseConversation,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version', snapshot, saveSnapshot,
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'restart-agent', method: 'agent/conversation/reset', params: { agentId: 'agent-dina' },
    })).rejects.toThrow('Archive failed');

    expect(snapshot.agents[0]?.providerSession).toStrictEqual({ kind: 'codex', threadId: 'thread-current' });
    expect(releaseConversation).not.toHaveBeenCalled();
    expect(saveSnapshot).not.toHaveBeenCalled();
    await server.close();
  });

  it.each(['codex', 'cursor', 'antigravity'] as const)('restores the previous %s session when persisting a switch fails', async provider => {
    const snapshot = createTestSnapshot();
    const oldSession = provider === 'codex' ? { kind: provider, threadId: 'thread-old' } : { kind: provider, sessionId: 'session-old' };
    const newSession = provider === 'codex' ? { kind: provider, threadId: 'thread-new' } : { kind: provider, sessionId: 'session-new' };
    const oldRef = provider === 'codex' ? { provider: provider, threadId: 'thread-old' } : { provider: provider, folder: '/repo', sessionId: 'session-old' };
    const newRef = provider === 'codex' ? { provider: provider, threadId: 'thread-new' } : { provider: provider, folder: '/repo', sessionId: 'session-new' };
    const storageState = provider === 'codex' ? 'archived' : 'active';
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/repo', provider: provider,
      providerSession: oldSession, status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z', updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const resumeConversation = vi.fn()
      .mockResolvedValueOnce({ providerSession: newSession })
      .mockResolvedValueOnce({ providerSession: oldSession });
    const driver: AgentProviderDriver = {
      provider: provider,
      getRuntimeStatus: () => ({ provider: provider, status: 'running' }),
      getCapabilities: () => defaultProviderCapabilities(provider),
      sendPrompt: async () => ({ providerSession: oldSession }),
      interrupt: async () => ({ providerSession: oldSession }),
      respondToAgentRequest: async () => undefined,
      resumeConversation,
      reconcileConversations: async () => undefined,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version', snapshot, saveSnapshot: vi.fn().mockRejectedValue(new Error('Disk full')),
      driverRpc: new ProviderDriverRpc(new Map([[provider, driver]])),
    });

    expect(conversationRefFromAgent(snapshot.agents[0]!)).toStrictEqual(oldRef);
    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'resume-agent', method: 'agent/conversation/resume',
      params: {
        agentId: 'agent-dina',
        target: { ref: newRef, storageState },
      },
    })).rejects.toThrow('Disk full');

    expect(snapshot.agents[0]?.providerSession).toStrictEqual(oldSession);
    expect(resumeConversation).toHaveBeenNthCalledWith(2, expect.objectContaining({
      providerSession: newSession,
    }), {
      ref: oldRef,
      storageState,
    });
    await server.close();
  });

  it('owns agent restart and conversation resume mutations', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      providerSession: { kind: 'codex', threadId: 'thread-old' },
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const releaseConversation = vi.fn();
    const archivedAgents: unknown[] = [];
    const archiveAgentConversation = vi.fn(async (agent) => { archivedAgents.push(structuredClone(agent)); });
    const resumeConversation = vi.fn().mockResolvedValue({
      providerSession: { kind: 'codex', threadId: 'thread-new' },
    });
    const summarize = vi.fn().mockResolvedValue({ text: 'Summary', session: { kind: 'codex', threadId: 'thread-test' } });
    const startSeeded = vi.fn().mockResolvedValue({ providerSession: { kind: 'codex', threadId: 'thread-compressed' } });
    const setConversationTitle = vi.fn().mockResolvedValue(undefined);
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: startSeeded,
      interrupt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      releaseConversation,
      archiveAgentConversation,
      executeScopedPrompt: summarize, loadConversation: async () => ({ kind: 'codex', threadId: 'thread-test' }),
      resumeConversation,
      setConversationTitle,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'restart-agent',
      method: 'agent/conversation/reset',
      params: { agentId: 'agent-dina' },
    })).resolves.toMatchObject({
      result: {
        agents: [{ id: 'agent-dina' }],
      },
    });
    expect(snapshot.agents[0]?.providerSession).toBeUndefined();
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'resume-agent',
      method: 'agent/conversation/resume',
      params: {
        agentId: 'agent-dina',
        target: {
          ref: { provider: 'codex', threadId: 'thread-new' },
          storageState: 'archived',
        },
      },
    })).resolves.toMatchObject({
      result: {
        agents: [{ id: 'agent-dina', providerSession: { kind: 'codex', threadId: 'thread-new' } }],
      },
    });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'compress-agent-session',
      method: 'agent/conversation/replaceWithSummary',
      params: { agentId: 'agent-dina' },
    })).resolves.toMatchObject({
      result: {
        agents: [{ id: 'agent-dina', providerSession: { kind: 'codex', threadId: 'thread-compressed' } }],
      },
    });

    expect(releaseConversation).toHaveBeenCalledWith('agent-dina');
    expect(archivedAgents).toContainEqual(expect.objectContaining({
      providerSession: { kind: 'codex', threadId: 'thread-old' },
    }));
    expect(resumeConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), {
      ref: { provider: 'codex', threadId: 'thread-new' },
      storageState: 'archived',
    });
    expect(startSeeded).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina', providerSession: undefined }), expect.stringContaining('Summary'));
    expect(setConversationTitle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'agent-dina' }),
      'Dina',
    );
    expect(setConversationTitle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'agent-dina' }),
      'Dina',
    );
    expect(saveSnapshot).toHaveBeenCalledTimes(3);
    await server.close();
  });

  it('forks a conversation into a selected agent directly below its source', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina', 'agent-jesse'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      providerSession: { kind: 'codex', threadId: 'thread-dina' },
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }, {
      id: 'agent-jesse',
      teamId: 'team-test',
      name: 'Jesse',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    snapshot.clientPreferences = { desktop: { agentOrderByTeam: { 'team-test': ['agent-dina', 'agent-jesse'] } } };
    const forkConversation = vi.fn().mockResolvedValue({
      providerSession: { kind: 'codex', threadId: 'thread-forked' },
      activeTurnId: 'turn-forked',
    });
    const setConversationTitle = vi.fn().mockResolvedValue(undefined);
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      forkConversation,
      setConversationTitle,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'fork-agent',
      method: 'agent/fork',
      params: { agentId: 'agent-dina', turnId: 'turn-2' },
    })).resolves.toMatchObject({
      result: {
        activeAgentId: expect.stringContaining('agent-'),
        agents: [
          { id: 'agent-dina' },
          {
            name: 'Dina (fork)',
            providerSession: { kind: 'codex', threadId: 'thread-forked' },
            status: { type: 'working' },
          },
          { id: 'agent-jesse' },
        ],
      },
    });

    const forkedAgentId = snapshot.agents[1]?.id;
    expect(snapshot.clientPreferences.desktop?.agentOrderByTeam?.['team-test']).toStrictEqual(['agent-dina', forkedAgentId, 'agent-jesse']);
    expect(forkConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      expect.objectContaining({ name: 'Dina (fork)' }),
      'turn-2',
    );
    expect(setConversationTitle).toHaveBeenCalledWith(
      expect.objectContaining({ id: forkedAgentId, providerSession: { kind: 'codex', threadId: 'thread-forked' } }),
      'Dina (fork)',
    );
    expect(snapshot.teams[0]?.agentIds).toStrictEqual(['agent-dina', forkedAgentId, 'agent-jesse']);
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
    await server.close();
  });

  it('owns goal and approval preset session mutations', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const goal = createThreadGoal('thread-goal', 'Ship the goal shelf');
    const setConversationTitle = vi.fn().mockResolvedValue(undefined);
    const setGoal = vi.fn().mockResolvedValue({
      providerSession: { kind: 'codex', threadId: 'thread-goal' },
      goal,
    });
    const clearGoal = vi.fn().mockResolvedValue({
      providerSession: { kind: 'codex', threadId: 'thread-goal' },
      cleared: true,
    });
    const setApprovalPreset = vi.fn().mockResolvedValue({
      providerSession: { kind: 'codex', threadId: 'thread-approval' },
      approvalPreset: 'approve-for-me',
    });
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      clearGoal,
      setApprovalPreset,
      setConversationTitle,
      setGoal,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const events: unknown[] = [];
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      onEvent: (event) => events.push(event),
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'set-goal',
      method: 'agent/goal/update',
      params: { agentId: 'agent-dina', objective: ' Ship the goal shelf ' },
    })).resolves.toMatchObject({
      result: {
        agents: [{ id: 'agent-dina', providerSession: { kind: 'codex', threadId: 'thread-goal' }, goal }],
      },
    });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'clear-goal',
      method: 'agent/goal/clear',
      params: { agentId: 'agent-dina' },
    })).resolves.toMatchObject({
      result: {
        agents: [{ id: 'agent-dina', providerSession: { kind: 'codex', threadId: 'thread-goal' } }],
      },
    });
    expect(snapshot.agents[0]?.goal).toBeUndefined();
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'set-preset',
      method: 'agent/approvalPreset/update',
      params: { agentId: 'agent-dina', preset: 'approve-for-me' },
    })).resolves.toMatchObject({
      result: {
        agents: [{
          id: 'agent-dina',
          providerSession: { kind: 'codex', threadId: 'thread-approval' },
          providerDefaults: {
            kind: 'codex',
            approvalPreset: 'approve-for-me',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'auto_review',
            sandboxMode: 'workspace-write',
          },
        }],
      },
    });

    expect(setGoal).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), 'Ship the goal shelf');
    expect(clearGoal).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }));
    expect(setApprovalPreset).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), 'approve-for-me');
    expect(snapshot.general.providerApprovalDefaults).toEqual({ codex: 'approve-for-me' });
    expect(setConversationTitle).toHaveBeenCalledOnce();
    expect(setConversationTitle).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), expect.stringContaining('Dina'));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'conversation.goalUpdated', payload: { goal } }),
      expect.objectContaining({ type: 'conversation.goalCleared' }),
      expect.objectContaining({ type: 'snapshot.updated' }),
    ]));
    expect(saveSnapshot).toHaveBeenCalledTimes(3);
    await server.close();
  });

  it('persists a Claude permission mode as the default for new Claude agents', async () => {
    const snapshot = createTestSnapshot();
    snapshot.general.providerApprovalDefaults = { codex: 'ask-for-approval' };
    snapshot.teams[0]!.agentIds = ['agent-claude'];
    snapshot.agents = [{
      id: 'agent-claude',
      teamId: 'team-test',
      name: 'Claude',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'claude',
      providerDefaults: { kind: 'claude', model: 'sonnet' },
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const setPermissionMode = vi.fn().mockResolvedValue({
      providerDefaults: { kind: 'claude', model: 'sonnet', permissionMode: 'bypassPermissions' },
    });
    const driver: AgentProviderDriver = {
      provider: 'claude',
      getRuntimeStatus: () => ({ provider: 'claude', status: 'running' }),
      getCapabilities: () => claudeProviderCapabilities,
      setPermissionMode,
      sendPrompt: async () => ({ providerSession: { kind: 'claude', sessionId: 'session-test', transport: 'stdio' } }),
      interrupt: async () => ({ providerSession: { kind: 'claude', sessionId: 'session-test', transport: 'stdio' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      driverRpc: new ProviderDriverRpc(new Map([['claude', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'set-permission-mode',
      method: backendMethods.agentPermissionModeUpdate,
      params: { agentId: 'agent-claude', mode: 'bypassPermissions' },
    })).resolves.toMatchObject({
      result: {
        agents: [{
          id: 'agent-claude',
          providerDefaults: { kind: 'claude', model: 'sonnet', permissionMode: 'bypassPermissions' },
        }],
      },
    });

    expect(setPermissionMode).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-claude' }), 'bypassPermissions');
    expect(snapshot.general.providerApprovalDefaults).toStrictEqual({ codex: 'ask-for-approval', claude: 'bypassPermissions' });
    expect(snapshot.agents[0]?.providerSession).toBeUndefined();
    expect(saveSnapshot).toHaveBeenCalledOnce();
    await server.close();
  });

  it('owns steer and interrupt session mutations', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      status: { type: 'working' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const steerPrompt = vi.fn().mockResolvedValue({
      providerSession: { kind: 'codex', threadId: 'thread-steer' },
      turnId: 'turn-steer',
    });
    const interrupt = vi.fn().mockResolvedValue({
      providerSession: { kind: 'codex', threadId: 'thread-interrupt' },
      turnId: 'turn-interrupt',
    });
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt,
      respondToAgentRequest: async () => undefined,
      steerPrompt,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'steer',
      method: 'agent/prompt/steer',
      params: {
        agentId: 'agent-dina',
        prompt: ' try smaller ',
        options: { attachments: [{ type: 'file', path: '/tmp/notes.txt', name: 'notes.txt' }] },
      },
    })).resolves.toMatchObject({
      result: {
        agents: [{ id: 'agent-dina', providerSession: { kind: 'codex', threadId: 'thread-steer' } }],
      },
    });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'interrupt',
      method: 'agent/interrupt',
      params: { agentId: 'agent-dina' },
    })).resolves.toMatchObject({
      result: {
        agents: [{ id: 'agent-dina', providerSession: { kind: 'codex', threadId: 'thread-interrupt' } }],
      },
    });

    expect(steerPrompt).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), 'try smaller', {
      attachments: [{ type: 'file', path: '/tmp/notes.txt', name: 'notes.txt' }],
    });
    expect(interrupt).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }));
    expect(saveSnapshot).toHaveBeenCalledTimes(2);
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
    await server.close();
  });

  it('emits an app error event when interrupt fails', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      status: { type: 'working' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: vi.fn().mockRejectedValue(new Error('no active turn')),
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
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'interrupt',
      method: 'agent/interrupt',
      params: { agentId: 'agent-dina' },
    })).resolves.toMatchObject({
      result: {
        agents: [{ id: 'agent-dina', status: { type: 'error', message: 'Failed to interrupt Codex: no active turn' } }],
      },
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'agent.statusChanged',
        payload: { type: 'error', message: 'Failed to interrupt Codex: no active turn' },
      }),
    ]));
    await server.close();
  });

  it('keeps Codex turn deletion history provider-owned', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      providerSession: { kind: 'codex', threadId: 'thread-old' },
      status: { type: 'working' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const deleteTurn = vi.fn().mockResolvedValue({
      providerSession: { kind: 'codex', threadId: 'thread-rollback' },
      activeTurnId: null,
    });
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      deleteTurn,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const events: unknown[] = [];
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      onEvent: (event) => events.push(event),
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'delete-turn',
      method: 'agent/turn/delete',
      params: { agentId: 'agent-dina', turnId: 'turn-1' },
    })).resolves.toMatchObject({
      result: {
        agents: [{ id: 'agent-dina', providerSession: { kind: 'codex', threadId: 'thread-rollback' }, status: { type: 'idle' } }],
      },
    });

    expect(deleteTurn).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), 'turn-1');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent.statusChanged', payload: { type: 'idle' },
    }));
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
    await server.close();
  });
});
