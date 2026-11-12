import { describe, expect, it, vi } from 'vitest';
import type { AgentProviderDriver } from '@workspace/core/provider-driver';
import { codexProviderCapabilities } from '@workspace/core/provider-capabilities';
import { AppBackendServer } from '../server';
import { createMission } from '@workspace/core/missions';
import { ProviderDriverRpc } from '../driver-rpc';
import type { AgentGitService } from '../git/agent-git-service';
import {
  createTestSnapshot
} from './server-test-fixtures';

describe('AppBackendServer', () => {

  it('keeps snapshot and navigation free of implicit loading; explicit load refreshes git', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.teams[0]!.activeAgentId = 'agent-dina';
    snapshot.activeAgentId = 'agent-dina';
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      providerSession: { kind: 'codex', conversationId: 'thread-old' },
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const loadConversation = vi.fn().mockResolvedValue({ kind: 'codex', conversationId: 'thread-hydrated' });
    const getGitStatus = vi.fn().mockResolvedValue({
      folder: '/Users/nbonamy/src/agent-workspace',
      branch: 'main',
      ahead: 0,
      behind: 0,
      changedFiles: 2,
      addedLines: 12,
      removedLines: 4,
      hasUntracked: false,
      state: 'dirty',
      updatedAt: '2026-06-13T00:00:00.000Z',
    });
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', conversationId: 'thread-test' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', conversationId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      loadConversation,
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
      agentGitService: { status: getGitStatus } as unknown as AgentGitService,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'initial-snapshot',
      method: 'snapshot/get',
    })).resolves.toMatchObject({
      result: { snapshot: { activeAgentId: 'agent-dina' } },
    });
    expect(getGitStatus).not.toHaveBeenCalled();
    await server.handleMessage({ jsonrpc: '2.0', id: 'navigate', method: 'client/navigation/selectAgent', params: { agentId: 'agent-dina' } });
    expect(loadConversation).not.toHaveBeenCalled();
    expect(getGitStatus).not.toHaveBeenCalled();

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'select',
      method: 'agent/conversation/load',
      params: { agentId: 'agent-dina' },
    })).resolves.toMatchObject({
      result: {
        activeAgentId: 'agent-dina',
        agents: [{ id: 'agent-dina', providerSession: { kind: 'codex', conversationId: 'thread-hydrated' } }],
        agentGitStatuses: {
          'agent-dina': expect.objectContaining({ branch: 'main', state: 'dirty' }),
        },
      },
    });

    expect(loadConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }));
    expect(getGitStatus).toHaveBeenCalledOnce();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'git.statusUpdated', agentId: 'agent-dina' }),
    ]));
    expect(saveSnapshot).toHaveBeenCalled();
    // Released clients omit the opt-in and still receive the full snapshot above.
    // Desktop recovery explicitly opts out, even with a large retained roster.
    const mission = createMission(snapshot, { outcome: 'Large mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: 'agent-dina' });
    const proposal = structuredClone(mission.artifacts);
    proposal.requirements = { problem: 'x'.repeat(6_000_000), acceptance: 'Preserve the transcript' };
    mission.execution = { teamId: snapshot.teams[0]!.id, repoPath: '/repo', memberIds: ['agent-dina'], runs: [{ id: 'retained-run', stage: 'requirements', memberId: 'agent-dina', workerId: 'agent-dina', status: 'awaitingReview', skills: [], feedback: '', startedAt: '', proposal }] };
    const compact = await server.handleMessage({ jsonrpc: '2.0', id: 'compact', method: 'agent/conversation/load', params: { agentId: 'agent-dina', omitSnapshot: true } });
    expect(compact).toEqual({ jsonrpc: '2.0', id: 'compact', result: null });
    expect(loadConversation).toHaveBeenCalledTimes(2);
    const legacy = await server.handleMessage({ jsonrpc: '2.0', id: 'legacy', method: 'agent/conversation/load', params: { agentId: 'agent-dina' } });
    // Decode the released request's JSON independently of current shared types.
    const decoded = JSON.parse(JSON.stringify(legacy));
    expect(decoded.result.agents[0].providerSession).toEqual({ kind: 'codex', conversationId: 'thread-hydrated' });
    expect(decoded.result.missions[0].execution.runs[0].proposal.requirements.problem).toHaveLength(6_000_000);
    expect(getGitStatus).toHaveBeenCalledTimes(2);
    // A rebound session reference reaches the renderer; the compact response stays null otherwise.
    loadConversation.mockResolvedValueOnce({ kind: 'codex', conversationId: 'thread-rebound' });
    const rebound = JSON.parse(JSON.stringify(await server.handleMessage({ jsonrpc: '2.0', id: 'rebound', method: 'agent/conversation/load', params: { agentId: 'agent-dina', omitSnapshot: true } })));
    expect(rebound.result.agents[0].providerSession).toEqual({ kind: 'codex', conversationId: 'thread-rebound' });
    // Recovery hydration must not run while a handoff owns the conversation.
    snapshot.agents[0]!.handoff = { operationId: 'op', selection: {} as never, sourceAgentId: 'agent-dina', sourceTitle: 'Dina', sourceRef: {} as never, phase: 'closing' };
    const callsBeforeHandoff = loadConversation.mock.calls.length;
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'handoff', method: 'agent/conversation/load', params: { agentId: 'agent-dina', omitSnapshot: true } }))
      .rejects.toThrow('Wait for the handoff to finish.');
    expect(loadConversation).toHaveBeenCalledTimes(callsBeforeHandoff);
    await server.close();
  });

  it('hydrates persisted agent history without changing active selection', async () => {
    const snapshot = createTestSnapshot();
    snapshot.activeAgentId = 'agent-dina';
    snapshot.agents = [
      {
        id: 'agent-dina',
        teamId: 'team-test',
        name: 'Dina',
        folder: '/Users/nbonamy/src/agent-workspace',
        provider: 'codex',
        status: { type: 'idle' },
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
      {
        id: 'agent-jesse',
        teamId: 'team-test',
        name: 'Jesse',
        folder: '/Users/nbonamy/src/multi-llm-ts',
        provider: 'codex',
        providerSession: { kind: 'codex', conversationId: 'thread-old' },
        status: { type: 'idle' },
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
    ];
    const loadConversation = vi.fn().mockResolvedValue({ kind: 'codex', conversationId: 'thread-hydrated' });
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', conversationId: 'thread-test' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', conversationId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      loadConversation,
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
      // This case owns selection/history; never inspect the operator's checkout.
      agentGitService: { status: vi.fn().mockResolvedValue(null) } as unknown as AgentGitService,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'hydrate',
      method: 'agent/conversation/load',
      params: { agentId: 'agent-jesse' },
    })).resolves.toMatchObject({
      result: {
        activeAgentId: 'agent-dina',
        agents: [
          { id: 'agent-dina' },
          { id: 'agent-jesse', providerSession: { kind: 'codex', conversationId: 'thread-hydrated' } },
        ],
      },
    });

    expect(loadConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-jesse' }));
    expect(saveSnapshot).toHaveBeenCalled();
    expect(snapshot.activeAgentId).toBe('agent-dina');
    await server.close();
  });

  it('forwards a safe hydration failure event while keeping the request nonblocking', async () => {
    const snapshot = createTestSnapshot();
    snapshot.activeAgentId = 'agent-dina';
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: snapshot.teams[0]!.id,
      name: 'Dina',
      folder: '/repo',
      provider: 'codex',
      providerSession: { kind: 'codex', conversationId: 'thread-dina' },
      status: { type: 'idle' },
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    }];
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', conversationId: 'thread-test' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', conversationId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      loadConversation: vi.fn().mockRejectedValue(new Error('active writer: provider-only detail')),
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const events: Array<{ type: string; agentId?: string; payload?: unknown }> = [];
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
      onEvent: (event) => events.push(event),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'hydrate-failed',
      method: 'agent/conversation/load',
      params: { agentId: snapshot.agents[0]!.id },
    })).resolves.toMatchObject({ result: { activeAgentId: snapshot.activeAgentId } });

    expect(events).toContainEqual(expect.objectContaining({
      agentId: snapshot.agents[0]!.id,
      type: 'conversation.historyLoadFailed',
      payload: { error: 'Unable to load conversation history.' },
    }));
    expect(JSON.stringify(events)).not.toContain('provider-only detail');
    // A new desktop opts into a request-level error; released/mobile clients
    // above retain their successful snapshot response and safe failure event.
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'strict-history', method: 'agent/conversation/load',
      params: { agentId: snapshot.agents[0]!.id, reportFailure: true } })).rejects.toThrow('Unable to load conversation history.');
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'strict-recovery', method: 'agent/conversation/load',
      params: { agentId: snapshot.agents[0]!.id, omitSnapshot: true, reportFailure: true } })).rejects.toThrow('Unable to load conversation history.');
    await server.close();
  });

  it('explicitly loads an agent without returning provider conversation data', async () => {
    const snapshot = createTestSnapshot();
    snapshot.activeAgentId = null;
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      provider: 'codex',
      providerSession: { kind: 'codex', conversationId: 'thread-live' },
      status: { type: 'working' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const loadConversation = vi.fn().mockResolvedValue({ kind: 'codex', conversationId: 'thread-stale' });
    const getGitStatus = vi.fn().mockResolvedValue(null);
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', conversationId: 'thread-test' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', conversationId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      loadConversation,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
      agentGitService: { status: getGitStatus } as unknown as AgentGitService,
    });

    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'select-live',
      method: 'agent/conversation/load',
      params: { agentId: 'agent-dina' },
    });
    expect(response).toMatchObject({
      result: {
        activeAgentId: null,
      },
    });
    expect((response as { result: Record<string, unknown> }).result).not.toHaveProperty('messages');
    expect(loadConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }));
    expect(getGitStatus).toHaveBeenCalledOnce();
    await server.close();
  });

  it('selects a team without loading its agents and explicitly loads only the requested agent', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams = [
      { id: 'team-test', name: 'Test Team', agentIds: ['agent-dina'], activeAgentId: 'agent-dina' },
      { id: 'team-other', name: 'Other Team', agentIds: ['agent-jesse', 'agent-sam'], activeAgentId: 'agent-jesse' },
    ];
    snapshot.activeTeamId = 'team-test';
    snapshot.activeAgentId = 'agent-dina';
    snapshot.agents = [
      {
        id: 'agent-dina',
        teamId: 'team-test',
        name: 'Dina',
        folder: '/Users/nbonamy/src/agent-workspace',
        provider: 'codex',
        status: { type: 'idle' },
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
      {
        id: 'agent-jesse',
        teamId: 'team-other',
        name: 'Jesse',
        folder: '/Users/nbonamy/src/multi-llm-ts',
        provider: 'codex',
        providerSession: { kind: 'codex', conversationId: 'thread-old' },
        status: { type: 'idle' },
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
      {
        id: 'agent-sam',
        teamId: 'team-other',
        name: 'Sam',
        folder: '/Users/nbonamy/src/other-project',
        workspace: {
          kind: 'git',
          folder: '/Users/nbonamy/src/other-project',
          repositoryName: 'other-project',
          repositoryRoot: '/Users/nbonamy/src/other-project',
          branch: 'stale-branch',
          isLinkedWorktree: false,
          primaryWorktreeRoot: '/Users/nbonamy/src/other-project',
          originUrl: 'https://github.com/old-owner/other-project.git',
          updatedAt: '2026-06-12T00:00:00.000Z',
        },
        provider: 'codex',
        status: { type: 'idle' },
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
    ];
    const identity = vi.fn().mockImplementation(async (folder: string) => ({
      kind: 'git' as const,
      folder,
      repositoryName: folder.split('/').at(-1)!,
      repositoryRoot: folder,
      branch: folder.endsWith('other-project') ? 'current-branch' : 'main',
      isLinkedWorktree: false,
      primaryWorktreeRoot: folder,
      originUrl: `https://github.com/current-owner/${folder.split('/').at(-1)!}.git`,
      updatedAt: '2026-06-13T00:00:00.000Z',
    }));
    const loadConversation = vi.fn().mockResolvedValue({ kind: 'codex', conversationId: 'thread-hydrated' });
    const getGitStatus = vi.fn().mockResolvedValue({
      folder: '/Users/nbonamy/src/multi-llm-ts',
      branch: 'main',
      ahead: 0,
      behind: 0,
      changedFiles: 1,
      addedLines: 3,
      removedLines: 2,
      hasUntracked: false,
      state: 'dirty',
      updatedAt: '2026-06-13T00:00:00.000Z',
    });
    const driver: AgentProviderDriver = {
      provider: 'codex',
      getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
      getCapabilities: () => codexProviderCapabilities,
      sendPrompt: async () => ({ providerSession: { kind: 'codex', conversationId: 'thread-test' } }),
      interrupt: async () => ({ providerSession: { kind: 'codex', conversationId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      loadConversation,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      agentGitService: { identity, status: getGitStatus } as unknown as AgentGitService,
      driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'select-team',
      method: 'client/navigation/selectTeam',
      params: { teamId: 'team-other' },
    })).resolves.toMatchObject({ result: { activeTeamId: 'team-other', activeAgentId: 'agent-jesse' } });
    expect(loadConversation).not.toHaveBeenCalled();
    expect(identity).not.toHaveBeenCalled();
    expect(getGitStatus).not.toHaveBeenCalled();
    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'load', method: 'agent/conversation/load', params: { agentId: 'agent-jesse' },
    })).resolves.toMatchObject({
      result: {
        activeTeamId: 'team-other',
        activeAgentId: 'agent-jesse',
        agents: [
          { id: 'agent-dina' },
          { id: 'agent-jesse', providerSession: { kind: 'codex', conversationId: 'thread-hydrated' }, workspace: { branch: 'main' } },
          { id: 'agent-sam' },
        ],
        agentGitStatuses: {
          'agent-jesse': expect.objectContaining({ branch: 'main', state: 'dirty' }),
        },
      },
    });

    expect(loadConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-jesse' }));
    expect(identity).toHaveBeenCalledWith('/Users/nbonamy/src/multi-llm-ts');
    expect(identity).not.toHaveBeenCalledWith('/Users/nbonamy/src/other-project');
    expect(getGitStatus).toHaveBeenCalledWith('/Users/nbonamy/src/multi-llm-ts');
    await server.close();
  });
});
