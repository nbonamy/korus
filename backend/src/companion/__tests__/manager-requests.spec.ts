import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/events';
import type { Agent } from '@workspace/core/contracts';
import { companionTarget, type CompanionWorkspace } from '@workspace/core/companion-protocol';
import { AppBackendServer } from '../../server';
import { BackendDriverRpc } from '../../driver-rpc';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { ClaudeBackendDriver } from '../../claude/claude-driver';
import { ClaudeAgentSdkTransport } from '../../claude/agent-sdk-transport';
import { createQueryHarness } from '../../claude/__tests__/sdk-query-fixture';
import { codexSdkFixture, sdkAgent } from '../../codex/__tests__/sdk-surface-fixture';
import { CompanionManager, type CompanionBackendPort } from '../manager';
import type { CompanionGateway } from '../gateway';

// Network admission has its own encrypted-circuit tests. Keep the entire daemon/provider path real.
const transport = vi.hoisted(() => ({ gateway: null as CompanionGateway | null, push: vi.fn(async (_peerId: string, _registration: unknown, _notification: unknown) => 'sent' as const) }));
vi.mock('../connector', () => ({ CompanionOutboundConnector: class {
  connected = false;
  constructor(_key: unknown, gateway: CompanionGateway) { transport.gateway = gateway; }
  push = transport.push;
  async start() { this.connected = true; }
  async stop() { this.connected = false; }
} }));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function fixture(driver: AgentBackendDriver, agent: Agent, desktopFocused?: () => Promise<boolean>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-requests-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const snapshot = createTestSnapshot();
  snapshot.general.claudeCodeEnabled = true;
  snapshot.agents = [agent]; snapshot.teams[0]!.agentIds = [agent.id];
  const events: AppBackendEvent[] = [];
  let manager: CompanionManager | undefined;
  const server = new AppBackendServer({ version: 'test', pid: 1, snapshot,
    driverRpc: new BackendDriverRpc(new Map([[driver.backend, driver]])),
    onEvent: (event) => { events.push(event); manager?.event(event); },
  });
  cleanup.push(() => server.close());
  const backend: CompanionBackendPort = { desktopFocused, async request<Result>(method: string, params?: unknown): Promise<Result> {
    const response = await server.handleMessage({ jsonrpc: '2.0', id: randomUUID(), method, params });
    if (!response || 'error' in response) throw new Error(JSON.stringify(response));
    return response.result as Result;
  } };
  const initial = new CompanionManager(directory, backend, {});
  const { status: host } = await initial.control({ action: 'status' }); await initial.stop();
  const file = path.join(directory, 'state.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.enabled = true;
  saved.gateway.grants = [{ peerId: 'phone', name: 'Phone', createdAt: 1 }];
  await writeFile(file, JSON.stringify(saved));
  manager = new CompanionManager(directory, backend, {});
  cleanup.push(() => manager!.stop());
  await manager.control({ action: 'status' });
  const gateway = transport.gateway!;
  return { server, snapshot, events, gateway, hostId: host.hostId,
    workspace: () => gateway.request('phone', 'snapshot.get', {}) as Promise<CompanionWorkspace>,
    async answer(answers: Record<string, { answers: string[] }>) {
      const workspace = await gateway.request('phone', 'snapshot.get', {}) as CompanionWorkspace;
      const owner = workspace.agents.find(item => item.id === agent.id)!;
      const request = workspace.agentRequests![agent.id]![0]!;
      await gateway.request('phone', 'agent.request.respond', {
        target: companionTarget(host.hostId, workspace.teams[0]!, owner), id: request.id,
        conversationId: request.conversationId, outcome: { kind: 'answered', answers },
      });
    },
  };
}

describe('mobile requests across the owning daemon', () => {
  it.each([
    { focused: true, selected: 'same', pushes: false },
    { focused: true, selected: 'other', pushes: true },
    { focused: false, selected: 'same', pushes: true },
    { focused: 'unavailable', selected: 'same', pushes: true },
  ])('suppresses an unread completion only for the focused desktop conversation ($focused/$selected)', async ({ focused, selected, pushes }) => {
    const sdk = codexSdkFixture(); const agent = { ...sdkAgent(), teamId: 'team-test' };
    const desktopFocused = vi.fn(async () => { if (focused === 'unavailable') throw new Error('No desktop'); return focused === true; });
    const f = await fixture(sdk.driver, agent, desktopFocused);
    const other = { ...sdkAgent('other-agent', 'other-conversation'), teamId: agent.teamId };
    f.snapshot.agents.push(other); f.snapshot.teams[0]!.agentIds.push(other.id);
    await f.server.handleMessage({ jsonrpc: '2.0', id: randomUUID(), method: backendMethods.clientNavigationSelectAgent,
      params: { agentId: selected === 'same' ? agent.id : other.id, _clientId: 'desktop' } });
    await f.gateway.request('phone', 'notifications.register', { token: 'ab'.repeat(32), environment: 'development' });
    transport.push.mockClear();
    const session = sdk.conversation('conversation-a'); session.setSnapshot({ activeTurnId: 'turn', busy: true });
    await f.server.handleMessage({ jsonrpc: '2.0', id: randomUUID(), method: backendMethods.agentPromptSend, params: { agentId: agent.id, prompt: 'Hello' } });
    await vi.waitFor(() => expect(session.handle.sendMessage).toHaveBeenCalledOnce());
    session.emit({ type: 'turn.started', conversationId: 'conversation-a', turnId: 'turn', seq: 1, occurredAt: '', origin: 'notification', payload: { startedAt: '' } });
    session.emit({ type: 'turn.completed', conversationId: 'conversation-a', turnId: 'turn', seq: 2, occurredAt: '', origin: 'notification', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } });
    await vi.waitFor(() => expect(desktopFocused).toHaveBeenCalledOnce());
    if (pushes) await vi.waitFor(() => expect(transport.push).toHaveBeenCalledOnce());
    else expect(transport.push).not.toHaveBeenCalled();
    expect(f.snapshot.agents[0]!.readState).toMatchObject({ revision: 1, readRevision: 0 });
    if (!pushes) {
      await f.server.handleMessage({ jsonrpc: '2.0', id: randomUUID(), method: backendMethods.agentMarkRead, params: { agentId: agent.id, revision: 1 } });
      await vi.waitFor(() => expect(transport.push).toHaveBeenCalledOnce());
      expect(transport.push.mock.calls[0]![2]).toMatchObject({ kind: 'read' });
    }
  });
  it('creates a team through the shared daemon service without changing desktop navigation or accepting mobile color or remote overrides', async () => {
    const sdk = codexSdkFixture();
    const f = await fixture(sdk.driver, { ...sdkAgent(), teamId: 'team-test' });
    const desktop = () => f.server.handleMessage({ jsonrpc: '2.0', id: 'desktop', method: backendMethods.snapshotGet, params: {} });
    const before = await desktop();
    await expect(f.gateway.request('stranger', 'team.create', { name: 'Mobile team' })).rejects.toThrow('authorized');
    for (const input of [{ name: '  ' }, { name: 'x'.repeat(101) }, { name: 'Mobile team', color: '#1B4FB2' }, { name: 'Mobile team', remoteConnectionId: 'other' }]) {
      await expect(f.gateway.request('phone', 'team.create', input)).rejects.toThrow();
    }
    const { teamId } = await f.gateway.request('phone', 'team.create', { name: '  Mobile team  ' }) as { teamId: string };
    const workspace = await f.workspace();
    expect(workspace.teams.find(team => team.id === teamId)).toMatchObject({ name: 'Mobile team', agentIds: [] });
    const after = await desktop();
    if (!before || !('result' in before) || !after || !('result' in after)) throw new Error('Desktop snapshot unavailable');
    const previous = before.result as { snapshot: import('@workspace/core/contracts').AppSnapshot };
    const current = after.result as typeof previous;
    expect(current.snapshot.activeTeamId).toBe(previous.snapshot.activeTeamId);
    expect(current.snapshot.teams.find(team => team.id === teamId)).toMatchObject({ name: 'Mobile team', color: '#1B4FB2', agentIds: [] });
  });
  it('reads real workspace Git status and patches through the paired, read-only gateway', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-git-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
    git('init', '--initial-branch=main');
    await writeFile(path.join(directory, 'tracked.txt'), 'before\n'); git('add', 'tracked.txt');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'seed');
    await writeFile(path.join(directory, 'tracked.txt'), 'after\n');
    await writeFile(path.join(directory, 'new.txt'), 'new\n');
    const sdk = codexSdkFixture();
    const f = await fixture(sdk.driver, { ...sdkAgent(), teamId: 'team-test', folder: directory, workspace: undefined });
    let wire = await f.workspace();
    await f.gateway.request('phone', 'conversation.subscribe', companionTarget(f.hostId, wire.teams[0]!, wire.agents[0]!));
    await vi.waitFor(async () => {
      wire = await f.workspace();
      expect(wire.gitStatuses?.[wire.agents[0]!.id]).toMatchObject({ state: 'dirty', changedFiles: 2, addedLines: 2, removedLines: 1 });
    });
    const target = companionTarget(f.hostId, wire.teams[0]!, wire.agents[0]!);
    const diff = await f.gateway.request('phone', 'agent.git.diff', { target, scope: { type: 'uncommitted' } }) as import('@workspace/core/contracts').AgentGitDiff;
    expect(diff.summary).toMatchObject({ changedFiles: 2, addedLines: 2, removedLines: 1 });
    // The text files in this fixture are neither code, tests nor documentation.
    expect(diff.summary.byKind).toMatchObject({ other: { changedFiles: 2, addedLines: 2, removedLines: 1 }, code: { changedFiles: 0 } });
    expect(diff.diff).toContain('+after'); expect(diff.diff).toContain('+new');
    expect(JSON.stringify(wire.gitStatuses)).not.toContain(directory);
    expect(git('status', '--porcelain').toString()).toContain('?? new.txt');
  });
  it.each([
    { clientId: 'desktop', readOnDesktop: false, duringGrace: false, method: backendMethods.agentPromptSend },
    { clientId: 'mobile:phone', readOnDesktop: false, duringGrace: false, method: backendMethods.agentPromptSteer },
    { clientId: 'desktop', readOnDesktop: true, duringGrace: false, method: backendMethods.agentPromptSend },
    { clientId: 'desktop', readOnDesktop: true, duringGrace: true, method: backendMethods.agentPromptSend },
  ])('pushes unread completions and clears only acknowledged results ($clientId / read=$readOnDesktop / grace=$duringGrace)', async ({ clientId, readOnDesktop, duringGrace, method }) => {
    const sdk = codexSdkFixture(); const agent = { ...sdkAgent(), teamId: 'team-test' };
    const f = await fixture(sdk.driver, agent);
    const other = { ...sdkAgent('other-agent', 'other-conversation'), teamId: agent.teamId };
    f.snapshot.agents.push(other); f.snapshot.teams[0]!.agentIds.push(other.id);
    f.snapshot.activeAgentId = other.id;
    await f.gateway.request('phone', 'notifications.register', { token: 'ab'.repeat(32), environment: 'development' });
    const subscription = f.gateway.subscribe('phone', vi.fn(), vi.fn());
    cleanup.push(async () => subscription.close());
    await subscription.request('snapshot.get', { notifications: false });
    transport.push.mockClear();
    const session = sdk.conversation('conversation-a');
    session.setSnapshot({ activeTurnId: 'turn', busy: true });
    const response = await f.server.handleMessage({ jsonrpc: '2.0', id: randomUUID(), method,
      params: { agentId: agent.id, prompt: 'Hello', startIfIdle: true, _clientId: clientId } });
    expect(response).toHaveProperty('result');
    await vi.waitFor(() => expect(session.handle.sendMessage).toHaveBeenCalledOnce());
    session.emit({ type: 'turn.started', conversationId: 'conversation-a', turnId: 'turn', seq: 1, occurredAt: '', origin: 'notification', payload: { startedAt: '' } });
    session.emit({ type: 'turn.completed', conversationId: 'conversation-a', turnId: 'turn', seq: 2, occurredAt: '', origin: 'notification', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } });
    if (duringGrace) await vi.waitFor(() => expect(f.snapshot.agents[0]!.readState?.revision).toBe(1));
    else await vi.waitFor(() => expect(transport.push).toHaveBeenCalledOnce());
    if (readOnDesktop) {
      await expect(f.server.handleMessage({ jsonrpc: '2.0', id: randomUUID(), method: 'agent/read', params: { agentId: agent.id, revision: 1 } })).resolves.toHaveProperty('result');
      await vi.waitFor(() => expect(transport.push).toHaveBeenCalledTimes(duringGrace ? 1 : 2));
    }
    expect(transport.push.mock.calls.map(call => call[2])).toStrictEqual((duringGrace ? ['read'] : readOnDesktop ? ['completed', 'read'] : ['completed']).map(kind => expect.objectContaining({
      kind, revision: 1, target: expect.objectContaining({ agentId: agent.id }),
    })));

  });

  it('sets, edits and clears the same provider goal exposed to desktop and the phone', async () => {
    const sdk = codexSdkFixture();
    const agent = { ...sdkAgent(), teamId: 'team-test' };
    const f = await fixture(sdk.driver, agent);
    const session = sdk.conversation('conversation-a');
    const target = companionTarget(f.hostId, f.snapshot.teams[0]!, agent);
    const goal = { threadId: 'conversation-a', objective: 'Ship', status: 'active' as const, tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 };
    for (const objective of ['Ship', 'Ship and verify']) {
      session.setSnapshot({ goal: { ...goal, objective } });
      await f.gateway.request('phone', 'agent.goal.set', { target, objective });
      expect(session.handle.setGoal).toHaveBeenLastCalledWith(objective, undefined);
      expect((await f.workspace()).agents[0]!.goal).toStrictEqual({ ...goal, objective });
      expect(f.snapshot.agents[0]!.goal?.objective).toBe(objective);
    }
    await f.gateway.request('phone', 'agent.goal.set', { target, objective: null });
    expect(session.handle.clearGoal).toHaveBeenCalledOnce();
    expect((await f.workspace()).agents[0]!.goal).toBeUndefined();
    expect(f.snapshot.agents[0]!.goal).toBeUndefined();
  });

  it('releases a waiting Claude SDK tool and clears the desktop and phone request', async () => {
    const sdk = createQueryHarness();
    const driver = new ClaudeBackendDriver(new ClaudeAgentSdkTransport({ createQuery: sdk.createQuery }));
    const agent: Agent = { ...sdkAgent('claude-phone'), teamId: 'team-test', backend: 'claude', backendSession: undefined };
    const f = await fixture(driver, agent);
    const updates = vi.fn(); const failed = vi.fn();
    const subscription = f.gateway.subscribe('phone', updates, failed);
    cleanup.push(async () => subscription.close());
    await subscription.request('snapshot.get', { notifications: true });
    await f.gateway.request('phone', 'notifications.register', { token: 'ab'.repeat(32), environment: 'development' });
    transport.push.mockClear();
    const started = driver.sendPrompt(agent, 'Ask for a choice');
    await vi.waitFor(() => expect(sdk.options).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'claude-session' }); await started;
    const waiting = sdk.options[0]!.canUseTool!('AskUserQuestion', {
      questions: [{ header: 'Choice', question: 'Which option?', options: [{ label: 'Second', description: '' }], multiSelect: false }],
    }, { signal: new AbortController().signal, toolUseID: 'item', requestId: 'request' });
    await vi.waitFor(() => expect(f.snapshot.agentRequests?.[agent.id]).toHaveLength(1));
    expect(f.snapshot.agents[0]!.status.type).toBe('awaitingInput');
    await vi.waitFor(() => expect(updates.mock.calls.some(([update]) => update.type === 'notification')).toBe(true));
    expect(transport.push).not.toHaveBeenCalled();
    const notification = updates.mock.calls.find(([update]) => update.type === 'notification')![0].notification;
    expect(notification).toMatchObject({ kind: 'question', target: { hostId: f.hostId, agentId: agent.id } });
    expect(updates).toHaveBeenCalledWith({ type: 'notification', notification });
    await f.answer({ 'Which option?': { answers: ['Second'] } });
    await expect(waiting).resolves.toMatchObject({ behavior: 'allow', updatedInput: { answers: { 'Which option?': 'Second' } } });
    expect(f.snapshot.agentRequests?.[agent.id]).toEqual([]);
    expect((await f.workspace()).agentRequests?.[agent.id] ?? []).toEqual([]);
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'agentRequest.resolved', agentId: agent.id }));
    expect(f.snapshot.agents[0]!.status.type).toBe('working');
  });

  it('routes a Codex answer through the owning SDK handle and publishes its resolution to desktop', async () => {
    const sdk = codexSdkFixture();
    const agent = { ...sdkAgent(), teamId: 'team-test' };
    const f = await fixture(sdk.driver, agent);
    const request = { id: 'request', conversationId: 'conversation-a', turnId: 'turn', itemId: 'item', kind: 'ask_user' as const,
      payload: { request: { itemId: 'item', delivery: 'tool' as const, blocking: true, questions: [{ id: 'choice', header: 'Choice', question: 'Which option?', isOther: true, isSecret: false, options: null }] } } };
    const conversation = sdk.conversation('conversation-a');
    conversation.setSnapshot({ clientRequests: [request], activeTurnId: 'turn', busy: true });
    await sdk.driver.loadConversation(agent);
    conversation.handle.respondToClientRequest.mockImplementationOnce(async response => {
      conversation.setSnapshot({ clientRequests: [], answeredClientRequestIds: ['request'], activeTurnId: 'turn', busy: true });
      conversation.emit({ type: 'clientRequest.resolved', conversationId: 'conversation-a', turnId: 'turn', seq: 1, occurredAt: '', origin: 'action', payload: { request, response, reason: 'host' } });
      return conversation.handle.getSnapshot();
    });
    await f.answer({ choice: { answers: ['Second'] } });
    expect(conversation.handle.respondToClientRequest).toHaveBeenCalledExactlyOnceWith({ id: 'request', payload: { answers: { choice: { answers: ['Second'] } } } });
    expect(f.snapshot.agentRequests?.[agent.id]).toEqual([]);
    expect((await f.workspace()).agentRequests?.[agent.id] ?? []).toEqual([]);
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'agentRequest.resolved', agentId: agent.id }));
  });
});
