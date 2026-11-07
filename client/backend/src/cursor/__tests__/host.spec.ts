import { mkdtemp, copyFile, chmod, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendDriverRpc, createBackendDriver } from '../../driver-rpc';
import { AppBackendServer } from '../../server';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { CursorConversationSnapshot } from '@workspace/core/contracts/cursor-conversation';
import { UsageLedger } from '../../usage/usage-ledger';
import { UsageService } from '../../usage/usage-service';
let root: string, host: AgentBackendDriver;
let events: BackendEvent[];
const agent = { ...createInitialSnapshot().agents[0]!, id: 'cursor-fixture', backend: 'cursor' as const, backendDefaults: { kind: 'cursor' as const }, backendSession: undefined };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cursor-host-'));
  vi.stubEnv('HOME', root); vi.stubEnv('PATH', root); vi.stubEnv('SHELL', path.join(root, 'missing-shell')); vi.stubEnv('CURSOR_API_KEY', 'synthetic-must-not-leak');
  await copyFile(new URL('./fixtures/acp-agent.cjs', import.meta.url), path.join(root, 'fixture.cjs'));
  await writeFile(path.join(root, 'agent'), `#!${process.execPath}\nrequire(${JSON.stringify(path.join(root, 'fixture.cjs'))});\n`);
  await chmod(path.join(root, 'agent'), 0o700);
  await writeFile(path.join(root, 'version'), '2026.10.22-27dcf5f');
  agent.folder = root; events = []; host = createBackendDriver('cursor'); host.onEvent(event => events.push(event));
});
afterEach(async () => { vi.useRealTimers(); await host.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
const completions = () => events.filter(event => event.type === 'cursor.conversationEventReceived' && event.payload.event.type === 'turn.completed');
async function snapshot(): Promise<CursorConversationSnapshot> {
  await host.loadConversation!(agent);
  const frame = events.filter(event => event.type === 'cursor.conversationSnapshotChanged').at(-1);
  if (frame?.type !== 'cursor.conversationSnapshotChanged') throw new Error('No Cursor snapshot');
  return frame.payload.snapshot;
}
async function wire() { return (await readFile(path.join(root, 'wire.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); }
describe('Cursor ACP host transport boundary', () => {
  it('records completed, interrupted and failed native executions without inventing tokens or costs or counting snapshot reads', async () => {
    const ledger = new UsageLedger(path.join(root, 'usage.sqlite'));
    const usage = new UsageService(ledger, () => agent);
    await ledger.load();
    expect(host.onUsage).toBeTypeOf('function');
    const unsubscribeUsage = host.onUsage!(event => usage.observe(event));
    const unsubscribeEvents = host.onEvent(event => usage.observeEvent(event as never));
    try {
      await host.sendPrompt(agent, 'hello');
      await vi.waitFor(() => expect(completions()).toHaveLength(1));
      await snapshot(); await snapshot();
      const waiting = { ...agent, id: 'waiting' };
      const turn = await host.sendPrompt(waiting, 'wait');
      await host.interrupt(waiting, turn.turnId);
      await host.sendPrompt({ ...agent, id: 'failed' }, 'eof');
      await vi.waitFor(() => expect(completions()).toHaveLength(3));
      const released = { ...agent, id: 'released' };
      await host.sendPrompt(released, 'wait');
      await host.releaseConversation!(released.id);
      await vi.waitFor(() => expect(completions()).toHaveLength(4));
      await usage.drain();
      expect(ledger.query({ provider: 'cursor' }).rows).toMatchObject([{
        started: 4, completed: 1, interrupted: 2, failed: 1, inProgress: 0, measuredTurns: 0, tokens: null,
        cost: { usd: null, coverage: 'unavailable' },
      }]);
      // Projection is local; the uploader negotiates collector acceptance.
      expect(ledger.projectDailyTelemetry({ day: new Date().toISOString().slice(0, 10) })).toMatchObject([{provider: 'cursor', model: 'unknown', turns: 4, measuredTurns: 0, inputTokens: null, outputTokens: null, estimatedCostUsd: null, costCoverage: 'unavailable'}]);
      await usage.close();
      const restored = new UsageLedger(path.join(root, 'usage.sqlite'));
      try {
        await restored.load();
        expect(restored.query({ provider: 'cursor' }).rows).toMatchObject([{ started: 4, completed: 1, interrupted: 2, failed: 1 }]);
      } finally { await restored.close(); }
    } finally { unsubscribeUsage(); unsubscribeEvents(); await usage.close(); }
  });
  it('switches an untouched agent to Cursor through the app boundary and accepts its first prompt', async () => {
    const state = createTestSnapshot();
    state.agents = [{ ...agent, backend: 'codex', backendDefaults: { kind: 'codex', model: 'must-not-leak' }, backendSession: undefined }];
    state.teams[0]!.agentIds = [agent.id]; state.teams[0]!.activeAgentId = agent.id; state.activeAgentId = agent.id;
    state.providerConnections = [{ backend: 'cursor', installed: true, connected: true, checking: false }];
    const server = new AppBackendServer({ version: 'fixture', snapshot: state, driverRpc: new BackendDriverRpc(new Map([['cursor', host]])) });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/update', params: { input: { id: agent.id, selection: { backend: 'cursor' } } } });
      expect(state.agents[0]).toMatchObject({ backend: 'cursor', backendDefaults: { kind: 'cursor' } });
      expect(state.agents[0]!.backendDefaults?.model).toBeUndefined();
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'hello', expectedSessionId: null } });
      await vi.waitFor(() => expect(completions()).toHaveLength(1));
      expect(state.agents[0]!.backendSession).toMatchObject({ kind: 'cursor' });
      expect(state.agents[0]!.status.type).toBe('idle');
    } finally { await server.close(); }
  });
  it('starts two independent agents without sharing transcripts or failing a concurrent auth check', async () => {
    const second = { ...agent, id: 'second-cursor-agent' };
    const results = await Promise.all([host.sendPrompt(agent, 'hello'), host.sendPrompt(second, 'hello')]);
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect(results[0]!.backendSession).not.toEqual(results[1]!.backendSession);
    await host.loadConversation!(second);
    const frames = events.filter(event => event.type === 'cursor.conversationSnapshotChanged');
    expect(frames.at(-1)).toMatchObject({ agentId: second.id, payload: { snapshot: { agentId: second.id } } });
  });
  it('handshakes, streams split text/thought/tool frames and serializes two prompts with developer context', async () => {
    const first = await host.sendPrompt(agent, 'hello');
    const second = await host.sendPrompt({ ...agent, backendSession: first.backendSession }, 'again');
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    const state = await snapshot();
    expect(state.turns.map(turn => turn.status)).toEqual(['completed', 'completed']);
    expect(state.messages.flatMap(message => message.parts).filter(part => part.type === 'text')).toContainEqual({ type: 'text', text: 'Hello Cursor' });
    expect(state.messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({ type: 'tool', title: 'Read synthetic.txt', status: 'completed', body: 'synthetic contents' }));
    expect(second.backendSession).toEqual(first.backendSession);
    const calls = await wire();
    expect(calls.slice(0, 3).map(call => call.method)).toEqual(['initialize', 'authenticate', 'session/new']);
    expect(calls[0].params.clientCapabilities).toEqual({ _meta: { parameterizedModelPicker: true } });
    expect(calls[1].params).toEqual({ methodId: 'cursor_login' });
    expect(calls[2].params).toEqual({ cwd: root, mcpServers: [] });
    expect(calls.find(call => call.method === 'session/prompt').params.prompt[0].text).toContain('<context id=');
    expect(calls.find(call => call.method === 'session/prompt').params.prompt[0].text).toContain(`agent ID is ${agent.id}`);
    expect(host.getCapabilities(agent)).toMatchObject({ interrupt: true, approvals: false, history: false, models: false });
  });
  it('denies permissions using the native reject option and keeps a completed-but-rejected tool visibly failed', async () => {
    await host.sendPrompt(agent, 'permission'); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await wire()).find(call => call.id === 1 && call.result)?.result).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } });
    await expect(access(path.join(root, 'should-not-exist'))).rejects.toThrow();
    expect((await snapshot()).messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({ type: 'tool', status: 'failed', body: expect.stringMatching(/denied/i) }));
  });
  it('settles blocking extensions with cancellation', async () => {
    await host.sendPrompt(agent, 'extension'); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await wire()).find(call => call.id === 2 && call.result)?.result).toEqual({ outcome: { outcome: 'cancelled' } });
  });
  it('interrupts once, ignores stale completion/chunks, and admits the next prompt', async () => {
    const first = await host.sendPrompt(agent, 'wait');
    await vi.waitFor(() => expect(events.some(event => event.type === 'cursor.conversationEventReceived' && event.payload.event.type === 'message.upsert' && JSON.stringify(event.payload.event).includes('Hello'))).toBe(true));
    await host.interrupt(agent, first.turnId);
    await host.interrupt(agent, first.turnId);
    await host.sendPrompt({ ...agent, backendSession: first.backendSession }, 'again');
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    const state = await snapshot();
    expect(state.turns.map(turn => turn.status)).toEqual(['interrupted', 'completed']);
    expect(JSON.stringify(state)).not.toContain('LATE');
    expect((await wire()).find(call => call.id === 3 && call.result)?.result).toEqual({ outcome: { outcome: 'cancelled' } });
  });
  it.each(['eof', 'protocol', 'team', 'team-stderr', 'policy', 'policy-stderr', 'invalid-completion'])('turns %s into a terminal replica and a safe disconnected observation', async input => {
    await host.sendPrompt(agent, input); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const state = await snapshot();
    expect(state).toMatchObject({ busy: false, turns: [{ status: 'failed' }], error: expect.any(String) });
    expect(host.getRuntimeStatus()).toMatchObject({ status: 'error' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'provider.authenticationChanged', payload: expect.objectContaining({ kind: 'cursor', connected: false }) }));
    if (input.startsWith('team')) expect(state.error).toContain('Your team has switched');
    if (input.startsWith('policy')) expect(state.error).toMatch(/team policy/i);
    expect(JSON.stringify(events)).not.toContain('private.invalid');
  });
  it('rejects an unsupported version before any ACP process is started', async () => {
    await writeFile(path.join(root, 'version'), '2026.10.07-old');
    await expect(host.sendPrompt(agent, 'hello')).rejects.toThrow('2026.10.08');
    await expect(access(path.join(root, 'wire.jsonl'))).rejects.toThrow();
  });
  it('refuses an incompatible handshake before creating a conversation', async () => {
    await writeFile(path.join(root, 'no-list'), '');
    await expect(host.sendPrompt(agent, 'hello')).rejects.toThrow('safe cancellation');
    expect((await wire()).map(call => call.method)).toEqual(['initialize']);
  });
  it('rejects cross-session and workspace mutations without sending another prompt', async () => {
    const first = await host.sendPrompt(agent, 'hello'); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    await expect(host.sendPrompt({ ...agent, backendSession: { kind: 'cursor', sessionId: 'wrong' } }, 'wrong')).rejects.toThrow('identity');
    await expect(host.sendPrompt({ ...agent, folder: path.join(root, 'different') }, 'wrong')).rejects.toThrow('workspace');
    expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1);
    expect(first.backendSession.kind).toBe('cursor');
  });
  it('queues a prompt behind the active turn and releases it only after cancellation settles', async () => {
    const first = await host.sendPrompt(agent, 'wait');
    let admitted = false;
    const queued = host.sendPrompt({ ...agent, backendSession: first.backendSession }, 'again').then(result => { admitted = true; return result; });
    await vi.waitFor(async () => expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1));
    expect(admitted).toBe(false);
    await host.interrupt(agent, first.turnId); await queued;
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect((await snapshot()).turns.map(turn => turn.status)).toEqual(['interrupted', 'completed']);
  });
  it('bounds a non-cooperative cancellation and retains its interrupted transcript', async () => {
    const first = await host.sendPrompt(agent, 'ignore-cancel');
    await vi.waitFor(() => expect(JSON.stringify(events)).toContain('Hello'));
    vi.useFakeTimers();
    try {
      const stopped = host.interrupt(agent, first.turnId);
      await vi.advanceTimersByTimeAsync(5_000); await stopped;
      expect((await snapshot()).turns).toMatchObject([{ status: 'interrupted' }]);
      await expect(host.sendPrompt(agent, 'after-process-loss')).rejects.toThrow(/connection closed/i);
    } finally { vi.useRealTimers(); }
  });
  it('creates a private Quick Chat workspace and supplies no MCP servers', async () => {
    await host.sendPrompt({ ...agent, folder: null }, 'hello');
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const created = (await wire()).find(call => call.method === 'session/new');
    expect(created.params.cwd).toContain('cursor-quick-chats');
    expect(created.params.cwd).not.toBe(process.cwd());
    expect(created.params.mcpServers).toEqual([]);
  });
  it('releases a session during startup without attaching a stale replica', async () => {
    await writeFile(path.join(root, 'hold-new'), '');
    const opening = host.sendPrompt(agent, 'hello').catch(error => error);
    await vi.waitFor(async () => expect((await wire()).some(call => call.method === 'session/new')).toBe(true));
    await host.releaseConversation!(agent.id);
    expect(await opening).toBeInstanceOf(Error);
    expect(events.some(event => event.type === 'cursor.conversationSnapshotChanged')).toBe(false);
  });
});
