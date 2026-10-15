import { describe, expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { claudeBackendCapabilities, codexBackendCapabilities, defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { AgentBackendDriver, BackendCodeReviewResult } from '@workspace/core/backend-driver';
import type { Agent } from '@workspace/core/contracts';
import { BackendDriverRpc } from '../driver-rpc';
import { AppBackendServer } from '../server';
import { createTestSnapshot } from './server-test-fixtures';
import { ReviewToolRegistry, type ReviewToolHandlers } from '../review/review-tool-registry';


describe('AppBackendServer code review workflow', () => {
  it('simulates automatic inspection through manual handoff and stop without calling a provider', async () => {
    const snapshot = createTestSnapshot();
    const owner: Agent = {
      id: 'debug-owner', teamId: snapshot.teams[0]!.id, name: 'Debug owner', folder: '/repo',
      backend: 'codex', status: { type: 'idle' }, createdAt: 'now', updatedAt: 'now',
    };
    snapshot.agents = [owner];
    snapshot.teams[0]!.agentIds = [owner.id];
    const interrupt = vi.fn();
    const runCodeReview = vi.fn();
    const driver: AgentBackendDriver = {
      backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities, runCodeReview, interrupt,
      sendPrompt: vi.fn(), respondToAgentRequest: vi.fn(), onEvent: () => () => undefined, close: vi.fn(),
    };
    const server = new AppBackendServer({
      version: 'test', snapshot, saveSnapshot: vi.fn().mockResolvedValue(undefined),
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      codeReviewTools: {
        createReviewToolContext: () => ({ id: 'debug-context', url: 'http://review.test/mcp' }),
        closeReviewToolContext: vi.fn(),
      },
    });
    try {
      await request(server, backendMethods.debugCodeReviewSet, { agentId: owner.id, scenario: 'automaticReviewing' });
      const session = owner.codeReview!;
      expect(session).toMatchObject({ status: 'reviewing', automation: { enabled: true, state: 'running' } });
      const findings = structuredClone(session.rounds[0]!.findings);
      expect(findings).toHaveLength(4);
      await request(server, backendMethods.agentCodeReviewManual, { agentId: owner.id, sessionId: session.id });
      expect(session).toMatchObject({ status: 'reviewing', automation: { enabled: false, state: 'manual' } });
      expect(owner.status.type).toBe('working');
      await request(server, backendMethods.agentInterrupt, { agentId: owner.id });
      expect(owner.codeReview).toBe(session);
      expect(session.status).toBe('failed');
      expect(session.rounds[0]!.error).toBe('Review stopped. Retry to complete the inspection.');
      expect(session.rounds[0]!.findings).toStrictEqual(findings);
      expect(session.automation?.state).toBe('manual');
      expect(owner.status.type).toBe('idle');
      expect(interrupt).not.toHaveBeenCalled();
      expect(runCodeReview).not.toHaveBeenCalled();

      await request(server, backendMethods.debugCodeReviewSet, { agentId: owner.id, scenario: 'automaticReviewing' });
      expect(owner.codeReview).not.toBe(session);
      expect(owner.codeReview?.automation?.state).toBe('running');
      await request(server, backendMethods.debugCodeReviewSet, { agentId: owner.id, scenario: 'ready' });
      expect(owner.codeReview?.status).toBe('ready');
      expect(owner.status.type).toBe('idle');
      const idleFixture = owner.codeReview;
      owner.status = { type: 'working' };
      await expect(server.handleMessage({
        jsonrpc: '2.0', id: 'busy-simulation', method: backendMethods.debugCodeReviewSet,
        params: { agentId: owner.id, scenario: 'automaticReviewing' },
      })).rejects.toThrow('active agent turn');
      expect(owner.codeReview).toBe(idleFixture);
      owner.status = { type: 'idle' };
    } finally { await server.close(); }
  });

  it.each(['reviewing', 'fixing'] as const)('resumes a persisted %s session after startup connection detection without replacing the open context', async status => {
    const snapshot = createTestSnapshot();
    snapshot.sourceFolder = { path: '/repo', initialized: true, recentRepoNames: [] };
    const reviewer: Agent = {
      id: 'reviewer', teamId: 'team-test', name: 'Review', folder: '/repo', backend: 'claude',
      status: { type: 'idle' }, createdAt: 'now', updatedAt: 'now',
      backendSession: { kind: 'claude', sessionId: 'saved-review-thread', transport: 'stdio' },
      codeReview: {
        id: 'saved-review', targetAgentId: 'reviewer', reviewerAgentId: 'reviewer',
        scope: { type: 'uncommitted' }, threadMode: 'current', status,
        activeRoundId: 'saved-round', createdAt: 'now', updatedAt: 'now',
        rounds: [{
          id: 'saved-round', number: 1, status: status === 'fixing' ? 'submitted' : 'reviewing', startedAt: 'now',
          reviewerSession: { kind: 'claude', sessionId: 'saved-review-thread', transport: 'stdio' },
          findings: [{
            id: 'saved-finding', roundId: 'saved-round', priority: 'p1', title: 'Check ownership',
            body: 'Authorize before writing.', decision: { state: 'selected', decidedAt: 'now' },
            remediation: { state: 'fixing', startedAt: 'now' }, discussion: [],
            createdAt: 'now', updatedAt: 'now',
          }],
        }],
      },
    };
    snapshot.agents.push(reviewer);
    snapshot.teams[0]!.agentIds.push(reviewer.id);
    const registry = new ReviewToolRegistry();
    const runCodeReview = vi.fn(async (_agent, input) => {
      const contextId = new URL(input.reviewMcpServerUrl).searchParams.get('reviewContextId');
      const context = registry.resolve(reviewer.id, contextId);
      if (!context) throw new Error('Missing saved review context.');
      if (status === 'fixing') {
        await context.updateFinding({ findingId: 'saved-finding', status: 'fixed', evidence: 'Ownership verified.' });
      } else {
        await context.reportFinding({ priority: 'p1', title: 'Check ownership', body: 'Authorize before writing.' });
        await context.finishReviewRound({ findingCount: 1 });
      }
      return { text: '', reviewerSession: input.reviewerSession };
    });
    const driver: AgentBackendDriver = {
      backend: 'claude', getRuntimeStatus: () => ({ backend: 'claude', status: 'running' }),
      getCapabilities: () => claudeBackendCapabilities,
      authenticate: async () => ({ kind: 'claude', connected: true, state: { loggedIn: true } }),
      runCodeReview, sendPrompt: vi.fn(), interrupt: vi.fn(), respondToAgentRequest: vi.fn(),
      onEvent: () => () => undefined, close: vi.fn(),
    };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test', snapshot, saveSnapshot,
      driverRpc: new BackendDriverRpc(new Map([['claude', driver]])),
      providerSetup: { isChanging: () => false, list: () => [{ backend: 'claude', installed: true }] } as never,
      codeReviewTools: {
        createReviewToolContext: (agentId, sessionId, handlers) => {
          const context = registry.create(agentId, sessionId, handlers);
          return { id: context.id, url: `http://review.test/mcp?reviewContextId=${context.id}` };
        },
        closeReviewToolContext: id => registry.close(id),
      },
    });
    try {
      await server.initialize();
      await vi.waitFor(() => expect(snapshot.agents[0]?.codeReview?.status).not.toBe(status));
      expect(snapshot.agents[0]?.codeReview?.rounds[0]?.error).toBeUndefined();
      expect(snapshot.agents[0]?.codeReview).toMatchObject({
        id: 'saved-review', status: status === 'fixing' ? 'readyToFinish' : 'ready', rounds: [{
          id: 'saved-round', status: status === 'fixing' ? 'completed' : 'ready',
          reviewerSession: { kind: 'claude', sessionId: 'saved-review-thread' },
          findings: [status === 'fixing'
            ? { id: 'saved-finding', remediation: { state: 'fixed', evidence: 'Ownership verified.' } }
            : { title: 'Check ownership', remediation: { state: 'notStarted' } }],
        }],
      });
      expect(runCodeReview).toHaveBeenCalledTimes(1);
      expect(saveSnapshot).toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it('rejects malformed finding decisions at the backend protocol boundary', async () => {
    const server = new AppBackendServer({
      version: 'test', snapshot: createTestSnapshot(),
      codeReviewTools: {
        createReviewToolContext: () => ({ id: 'unused', url: 'http://review.test/mcp' }),
        closeReviewToolContext: vi.fn(),
      },
    });

    const response = await server.handleMessage({
      jsonrpc: '2.0', id: 'invalid-decision',
      method: backendMethods.agentCodeReviewFindingDecide,
      params: {
        agentId: 'agent-owner',
        input: { sessionId: 'review-1', roundId: 'round-1', findingId: 'finding-1', decision: 'ignore' },
      },
    });

    expect(response).toMatchObject({
      error: { code: -32602, message: 'Invalid code review decision input.' },
    });

    const emptyDiscussion = await server.handleMessage({
      jsonrpc: '2.0', id: 'invalid-discussion',
      method: backendMethods.agentCodeReviewFindingDiscuss,
      params: {
        agentId: 'agent-owner',
        input: { sessionId: 'review-1', roundId: 'round-1', findingId: 'finding-1', question: ' ' },
      },
    });
    expect(emptyDiscussion).toMatchObject({
      error: { code: -32602, message: 'Invalid code review discussion input.' },
    });
    await server.close();
  });

  it.each(['discard', 'manual'] as const)('routes review %s through the app-owned request and persists the result', async action => {
    const snapshot = createTestSnapshot();
    const owner: Agent = {
      id: 'agent-owner', teamId: snapshot.teams[0]!.id, name: 'Owner', folder: '/repo',
      backend: 'codex', status: { type: 'idle' },
      createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T10:00:00.000Z',
      codeReview: {
        id: 'review-1', targetAgentId: 'agent-owner', reviewerAgentId: 'agent-owner', scope: { type: 'uncommitted' },
        threadMode: 'current', status: 'ready', activeRoundId: 'round-1',
        rounds: [{ id: 'round-1', number: 1, status: 'ready', findings: [], startedAt: 'now' }],
        createdAt: 'now', updatedAt: 'now',
        automation: { enabled: true, state: 'paused', maxPriority: 'p2', maxRounds: 3, commits: [], reason: 'Round limit.' },
      },
    };
    snapshot.agents.push(owner);
    snapshot.teams[0]!.agentIds.push(owner.id);
    snapshot.agentGitStatuses[owner.id] = {
      folder: '/repo', branch: 'feat/review', ahead: 1, behind: 0,
      changedFiles: 2, addedLines: 12, removedLines: 3, hasUntracked: false,
      state: 'dirty', updatedAt: '2026-09-19T10:00:00.000Z',
    };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test', snapshot,
      driverRpc: new BackendDriverRpc(new Map()),
      saveSnapshot,
      codeReviewTools: {
        createReviewToolContext: () => ({ id: 'unused', url: 'http://review.test/mcp' }),
        closeReviewToolContext: vi.fn(),
      },
    });

    await request(server, action === 'discard' ? backendMethods.agentCodeReviewDiscard : backendMethods.agentCodeReviewManual, {
      agentId: owner.id, sessionId: 'review-1',
    });

    if (action === 'discard') expect(owner.codeReview).toBeUndefined();
    else {
      expect(owner.codeReview).toMatchObject({ id: 'review-1', status: 'ready', automation: { enabled: false, state: 'manual' } });
      expect(owner.codeReview?.automation?.reason).toBeUndefined();
      expect(saveSnapshot).toHaveBeenCalled();
    }
    await server.close();
  });

  it.each(['codex', 'claude', 'antigravity'] as const)('retains %s review conversations through review again and finish', async (backend) => {
    const snapshot = createTestSnapshot();
    snapshot.providerConnections?.push({ backend: 'antigravity', installed: true, connected: true, checking: false });
    const owner: Agent = {
      id: 'agent-owner',
      teamId: snapshot.teams[0]!.id,
      name: 'Owner',
      folder: '/repo',
      backend: 'codex' as const,
      backendDefaults: { kind: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      status: { type: 'idle' as const },
      createdAt: '2026-09-19T10:00:00.000Z',
      updatedAt: '2026-09-19T10:00:00.000Z',
    };
    snapshot.agents.push(owner);
    snapshot.teams[0]!.agentIds.push(owner.id);
    let activeHandlers: ReviewToolHandlers | null = null;
    let findingId = '';
    let reviewRun = 0;
    const runCodeReview = vi.fn(async (_agent, input) => {
      reviewRun += 1;
      if (!activeHandlers) throw new Error('Missing review tool context.');
      if (reviewRun === 1) {
        const finding = await activeHandlers.reportFinding({
          priority: 'p1', title: 'Authorize before writing',
          body: 'The public mutation writes before checking ownership.',
          location: { file: 'src/auth.ts', line: 42 },
        });
        findingId = finding.id;
        await activeHandlers.finishReviewRound({ findingCount: 1 });
      } else if (reviewRun === 2) {
        await activeHandlers.updateFinding({ findingId, status: 'fixed' });
      } else {
        await activeHandlers.finishReviewRound({ findingCount: 0 });
      }
      return {
        text: '',
        reviewerSession: input.reviewerSession ?? (backend === 'codex'
          ? { kind: 'codex' as const, threadId: `review-thread-${reviewRun}` }
          : backend === 'claude' ? { kind: 'claude' as const, sessionId: `review-thread-${reviewRun}`, transport: 'stdio' as const }
          : { kind: 'antigravity' as const, sessionId: `review-thread-${reviewRun}` }),
      };
    });
    const disposeCodeReview = vi.fn().mockResolvedValue(undefined);
    snapshot.general.worktreeDelegationStartingContext = 'conversation';
    snapshot.general.worktreeDelegationInstructions = 'Saved delegation directions must not enter an independent review.';
    const forkWorktreeConversation = vi.fn();
    // The first archive (between rounds) fails: housekeeping errors must not block the review.
    const archiveAgentConversation = vi.fn().mockRejectedValueOnce(new Error('thread not found')).mockResolvedValue(undefined);
    const saveCodeReviewReport = vi.fn().mockResolvedValue('/reports/review.md');
    const releaseConversation = vi.fn();
    const sendAgentMessage = vi.fn();
    const driver: AgentBackendDriver = {
      backend,
      getRuntimeStatus: () => ({ backend, status: 'running' }),
      getCapabilities: () => defaultBackendCapabilities(backend),
      runCodeReview,
      forkWorktreeConversation,
      disposeCodeReview,
      ...(backend === 'codex' ? { archiveAgentConversation } : {}),
      releaseConversation,
      sendPrompt: vi.fn(),
      interrupt: vi.fn(),
      respondToAgentRequest: vi.fn(),
      onEvent: () => () => undefined,
      close: vi.fn(),
    };
    let context = 0;
    const server = new AppBackendServer({
      version: 'test',
      snapshot,
      sendAgentMessage,
      saveCodeReviewReport,
      driverRpc: new BackendDriverRpc(new Map([[backend, driver]])),
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
      codeReviewTools: {
        createReviewToolContext: (agentId, _sessionId, handlers) => {
          activeHandlers = handlers;
          return { id: `context-${++context}`, url: `http://review.test/mcp?agentId=${agentId}&reviewContextId=${context}` };
        },
        closeReviewToolContext: vi.fn(() => { activeHandlers = null; }),
      },
    });

    const started = await request(server, backendMethods.agentCodeReviewStart, {
      agentId: owner.id,
      input: { scope: { type: 'uncommitted' }, threadMode: 'independent', backend, model: 'review-model', reasoningEffort: 'low', instructions: 'Focus on permission boundaries.' },
    });
    const reviewer = snapshot.agents.find((candidate) => candidate.id !== owner.id)!;
    await vi.waitFor(() => expect(reviewer.codeReview?.status).toBe('ready'));
    const session = reviewer.codeReview!;
    expect(forkWorktreeConversation).not.toHaveBeenCalled();
    expect(reviewer.delegationContext).toBeUndefined();
    expect(runCodeReview.mock.calls[0]?.[1].reviewerSession).toBeUndefined();
    expect(runCodeReview.mock.calls[0]?.[1].prompt).not.toContain(snapshot.general.worktreeDelegationInstructions);
    expect(started.activeAgentId).toBe(reviewer.id);
    expect(session).toMatchObject({ targetAgentId: owner.id, reviewerAgentId: reviewer.id, threadMode: 'independent' });
    expect(reviewer).toMatchObject({
      folder: owner.folder,
      backend,
      backendDefaults: { kind: backend, model: 'review-model', ...(backend === 'antigravity' ? {} : { reasoningEffort: 'low' }) },
      teamId: owner.teamId,
    });
    expect(snapshot.agentGitStatuses[reviewer.id]).toStrictEqual(snapshot.agentGitStatuses[owner.id]);
    expect(owner.backendDefaults).toMatchObject({ model: 'gpt-5.6-sol', reasoningEffort: 'high' });
    expect(snapshot.general.codeReviewDefaults?.providers[backend]).toStrictEqual({ model: 'review-model', ...(backend === 'antigravity' ? {} : { reasoningEffort: 'low' }) });
    if (backend === 'antigravity') expect(reviewer.backendDefaults?.reasoningEffort).toBeUndefined();
    const round = session.rounds[0]!;
    expect(runCodeReview).toHaveBeenNthCalledWith(1, reviewer, expect.objectContaining({
      reviewMcpServerUrl: expect.stringContaining('reviewContextId=1'),
      prompt: expect.stringContaining('Focus on permission boundaries.'),
    }));

    await request(server, backendMethods.agentCodeReviewFindingDecide, {
      agentId: reviewer.id,
      input: { sessionId: session.id, roundId: round.id, findingId, decision: 'select' },
    });
    await request(server, backendMethods.agentCodeReviewRoundSubmit, { agentId: reviewer.id, sessionId: session.id });
    await vi.waitFor(() => expect(session.status).toBe('readyToFinish'));

    expect(runCodeReview).toHaveBeenNthCalledWith(2, reviewer, expect.objectContaining({
      reviewerSession: backend === 'codex' ? { kind: 'codex', threadId: 'review-thread-1' }
        : backend === 'claude' ? { kind: 'claude', sessionId: 'review-thread-1', transport: 'stdio' } : { kind: 'antigravity', sessionId: 'review-thread-1' },
    }));
    expect(round.findings[0]!.remediation.state).toBe('fixed');

    await request(server, backendMethods.agentCodeReviewAgain, { agentId: reviewer.id, sessionId: session.id });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    expect(session.rounds).toHaveLength(2);
    expect(disposeCodeReview).not.toHaveBeenCalled();
    expect(round.reviewerSession).toBeDefined();
    expect(saveCodeReviewReport).toHaveBeenCalledOnce();
    expect(saveCodeReviewReport.mock.invocationCallOrder[0]).toBeLessThan(releaseConversation.mock.invocationCallOrder[0]!);
    expect(releaseConversation).toHaveBeenCalledExactlyOnceWith(reviewer.id);
    expect(runCodeReview.mock.calls[2]?.[1]).not.toHaveProperty('reviewerSession');
    await request(server, backendMethods.agentCodeReviewRoundSubmit, { agentId: reviewer.id, sessionId: session.id });
    const finished = await request(server, backendMethods.agentCodeReviewFinish, { agentId: reviewer.id, sessionId: session.id });
    expect(snapshot.agents).toStrictEqual([owner]);
    expect(snapshot.agentGitStatuses[reviewer.id]).toBeUndefined();
    expect(disposeCodeReview).not.toHaveBeenCalled();
    expect(archiveAgentConversation).toHaveBeenCalledTimes(backend === 'codex' ? 2 : 0);
    expect(saveCodeReviewReport).toHaveBeenCalledTimes(2);
    expect(releaseConversation).toHaveBeenCalledTimes(2);
    expect(finished.activeAgentId).toBe(owner.id);
    expect(sendAgentMessage).toHaveBeenCalledExactlyOnceWith(
      reviewer.id,
      owner.id,
      expect.stringContaining('- P1 — Authorize before writing'),
    );
    expect(sendAgentMessage.mock.calls[0]?.[2]).toContain('/reports/review.md');

    await server.close();
  });

  it.each([
    { phase: 'remediation', completion: 'reject', order: 'before' },
    { phase: 'inspection', completion: 'resolve', order: 'before' },
    { phase: 'inspection', completion: 'reject', order: 'before' },
    { phase: 'inspection', completion: 'resolve', order: 'after' },
    { phase: 'inspection', completion: 'reject', order: 'after' },
    { phase: 'inspection', completion: 'confirmed', order: 'before' },
  ] as const)('handles a $phase stop when the provider $completion happens $order the interrupt response', async ({ phase, completion, order }) => {
    const snapshot = createTestSnapshot();
    const owner: Agent = {
      id: 'agent-owner', teamId: snapshot.teams[0]!.id, name: 'Owner', folder: '/repo',
      backend: 'codex', status: { type: 'idle' },
      createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T10:00:00.000Z',
    };
    snapshot.agents.push(owner);
    snapshot.teams[0]!.agentIds.push(owner.id);
    let activeHandlers: ReviewToolHandlers | null = null;
    let findingId = '';
    let settleTurn!: () => Promise<void>;
    const interruptedTurn = new Promise<BackendCodeReviewResult>((resolve, reject) => {
      settleTurn = async () => {
        if (completion === 'confirmed') await activeHandlers!.finishReviewRound({ findingCount: 1 });
        if (completion === 'reject') reject(new Error('Provider turn cancelled.'));
        else resolve({ text: 'Inspection response.', reviewerSession: { kind: 'codex', threadId: 'review-thread' } });
      };
    });
    const runCodeReview = vi.fn(async (_agent: Agent, input: Parameters<NonNullable<AgentBackendDriver['runCodeReview']>>[1]) => {
      if (!activeHandlers) throw new Error('Missing review tool context.');
      if (!findingId) {
        findingId = (await activeHandlers.reportFinding({
          priority: 'p1', title: 'Authorize before writing',
          body: 'The public mutation writes before checking ownership.',
        })).id;
        if (phase === 'inspection') return interruptedTurn;
        await activeHandlers.finishReviewRound({ findingCount: 1 });
        return {
          text: '',
          reviewerSession: { kind: 'codex' as const, threadId: 'review-thread' },
        };
      }
      return interruptedTurn;
    });
    const interrupt = vi.fn(async (agent: Agent) => {
      if (order === 'before') {
        await settleTurn();
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      return {
        backendSession: agent.backendSession ?? { kind: 'codex' as const, threadId: 'review-thread' },
      };
    });
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      runCodeReview,
      sendPrompt: vi.fn(),
      interrupt,
      respondToAgentRequest: vi.fn(),
      onEvent: () => () => undefined,
      close: vi.fn(),
    };
    const server = new AppBackendServer({
      version: 'test', snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
      codeReviewTools: {
        createReviewToolContext: (_agentId, _sessionId, handlers) => {
          activeHandlers = handlers;
          return { id: 'review-context', url: 'http://review.test/mcp?reviewContextId=review-context' };
        },
        closeReviewToolContext: vi.fn(),
      },
    });

    await request(server, backendMethods.agentCodeReviewStart, {
      agentId: owner.id,
      input: { scope: { type: 'uncommitted' }, threadMode: 'independent' },
    });
    const reviewer = snapshot.agents.find((candidate) => candidate.id !== owner.id)!;
    await vi.waitFor(() => expect(reviewer.codeReview?.rounds[0]?.findings).toHaveLength(1));
    const session = reviewer.codeReview!;
    const round = session.rounds[0]!;
    if (phase === 'remediation') {
      await vi.waitFor(() => expect(session.status).toBe('ready'));
      await request(server, backendMethods.agentCodeReviewRoundSubmit, {
        agentId: reviewer.id,
        sessionId: session.id,
      });
      await vi.waitFor(() => expect(round.findings[0]?.remediation.state).toBe('fixing'));
    }
    const findingsBeforeStop = structuredClone(round.findings);

    await request(server, backendMethods.agentInterrupt, { agentId: reviewer.id });
    if (order === 'after') await settleTurn();
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(interrupt).toHaveBeenCalledWith(reviewer);
    expect(reviewer.codeReview).toBe(session);
    if (phase === 'inspection' && completion !== 'confirmed') {
      expect(session.status).toBe('failed');
      expect(round).toMatchObject({ status: 'failed', error: 'Review stopped. Retry to complete the inspection.' });
      expect(round.findings).toStrictEqual(findingsBeforeStop);
      expect(round.completedAt).toBeDefined();
    } else {
      expect(session.status).toBe('ready');
      expect(round).toMatchObject({ status: 'ready' });
      expect(round).not.toHaveProperty('error');
      if (completion === 'confirmed') expect(round.findings).toStrictEqual(findingsBeforeStop);
    }
    expect(round.findings[0]?.decision.state).toBe('selected');
    expect(round.findings[0]?.remediation).toStrictEqual({ state: 'notStarted' });
    await server.close();
  });

  it('closes the review tool context when its visible reviewer is deleted normally', async () => {
    let reviewTools!: ReviewToolHandlers;
    const snapshot = createTestSnapshot();
    const owner: Agent = {
      id: 'agent-owner', teamId: snapshot.teams[0]!.id, name: 'Owner', folder: '/repo',
      backend: 'codex', status: { type: 'idle' },
      createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T10:00:00.000Z',
    };
    snapshot.agents.push(owner);
    snapshot.teams[0]!.agentIds.push(owner.id);
    const releaseConversation = vi.fn();
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      runCodeReview: vi.fn(async (_agent, input) => {
        await reviewTools.finishReviewRound({ findingCount: 0 });
        return { text: '', reviewerSession: input.reviewerSession ?? { kind: 'codex', threadId: 'review-thread' } };
      }),
      archiveAgentConversation: vi.fn().mockResolvedValue(undefined),
      releaseConversation,
      sendPrompt: vi.fn(),
      interrupt: vi.fn(),
      respondToAgentRequest: vi.fn(),
      onEvent: () => () => undefined,
      close: vi.fn(),
    };
    const closeReviewToolContext = vi.fn();
    const server = new AppBackendServer({
      version: 'test', snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
      saveSnapshot: vi.fn().mockResolvedValue(undefined),
      codeReviewTools: {
        createReviewToolContext: (_agentId, _sessionId, handlers) => {
          reviewTools = handlers;
          return { id: 'review-context', url: 'http://review.test/mcp' };
        },
        closeReviewToolContext,
      },
    });

    await request(server, backendMethods.agentCodeReviewStart, {
      agentId: owner.id,
      input: { scope: { type: 'uncommitted' }, threadMode: 'independent' },
    });
    const reviewer = snapshot.agents.find((candidate) => candidate.id !== owner.id)!;
    await vi.waitFor(() => expect(reviewer.codeReview?.status).toBe('ready'));

    await request(server, backendMethods.agentDelete, { agentId: reviewer.id });

    expect(closeReviewToolContext).toHaveBeenCalledExactlyOnceWith('review-context');
    expect(snapshot.agents).toStrictEqual([owner]);
    expect(releaseConversation).toHaveBeenCalledWith(reviewer.id);
    await server.close();
  });
});

async function request(server: AppBackendServer, method: string, params: unknown): Promise<import('@workspace/core/contracts').AppSnapshot> {
  const response = await server.handleMessage({ jsonrpc: '2.0', id: method, method, params });
  expect(response).toHaveProperty('result');
  return (response as { result: import('@workspace/core/contracts').AppSnapshot }).result;
}
