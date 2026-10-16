import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentWorkspaceService } from '../../document-workspace-service';
import { product } from '@workspace/core/product';
import { createMobileSimulatorToolModuleProvider } from '../mobile-simulator-tools';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { Agent, AppSnapshot, BackendPublishedEvent } from '@workspace/core/contracts';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import { createQuickChatInSnapshot } from '@workspace/core/agent-manager';
import { projectWorkspaceSidebar } from '@workspace/core/workspace-sidebar';
import { BackendDriverRpc } from '../../driver-rpc';
import { VisualizeService } from '../../visualize-service';
import { WorktreeManager } from '../../worktrees/worktree-manager';
import { AppMcpService } from '../service';
import { HostedMcpGateway } from '../hosted-mcp-gateway';
import { structuredToolResult } from '../tool-result';
import { createVisualizeToolModuleProvider } from '../visualize-tools';
import { CodeReviewService } from '../../review/code-review-service';
import { DurableTaskService } from '../../agents/durable-task-service';
import { AgentCreationService } from '../../agents/agent-creation-service';
import { sendAgentPrompt } from '@workspace/core/agent-chat-service';


describe('AppMcpService', () => {
  let service: AppMcpService | null = null;

  afterEach(async () => {
    await service?.stop();
    service = null;
    vi.restoreAllMocks();
  });

  it('chooses celebration effects itself without consecutive repeats and accepts only a boolean request', async () => {
    const events: BackendEvent[] = [];
    service = new AppMcpService({ snapshot: createInitialSnapshot(), onEvent: event => events.push(event) });
    const url = await service.start();
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0.99);
    for (const kind of ['confetti', 'stars', 'schoolPride']) {
      const response = await callTool(url, 'agent-dina', 'finish_turn', { celebration: true });
      expect(response.result.structuredContent).toMatchObject({ celebration: { requested: true, kind } });
      expect(events.at(-1)).toMatchObject({ type: 'client.celebrationRequested', agentId: 'agent-dina', payload: { kind } });
    }
    events.length = 0;
    for (const input of [{}, { celebration: false }]) {
      const response = await callTool(url, 'agent-dina', 'finish_turn', input);
      expect(response.result.structuredContent).toStrictEqual({ success: true, status: null });
    }
    expect(events.some(event => event.type === 'client.celebrationRequested')).toBe(false);
    const invalid = await callTool(url, 'agent-dina', 'finish_turn', { celebration: { kind: 'stars' } });
    expect(invalid.result.isError).toBe(true);
  });

  it('loads bundled skills over authenticated MCP without filesystem access and rechecks feature enablement', async () => {
    const snapshot = createInitialSnapshot();
    let enabled = false;
    const execute = vi.fn();
    service = new AppMcpService({ snapshot, computerUseEnabled: () => enabled,
      computerUse: { execute, status: vi.fn(), stop: vi.fn(), requestAccessibility: vi.fn() } });
    const url = await service.start();
    const read = (name: string) => callTool(url, 'agent-dina', 'read-skill', { name });
    const html = (await read('korus-inline-html')).result;
    expect(html).toMatchObject({ isError: false, structuredContent: { name: 'korus-inline-html', loaded: true } });
    expect(html.content[0].text).toMatch(/^<artifact title="[^"]+">\n<!doctype html><html>[\s\S]*?<\/html>\n<\/artifact>$/m);
    for (const name of ['../../settings.json', '/etc/passwd', 'missing', 'korus-computer-use', 'mission-review']) {
      expect((await read(name)).result.isError).toBe(true);
    }
    enabled = true;
    expect((await read('korus-computer-use')).result).toMatchObject({
      isError: false, content: [{ type: 'text', text: expect.stringContaining('computer-use-list-windows') }],
    });
    enabled = false;
    expect((await read('korus-computer-use')).result.isError).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('loads workflow procedures only when the caller has the corresponding tool family', async () => {
    const snapshot = createInitialSnapshot();
    const owner = snapshot.agents[0]!;
    const browser = { open: vi.fn(), execute: vi.fn() };
    const simulator = vi.fn();
    service = new AppMcpService({ snapshot, browser, persistSnapshot: vi.fn(),
      startAutomaticReview: vi.fn(),
      toolModuleProviders: [createMobileSimulatorToolModuleProvider(simulator)] });
    const url = await service.start();
    for (const name of ['korus-delegation', 'korus-browser', 'korus-simulator', 'korus-automations', 'korus-review-launch']) {
      const result = (await callTool(url, owner.id, 'read-skill', { name })).result;
      expect(result).toMatchObject({ isError: false, structuredContent: { name, loaded: true } });
      expect(result.content[0].text).not.toMatch(/\{\{(?:productName|mcpServerName)\}\}/);
    }
    expect(browser.open).not.toHaveBeenCalled();
    expect(simulator).not.toHaveBeenCalled();

    owner.sessionKind = 'quickChat';
    expect((await callTool(url, owner.id, 'read-skill', { name: 'korus-review-launch' })).result.isError).toBe(true);
    expect((await callTool(url, owner.id, 'read-skill', { name: 'korus-automations' })).result.isError).toBe(false);
    owner.sessionKind = undefined;

    const context = service.createReviewToolContext(owner.id, 'review-skill-context', {
      finishReviewRound: vi.fn(), reportFinding: vi.fn(), updateFinding: vi.fn(), deleteFinding: vi.fn(),
    });
    const readReview = async (contextUrl: string) => (await postJson(contextUrl, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'read-skill', arguments: { name: 'korus-reviewer' } },
    })).result;
    expect((await readReview(`${url}?agentId=${owner.id}`)).isError).toBe(true);
    expect(await readReview(context.url)).toMatchObject({ isError: false, structuredContent: { name: 'korus-reviewer', loaded: true } });
    const otherUrl = new URL(context.url);
    otherUrl.searchParams.set('agentId', snapshot.agents[1]!.id);
    expect((await readReview(otherUrl.toString())).isError).toBe(true);
    service.closeReviewToolContext(context.id);
    expect((await readReview(context.url)).isError).toBe(true);
  });

  it('does not serve procedures for absent desktop or scheduling adapters', async () => {
    const snapshot = createInitialSnapshot();
    service = new AppMcpService({ snapshot });
    const url = await service.start();
    for (const name of ['korus-browser', 'korus-simulator', 'korus-automations', 'korus-review-launch']) {
      expect((await callTool(url, snapshot.agents[0]!.id, 'read-skill', { name })).result.isError).toBe(true);
    }
  });

  it('returns recoverable round-count errors over MCP and persists an accepted inspection', async () => {
    const snapshot = createInitialSnapshot();
    const owner = snapshot.agents[0]!;
    service = new AppMcpService({ snapshot });
    await service.start();
    let saved: AppSnapshot | undefined;
    let sequence = 0;
    const reviewService = new CodeReviewService({
      snapshot,
      createAgent: (input, options) => new AgentCreationService(snapshot).create(input, options),
      tools: service,
      changed: () => { saved = structuredClone(snapshot); },
      resetReviewer: vi.fn(), deleteReviewer: vi.fn(), saveReport: vi.fn(),
      runReview: async (_agent, _prompt, url) => {
        const call = async (name: string, args: Record<string, unknown>) => (await postJson(url, {
          jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: { name, arguments: args },
        })).result;
        for (const input of [{}, { findingCount: -1 }, { findingCount: 1.5 }, { findingCount: '2' }]) {
          expect((await call('finish_review_round', input)).isError).toBe(true);
        }
        const mismatch = await call('finish_review_round', { findingCount: 2 });
        expect(mismatch.isError).toBe(true);
        expect(mismatch.content[0].text).toContain('2 findings, but 0');
        expect(mismatch.content[0].text).toContain('report_finding');
        const first = await call('report_finding', { priority: 'p1', title: 'Authorize writes', body: 'Ownership is unchecked.' });
        await call('report_finding', { priority: 'p1', title: 'Authorize writes', body: 'More precise evidence.', priorFindingId: first.structuredContent.id });
        await call('report_finding', { priority: 'p3', title: 'Improve diagnostics', body: 'A diagnostic is misleading.' });
        const accepted = await call('finish_review_round', { findingCount: 2 });
        expect(accepted).toMatchObject({ isError: false, structuredContent: { findingCount: 2 } });
        expect(saved?.agents.find(agent => agent.id === owner.id)?.codeReview).toMatchObject({
          status: 'reviewing', rounds: [{ inspectionCompletion: { findingCount: 2 } }],
        });
        return { text: 'Two findings registered.', reviewerSession: { kind: 'codex', threadId: 'review-thread' } };
      },
    });
    owner.backendSession = { kind: 'codex', threadId: 'review-thread' };
    const session = reviewService.start(owner, { scope: { type: 'uncommitted' }, threadMode: 'current' });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    expect(session.rounds[0]?.findings.map(finding => finding.priority)).toEqual(['p1', 'p3']);
    expect(session.rounds[0]?.inspectionCompletion?.findingCount).toBe(2);
  });

  it('offers create-project only to Quick Chats and routes the handoff through the shared project operation', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    createQuickChatInSnapshot(snapshot, { teamId: 'team-app' }, undefined, 'agent-quick-chat', { select: false });
    const createProject = vi.fn().mockResolvedValue({
      repository: { name: 'new-product', path: '/src/new-product', worktrees: [] },
      agent: { ...snapshot.agents[0], id: 'agent-project', name: null, folder: '/src/new-product' },
      promptSubmitted: true,
    });
    service = new AppMcpService({ snapshot, createProject });
    const url = await service.start();

    const ordinaryTools = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    });
    const quickChatTools = await postJson(agentUrl(url, 'agent-quick-chat'), {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });
    expect(ordinaryTools.result.tools.map((tool: { name: string }) => tool.name)).not.toContain('create-project');
    expect(quickChatTools.result.tools.map((tool: { name: string }) => tool.name)).toContain('create-project');

    const result = await callTool(url, 'agent-quick-chat', 'create-project', {
      name: 'new-product', prompt: 'Build the agreed product and start with the requirements.', backend: 'claude',
    });
    expect(createProject).toHaveBeenCalledWith(
      'agent-quick-chat', 'new-product', 'Build the agreed product and start with the requirements.',
      'claude',
    );
    expect(result.result.structuredContent).toStrictEqual({
      success: true,
      agentId: 'agent-project',
      agentName: 'new-product',
      folder: '/src/new-product',
      promptSubmitted: true,
      message: 'Created new-product and started its project agent.',
    });
  });

  it('serializes an explicit null when set-status clears the current text', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const events: unknown[] = [];
    service = new AppMcpService({ snapshot, onEvent: (event) => events.push(event) });
    const url = await service.start();

    const response = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'set-status', arguments: { status: '' } },
    });

    expect(response.result.isError).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      agentId: 'agent-dina',
      type: 'agent.updated',
      payload: expect.objectContaining({ statusText: null }),
    }));
  });

  it('clears the current status when the agent turn ends', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const events: any[] = [];
    service = new AppMcpService({ snapshot, onEvent: (event) => events.push(event) });
    const url = await service.start();

    await callTool(url, 'agent-dina', 'set-status', { status: 'Running verification' });
    expect(snapshot.agents[0]!.statusText).toBe('Running verification');
    sendAgentPrompt(snapshot, createDriver({ sendPrompt: vi.fn().mockResolvedValue({ backendSession: { kind: 'codex', threadId: 'thread-dina' }, turnId: 'turn-1' }) }), 'agent-dina', 'Delegate this task', { delegation: { startingContext: 'conversation', instructions: 'Do not run tests.' } }, vi.fn());
    await new Promise(resolve => setImmediate(resolve));

    service.handleBackendEvent({
      seq: 1,
      occurredAt: '2026-08-02T00:00:00.000Z',
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-dina',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 1,
        event: {
          seq: 1,
          occurredAt: '2026-08-02T00:00:00.000Z',
          origin: 'notification',
          conversationId: 'thread-dina',
          turnId: 'turn-1',
          type: 'turn.completed',
          payload: { status: 'completed' },
        },
      },
    } as BackendPublishedEvent);

    expect(snapshot.agents[0]!.statusText).toBeUndefined();
    expect(snapshot.agents[0]!.userDelegationOverrides).toBeUndefined();
    expect(events.at(-1)).toEqual(expect.objectContaining({
      agentId: 'agent-dina',
      type: 'agent.updated',
      payload: expect.objectContaining({ statusText: null }),
    }));
  });

  it('retains newer delegation controls through older and wrong-conversation terminals, including pending admission', async () => {
    const snapshot = createInitialSnapshot();
    const parent = snapshot.agents[0]!;
    parent.backendSession = { kind: 'codex', threadId: 'thread-dina' };
    let accept!: (result: import('@workspace/core/backend-driver').BackendSendResult) => void;
    const receipt = new Promise<import('@workspace/core/backend-driver').BackendSendResult>(resolve => { accept = resolve; });
    service = new AppMcpService({ snapshot });
    sendAgentPrompt(snapshot, createDriver({ sendPrompt: vi.fn(() => receipt) }), parent.id, 'Delegate B', { delegation: { startingContext: 'handoff', instructions: 'Keep B local.' } }, vi.fn());
    const terminal = (turnId: string, conversationId = 'thread-dina') => service!.handleBackendEvent({
      seq: 1, occurredAt: '', agentId: parent.id, backend: 'codex', threadId: conversationId,
      type: 'codex.conversationEventReceived', payload: { revision: 1, event: {
        seq: 1, occurredAt: '', origin: 'notification', conversationId, turnId, type: 'turn.completed', payload: { status: 'completed' },
      } },
    } as BackendPublishedEvent);
    terminal('turn-A');
    expect(parent.userDelegationOverrides?.instructions).toBe('Keep B local.');
    accept({ backendSession: { kind: 'codex', threadId: 'thread-dina' }, turnId: 'turn-B' });
    await new Promise(resolve => setImmediate(resolve));
    terminal('turn-A');
    terminal('turn-B', 'other-thread');
    expect(parent.userDelegationOverrides?.instructions).toBe('Keep B local.');
    terminal('turn-B');
    expect(parent.userDelegationOverrides).toBeUndefined();
  });

  it('clears delegation controls when their own terminal precedes the admission receipt', async () => {
    const snapshot = createInitialSnapshot();
    const parent = snapshot.agents[0]!;
    let accept!: (result: import('@workspace/core/backend-driver').BackendSendResult) => void;
    const receipt = new Promise<import('@workspace/core/backend-driver').BackendSendResult>(resolve => { accept = resolve; });
    service = new AppMcpService({ snapshot });
    sendAgentPrompt(snapshot, createDriver({ sendPrompt: vi.fn(() => receipt) }), parent.id, 'Delegate', { delegation: { startingContext: 'handoff' } }, vi.fn());
    service.handleBackendEvent({ seq: 1, occurredAt: '', agentId: parent.id, backend: 'codex', threadId: 'thread-dina', type: 'codex.conversationEventReceived', payload: { revision: 1, event: {
      seq: 1, occurredAt: '', origin: 'notification', conversationId: 'thread-dina', turnId: 'turn-B', type: 'turn.completed', payload: { status: 'interrupted' },
    } } } as BackendPublishedEvent);
    accept({ backendSession: { kind: 'codex', threadId: 'thread-dina' }, turnId: 'turn-B' });
    await new Promise(resolve => setImmediate(resolve));
    expect(parent.userDelegationOverrides).toBeUndefined();
  });

  it.each(['claude', 'antigravity'] as const)('binds and clears %s controls using the owning host session identity', async backend => {
    const snapshot = createInitialSnapshot();
    const parent = snapshot.agents[0]!;
    parent.backend = backend;
    const backendSession = backend === 'claude'
      ? { kind: 'claude' as const, sessionId: 'native-session', transport: 'stdio' as const }
      : { kind: 'antigravity' as const, sessionId: 'native-session' };
    service = new AppMcpService({ snapshot });
    sendAgentPrompt(snapshot, createDriver({ backend, sendPrompt: vi.fn().mockResolvedValue({ backendSession, turnId: 'native-turn' }) }), parent.id, 'Delegate', { delegation: { startingContext: 'handoff', instructions: 'Native provider directions' } }, vi.fn());
    await new Promise(resolve => setImmediate(resolve));
    const terminal = (sessionId: string) => service!.handleBackendEvent({
      seq: 1, occurredAt: '', agentId: parent.id, backend, conversationId: 'newer-envelope-session',
      type: `${backend}.conversationEventReceived`, payload: { revision: 1, event: {
        seq: 1, occurredAt: '', agentId: parent.id, backend, turnId: 'native-turn', type: 'turn.completed',
        ...(backend === 'claude' ? { backendSessionId: sessionId, payload: { status: 'completed' } }
          : { sessionId, payload: { turn: { id: 'native-turn', status: 'completed' } } }),
      } },
    } as BackendPublishedEvent);
    terminal('different-native-session');
    expect(parent.userDelegationOverrides?.instructions).toBe('Native provider directions');
    terminal('native-session');
    expect(parent.userDelegationOverrides).toBeUndefined();
  });

  it('finishes turns by clearing status and replacing the proposed action in one update', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const events: any[] = [];
    service = new AppMcpService({ snapshot, onEvent: (event) => events.push(event) });
    const url = await service.start();

    await callTool(url, 'agent-dina', 'set-status', { status: 'Considering delegation' });
    const delegated = await callTool(url, 'agent-dina', 'finish_turn', {
      flag: 'delegate_to_worktree',
    });
    expect(delegated.result.structuredContent).toStrictEqual({
      success: true, status: null, flag: 'delegate_to_worktree',
    });
    expect(snapshot.agents[0]!.statusText).toBeUndefined();
    expect(snapshot.agents[0]!.threadFlags).toStrictEqual({ delegate_to_worktree: true });
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'agent.updated',
      payload: expect.objectContaining({
        statusText: null,
        threadFlags: { delegate_to_worktree: true },
      }),
    }));

    await callTool(url, 'agent-dina', 'set-status', { status: 'Implementing here' });
    expect(snapshot.agents[0]!.threadFlags).toStrictEqual({ delegate_to_worktree: true });

    const plain = await callTool(url, 'agent-dina', 'finish_turn', {});
    expect(plain.result.structuredContent).toStrictEqual({
      success: true, status: null,
    });
    expect(snapshot.agents[0]!.statusText).toBeUndefined();
    expect(snapshot.agents[0]!.threadFlags).toStrictEqual({ delegate_to_worktree: true });
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'agent.updated',
      payload: expect.objectContaining({
        statusText: null,
        threadFlags: { delegate_to_worktree: true },
      }),
    }));
  });

  it('publishes a caller-scoped prompt suggestion and explicitly clears it when omitted', async () => {
    const snapshot = createInitialSnapshot();
    const events: BackendEvent[] = [];
    service = new AppMcpService({ snapshot, onEvent: event => events.push(event) });
    const url = await service.start();
    const result = await callTool(url, 'agent-dina', 'finish_turn', {
      suggestedPrompt: '  Add keyboard navigation  ',
    });
    expect(result.result.isError).not.toBe(true);
    expect(snapshot.agents[0]!.suggestedPrompt).toBe('Add keyboard navigation');
    expect(snapshot.agents[1]!.suggestedPrompt).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      agentId: 'agent-dina', type: 'agent.updated',
      payload: { suggestedPrompt: 'Add keyboard navigation' },
    });
    await callTool(url, 'agent-dina', 'finish_turn', {});
    expect(snapshot.agents[0]!.suggestedPrompt).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ payload: { suggestedPrompt: null } });
  });

  it('adds only model-owned finding actions to a scoped review context', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    service = new AppMcpService({ snapshot });
    const ordinaryUrl = await service.start();
    const reportFinding = vi.fn().mockResolvedValue({ id: 'finding-1' });
    const updateFinding = vi.fn().mockResolvedValue({ id: 'finding-1', status: 'fixed' });
    const deleteFinding = vi.fn().mockResolvedValue({ findingId: 'finding-1', deleted: true });
    const review = service.createReviewToolContext('agent-dina', 'review-session-1', {
      finishReviewRound: vi.fn().mockResolvedValue({ roundId: 'round-1', findingCount: 0 }),
      reportFinding,
      updateFinding,
      deleteFinding,
    });

    const ordinary = await postJson(agentUrl(ordinaryUrl, 'agent-dina'), {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    });
    const scoped = await postJson(review.url, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });
    const ordinaryNames = ordinary.result.tools.map((tool: { name: string }) => tool.name);
    const scopedNames = scoped.result.tools.map((tool: { name: string }) => tool.name);

    expect(ordinaryNames).not.toEqual(expect.arrayContaining([
      'report_finding', 'update_finding', 'delete_finding', 'finish_review_round',
    ]));
    expect(scopedNames).toEqual(expect.arrayContaining([
      'report_finding', 'update_finding', 'delete_finding', 'finish_review_round',
    ]));
    expect(scopedNames).not.toContain('mark_finding_complete');
    expect(scopedNames).not.toEqual(expect.arrayContaining([
      'verify_finding', 'respond_to_finding', 'complete_review',
    ]));
    const reportTool = scoped.result.tools.find((tool: { name: string }) => tool.name === 'report_finding');
    expect(reportTool.inputSchema.properties.priority.description).toContain('P0: drop everything');
    expect(reportTool.inputSchema.properties.priority.description).toContain('P1: urgent');
    expect(reportTool.inputSchema.properties.priority.description).toContain('P2: normal');
    expect(reportTool.inputSchema.properties.priority.description).toContain('P3: low');
    const updateTool = scoped.result.tools.find((tool: { name: string }) => tool.name === 'update_finding');
    expect(updateTool.inputSchema.properties.status.const).toBe('fixed');

    const called = await postJson(review.url, {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
        name: 'report_finding',
        arguments: {
          priority: 'p1', title: 'Authorize before writing',
          body: 'The mutation writes before checking ownership.',
        },
      },
    });
    expect(called.result.isError).toBe(false);
    expect(reportFinding).toHaveBeenCalledOnce();

    const verbose = await postJson(review.url, {
      jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
        name: 'report_finding',
        arguments: {
          priority: 'p2', title: 'x'.repeat(81), body: 'This title is too long.',
        },
      },
    });
    expect(verbose.result.isError).toBe(true);
    expect(reportFinding).toHaveBeenCalledOnce();

    const updated = await postJson(review.url, {
      jsonrpc: '2.0', id: 5, method: 'tools/call', params: {
        name: 'update_finding',
        arguments: {
          findingId: 'finding-1', status: 'fixed', evidence: 'Focused test passes.',
        },
      },
    });
    expect(updated.result.isError).toBe(false);
    expect(updateFinding).toHaveBeenCalledWith({
      findingId: 'finding-1', status: 'fixed', evidence: 'Focused test passes.',
    });

    const deleted = await postJson(review.url, {
      jsonrpc: '2.0', id: 6, method: 'tools/call', params: {
        name: 'delete_finding', arguments: { findingId: 'finding-1' },
      },
    });
    expect(deleted.result.isError).toBe(false);
    expect(deleteFinding).toHaveBeenCalledWith({ findingId: 'finding-1' });

    service.closeReviewToolContext(review.id);
  });

  it('serves health and debug routes while rejecting invalid HTTP and MCP requests', async () => {
    service = new AppMcpService({ snapshot: createInitialSnapshot() });
    const mcpUrl = await service.start();
    await expect(service.start()).resolves.toBe(mcpUrl);
    const origin = new URL(mcpUrl).origin;

    const health = await fetch(`${origin}/health`);
    expect(health.status).toBe(200);
    await expect(health.text()).resolves.toBe('OK');
    const debug = await fetch(`${origin}/`);
    expect(debug.status).toBe(200);
    await expect(debug.json()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-dina' }),
    ]));
    await expect(fetch(mcpUrl)).resolves.toMatchObject({ status: 405 });
    await expect(fetch(mcpUrl, { method: 'DELETE' })).resolves.toMatchObject({ status: 405 });
    await expect(fetch(`${origin}/missing`)).resolves.toMatchObject({ status: 404 });

    const missingIdentity = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(missingIdentity.status).toBe(400);
    const invalidRequest = await fetch(agentUrl(mcpUrl, 'agent-dina'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} }),
    });
    expect(invalidRequest.status).toBe(400);
    const malformedJson = await fetch(agentUrl(mcpUrl, 'agent-dina'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(malformedJson.status).toBe(500);
    const oversized = await fetch(agentUrl(mcpUrl, 'agent-dina'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(1024 * 1024) }),
    });
    expect(oversized.status).toBe(500);

    await service.stop();
    await service.stop();
    service = null;
  });

  it('proxies hosted GitHub MCP traffic without exposing the shared credential', async () => {
    const fetchUpstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
      {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'github-session' },
      },
    ));
    const hostedMcpGateway = new HostedMcpGateway({
      credentials: {
        isHostedMcpConnected: provider => provider === 'github',
        authorizationHeader: vi.fn().mockResolvedValue('bearer ghu_secret'),
      },
      fetch: fetchUpstream,
    });
    service = new AppMcpService({ snapshot: createInitialSnapshot(), hostedMcpGateway });
    const mcpUrl = await service.start();
    expect(service.hostedMcpServerUrls()).toStrictEqual({
      github: `${new URL(mcpUrl).origin}/mcp/providers/github`,
    });

    const providerUrl = `${service.hostedMcpServerUrls().github}?agentId=agent-dina`;
    const response = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer client-value',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toBe('github-session');
    await expect(response.json()).resolves.toMatchObject({ result: { tools: [] } });
    const upstreamHeaders = new Headers(fetchUpstream.mock.calls[0]?.[1]?.headers);
    expect(upstreamHeaders.get('authorization')).toBe('bearer ghu_secret');
    expect(upstreamHeaders.get('authorization')).not.toContain('client-value');
    await expect(fetch(`${service.hostedMcpServerUrls().github}`, { method: 'POST' })).resolves.toMatchObject({ status: 400 });
  });

  it(`serves ${product.name} collaboration tools from daemon and delivers teammate messages through backend drivers`, async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const events: unknown[] = [];
    const sendPrompt = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-jesse' },
      turnId: 'turn-jesse',
    });
    service = new AppMcpService({ snapshot, onEvent: (event) => events.push(event) });
    service.setDriverRpc(new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt })]])));
    const url = await service.start();
    const dinaUrl = agentUrl(url, 'agent-dina');

    const toolsResponse = await postJson(dinaUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    expect(toolsResponse.result.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining([
      'list-agents',
      'send-message',
      'check-messages',
      'broadcast-message',
      'set-status',
    ]));

    const sendMessageResponse = await postJson(dinaUrl, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'send-message',
        arguments: {
          to: 'agent-jesse',
          content: 'Can you review this branch?',
        },
      },
    });

    expect(sendMessageResponse.result.isError).toBe(false);
    expect(sendMessageResponse.result.structuredContent).toMatchObject({
      recipientId: 'agent-jesse',
      recipientName: 'Jesse',
    });
    expect(sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-jesse' }),
      expect.stringContaining('Can you review this branch?'),
      undefined,
    );
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'message.userSubmitted' }));
  });

  it('exposes mission tools only to the active mission worker over HTTP', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    let active = true;
    const onSetMissionTitle = vi.fn().mockResolvedValue({ success: true, title: 'Add team billing' });
    service = new AppMcpService({
      snapshot,
      missionTools: {
        contextForAgent: agentId => active && agentId === 'agent-dina'
          ? { missionId: 'mission-1', runId: 'run-1', stage: 'requirements' }
          : undefined,
        submitResult: vi.fn(),
        upsertTicket: vi.fn(),
        setTitle: onSetMissionTitle,
        attachRepository: vi.fn(),
        listArtifacts: vi.fn().mockReturnValue([]),
        readArtifact: vi.fn(),
        writeArtifact: vi.fn(),
        reportReviewFinding: vi.fn(),
        updateReviewFinding: vi.fn(),
      },
    });
    const url = await service.start();

    const workerTools = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    });
    const missionTools = ['set-mission-title', 'list-mission-artifacts', 'read-mission-artifact', 'write-mission-artifact', 'upsert-mission-ticket', 'submit-mission-result'];
    const workerToolNames = workerTools.result.tools.map((tool: { name: string }) => tool.name);
    expect((await callTool(url, 'agent-dina', 'read-skill', { name: 'mission-shape-requirements' })).result.isError).toBe(false);
    expect((await callTool(url, 'agent-dina', 'read-skill', { name: 'mission-review' })).result.isError).toBe(true);
    expect((await callTool(url, 'agent-jesse', 'read-skill', { name: 'mission-shape-requirements' })).result.isError).toBe(true);
    expect(workerToolNames).toEqual(expect.arrayContaining(missionTools));
    expect(workerToolNames).not.toContain('set-mission-execution-policy');
    expect(workerToolNames).toContain('finish_turn');
    const ordinaryTools = await postJson(agentUrl(url, 'agent-jesse'), {
      jsonrpc: '2.0', id: 3, method: 'tools/list', params: {},
    });
    const ordinaryToolNames = ordinaryTools.result.tools.map((tool: { name: string }) => tool.name);
    expect(ordinaryToolNames).not.toEqual(expect.arrayContaining(missionTools));
    expect(ordinaryToolNames).toContain('finish_turn');

    const renamed = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'set-mission-title', arguments: { title: 'Add team billing' } },
    });
    expect(renamed.result.structuredContent).toEqual({ success: true, title: 'Add team billing' });
    expect(onSetMissionTitle).toHaveBeenCalledWith('agent-dina', 'Add team billing');

    active = false;
    expect((await callTool(url, 'agent-dina', 'read-skill', { name: 'mission-shape-requirements' })).result.isError).toBe(true);
    const inactiveTools = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 5, method: 'tools/list', params: {},
    });
    expect(inactiveTools.result.tools.map((tool: { name: string }) => tool.name))
      .not.toEqual(expect.arrayContaining(missionTools));
  });

  it('attaches a mode-specific tool module through the service extension seam', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    service = new AppMcpService({
      snapshot,
      toolModuleProviders: [{
        id: 'design',
        resolve: ({ agentId }) => agentId === 'agent-dina' ? {
          id: 'design',
          register: server => server.registerTool('record-design-decision', {
            description: 'Record a decision in the active design.',
            inputSchema: {},
          }, () => structuredToolResult({ success: true })),
        } : undefined,
      }],
    });
    const url = await service.start();

    const designAgent = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    });
    const ordinaryAgent = await postJson(agentUrl(url, 'agent-jesse'), {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });

    expect(designAgent.result.tools.map((tool: { name: string }) => tool.name))
      .toContain('record-design-decision');
    expect(ordinaryAgent.result.tools.map((tool: { name: string }) => tool.name))
      .not.toContain('record-design-decision');
  });

  it('advertises Visualize tools before the pane opens while rejecting inactive calls', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const visualize = new VisualizeService({
      snapshot,
      generatedImagesRoot: process.cwd(),
      persist: async () => undefined,
      publish: () => undefined,
    });
    service = new AppMcpService({
      snapshot,
      toolModuleProviders: [createVisualizeToolModuleProvider(visualize)],
    });
    const url = await service.start();
    const callerUrl = agentUrl(url, 'agent-dina');
    const listTools = async () => postJson(callerUrl, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    });
    const publishSuggestion = async () => postJson(callerUrl, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'suggest-visualizations', arguments: {
        suggestions: [{ title: 'Flow', description: 'Show the workflow.' }],
      } },
    });

    const initial = await listTools();
    expect(initial.result.tools.map((tool: { name: string }) => tool.name))
      .toContain('suggest-visualizations');
    expect((await publishSuggestion()).result.isError).toBe(true);
    expect(snapshot.agents[0].visualize).toBeUndefined();

    await visualize.enter('agent-dina');
    const published = (await publishSuggestion()).result.structuredContent;
    expect(published).toMatchObject({
      success: true,
      suggestions: [{ title: 'Flow', description: 'Show the workflow.' }],
    });
    expect(snapshot.agents[0].visualize?.suggestions).toStrictEqual(published.suggestions);

    await visualize.setOpen('agent-dina', false);
    expect((await publishSuggestion()).result.isError).toBe(true);
    expect(snapshot.agents[0].visualize?.suggestions).toStrictEqual(published.suggestions);
  });

  it('exposes the same message delivery path to backend-owned debug fixtures', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const sendPrompt = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-jesse' },
      turnId: 'turn-jesse',
    });
    service = new AppMcpService({ snapshot });
    service.setDriverRpc(new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt })]])));

    service.sendMessage('agent-dina', 'agent-jesse', 'Debug menu delivery');

    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-jesse' }),
      expect.stringContaining('Debug menu delivery'),
      undefined,
    ));
  });

  it('queues teammate messages during the idle handoff boundary without starting another turn', async () => {
    const snapshot = createInitialSnapshot();
    const recipient = snapshot.agents.find(agent => agent.id === 'agent-jesse')!;
    recipient.status = { type: 'idle' };
    recipient.handoff = { operationId: 'handoff', backend: 'claude', sourceAgentId: recipient.id, sourceTitle: 'Jesse', sourceRef: { backend: 'codex', threadId: 'original' }, phase: 'closing' };
    const events: BackendEvent[] = [];
    const sendPrompt = vi.fn();
    service = new AppMcpService({ snapshot, onEvent: event => events.push(event) });
    service.setDriverRpc(new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt })]])));
    service.sendMessage('agent-dina', recipient.id, 'Keep this requirement.');
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
      agentId: recipient.id, type: 'agent.promptQueued',
      payload: expect.objectContaining({ text: expect.stringContaining('Keep this requirement.') }),
    })));
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('steers teammate messages into a recipient with an active turn', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const recipient = snapshot.agents.find((agent) => agent.id === 'agent-jesse')!;
    recipient.status = { type: 'working' };
    recipient.backendSession = { kind: 'codex', threadId: 'thread-jesse' };
    const events: any[] = [];
    const steerPrompt = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-jesse' },
      turnId: 'turn-active',
    });
    service = new AppMcpService({ snapshot, onEvent: (event) => events.push(event) });
    service.setDriverRpc(new BackendDriverRpc(new Map([['codex', createDriver({ steerPrompt })]])));
    const url = await service.start();

    await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'send-message', arguments: { to: 'agent-jesse', content: 'Check the failing test.' } },
    });

    await vi.waitFor(() => expect(steerPrompt).toHaveBeenCalledOnce());
    expect(steerPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-jesse' }),
      expect.stringContaining('Check the failing test.'),
    );
    expect(events.some((event) => event.type === 'agent.promptQueued')).toBe(false);
  });

  it('shows busy teammate messages in the backend-owned queue until it reports dequeue', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const recipient = snapshot.agents.find((agent) => agent.id === 'agent-jesse')!;
    recipient.status = { type: 'working' };
    const events: any[] = [];
    const sendPrompt = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-next' },
      turnId: 'turn-next',
    });
    service = new AppMcpService({ snapshot, onEvent: (event) => events.push(event) });
    service.setDriverRpc(new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt })]])));
    const url = await service.start();

    await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'send-message', arguments: { to: 'agent-jesse', content: 'Run this next.' } },
    });

    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
      agentId: 'agent-jesse',
      type: 'agent.promptQueued',
      payload: expect.objectContaining({
        text: expect.stringContaining('Run this next.'),
      }),
    })));
    expect(sendPrompt).not.toHaveBeenCalled();

    const queuedEvent = events.find((event) => event.type === 'agent.promptQueued');
    const queuedMessageId = queuedEvent?.payload?.id as string;
    service.handleBackendEvent({
      seq: 1,
      agentId: 'agent-jesse',
      type: 'agent.promptDequeued',
      payload: { ids: [queuedMessageId] },
      occurredAt: '2026-08-02T00:00:00.000Z',
    });
    expect(sendPrompt).not.toHaveBeenCalled();

    recipient.status = { type: 'idle' };
    await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'send-message', arguments: { to: 'agent-jesse', content: 'Only this remains.' } },
    });
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledOnce());
    expect(sendPrompt.mock.calls[0]?.[1]).toContain('Only this remains.');
    expect(sendPrompt.mock.calls[0]?.[1]).not.toContain('Run this next.');
  });

  it('marks collaboration messages already submitted when an idle delivery fails', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const events: any[] = [];
    const sendPrompt = vi.fn().mockRejectedValue(new Error('transport disconnected'));
    service = new AppMcpService({ snapshot, onEvent: (event) => events.push(event) });
    service.setDriverRpc(new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt })]])));
    const url = await service.start();

    await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'send-message', arguments: { to: 'agent-jesse', content: 'Retry this safely.' } },
    });

    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
      agentId: 'agent-jesse',
      type: 'agent.promptQueued',
      payload: expect.objectContaining({ submitted: true }),
    })));
  });

  it('routes Computer Use MCP calls through the desktop client port', async () => {
    const status = vi.fn().mockResolvedValue({ available: true, accessibilityTrusted: true, platform: 'darwin' });
    const execute = vi.fn().mockResolvedValue({ ok: true, result: { apps: [] } });
    const stop = vi.fn().mockResolvedValue({ stopped: true });
    service = new AppMcpService({
      snapshot: createInitialSnapshot(),
      computerUse: {
        execute,
        requestAccessibility: vi.fn(),
        status,
        stop,
      },
    });
    const url = await service.start();

    const statusResponse = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'computer-use-status', arguments: {} },
    });
    expect(statusResponse.result.isError).toBe(false);
    expect(status).toHaveBeenCalledOnce();

    const stateResponse = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'computer-use-get-app-state', arguments: { app: 'TextEdit', window_id: 1, maxNodes: 200 } },
    });
    expect(execute).toHaveBeenCalledWith({
      command: 'get_app_state',
      arguments: { app: 'TextEdit', window_id: 1, maxNodes: 200, includeScreenshot: false },
    });
    expect(stateResponse.result.content[0].text).toBe('Observation metadata returned in structuredContent.');
    expect(stateResponse.result.structuredContent).toStrictEqual({ apps: [] });

    const stopResponse = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'computer-use-stop', arguments: {} },
    });
    expect(stopResponse.result.structuredContent).toStrictEqual({ stopped: true });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('omits Computer Use tools when the capability is disabled', async () => {
    service = new AppMcpService({
      snapshot: createInitialSnapshot(),
      computerUse: {
        execute: vi.fn(),
        requestAccessibility: vi.fn(),
        status: vi.fn(),
        stop: vi.fn(),
      },
      computerUseEnabled: () => false,
    });
    const url = await service.start();

    const toolsResponse = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    });

    expect(toolsResponse.result.tools.map((tool: { name: string }) => tool.name)).not.toEqual(
      expect.arrayContaining(['computer-use-status', 'computer-use-click']),
    );
  });

  it('routes in-app browser inspection and debugging tools through the desktop client port', async () => {
    const open = vi.fn().mockResolvedValue({ url: 'https://example.com/', title: 'Example', canGoBack: false, canGoForward: false });
    const execute = vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example', element: { tag: 'button' } });
    service = new AppMcpService({
      snapshot: createInitialSnapshot(),
      browser: { open, execute },
    });
    const url = await service.start();
    const openResponse = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser-open', arguments: { url: 'https://example.com' } },
    });
    expect(openResponse.result.structuredContent).toStrictEqual({ url: 'https://example.com/', title: 'Example', canGoBack: false, canGoForward: false });
    expect(open).toHaveBeenCalledWith({ agentId: 'agent-dina', browserId: 'primary', url: 'https://example.com' });
    const response = await postJson(agentUrl(url, 'agent-dina'), {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser-get-dom', arguments: { selector: '#save' } },
    });
    expect(response.result.structuredContent).toStrictEqual({ url: 'https://example.com', title: 'Example', element: { tag: 'button' } });
    expect(execute).toHaveBeenCalledWith({ agentId: 'agent-dina', browserId: 'primary', command: 'dom', arguments: { selector: '#save' } });
  });

  it('retains display-markdown before delivery and recovers it without replaying the tool', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'mcp-documents-test-'));
    const filename = path.join(home, 'documents.json');
    const documents = new DocumentWorkspaceService(filename);
    const events: BackendEvent[] = [];
    service = new AppMcpService({ snapshot: createInitialSnapshot(), retainDocument: (id, request) => documents.display(id, request), onEvent: event => events.push(event) });
    try {
      const url = await service.start();
      await callTool(url, 'agent-dina', 'display-markdown', { markdown: '# Exact\n', title: 'Saved proposal' });
      const event = events.find(event => event.type === 'client.markdownDisplayRequested');
      expect(event).toMatchObject({ payload: { documentId: expect.any(String), title: 'Saved proposal' } });
      const fresh = new DocumentWorkspaceService(filename);
      const tab = (await fresh.get('desktop'))['agent-dina']!.tabs[0]!;
      expect(await fresh.read('desktop', 'agent-dina', tab.id, async () => '')).toStrictEqual({ content: '# Exact\n' });
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  it('still displays markdown when document retention fails', async () => {
    const events: BackendEvent[] = [];
    service = new AppMcpService({ snapshot: createInitialSnapshot(), retainDocument: async () => { throw new Error('store is corrupt'); }, onEvent: event => events.push(event) });
    const url = await service.start();
    await callTool(url, 'agent-dina', 'display-markdown', { markdown: '# Still shown\n', title: 'Proposal' });
    expect(events.find(event => event.type === 'client.markdownDisplayRequested')).toMatchObject({ payload: { kind: 'markdown', title: 'Proposal', content: '# Still shown\n' } });
  });

  it('displays generated Markdown, requests celebrations, and creates agents through the service boundary', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.general.claudeCodeEnabled = true;
    const events: any[] = [];
    service = new AppMcpService({ snapshot, onEvent: (event) => events.push(event) });
    const url = await service.start();
    const callerUrl = agentUrl(url, 'agent-dina');

    const markdownResponse = await postJson(callerUrl, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'display-markdown', arguments: { markdown: '# Coverage report', title: 'Coverage' } },
    });
    expect(markdownResponse.result.structuredContent).toMatchObject({
      success: true,
      message: 'Displayed Markdown in the side panel.',
      title: 'Coverage',
    });
    expect(events).toContainEqual(expect.objectContaining({
      agentId: 'agent-dina',
      type: 'client.markdownDisplayRequested',
      payload: { kind: 'markdown', title: 'Coverage', content: '# Coverage report' },
    }));

    const celebrationResponse = await postJson(callerUrl, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'finish_turn', arguments: { celebration: true } },
    });
    expect(celebrationResponse.result.structuredContent).toStrictEqual({
      success: true,
      status: null,
      celebration: {
        success: true,
        requested: true,
        kind: expect.any(String),
        message: 'Celebration requested; each client decides whether to display it.',
      },
    });
    expect(events).toContainEqual(expect.objectContaining({
      agentId: 'agent-dina',
      type: 'client.celebrationRequested',
      payload: { kind: celebrationResponse.result.structuredContent.celebration.kind },
    }));

    const createResponse = await postJson(callerUrl, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: {
        name: 'create-agent',
        arguments: { repoPath: '/tmp/new-agent', name: 'New Agent', backend: 'claude' },
      },
    });
    expect(createResponse.result.structuredContent).toMatchObject({ success: true, agentId: expect.any(String) });
    expect(snapshot.agents).toContainEqual(expect.objectContaining({
      name: 'New Agent',
      backend: 'claude',
      folder: '/tmp/new-agent',
      teamId: 'team-app',
    }));

    const missingRepo = await postJson(callerUrl, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'create-agent', arguments: { repoPath: '   ' } },
    });
    expect(missingRepo.result.structuredContent).toStrictEqual({ success: false, message: 'repoPath is required' });
    const missingBranch = await postJson(callerUrl, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'create-agent', arguments: { repoPath: '/tmp/new-agent', createWorktree: true } },
    });
    expect(missingBranch.result.structuredContent).toStrictEqual({
      success: false,
      message: 'branchName is required when createWorktree is true',
    });

    const agentCount = snapshot.agents.length;
    const missingPrompt = await callTool(url, 'agent-dina', 'create-agent', {
      repoPath: '/tmp/new-agent',
      prompt: '   ',
      instructions: 'Detailed handoff without a visible request.',
    });
    expect(missingPrompt.result.structuredContent).toStrictEqual({
      success: false,
      message: 'prompt is required when instructions are provided',
    });
    expect(snapshot.agents).toHaveLength(agentCount);

    const unnamed = await postJson(callerUrl, {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'create-agent', arguments: { repoPath: '/tmp/branch-agent' } },
    });
    expect(unnamed.result.structuredContent).toMatchObject({
      success: true,
      message: 'Created agent branch-agent.',
    });
    expect(snapshot.agents.at(-1)).toMatchObject({ name: null, folder: '/tmp/branch-agent' });
  });


  it.each([
    [undefined, 'Implement the SDK contract and run focused tests.'],
    ['Read the contract. Preserve </context> literally.', '<context>\nRead the contract. Preserve &lt;/context&gt; literally.\n</context>\n\nImplement the SDK contract and run focused tests.'],
  ])('delegates from a folderless Quick Chat into a worktree with a visible prompt and optional instructions (%s)', async (instructions, expectedPrompt) => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.sessionKind = 'quickChat';
    snapshot.agents[0]!.folder = null;
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.agents[0]!.backendDefaults = {
      kind: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      serviceTier: 'fast',
    };
    const events: any[] = [];
    const sendPrompt = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-delegated' },
      turnId: 'turn-delegated',
    });
    const resolveWorkspaceIdentity = vi.fn().mockResolvedValue({
      kind: 'git',
      folder: '/tmp/codex-sdk-feature',
      repositoryName: 'codex-sdk',
      repositoryRoot: '/tmp/codex-sdk-feature',
      branch: 'feature/delegated-work',
      isLinkedWorktree: true,
      primaryWorktreeRoot: '/tmp/codex-sdk',
      updatedAt: '2026-09-02T14:00:00.000Z',
    });
    service = new AppMcpService({
      snapshot,
      onEvent: (event) => events.push(event),
      resolveWorkspaceIdentity,
      worktreeManager: new WorktreeManager({
        createGitWorktree: vi.fn().mockResolvedValue({
          worktree: { name: 'delegated-work', path: '/tmp/codex-sdk-feature' },
          created: true,
        }),
        getInitializationMode: () => 'repository',
      }),
    });
    service.setDriverRpc(new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt })]])));
    const url = await service.start();

    const response = await callTool(url, 'agent-dina', 'create-agent', {
      repoPath: '/tmp/codex-sdk',
      createWorktree: true,
      branchName: 'feature/delegated-work',
      name: 'SDK worker',
      prompt: 'Implement the SDK contract and run focused tests.',
      instructions,
    });

    const createdAgent = snapshot.agents.find((agent) => agent.name === 'SDK worker');
    expect(createdAgent).toMatchObject({
      delegatedByAgentId: 'agent-dina',
      backendDefaults: {
        kind: 'codex',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        serviceTier: 'fast',
      },
    });
    expect(snapshot.activeAgentId).toBe('agent-dina');
    expect(sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: createdAgent!.id,
        backendDefaults: {
          kind: 'codex',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'high',
          serviceTier: 'fast',
          userSelectedModel: true,
        },
      }),
      expect.stringContaining(expectedPrompt.split("</context>\n\n").at(-1)!),
      undefined,
    );
    expect(response.result.structuredContent).toMatchObject({
      success: true,
      agentId: createdAgent!.id,
      agentName: 'SDK worker',
      folder: '/tmp/codex-sdk-feature',
      promptSubmitted: true,
      message: 'Created agent SDK worker and started its initial prompt.',
    });
    const creationProgress = events.filter((event) => event.type === 'agentCreation.progress');
    expect(creationProgress.map((event) => event.payload.phase ?? event.payload.state)).toStrictEqual([
      'creatingWorktree',
      'initializingWorktree',
      'initializingWorktree',
      'creatingAgent',
      'startingPrompt',
      'success',
    ]);
    expect(creationProgress.at(-1)).toEqual(expect.objectContaining({
      agentId: 'agent-dina',
      payload: expect.objectContaining({ state: 'success', agentId: createdAgent!.id, agentName: 'SDK worker' }),
    }));
    expect(resolveWorkspaceIdentity).toHaveBeenCalledWith('/tmp/codex-sdk-feature');
    const sidebar = projectWorkspaceSidebar({
      agents: snapshot.agents,
      activeAgentId: snapshot.activeAgentId,
      quickChatsLabel: 'Chats',
    });
    expect(sidebar.find((group) => group.id === 'git:/tmp/codex-sdk')?.sessions).toContainEqual(
      expect.objectContaining({ agentId: createdAgent!.id }),
    );
  });

  it.each([
    { saved: undefined, override: undefined, backend: 'codex', fork: 'success', effective: 'handoff', reason: undefined },
    { saved: 'conversation', override: 'conversation', user: { startingContext: 'handoff', instructions: 'User-entered: say Hello' }, backend: 'codex', fork: 'success', effective: 'handoff', reason: undefined },
    { saved: 'conversation', override: undefined, backend: 'codex', fork: 'success', effective: 'conversation', reason: undefined },
    { saved: 'conversation', override: 'handoff', backend: 'codex', fork: 'success', effective: 'handoff', reason: undefined },
    { saved: 'handoff', override: 'conversation', backend: 'codex', fork: 'success', effective: 'conversation', reason: undefined },
    { saved: 'conversation', override: undefined, backend: 'claude', fork: 'success', effective: 'handoff', reason: 'cross-provider' },
    { saved: 'conversation', override: undefined, backend: 'codex', fork: 'unsupported', effective: 'handoff', reason: 'unsupported' },
    { saved: 'conversation', override: undefined, backend: 'codex', fork: 'failure', effective: 'handoff', reason: 'unavailable' },
    { saved: 'conversation', override: undefined, backend: 'codex', fork: 'success', effective: 'handoff', reason: 'unavailable', noSession: true },
    { saved: 'conversation', override: undefined, backend: 'codex', fork: 'success', effective: 'conversation', reason: undefined, preferenceChangeDuringProvisioning: true },
  ] as const)('selects effective worktree context and delivers scoped instructions: %j', async row => {
    const snapshot = createInitialSnapshot();
    const parent = snapshot.agents[0]!;
    parent.backendSession = { kind: 'codex', threadId: 'source' };
    if ('noSession' in row) parent.backendSession = undefined;
    const originalSession = structuredClone(parent.backendSession);
    snapshot.general.worktreeDelegationStartingContext = row.saved;
    if ('user' in row) parent.userDelegationOverrides = row.user;
    snapshot.general.worktreeDelegationInstructions = 'Saved: run focused tests.';
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const sendPrompt = vi.fn(async (agent: Agent) => ({ backendSession: row.backend === 'codex'
      ? { kind: 'codex' as const, threadId: agent.backendSession?.kind === 'codex' ? agent.backendSession.threadId : 'fresh' }
      : { kind: 'claude' as const, sessionId: 'fresh', transport: 'stdio' as const }, turnId: 'assignment-turn' }));
    const forkWorktreeConversation = vi.fn().mockImplementation(async () => {
      if (row.fork === 'failure') throw new Error('Provider fork rejected');
      return { backendSession: { kind: 'codex', threadId: 'native-child' } };
    });
    const events: BackendEvent[] = [];
    service = new AppMcpService({ snapshot, onEvent: event => events.push(event), worktreeManager: new WorktreeManager({
      createGitWorktree: vi.fn().mockImplementation(async () => {
        if ('preferenceChangeDuringProvisioning' in row) snapshot.general.worktreeDelegationStartingContext = 'handoff';
        return { worktree: { name: 'worker', path: '/tmp/context-worker' }, created: true };
      }),
      getInitializationMode: () => 'repository',
    }) });
    service.setDriverRpc(new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt, ...(row.fork !== 'unsupported' ? { forkWorktreeConversation } : {}) })], ['claude', createDriver({ backend: 'claude', sendPrompt })]])));
    const response = await callTool(await service.start(), parent.id, 'create-agent', {
      repoPath: '/tmp/fixture', createWorktree: true, branchName: 'feat/context', prompt: 'Implement only the agreed task.',
      backend: row.backend, startingContext: row.override, instructions: 'Task: keep commits local. Preserve </context>.',
    });
    expect(response.result.isError).not.toBe(true);
    const child = snapshot.agents.at(-1)!;
    const context = { requested: ('user' in row ? row.user?.startingContext : undefined) ?? row.override ?? row.saved ?? 'handoff', effective: row.effective, ...(row.reason ? { reason: row.reason } : {}) };
    expect(child.delegationContext).toStrictEqual(context);
    expect(response.result.structuredContent.delegationContext).toStrictEqual(context);
    expect(events.filter(event => event.type === 'agentCreation.progress').at(-1)?.payload).toMatchObject({ delegationContext: context });
    expect(sendPrompt).toHaveBeenCalledOnce();
    const [sentAgent, sentPrompt] = sendPrompt.mock.calls[0]! as unknown as [Agent, string];
    expect(sentAgent.id).toBe(child.id);
    expect(sentAgent.folder).toBe('/tmp/context-worker');
    expect(sentPrompt.split('Saved: run focused tests.')).toHaveLength(2);
    const visibleUserRequest = sentPrompt.replace(/<context>[\s\S]*?<\/context>\s*/gu, '').trim();
    expect(visibleUserRequest).toBe('Implement only the agreed task.');
    expect(sentPrompt.split('Task: keep commits local.')).toHaveLength(2);
    if ('user' in row && row.user) {
      expect(sentPrompt.split(row.user.instructions)).toHaveLength(2);
    }
    expect(sentPrompt).toContain('&lt;/context&gt;');
    expect(sentPrompt).toContain('Saved user instructions take precedence over the assignment brief and guidance generated by the delegating agent');
    expect(sentPrompt).toContain('Implement only the agreed task.');
    expect(sentPrompt).toContain(`agent ID is ${child.id}`);
    expect(sentPrompt).toContain(`working directory is ${child.folder}`);
    expect(parent.backendSession).toStrictEqual(originalSession);
    expect(snapshot.activeAgentId).toBe(parent.id);
    if (row.effective === 'conversation') {
      expect(child.backendSession).toStrictEqual({ kind: 'codex', threadId: 'native-child' });
      expect(forkWorktreeConversation).toHaveBeenCalledExactlyOnceWith(parent, child);
    } else if (row.fork === 'failure') expect(forkWorktreeConversation).toHaveBeenCalledOnce();
    else expect(forkWorktreeConversation).not.toHaveBeenCalled();
  });

  it.each([
    { backendSession: { kind: 'codex', threadId: 'source' } },
    { backendSession: { kind: 'claude', sessionId: 'wrong-provider', transport: 'stdio' } },
    { backendSession: { kind: 'codex', threadId: 'child' }, activeTurnId: 'running-child' },
  ])('rejects a native fork that cannot isolate assignment execution: %j', async forkResult => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const parent = snapshot.agents[0]!;
    parent.backendSession = { kind: 'codex', threadId: 'source' };
    const sendPrompt = vi.fn();
    service = new AppMcpService({ snapshot, worktreeManager: new WorktreeManager({
      createGitWorktree: vi.fn().mockResolvedValue({ worktree: { name: 'worker', path: '/tmp/isolated-worker' }, created: true }), getInitializationMode: () => 'repository',
    }) });
    service.setDriverRpc(new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt, forkWorktreeConversation: vi.fn().mockResolvedValue(forkResult) })]])));
    const response = await callTool(await service.start(), parent.id, 'create-agent', { repoPath: '/tmp/repo', createWorktree: true, branchName: 'feat/isolation', prompt: 'Execute the assignment', startingContext: 'conversation' });
    expect(response.result.isError).toBe(true);
    expect(JSON.stringify(response.result.content)).toContain('independent idle worker');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(parent.backendSession).toStrictEqual({ kind: 'codex', threadId: 'source' });
  });

  it('forks a durable assignment once and retains frozen instructions across creation retries', async () => {
    const snapshot = createInitialSnapshot();
    const parent = snapshot.agents[0]!;
    parent.backendSession = { kind: 'codex', threadId: 'parent-native' };
    parent.userDelegationOverrides = { startingContext: 'conversation', instructions: 'User-only startup instructions' };
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    snapshot.general.worktreeDelegationInstructions = 'Saved preference at assignment time';
    const forkWorktreeConversation = vi.fn().mockResolvedValue({ backendSession: { kind: 'codex', threadId: 'worker-native' } });
    const send = vi.fn(async (worker: Agent) => ({ backendSession: worker.backendSession!, turnId: 'worker-turn' }));
    let disk: import('@workspace/core/delegated-task').DelegatedTask[] = [];
    const tasks = new DurableTaskService({ tasks: [], save: async value => { disk = structuredClone(value); },
      agent: id => snapshot.agents.find(agent => agent.id === id), send, interrupt: vi.fn(), onError: vi.fn() });
    try {
      service = new AppMcpService({ snapshot, tasks, persistSnapshot: vi.fn(), worktreeManager: new WorktreeManager({
        createGitWorktree: vi.fn().mockResolvedValue({ worktree: { name: 'durable', path: '/tmp/durable-worker' }, created: true }), getInitializationMode: () => 'repository',
      }) });
      service.setDriverRpc(new BackendDriverRpc(new Map([['codex', createDriver({ forkWorktreeConversation })]])));
      const url = await service.start();
      const input = { requestId: 'stable-assignment', task: { title: 'Implement the task', doneWhen: 'Focused regressions pass' }, repoPath: '/tmp/fixture', createWorktree: true, branchName: 'feat/durable', prompt: 'Implement the agreed fix', instructions: 'Task-only directions', startingContext: 'conversation' };
      const creation = await callTool(url, parent.id, 'create-agent', input);
      expect(creation.result.isError, JSON.stringify(creation.result)).not.toBe(true);
      const first = creation.result.structuredContent;
      expect(first.success).toBe(true);
      expect(first.promptSubmitted).toBe(true);
      expect(first.delegationContext).toStrictEqual({ requested: 'conversation', effective: 'conversation' });
      const worker = snapshot.agents.find(agent => agent.id === first.agentId)!;
      expect(worker.backendSession).toStrictEqual({ kind: 'codex', threadId: 'worker-native' });
      expect(worker.folder).toBe('/tmp/durable-worker');
      expect(disk[0]!.acceptance).toStrictEqual({ backendSession: worker.backendSession, turnId: 'worker-turn' });
      snapshot.general.worktreeDelegationInstructions = 'Changed after assignment';
      snapshot.general.worktreeDelegationStartingContext = 'handoff';
      delete parent.userDelegationOverrides;
      const retry = (await callTool(url, parent.id, 'create-agent', input)).result.structuredContent;
      expect(retry.taskId).toBe(first.taskId);
      expect(retry.agentId).toBe(first.agentId);
      expect(forkWorktreeConversation).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledOnce();
      const prompt = (send.mock.calls[0]! as unknown as [Agent, string])[1];
      expect(disk[0]!.delegationUserInstructions).toStrictEqual({ saved: 'Saved preference at assignment time', taskSpecific: 'User-only startup instructions' });
      expect(worker.delegationUserInstructions).toStrictEqual(disk[0]!.delegationUserInstructions);
      expect(prompt.split('User-only startup instructions')).toHaveLength(2);
      expect(prompt.split('Saved preference at assignment time')).toHaveLength(2);
      expect(prompt.split('Task-only directions')).toHaveLength(2);
      expect(prompt).not.toContain('Changed after assignment');
      expect(prompt).toContain(`agent ID is ${worker.id}`);
      expect(prompt).toContain(`working directory is ${worker.folder}`);
      const conflict = await callTool(url, parent.id, 'create-agent', { ...input, startingContext: 'handoff' });
      expect(conflict.result.isError).toBe(true);
      expect(forkWorktreeConversation).toHaveBeenCalledOnce();
    } finally { tasks.close(); }
  });

  it('delegates an Antigravity worktree prompt with its model and independent session', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'antigravity', installed: true, connected: true, checking: false }];
    const parent = snapshot.agents[0]!;
    parent.backend = 'antigravity';
    parent.backendDefaults = { kind: 'antigravity', model: 'gemini-low', permissionMode: 'default' };
    parent.backendSession = { kind: 'antigravity', sessionId: 'parent-session' };
    const sendPrompt = vi.fn().mockResolvedValue({ backendSession: { kind: 'antigravity', sessionId: 'child-session' }, turnId: 'child-turn' });
    service = new AppMcpService({ snapshot, worktreeManager: new WorktreeManager({
      createGitWorktree: vi.fn().mockResolvedValue({ worktree: { name: 'acp-task', path: '/tmp/acp-task' }, created: true }),
      getInitializationMode: () => 'repository',
    }) });
    service.setDriverRpc(new BackendDriverRpc(new Map([['antigravity', createDriver({ backend: 'antigravity', sendPrompt })]])));
    const response = await callTool(await service.start(), parent.id, 'create-agent', {
      repoPath: '/tmp/fixture', createWorktree: true, branchName: 'feat/acp-task', name: 'ACP worker', prompt: 'Complete the task', instructions: 'Keep commits local',
    });
    expect(response.result.structuredContent).toMatchObject({ success: true, promptSubmitted: true });
    const child = snapshot.agents.find(agent => agent.name === 'ACP worker')!;
    expect(child).toMatchObject({ backend: 'antigravity', delegatedByAgentId: parent.id, backendDefaults: { kind: 'antigravity', model: 'gemini-low' }, backendSession: { kind: 'antigravity', sessionId: 'child-session' } });
    expect(sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ id: child.id }), expect.stringContaining('Keep commits local'), undefined);
    expect(parent.backendSession).toEqual({ kind: 'antigravity', sessionId: 'parent-session' });
    expect(snapshot.activeAgentId).toBe(parent.id);
  });

  it('lets create-agent override inherited model settings and avoids cross-backend inheritance', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.general.claudeCodeEnabled = true;
    snapshot.general.providerApprovalDefaults = { claude: 'auto' };
    snapshot.general.providerModelDefaults = {
      codex: { model: 'global-model', reasoningEffort: 'low', serviceTier: 'fast' },
      claude: { model: 'sonnet', reasoningEffort: 'medium', serviceTier: null },
    };
    snapshot.agents[0]!.backendDefaults = {
      kind: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      serviceTier: null,
    };
    service = new AppMcpService({ snapshot });
    const url = await service.start();

    await callTool(url, 'agent-dina', 'create-agent', {
      repoPath: '/tmp/explicit-worker',
      name: 'Explicit worker',
      model: 'gpt-6-astra',
      reasoningEffort: 'max',
    });
    await callTool(url, 'agent-dina', 'create-agent', {
      repoPath: '/tmp/claude-worker',
      name: 'Claude worker',
      backend: 'claude',
    });

    expect(snapshot.agents.find((agent) => agent.name === 'Explicit worker')?.backendDefaults).toStrictEqual({
      kind: 'codex',
      model: 'gpt-6-astra',
      reasoningEffort: 'max',
      userSelectedModel: true,
      serviceTier: null,
    });
    expect(snapshot.agents.find((agent) => agent.name === 'Claude worker')?.backendDefaults).toStrictEqual({
      kind: 'claude',
      model: 'sonnet',
      reasoningEffort: 'medium',
      serviceTier: null,
      userSelectedModel: true,
      permissionMode: 'auto',
    });
  });

  it('leaves celebration display policy to the receiving client', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.general.celebrationsEnabled = false;
    const events: Array<{ type?: string }> = [];
    service = new AppMcpService({ snapshot, onEvent: (event) => events.push(event) });
    const url = await service.start();

    const response = await callTool(url, 'agent-dina', 'finish_turn', {
      celebration: true,
    });

    expect(response.result.structuredContent).toStrictEqual({
      success: true,
      status: null,
      celebration: {
        success: true,
        requested: true,
        kind: expect.any(String),
        message: 'Celebration requested; each client decides whether to display it.',
      },
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'client.celebrationRequested' }));
  });

  it('emits celebration requests independently of legacy shared selection', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.activeAgentId = 'agent-dina';
    const events: Array<{ type?: string }> = [];
    service = new AppMcpService({ snapshot, onEvent: (event) => events.push(event) });
    const url = await service.start();

    const response = await callTool(url, 'agent-jesse', 'finish_turn', {
      celebration: true,
    });

    expect(response.result.structuredContent).toStrictEqual({
      success: true,
      status: null,
      celebration: {
        success: true,
        requested: true,
        kind: expect.any(String),
        message: 'Celebration requested; each client decides whether to display it.',
      },
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'client.celebrationRequested', agentId: 'agent-jesse' }));
  });

  it('retains global speech enablement but delegates selection, mute and voice to the client', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const queueSpokenAnnouncement = vi.fn().mockResolvedValue({ queued: true });
    service = new AppMcpService({ snapshot, queueSpokenAnnouncement });
    const url = await service.start();

    const disabled = await callTool(url, 'agent-dina', 'set-status', {
      status: 'Starting', announcement: { phase: 'start', text: 'On it.' },
    });
    expect(disabled.result.structuredContent).toStrictEqual({
      success: true,
      status: 'Starting',
      announcement: { success: true, phase: 'start' },
    });
    expect(queueSpokenAnnouncement).not.toHaveBeenCalled();

    snapshot.general.spokenAnnouncementsEnabled = true;
    snapshot.general.spokenAnnouncementsOnlyForDictatedPrompts = false;
    snapshot.activeAgentId = 'agent-dina';
    const selected = await callTool(url, 'agent-dina', 'set-status', {
      status: 'Starting', announcement: { phase: 'start', text: '  On it.  ' },
    });
    expect(selected.result.structuredContent).toStrictEqual({
      success: true,
      status: 'Starting',
      announcement: { success: true, phase: 'start' },
    });
    expect(queueSpokenAnnouncement).toHaveBeenCalledWith({
      agentId: 'agent-dina',
      phase: 'start',
      text: 'On it.',
    });

    const background = await callTool(url, 'agent-jesse', 'finish_turn', {
      announcement: { text: 'Done.' },
    });
    expect(background.result.structuredContent).toStrictEqual({
      success: true, status: null, announcement: { success: true, phase: 'finish' },
    });
    expect(queueSpokenAnnouncement).toHaveBeenCalledTimes(2);

    snapshot.general.spokenAnnouncementsMuted = true;
    const muted = await callTool(url, 'agent-dina', 'finish_turn', {
      announcement: { text: 'Done.' },
    });
    expect(muted.result.structuredContent).toStrictEqual({
      success: true, status: null, announcement: { success: true, phase: 'finish' },
    });
    expect(queueSpokenAnnouncement).toHaveBeenCalledTimes(3);

    snapshot.general.spokenAnnouncementsMuted = false;
    snapshot.general.spokenAnnouncementScope = 'all';
    await callTool(url, 'agent-jesse', 'finish_turn', {
      announcement: { text: 'Done.' },
    });
    expect(queueSpokenAnnouncement).toHaveBeenLastCalledWith({
      agentId: 'agent-jesse',
      phase: 'finish',
      text: 'Done.',
    });
  });

  it('queues spoken announcements only for dictated prompts when configured', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.general.spokenAnnouncementsEnabled = true;
    snapshot.general.spokenAnnouncementsOnlyForDictatedPrompts = true;
    snapshot.activeAgentId = 'agent-dina';
    const queueSpokenAnnouncement = vi.fn().mockResolvedValue({ queued: true });
    service = new AppMcpService({ snapshot, queueSpokenAnnouncement });
    const url = await service.start();

    service.recordPromptInputMethod('agent-dina', 'typed');
    const typed = await callTool(url, 'agent-dina', 'set-status', {
      status: 'Starting', announcement: { phase: 'start', text: 'On it.' },
    });
    expect(typed.result.structuredContent).toStrictEqual({
      success: true, status: 'Starting', announcement: { success: true, phase: 'start' },
    });
    expect(queueSpokenAnnouncement).not.toHaveBeenCalled();

    service.recordPromptInputMethod('agent-dina', 'dictated');
    const dictatedStart = await callTool(url, 'agent-dina', 'set-status', {
      status: 'Starting', announcement: { phase: 'start', text: 'On it.' },
    });
    const dictatedFinish = await callTool(url, 'agent-dina', 'finish_turn', {
      announcement: { text: 'Done.' },
    });

    expect(dictatedStart.result.structuredContent).toStrictEqual({
      success: true, status: 'Starting', announcement: { success: true, phase: 'start' },
    });
    expect(dictatedFinish.result.structuredContent).toStrictEqual({
      success: true, status: null, announcement: { success: true, phase: 'finish' },
    });

    expect(queueSpokenAnnouncement).toHaveBeenCalledTimes(2);
  });

  it('keeps TTS failures best-effort and rejects invalid MCP text before routing', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.general.spokenAnnouncementsEnabled = true;
    snapshot.general.spokenAnnouncementsOnlyForDictatedPrompts = false;
    snapshot.activeAgentId = 'agent-dina';
    const queueSpokenAnnouncement = vi.fn().mockRejectedValue(new Error('helper crashed'));
    service = new AppMcpService({ snapshot, queueSpokenAnnouncement });
    const url = await service.start();

    const failed = await callTool(url, 'agent-dina', 'finish_turn', {
      announcement: { text: 'Done.' },
    });
    expect(failed.result.isError).toBe(false);
    expect(failed.result.structuredContent).toStrictEqual({
      success: true, status: null, announcement: { success: true, phase: 'finish' },
    });

    const invalid = await callTool(url, 'agent-dina', 'set-status', {
      status: 'Starting', announcement: { phase: 'start', text: 'x'.repeat(161) },
    });
    expect(invalid.result.isError).toBe(true);
    expect(queueSpokenAnnouncement).toHaveBeenCalledTimes(1);
  });

  it('keeps client-side playback suppression private from the model', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.general.spokenAnnouncementsEnabled = true;
    snapshot.general.spokenAnnouncementsOnlyForDictatedPrompts = false;
    snapshot.activeAgentId = 'agent-dina';
    const queueSpokenAnnouncement = vi.fn().mockResolvedValue({
      queued: false,
      reason: 'suppressed',
    });
    service = new AppMcpService({ snapshot, queueSpokenAnnouncement });
    const url = await service.start();

    const response = await callTool(url, 'agent-dina', 'set-status', {
      status: 'Starting', announcement: { phase: 'start', text: 'On it.' },
    });

    expect(response.result.structuredContent).toStrictEqual({
      success: true, status: 'Starting', announcement: { success: true, phase: 'start' },
    });
  });

  it('keeps celebrations enabled when a migrated live snapshot omits the setting', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    delete (snapshot.general as Partial<typeof snapshot.general>).celebrationsEnabled;
    const events: Array<{ type?: string }> = [];
    service = new AppMcpService({ snapshot, onEvent: (event) => events.push(event) });
    const url = await service.start();

    const response = await callTool(url, 'agent-dina', 'finish_turn', {
      celebration: true,
    });

    expect(response.result.structuredContent).toMatchObject({
      status: null,
      celebration: { requested: true, kind: expect.any(String) },
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'client.celebrationRequested' }));
  });

  it('updates only the caller-owned assignment and requires blocked context', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.workBacklog.assignments['github:nbonamy/agent-workspace#12'] = {
      provider: 'github',
      itemId: 'nbonamy/agent-workspace#12',
      agentId: 'agent-dina',
      assignedAt: '2026-06-15T01:00:00.000Z',
      policy: 'review',
      status: 'inProgress',
    };
    const events: any[] = [];
    service = new AppMcpService({
      snapshot,
      now: () => new Date('2026-06-15T01:30:48.802Z'),
      onEvent: (event) => events.push(event),
    });
    const url = await service.start();

    const missingNote = await callTool(url, 'agent-dina', 'update-work-item', {
      workItemId: 'github:nbonamy/agent-workspace#12',
      status: 'blocked',
    });
    expect(missingNote.result.isError).toBe(true);

    const blocked = await callTool(url, 'agent-dina', 'update-work-item', {
      workItemId: 'github:nbonamy/agent-workspace#12',
      status: 'blocked',
      note: 'Need access to the private fixture',
    });
    expect(blocked.result.structuredContent).toMatchObject({
      status: 'blocked',
      note: 'Need access to the private fixture',
    });
    expect(snapshot.workBacklog.assignments['github:nbonamy/agent-workspace#12']).toMatchObject({
      status: 'blocked',
      note: 'Need access to the private fixture',
      updatedAt: '2026-06-15T01:30:48.802Z',
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'workItem.assignmentUpdated' }));
  });

});

function createDriver(overrides: Partial<AgentBackendDriver> = {}): AgentBackendDriver {
  return {
    backend: 'codex',
    getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
    getCapabilities: () => codexBackendCapabilities,
    sendPrompt: vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-test' },
      turnId: 'turn-test',
    }),
    interrupt: vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-test' },
      turnId: 'turn-test',
    }),
    respondToAgentRequest: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn().mockReturnValue(() => undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function agentUrl(url: string, agentId: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('agentId', agentId);
  return parsed.toString();
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });

  expect(response.status).toBe(200);
  const text = await response.text();
  if (text.startsWith('event:')) {
    const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
    expect(dataLine).toBeTruthy();
    return JSON.parse(dataLine!.slice('data: '.length));
  }

  return JSON.parse(text);
}

function callTool(url: string, agentId: string, name: string, arguments_: Record<string, unknown>): Promise<any> {
  return postJson(agentUrl(url, agentId), {
    jsonrpc: '2.0',
    id: `${name}-${agentId}`,
    method: 'tools/call',
    params: { name, arguments: arguments_ },
  });
}

function createTestAgent(id: string, teamId: string, name: string): Agent {
  return {
    id,
    teamId,
    name,
    folder: `/Users/nbonamy/src/${id}`,
    backend: 'codex',
    backendSession: { kind: 'codex', threadId: `thread-${id}` },
    status: { type: 'idle' },
    createdAt: '2026-06-15T01:00:00.000Z',
    updatedAt: '2026-06-15T01:00:00.000Z',
  };
}
