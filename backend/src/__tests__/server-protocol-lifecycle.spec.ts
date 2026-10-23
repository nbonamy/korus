import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import type { AppSnapshot, SystemPermissionsStatus } from '@workspace/core/contracts';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import type { AgentGitService } from '../git/agent-git-service';
import { createMission, isMission } from '@workspace/core/missions';
import {
  createTestSnapshot,
} from './server-test-fixtures';

describe('AppBackendServer', () => {
  it('backfills missing workspace identity before returning the startup snapshot', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/repo',
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }];
    snapshot.activeAgentId = 'agent-dina';
    const identity = vi.fn().mockResolvedValue({
      kind: 'git',
      folder: '/repo',
      repositoryName: 'repo',
      repositoryRoot: '/repo',
      branch: 'main',
      isLinkedWorktree: false,
      primaryWorktreeRoot: '/repo',
      updatedAt: '2026-08-27T12:00:00.000Z',
    });
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      saveSnapshot,
      agentGitService: { identity } as unknown as AgentGitService,
    });

    await server.initialize();
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'startup-snapshot',
      method: backendMethods.snapshotGet,
    })).resolves.toMatchObject({
      result: {
        snapshot: {
          agents: [expect.objectContaining({
            workspace: expect.objectContaining({ repositoryName: 'repo', branch: 'main' }),
          })],
        },
      },
    });

    expect(identity).toHaveBeenCalledWith('/repo');
    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it('responds to backend health requests', async () => {
    const server = new AppBackendServer({ version: 'test-version', pid: 123 });

    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'health-1', method: 'backend/health/get' })).resolves.toStrictEqual({
      jsonrpc: '2.0',
      id: 'health-1',
      result: {
        ok: true,
        name: product.daemonName,
        version: 'test-version',
        pid: 123,
      },
    });
  });

  it('reads plugin status through the runtime-owned inspector', async () => {
    const inspectPluginStatus = vi.fn().mockResolvedValue({ chromeEnabled: true });
    const server = new AppBackendServer({
      version: 'test-version',
      inspectPluginStatus,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'plugin-status',
      method: backendMethods.settingsPluginStatusGet,
    })).resolves.toStrictEqual({
      jsonrpc: '2.0',
      id: 'plugin-status',
      result: { chromeEnabled: true },
    });
    expect(inspectPluginStatus).toHaveBeenCalledOnce();
  });

  it('rejects malformed mutation payloads at the backend protocol boundary', async () => {
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot: createTestSnapshot(),
    });

    await expect(server.handleMessage({ jsonrpc: '2.0', method: 'ignored/notification' })).resolves.toBeUndefined();
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'response', result: {} })).resolves.toMatchObject({
      error: { code: -32600 },
    });

    const invalidRequests: Array<[string, unknown, string]> = [
      [backendMethods.agentCreate, { input: { name: '', folder: '' } }, 'name'],
      [backendMethods.agentUpdate, { input: { id: 'agent-1', name: 42 } }, 'agent name'],
      [backendMethods.agentUpdate, { input: { id: 'agent-1', modelSelection: { model: 'sol', reasoningEffort: 42, serviceTier: null } } }, 'reasoning effort'],
      [backendMethods.agentFork, { agentId: 'agent-1', turnId: 42 }, 'turnId'],
      [backendMethods.clientAgentExternalApplicationUpdate, { agentId: 'agent-1', application: 'emacs' }, 'application'],
      [backendMethods.teamCreate, { input: { name: '', color: '#123456' } }, 'name'],
      [backendMethods.teamCreate, { input: { name: 'Team', color: 'transparent' } }, 'color'],
      [backendMethods.settingsCodexResourceSharingSet, { input: { enabled: false, mode: 'later' } }, 'sharing'],
      [backendMethods.sourceWorktreesList, { repoPath: '' }, 'repoPath'],
      [backendMethods.sourceRepositoryClone, { input: { url: '' } }, 'url'],
      [backendMethods.sourceRepositoryCreate, { input: { name: 42 } }, 'name'],
      [backendMethods.sourceWorktreeCreate, { input: { repoPath: '', branchName: '' } }, 'configured'],
      [backendMethods.workProviderConnect, { provider: 'linear' }, 'work integrations'],
      [backendMethods.snapshotAutomationsGet, { location: { kind: 'elsewhere' } }, 'location'],
    ];

    for (const [method, params, message] of invalidRequests) {
      let actualMessage = '';
      try {
        const response = await server.handleMessage({ jsonrpc: '2.0', id: method, method, params });
        actualMessage = response && 'error' in response ? response.error.message : '';
      } catch (error) {
        actualMessage = error instanceof Error ? error.message : String(error);
      }
      expect(actualMessage.toLowerCase()).toContain(message.toLowerCase());
    }

    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'work-manager', method: backendMethods.workProviderConnectionsReload,
    })).rejects.toThrow('Work integrations are not configured');
    await server.close();
  });

  it('routes the debug message fixture through the MCP messaging port', async () => {
    const snapshot = createTestSnapshot();
    snapshot.agents = [
      {
        id: 'agent-target',
        teamId: 'team-test',
        name: 'Target',
        folder: '/src/target',
        backend: 'codex',
        status: { type: 'idle' },
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
      {
        id: 'agent-sender',
        teamId: 'team-test',
        name: 'Sender',
        folder: '/src/sender',
        backend: 'codex',
        status: { type: 'idle' },
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
    ];
    const sendAgentMessage = vi.fn();
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      sendAgentMessage,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'debug-message',
      method: backendMethods.debugAgentMessageSend,
      params: { agentId: 'agent-target' },
    })).resolves.toMatchObject({
      result: {
        recipientId: 'agent-target',
        senderId: 'agent-sender',
      },
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(
      'agent-sender',
      'agent-target',
      'Reply with a brief confirmation that the Debug menu message arrived.',
    );
  });

  it('toggles the persisted debug execution plan through the backend event pipeline', async () => {
    const snapshot = createTestSnapshot();
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
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
    });

    const createResult = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'debug-plan-create',
      method: backendMethods.debugExecutionPlanToggle,
      params: { agentId: 'agent-dina' },
    });
    expect(createResult).toMatchObject({
      result: {
        agents: [{
          id: 'agent-dina',
          plan: {
            explanation: 'Debug execution plan',
            steps: [
              { step: 'Inspect the current state', status: 'completed' },
              { step: 'Exercise the execution-plan overlay', status: 'inProgress' },
              { step: 'Remove the debug fixture', status: 'pending' },
            ],
          },
        }],
      },
    });

    const removeResult = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'debug-plan-remove',
      method: backendMethods.debugExecutionPlanToggle,
      params: { agentId: 'agent-dina' },
    });
    expect(removeResult).toMatchObject({ result: { agents: [{ id: 'agent-dina' }] } });
    expect((removeResult as { result: AppSnapshot }).result.agents[0]?.plan).toBeUndefined();
    expect(saveSnapshot).toHaveBeenCalledTimes(2);
  });

  it('removes an existing execution plan on the first debug-menu request', async () => {
    const snapshot = createTestSnapshot();
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      status: { type: 'idle' },
      plan: {
        threadId: 'thread-old',
        turnId: 'turn-old',
        kind: 'execution',
        status: 'incomplete',
        explanation: 'Old plan',
        steps: [{ step: 'Old step', status: 'pending' }],
        markdown: 'Old plan',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const server = new AppBackendServer({ version: 'test-version', snapshot });

    const result = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'debug-plan-replace-stale',
      method: backendMethods.debugExecutionPlanToggle,
      params: { agentId: 'agent-dina' },
    });

    expect(result).toMatchObject({ result: { agents: [{ id: 'agent-dina' }] } });
    expect((result as { result: AppSnapshot }).result.agents[0]?.plan).toBeUndefined();
  });

  it('injects a proposed plan and emits the normal review-ready domain event', async () => {
    const snapshot = createTestSnapshot();
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
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    const events: unknown[] = [];
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      onEvent: (event) => events.push(event),
    });

    const result = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'debug-plan-review',
      method: backendMethods.debugPlanReadyForReviewInject,
      params: { agentId: 'agent-dina' },
    });

    expect(result).toMatchObject({ result: { agents: [{ id: 'agent-dina' }] } });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'plan.readyForReview',
        payload: expect.objectContaining({
          markdown: expect.stringMatching(/## Key Changes[\s\S]*## Commit Strategy/u),
        }),
      }),
    ]));
  });

  it('injects observable code review states through the debug protocol', async () => {
    const snapshot = createTestSnapshot();
    snapshot.agents = [{
      id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/repo', backend: 'codex',
      status: { type: 'idle' }, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
    }];
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.activeAgentId = 'agent-dina';
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({ version: 'test-version', snapshot, saveSnapshot });

    const reviewing = await server.handleMessage({
      jsonrpc: '2.0', id: 'debug-reviewing', method: backendMethods.debugCodeReviewSet,
      params: { agentId: 'agent-dina', scenario: 'reviewing' },
    });
    const reviewingSession = (reviewing as { result: AppSnapshot }).result.agents[0]!.codeReview!;
    expect(reviewingSession).toMatchObject({
      targetAgentId: 'agent-dina', reviewerAgentId: 'agent-dina', threadMode: 'current', status: 'reviewing',
      rounds: [{ status: 'reviewing' }],
    });
    expect(reviewingSession.rounds[0]!.findings.map((finding) => finding.priority))
      .toStrictEqual(['p0', 'p1', 'p2', 'p3']);
    expect(reviewingSession.rounds[0]!.findings[2]!.location).toBeUndefined();

    const ready = await server.handleMessage({
      jsonrpc: '2.0', id: 'debug-ready', method: backendMethods.debugCodeReviewSet,
      params: { agentId: 'agent-dina', scenario: 'ready' },
    });
    const readySession = (ready as { result: AppSnapshot }).result.agents[0]!.codeReview!;
    expect(readySession.status).toBe('ready');
    expect(readySession.rounds[0]!.status).toBe('ready');
    expect(readySession.rounds[0]!.findings.map((finding) => finding.decision.state))
      .toStrictEqual(['selected', 'selected', 'selected', 'selected']);

    const fixing = await server.handleMessage({
      jsonrpc: '2.0', id: 'debug-fixing', method: backendMethods.debugCodeReviewSet,
      params: { agentId: 'agent-dina', scenario: 'fixing' },
    });
    const fixingSession = (fixing as { result: AppSnapshot }).result.agents[0]!.codeReview!;
    expect(fixingSession.status).toBe('fixing');
    expect(fixingSession.rounds[0]!.status).toBe('submitted');
    expect(fixingSession.rounds[0]!.findings.map((finding) => finding.remediation.state))
      .toStrictEqual(['fixed', 'skipped', 'fixing', 'fixed']);
    expect(fixingSession.rounds[0]!.findings[1]!.decision).toMatchObject({
      state: 'rejected',
      reason: 'The existing behavior is intentional for this workflow.',
    });

    const completed = await server.handleMessage({
      jsonrpc: '2.0', id: 'debug-ready-to-finish', method: backendMethods.debugCodeReviewSet,
      params: { agentId: 'agent-dina', scenario: 'readyToFinish' },
    });
    const completedSession = (completed as { result: AppSnapshot }).result.agents[0]!.codeReview!;
    expect(completedSession.status).toBe('readyToFinish');
    expect(completedSession.rounds[0]).toMatchObject({ status: 'completed', findings: [] });
    expect(saveSnapshot).toHaveBeenCalledTimes(4);
  });

  it('sets and clears both thread flags through the debug protocol', async () => {
    const snapshot = createTestSnapshot();
    snapshot.agents = [{
      id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/repo', backend: 'codex',
      status: { type: 'idle' }, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
    }];
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.activeAgentId = 'agent-dina';
    const server = new AppBackendServer({ version: 'test-version', snapshot });

    const set = await server.handleMessage({
      jsonrpc: '2.0', id: 'debug-thread-flag-set', method: backendMethods.debugThreadFlagSet,
      params: { agentId: 'agent-dina', id: 'delegate_to_worktree', value: true },
    });
    expect((set as { result: AppSnapshot }).result.agents[0]?.threadFlags)
      .toStrictEqual({ delegate_to_worktree: true });

    const ready = await server.handleMessage({
      jsonrpc: '2.0', id: 'debug-ready-flag-set', method: backendMethods.debugThreadFlagSet,
      params: { agentId: 'agent-dina', id: 'ready_for_review', value: true },
    });
    expect((ready as { result: AppSnapshot }).result.agents[0]?.threadFlags)
      .toStrictEqual({ delegate_to_worktree: true, ready_for_review: true });

    const cleared = await server.handleMessage({
      jsonrpc: '2.0', id: 'debug-thread-flag-clear', method: backendMethods.debugThreadFlagSet,
      params: { agentId: 'agent-dina', id: 'delegate_to_worktree', value: false },
    });
    expect((cleared as { result: AppSnapshot }).result.agents[0]?.threadFlags)
      .toStrictEqual({ ready_for_review: true });

    const readyCleared = await server.handleMessage({
      jsonrpc: '2.0', id: 'debug-ready-flag-clear', method: backendMethods.debugThreadFlagSet,
      params: { agentId: 'agent-dina', id: 'ready_for_review', value: false },
    });
    expect((readyCleared as { result: AppSnapshot }).result.agents[0]?.threadFlags).toBeUndefined();
  });

  it('persists a populated Visualize fixture through the debug protocol', async () => {
    const snapshot = createTestSnapshot();
    snapshot.agents = [{
      id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/repo', backend: 'codex',
      status: { type: 'idle' }, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
      backendSession: { kind: 'codex', threadId: 'thread-design' },
    }];
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.activeAgentId = 'agent-dina';
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({ version: 'test-version', snapshot, saveSnapshot });

    const result = await server.handleMessage({
      jsonrpc: '2.0', id: 'debug-visualize', method: backendMethods.debugVisualizePopulate,
      params: { agentId: 'agent-dina' },
    });

    const visualize = (result as { result: AppSnapshot }).result.agents[0]!.visualize!;
    expect(visualize.conversationRef).toStrictEqual({ backend: 'codex', threadId: 'thread-design' });
    expect(visualize.isOpen).toBe(true);
    expect(visualize.selectedVisualizationId).toBe('debug-visualization-workflow');
    expect(visualize.visualizations.map(visualization => visualization.content.kind)).toStrictEqual(['mermaid', 'svg']);
    expect(visualize.suggestions.map(suggestion => suggestion.id)).toContain('debug-suggestion-state');
    expect(visualize.suggestions.find(suggestion => suggestion.id === 'debug-suggestion-state'))
      .not.toHaveProperty('visualizationId');

    const suggestionsResult = await server.handleMessage({
      jsonrpc: '2.0', id: 'debug-visualize-suggestions', method: backendMethods.debugVisualizePopulate,
      params: { agentId: 'agent-dina', scenario: 'suggestions' },
    });
    const suggestions = (suggestionsResult as { result: AppSnapshot }).result.agents[0]!.visualize!;
    expect(suggestions.suggestions).toHaveLength(4);
    expect(suggestions.visualizations).toStrictEqual([]);
    expect(suggestions.selectedVisualizationId).toBeNull();
    expect(saveSnapshot).toHaveBeenCalledTimes(2);
  });

  it('persists a populated Mission stage fixture through the debug protocol', async () => {
    const snapshot = createTestSnapshot();
    snapshot.agents = [{
      id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/repo', backend: 'codex',
      status: { type: 'idle' }, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
    }];
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    const mission = createMission(snapshot, { outcome: 'Debug mission', workflowType: 'shapeAndShipFeature', teamId: 'team-test', orchestratorMemberId: 'agent-dina' });
    mission.execution!.runs.push({
      id: 'run-requirements', stage: 'requirements', memberId: 'agent-dina', workerId: 'agent-dina', status: 'running',
      skills: [], feedback: '', startedAt: '2026-09-19T00:00:00.000Z',
    });
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({ version: 'test-version', snapshot, saveSnapshot });

    const result = await server.handleMessage({
      jsonrpc: '2.0', id: 'debug-mission-stage', method: backendMethods.debugMissionStageSet,
      params: { missionId: mission.id, stage: 'implementation' },
    });

    expect(result).toMatchObject({ result: { missions: [{ id: mission.id, stage: 'implementation', execution: { debugFixture: true } }] } });
    expect(saveSnapshot).toHaveBeenCalledOnce();
    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'debug-mission-review', method: backendMethods.debugMissionStageSet,
      params: { missionId: mission.id, stage: 'review', reviewState: 'remediated' },
    })).resolves.toMatchObject({ result: { missions: [{ artifacts: { review: { findings: [
      { remediation: { state: 'fixed' } }, { remediation: { state: 'skipped' } },
    ] } } }] } });
    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'debug-mission-invalid', method: backendMethods.debugMissionStageSet,
      params: { missionId: mission.id, stage: 'unknown' },
    })).resolves.toMatchObject({ error: { code: -32602 } });
  });

  it('loads a repeatable two-repository Mission screenshot with synthetic chats across reloads', async () => {
    // Failure modes: incorrect ticket grouping/state; missing chats after reload;
    // duplicated agents on reuse; accidentally hydrating a fake provider session.
    const snapshot = createTestSnapshot();
    snapshot.agents = [{ id: 'original', teamId: 'team-test', name: 'Original', folder: '/repo', backend: 'codex',
      status: { type: 'idle' }, createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z' }];
    snapshot.teams[0]!.agentIds = ['original'];
    const original = structuredClone(snapshot.agents[0]);
    const mission = createMission(snapshot, { outcome: 'Screenshot', workflowType: 'shapeAndShipFeature', teamId: 'team-test', orchestratorMemberId: 'original' });
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot });
    const load = () => server.handleMessage({ jsonrpc: '2.0', id: 'screenshot', method: backendMethods.debugMissionStageSet,
      params: { missionId: mission.id, stage: 'implementation', preset: 'screenshot' } });
    await load();
    const tickets = mission.artifacts.tickets;
    expect(tickets).toHaveLength(3);
    expect(tickets.map(ticket => ticket.done)).toEqual([true, false, true]);
    expect(tickets[0]!.repositoryPath).toBe(tickets[1]!.repositoryPath);
    expect(tickets[2]!.repositoryPath).not.toBe(tickets[0]!.repositoryPath);
    expect(mission.execution?.workspaces).toHaveLength(2);
    expect(isMission(mission)).toBe(true);
    expect(mission.execution?.runs.filter(run => run.stage === 'implementation').map(run => run.status)).toEqual(['accepted', 'running', 'accepted']);
    expect(snapshot.agents.find(agent => agent.id === 'original')).toEqual(original);
    const agentCount = snapshot.agents.length;
    await load();
    expect(snapshot.agents).toHaveLength(agentCount);
    expect(saveSnapshot).toHaveBeenCalledTimes(2);

    // A fresh daemon reconstructs fixture conversations without provider history.
    const events: BackendEvent[] = [];
    const reopened = new AppBackendServer({ version: 'test', snapshot: structuredClone(snapshot), onEvent: event => events.push(event) });
    const workerIds = [...new Set(mission.execution!.runs.map(run => run.workerId!))];
    expect(workerIds).toHaveLength(3);
    for (const agentId of workerIds) {
      await reopened.handleMessage({ jsonrpc: '2.0', id: agentId, method: backendMethods.agentConversationLoad, params: { agentId } });
      const event = events.find(event => event.agentId === agentId && event.type === 'claude.conversationSnapshotChanged');
      expect(event).toMatchObject({ payload: { snapshot: { agentId, messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user' }), expect.objectContaining({ role: 'assistant' }),
      ]) } } });
    }
    const runningWorker = mission.execution!.runs.find(run => run.status === 'running')!.workerId!;
    await expect(reopened.handleMessage({ jsonrpc: '2.0', id: 'fixture-models', method: backendMethods.agentModelsList, params: { agentId: runningWorker } }))
      .resolves.toMatchObject({ result: [{ model: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6' }] });
    expect(events.find(event => event.agentId === runningWorker && event.type === 'claude.conversationSnapshotChanged'))
      .toMatchObject({ payload: { snapshot: { busy: true, activeTurnId: expect.any(String) } } });
    await expect(reopened.handleMessage({ jsonrpc: '2.0', id: 'no-provider', method: backendMethods.agentSkillsList, params: { agentId: runningWorker } }))
      .rejects.toThrow('screenshot agents are read-only');
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'wrong-stage', method: backendMethods.debugMissionStageSet,
      params: { missionId: mission.id, stage: 'review', preset: 'screenshot' } })).resolves.toMatchObject({ error: { code: -32602 } });
    await server.close();
    await reopened.close();
  });

  it('routes system permission requests through the backend system port', async () => {
    const status: SystemPermissionsStatus = {
      platform: 'darwin',
      accessibility: {
        required: true,
        trusted: false,
      },
      screenRecording: {
        required: true,
        trusted: false,
      },
    };
    const openedStatus: SystemPermissionsStatus = {
      platform: 'darwin',
      accessibility: {
        required: true,
        trusted: true,
      },
      screenRecording: {
        required: true,
        trusted: false,
      },
    };
    const screenRecordingStatus: SystemPermissionsStatus = {
      ...openedStatus,
      screenRecording: { required: true, trusted: true },
    };
    const systemPermissions = {
      getStatus: vi.fn().mockResolvedValue(status),
      openAccessibilitySettings: vi.fn().mockResolvedValue(openedStatus),
      openScreenRecordingSettings: vi.fn().mockResolvedValue(screenRecordingStatus),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      systemPermissions,
    });

    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'permissions', method: 'system/permissions/get' })).resolves.toStrictEqual({
      jsonrpc: '2.0',
      id: 'permissions',
      result: status,
    });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'open-permissions', method: 'system/permissions/accessibility/open' })).resolves.toStrictEqual({
      jsonrpc: '2.0',
      id: 'open-permissions',
      result: openedStatus,
    });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'open-screen-recording', method: 'system/permissions/screenRecording/open' })).resolves.toStrictEqual({
      jsonrpc: '2.0',
      id: 'open-screen-recording',
      result: screenRecordingStatus,
    });
    expect(systemPermissions.getStatus).toHaveBeenCalledOnce();
    expect(systemPermissions.openAccessibilitySettings).toHaveBeenCalledOnce();
    expect(systemPermissions.openScreenRecordingSettings).toHaveBeenCalledOnce();
  });

  it('returns a non-desktop system permission status when no host port is configured', async () => {
    const server = new AppBackendServer({ version: 'test-version', pid: 123 });

    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'permissions', method: 'system/permissions/get' })).resolves.toStrictEqual({
      jsonrpc: '2.0',
      id: 'permissions',
      result: {
        platform: 'unsupported',
        accessibility: {
          required: false,
          trusted: true,
        },
        screenRecording: {
          required: false,
          trusted: true,
        },
      },
    });
  });

  it('routes device pairing requests through the Codex driver RPC boundary', async () => {
    const status = { status: 'connected', environmentId: 'environment-1' };
    const handle = vi.fn().mockResolvedValue(status);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      driverRpc: {
        handle,
        onEvent: vi.fn(() => () => undefined),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as BackendDriverRpc,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'pairing-status', method: 'remoteControl/status/get',
    })).resolves.toStrictEqual({ jsonrpc: '2.0', id: 'pairing-status', result: status });
    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'pairing-revoke', method: 'remoteControl/client/revoke',
      params: { environmentId: 'environment-1', clientId: 'client-1' },
    })).resolves.toStrictEqual({ jsonrpc: '2.0', id: 'pairing-revoke', result: status });

    expect(handle).toHaveBeenCalledWith('remoteControl/status/get', undefined);
    expect(handle).toHaveBeenCalledWith('remoteControl/client/revoke', {
      environmentId: 'environment-1', clientId: 'client-1',
    });
  });

  it('returns an app snapshot with the backend event sequence', async () => {
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot: {
        ...createTestSnapshot(),
        activeTeamId: 'team-test',
      },
    });
    const response = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'snapshot/get' });

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        lastEventSeq: 0,
        clientState: {
          sourceFolderPath: '',
          shouldPreventDisplaySleep: false,
        },
        snapshot: {
          activeTeamId: 'team-test',
          activeAgentId: null,
          teams: [{ id: 'team-test' }],
          agents: [],
        },
      },
    });
  });

  it('derives client state from backend-owned snapshot state', async () => {
    const snapshot = createTestSnapshot();
    snapshot.sourceFolder = {
      path: '/Users/nbonamy/src',
      initialized: true,
      recentRepoNames: [],
    };
    snapshot.general.preventSleepWhenAgentsRun = true;
    snapshot.general.preventSleepWhenRemoteAccessEnabled = true;
    snapshot.agents = [{
      id: 'agent-dina',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      status: { type: 'working' },
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
    }];
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'desktop-state',
      method: 'client/state/get',
    })).resolves.toMatchObject({
      result: {
        sourceFolderPath: '/Users/nbonamy/src',
        shouldPreventDisplaySleep: true,
        shouldPreventDisplaySleepForRemoteAccess: false,
      },
    });

    snapshot.general.preventSleepWhenAgentsRun = false;
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'desktop-state-disabled',
      method: 'client/state/get',
    })).resolves.toMatchObject({
      result: {
        sourceFolderPath: '/Users/nbonamy/src',
        shouldPreventDisplaySleep: false,
        shouldPreventDisplaySleepForRemoteAccess: false,
      },
    });
  });

  it('hydrates remote-control status before deriving initial client state', async () => {
    const snapshot = createTestSnapshot();
    snapshot.general.preventSleepWhenAgentsRun = true;
    snapshot.general.preventSleepWhenRemoteAccessEnabled = true;
    const handle = vi.fn(async (method: string) => method === backendMethods.remoteControlStatusGet ? {
      status: 'connected',
      serverName: 'Codex remote control',
      installationId: 'installation-1',
      environmentId: 'environment-1',
    } : undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: {
        handle,
        onEvent: vi.fn(() => () => undefined),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as BackendDriverRpc,
    });

    await server.initialize();
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'snapshot',
      method: 'snapshot/get',
    })).resolves.toMatchObject({
      result: {
        clientState: {
          shouldPreventDisplaySleepForRemoteAccess: true,
        },
      },
    });
    expect(handle).toHaveBeenCalledWith(backendMethods.remoteControlStatusGet, undefined);
    server.setCompanionAccessEnabled(true);
    server.setCompanionAccessEnabled(false);
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'codex-still-enabled', method: backendMethods.clientStateGet })).resolves.toMatchObject({
      result: { shouldPreventDisplaySleepForRemoteAccess: true },
    });
    await server.close();
  });

  it('initializes source folder state from the backend when snapshots are requested', async () => {
    const snapshot = createTestSnapshot();
    snapshot.sourceFolder = { path: '', initialized: false, recentRepoNames: [] };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const handle = vi.fn().mockResolvedValue('/Users/nbonamy/src');
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      driverRpc: {
        handle,
        onEvent: vi.fn(() => () => undefined),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as BackendDriverRpc,
    });

    await server.initialize();
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'snapshot', method: 'snapshot/get' })).resolves.toMatchObject({
      result: {
        snapshot: {
          sourceFolder: {
            path: '/Users/nbonamy/src',
            initialized: true,
            recentRepoNames: [],
          },
        },
      },
    });

    expect(handle).toHaveBeenCalledWith('source/folder/detect', undefined);
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
    await server.close();
  });

  it('returns method-not-found errors for unknown methods', async () => {
    const server = new AppBackendServer({ version: 'test-version', pid: 123 });

    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'missing', method: 'nope' })).resolves.toStrictEqual({
      jsonrpc: '2.0',
      id: 'missing',
      error: {
        code: -32601,
        message: 'Unknown backend method: nope',
      },
    });
  });

  it('does not accept legacy backend method names', async () => {
    const server = new AppBackendServer({ version: 'test-version', pid: 123 });

    for (const method of ['agent/listFiles']) {
      await expect(server.handleMessage({ jsonrpc: '2.0', id: method, method })).resolves.toStrictEqual({
        jsonrpc: '2.0',
        id: method,
        error: {
          code: -32601,
          message: `Unknown backend method: ${method}`,
        },
      });
    }
  });

  it('assigns backend event sequence numbers', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      status: { type: 'idle' },
      backendSession: { kind: 'codex', threadId: 'thread-test' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    snapshot.activeAgentId = 'agent-dina';
    const events: unknown[] = [];
    let emitEvent: (event: BackendEvent) => void = () => undefined;
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      onEvent: (listener) => {
        emitEvent = listener;
        return () => undefined;
      },
      close: async () => undefined,
    };
    const driverRpc = new BackendDriverRpc(new Map([['codex', driver]]));
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc,
      onEvent: (event) => events.push(event),
    });

    emitEvent({
      backend: 'codex',
      agentId: 'agent-dina',
      type: 'agent.statusChanged',
      payload: { type: 'working' },
    });

    expect(events).toMatchObject([{
      seq: 1,
      backend: 'codex',
      agentId: 'agent-dina',
      type: 'agent.statusChanged',
      payload: { type: 'working' },
      clientState: {
        shouldPreventDisplaySleep: true,
        shouldPreventDisplaySleepForRemoteAccess: false,
      },
    }]);
    emitEvent({
      backend: 'codex',
      type: 'remoteControl.statusChanged',
      payload: {
        status: 'connected',
        serverName: 'Codex remote control',
        installationId: 'installation-1',
        environmentId: 'environment-1',
      },
    });
    expect(events).toContainEqual(expect.objectContaining({
      seq: 2,
      type: 'remoteControl.statusChanged',
      clientState: expect.objectContaining({ shouldPreventDisplaySleepForRemoteAccess: true }),
    }));
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'snapshot/get' })).resolves.toMatchObject({
      result: {
        lastEventSeq: 2,
      },
    });
  });
});
