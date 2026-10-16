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

async function fixture(driver: AgentBackendDriver, agent: Agent) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-requests-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const snapshot = createTestSnapshot();
  snapshot.general.claudeCodeEnabled = true;
  snapshot.agents = [agent]; snapshot.teams[0]!.agentIds = [agent.id];
  const events: AppBackendEvent[] = [];
  const desktopFocused = vi.fn(async () => false);
  let manager: CompanionManager | undefined;
  const server = new AppBackendServer({ version: 'test', pid: 1, snapshot,
    driverRpc: new BackendDriverRpc(new Map([[driver.backend, driver]])),
    onPromptSource: (agent, clientId) => manager?.recordPrompt(agent, clientId),
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
  return { server, snapshot, events, gateway, desktopFocused, hostId: host.hostId,
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
    expect(diff.summary).toStrictEqual({ changedFiles: 2, addedLines: 2, removedLines: 1 });
    expect(diff.diff).toContain('+after'); expect(diff.diff).toContain('+new');
    expect(JSON.stringify(wire.gitStatuses)).not.toContain(directory);
    expect(git('status', '--porcelain').toString()).toContain('?? new.txt');
  });
  it.each([
    { clientId: 'desktop', focused: true, expectedPush: false, method: backendMethods.agentPromptSend },
    { clientId: 'desktop', focused: false, expectedPush: true, method: backendMethods.agentPromptSend },
    { clientId: 'desktop', focused: null, expectedPush: true, method: backendMethods.agentPromptSend },
    { clientId: 'mobile:phone', focused: true, expectedPush: true, method: backendMethods.agentPromptSteer },
  ])('gates background pushes by prompt origin and current desktop focus ($clientId / $focused)', async ({ clientId, focused, expectedPush, method }) => {
    const sdk = codexSdkFixture(); const agent = { ...sdkAgent(), teamId: 'team-test' };
    const f = await fixture(sdk.driver, agent); f.desktopFocused.mockResolvedValue(true);
    await f.gateway.request('phone', 'notifications.register', { token: 'ab'.repeat(32), environment: 'development' });
    const updates = vi.fn(); const subscription = f.gateway.subscribe('phone', updates, vi.fn());
    cleanup.push(async () => subscription.close());
    // A legacy observer is not a foreground phone until it opts into the live alert stream.
    await subscription.request('snapshot.get', {});
    transport.push.mockClear();
    const session = sdk.conversation('conversation-a');
    session.setSnapshot({ activeTurnId: 'turn', busy: true });
    const response = await f.server.handleMessage({ jsonrpc: '2.0', id: randomUUID(), method,
      params: { agentId: agent.id, prompt: 'Hello', startIfIdle: true, _clientId: clientId } });
    expect(response).toHaveProperty('result');
    await vi.waitFor(() => expect(session.handle.sendMessage).toHaveBeenCalledOnce());
    session.emit({ type: 'turn.started', conversationId: 'conversation-a', turnId: 'turn', seq: 1, occurredAt: '', origin: 'notification', payload: { startedAt: '' } });
    if (focused === null) f.desktopFocused.mockRejectedValue(new Error('Desktop unavailable')); else f.desktopFocused.mockResolvedValue(focused);
    session.emit({ type: 'turn.completed', conversationId: 'conversation-a', turnId: 'turn', seq: 2, occurredAt: '', origin: 'notification', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } });
    await vi.waitFor(() => expect(f.events.some(event => event.type === 'codex.conversationEventReceived' && event.payload.event.type === 'turn.completed')).toBe(true));
    if (expectedPush) await vi.waitFor(() => expect(transport.push).toHaveBeenCalledOnce());
    else {
      await vi.waitFor(() => expect(f.desktopFocused).toHaveBeenCalledOnce());
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(transport.push).not.toHaveBeenCalled();
    }
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
