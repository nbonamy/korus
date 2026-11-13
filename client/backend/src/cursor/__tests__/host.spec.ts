import { mkdtemp, copyFile, chmod, writeFile, readFile, rm, access, symlink, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderDriverRpc, createProviderDriver } from '../../driver-rpc';
import { AppBackendServer } from '../../server';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { CodeReviewService } from '../../review/code-review-service';
import { AgentCreationService } from '../../agents/agent-creation-service';
import { AppMcpService } from '../../mcp/service';
import type { ProviderCodeReviewResult } from '@workspace/core/provider-driver';
import type { Agent } from '@workspace/core/contracts';
import type { AgentProviderDriver, BackendEvent } from '@workspace/core/provider-driver';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { createAgentInSnapshot, createQuickChatInSnapshot } from '@workspace/core/agent-manager';
import { companionSessionId } from '@workspace/core/companion-protocol';
import type { SessionState } from '@korus-dev/multi-agent-sdk';
import { UsageLedger } from '../../usage/usage-ledger';
import { UsageService } from '../../usage/usage-service';
import { TurnClock } from '../../usage/turn-clock';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../../state-persistence';
vi.mock('node:fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return {...actual,open:vi.fn(actual.open),realpath:vi.fn(actual.realpath)}; });
let root: string, host: AgentProviderDriver;
let events: BackendEvent[];
const observedPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1cAAAAASUVORK5CYII=';
const agent = { ...createInitialSnapshot().agents[0]!, id: 'cursor-fixture', provider: 'cursor' as const, providerDefaults: { kind: 'cursor' as const }, providerSession: undefined };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cursor-host-'));
  vi.stubEnv('HOME', root); vi.stubEnv('PATH', root); vi.stubEnv('SHELL', path.join(root, 'missing-shell')); vi.stubEnv('CURSOR_API_KEY', 'synthetic-must-not-leak');
  await copyFile(new URL('./fixtures/acp-agent.cjs', import.meta.url), path.join(root, 'fixture.cjs'));
  await writeFile(path.join(root, 'agent'), `#!${process.execPath}\nrequire(${JSON.stringify(path.join(root, 'fixture.cjs'))});\n`);
  await chmod(path.join(root, 'agent'), 0o700);
  await writeFile(path.join(root, 'version'), '2026.10.22-27dcf5f');
  agent.folder = root; events = []; host = createProviderDriver('cursor'); host.onEvent(event => events.push(event));
});
afterEach(async () => { vi.useRealTimers(); await host.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
const completions = () => events.filter(event => event.type === 'turn.completed');
async function snapshot(): Promise<SessionState> {
  await host.loadConversation!(agent);
  const frame = events.filter(event => event.type === 'conversation.sessionSnapshot').at(-1);
  if (frame?.type !== 'conversation.sessionSnapshot') throw new Error('No Cursor snapshot');
  return frame.payload.snapshot.state;
}
async function wire() { return (await readFile(path.join(root, 'wire.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); }
describe('Cursor ACP host transport boundary', () => {
  it.each(['manual', 'automatic'] as const)('runs a %s Cursor review, fixes a finding and completes a clean follow-up through the driver RPC', async mode => {
    const state = createInitialSnapshot();
    const owner = { ...agent, id: 'review-owner' };
    state.agents = [owner]; state.general.providerEnabled = { cursor: true };
    state.providerConnections = [{ provider: 'cursor', installed: true, connected: true, checking: false }];
    const mcp = new AppMcpService({ snapshot: state });
    const url = await mcp.start();
    await host.close(); host = createProviderDriver('cursor', { appMcpServerUrl: url });
    const rpc = new ProviderDriverRpc(new Map([['cursor', host]]));
    const creation = new AgentCreationService(state);
    const checkpoint = { head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'fixture' };
    const commit = vi.fn();
    const dispose = vi.fn(async (reviewer: import('@workspace/core/contracts').Agent) => {
      if (reviewer.providerSession) await rpc.handle('driver/codeReview/dispose', { agent: reviewer, reviewerSession: reviewer.providerSession });
      state.agents = state.agents.filter(candidate => candidate.id !== reviewer.id);
    });
    const review = new CodeReviewService({ snapshot: state, tools: mcp,
      createAgent: (input, options) => creation.create(input, options),
      runReview: (reviewer, prompt, reviewMcpServerUrl, reviewerSession) => rpc.handle('driver/codeReview/run', { agent: reviewer, prompt, cwd: root, reviewMcpServerUrl, reviewerSession }) as Promise<ProviderCodeReviewResult>,
      resetReviewer: async reviewer => { await host.releaseConversation!(reviewer.id); delete reviewer.providerSession; },
      deleteReviewer: dispose, saveReport: async () => path.join(root, 'report.md'), changed: () => {},
      git: { prepare: async () => ({ ...checkpoint, baseRef: 'a'.repeat(40) }), inspect: async () => checkpoint, hasChanges: async () => false, commit },
    });
    try {
      const result = mode === 'automatic'
        ? review.startAutomatic(owner, { scope: { type: 'uncommitted' }, maxRounds: 3, autoCommit: false })
        : review.start(owner, { scope: { type: 'uncommitted' }, threadMode: 'independent' });
      if (mode === 'manual') {
        await vi.waitFor(() => expect(result.status).toBe('ready'));
        const reviewer = state.agents.find(candidate => candidate.id === result.reviewerAgentId)!;
        const round = result.rounds[0]!, finding = round.findings[0]!;
        review.discuss(reviewer, { sessionId: result.id, roundId: round.id, findingId: finding.id, question: 'Why is this actionable?' });
        await vi.waitFor(() => expect(finding.discussion.at(-1)).toMatchObject({ author: 'reviewer', body: 'The finding is supported by the fixture.' }));
        review.submit(reviewer, result.id);
        await vi.waitFor(() => expect(result.status).toBe('readyToFinish'));
        await review.reviewAgain(reviewer, result.id);
        await vi.waitFor(() => expect(result.status).toBe('ready'));
        review.submit(reviewer, result.id);
        await review.finish(reviewer, result.id);
      } else {
        await vi.waitFor(() => expect(['completed', 'paused']).toContain(result.automation?.state));
        expect(result.automation?.state, JSON.stringify(result.rounds)).toBe('completed');
      }
      expect(result.rounds.map(round => round.inspectionCompletion?.findingCount)).toStrictEqual([1, 0]);
      expect(result.rounds[0]?.findings[0]?.remediation).toMatchObject({ state: 'fixed', evidence: expect.stringContaining('verified') });
      expect(await readFile(path.join(root, 'fixture-code.txt'), 'utf8')).toBe('fixed');
      await vi.waitFor(() => expect(state.agents).toStrictEqual([owner]));
      expect(dispose).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled();
    } finally { await rpc.close(); await mcp.stop(); }
  });

  it.each(['workspace', 'quickChat'] as const)('attaches the first %s prompt before streaming and steers within that saved session', async kind => {
    const state = createInitialSnapshot(); state.agents = [{ ...agent, ...(kind === 'quickChat' ? { folder: null, sessionKind: 'quickChat' as const } : {}) }];
    const current = state.agents[0]!;
    state.general.providerEnabled = { cursor: true }; state.general.cursorSteeringFallbackEnabled = true;
    state.providerConnections = [{ provider: 'cursor', installed: true, connected: true, checking: false }];
    await host.close(); host = createProviderDriver('cursor', { getGeneralSettings: () => state.general });
    const boundAtStart: unknown[] = [];
    let persisted: ReturnType<typeof persistedStateFromSnapshot> | undefined;
    const server = new AppBackendServer({ version: 'fixture', snapshot: state,
      saveSnapshot: async value => { persisted = JSON.parse(JSON.stringify(persistedStateFromSnapshot(value))); },
      driverRpc: new ProviderDriverRpc(new Map([['cursor', host]])), onEvent: event => {
        if (event.type === 'turn.started') boundAtStart.push(structuredClone(current.providerSession));
      } });
    try {
      await host.listModels!(current);
      expect(current.providerSession).toBeUndefined();
      await server.handleMessage({ jsonrpc: '2.0', id: 'first', method: 'agent/prompt/send', params: { agentId: current.id, prompt: 'wait' } });
      await vi.waitFor(async () => expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1));
      expect(boundAtStart).toStrictEqual([expect.objectContaining({ kind: 'cursor' })]);
      const saved = structuredClone(current.providerSession);
      await vi.waitFor(() => expect(snapshotFromPersistedState(persisted).agents.find(candidate => candidate.id === current.id)?.providerSession).toStrictEqual(saved));
      await server.handleMessage({ jsonrpc: '2.0', id: 'steer', method: 'agent/prompt/steer', params: { agentId: current.id, prompt: 'Correction', expectedSessionId: companionSessionId(current) } });
      await vi.waitFor(async () => { await host.loadConversation!(current); expect(boundAtStart).toHaveLength(2); });
      expect(current.providerSession).toStrictEqual(saved);
      expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
    } finally { await server.close(); }
  });

  it('reopens a catalog-only Cursor child after ACP exit without attaching until the first prompt', async () => {
    const state = createInitialSnapshot(); state.agents = [{ ...agent }];
    const current = state.agents[0]!;
    state.general.providerEnabled = { cursor: true };
    state.providerConnections = [{ provider: 'cursor', installed: true, connected: true, checking: false }];
    await host.close(); host = createProviderDriver('cursor', { getGeneralSettings: () => state.general });
    host.onEvent(event => events.push(event));
    const boundAtStart: unknown[] = [];
    const server = new AppBackendServer({ version: 'fixture', snapshot: state,
      driverRpc: new ProviderDriverRpc(new Map([['cursor', host]])), onEvent: event => {
        if (event.type === 'turn.started') boundAtStart.push(structuredClone(current.providerSession));
      } });
    try {
      await host.listModels!(current);
      expect(current.providerSession).toBeUndefined();
      expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
      const pid = Number(await readFile(path.join(root, 'pid'), 'utf8'));
      process.kill(pid);
      await vi.waitFor(() => expect(host.getRuntimeStatus().status).toBe('error'));
      expect(current.providerSession).toBeUndefined();
      await server.handleMessage({ jsonrpc: '2.0', id: 'first', method: 'agent/prompt/send', params: { agentId: current.id, prompt: 'hello' } });
      await vi.waitFor(async () => expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1));
      expect(boundAtStart).toStrictEqual([expect.objectContaining({ kind: 'cursor' })]);
      expect(current.providerSession).toMatchObject({ kind: 'cursor' });
      expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(2);
    } finally { await server.close(); }
  });

  it.each(['complete', 'invalid-model'] as const)('steers a live review without losing its saved session, tool scope or completion (%s)', async outcome => {
    const state = createInitialSnapshot(); state.agents = [{ ...agent }];
    state.general.providerEnabled = { cursor: true }; state.general.cursorSteeringFallbackEnabled = true;
    state.providerConnections = [{ provider: 'cursor', installed: true, connected: true, checking: false }];
    const mcp = new AppMcpService({ snapshot: state }); const url = await mcp.start();
    await host.close(); host = createProviderDriver('cursor', { appMcpServerUrl: url, getGeneralSettings: () => state.general });
    const usage: import('@workspace/core/usage').ExecutionObservation[] = [];
    host.onEvent(event => events.push(event)); host.onUsage!(event => usage.push(event));
    let persisted: ReturnType<typeof persistedStateFromSnapshot> | undefined;
    const server = new AppBackendServer({ version: 'fixture', snapshot: state, codeReviewTools: mcp,
      saveSnapshot: async value => { persisted = JSON.parse(JSON.stringify(persistedStateFromSnapshot(value))); },
      driverRpc: new ProviderDriverRpc(new Map([['cursor', host]])) });
    await writeFile(path.join(root, 'hold-review'), '');
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 'review', method: 'agent/codeReview/start', params: { agentId: agent.id, input: { scope: { type: 'uncommitted' }, threadMode: 'independent' } } });
      await vi.waitFor(async () => expect((await wire()).some(call => call.fixture === 'review-held')).toBe(true));
      const reviewer = state.agents.find(candidate => candidate.codeReview)!;
      await vi.waitFor(() => expect(snapshotFromPersistedState(persisted).agents.find(candidate => candidate.id === reviewer.id)?.providerSession).toMatchObject({ kind: 'cursor' }));
      const steer = (prompt: string, options?: unknown) => server.handleMessage({ jsonrpc: '2.0', id: 'steer', method: 'agent/prompt/steer', params: { agentId: reviewer.id, prompt,
        expectedSessionId: companionSessionId(reviewer), options } });
      if (outcome === 'invalid-model') {
        await expect(steer('STEER_REVIEW_FINAL', { selection: { model: 'missing-model' } })).rejects.toThrow(/Unknown Cursor model/);
        await vi.waitFor(() => expect(reviewer.codeReview?.status).toBe('failed'));
        expect(reviewer.codeReview?.rounds[0]?.error).toMatch(/Unknown Cursor model/);
        expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1);
        const retry = await host.runCodeReview!(reviewer, { prompt: 'Retry inspection', cwd: root, reviewerSession: reviewer.providerSession, reviewMcpServerUrl: 'http://127.0.0.1:1234/review' });
        expect(retry.text).toBe('Hello Cursor');
      } else {
        await steer('STEER_REVIEW_WAIT');
        expect(reviewer.provider).toBe('cursor');
        expect(reviewer.providerSession).toMatchObject({ kind: 'cursor' });
        const saved = structuredClone(reviewer.providerSession);
        await vi.waitFor(async () => expect((await wire()).filter(call => call.fixture === 'review-held')).toHaveLength(2));
        expect(reviewer.codeReview?.status).toBe('reviewing');
        await steer('STEER_REVIEW_FINAL');
        await vi.waitFor(() => expect(reviewer.codeReview?.status).toBe('ready'));
        expect(reviewer.providerSession).toStrictEqual(saved);
        expect(reviewer.codeReview?.rounds[0]).toMatchObject({ summary: 'Review turn complete.', inspectionCompletion: { findingCount: 1 }, reviewerSession: saved });
        await host.loadConversation!(reviewer);
        const frame = events.filter(event => event.type === 'conversation.sessionSnapshot' && event.agentId === reviewer.id).at(-1);
        if (frame?.type !== 'conversation.sessionSnapshot') throw new Error('Missing review snapshot');
        expect(frame.payload.snapshot.state.turns.map(turn => turn.status)).toStrictEqual(['interrupted', 'interrupted', 'completed']);
        expect(JSON.stringify(frame.payload.snapshot.state.messages)).not.toContain('LATE');
        expect(usage.filter(event => event.agentId === reviewer.id).map(event => event.phase)).toStrictEqual(['started', 'interrupted', 'started', 'interrupted', 'started', 'completed']);
        expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
        expect((await wire()).filter(call => call.method === 'session/load')).toHaveLength(0);
      }
    } finally { await server.close(); await mcp.stop(); }
  });

  it('preserves the native conversation and selected model while entering and leaving a scoped review', async () => {
    await writeFile(path.join(root, 'rich-models'), '');
    await host.close(); host = createProviderDriver('cursor', { appMcpServerUrl: 'http://127.0.0.1:1234/mcp', hostedMcpServerUrls: () => ({ external: 'http://127.0.0.1:1235/mcp' }) }); host.onEvent(event => events.push(event));
    const reviewer = { ...agent, providerDefaults: { kind: 'cursor' as const, model: 'fixture-beta', reasoningEffort: 'xhigh' } };
    const sent = await host.sendPrompt(reviewer, 'hello');
    await vi.waitFor(async () => expect((await wire()).filter(call => call.fixture === 'prompt-admission')).toHaveLength(1));
    await vi.waitFor(async () => expect((await snapshot()).busy).toBe(false));
    const rpc = new ProviderDriverRpc(new Map([['cursor', host]]));
    try {
      const reviewMcpServerUrl = 'http://127.0.0.1:1234/review';
      const result = await rpc.handle('driver/codeReview/run', { agent: reviewer, prompt: 'Inspect changes', cwd: root, reviewMcpServerUrl, reviewerSession: sent.providerSession }) as ProviderCodeReviewResult;
      expect(result).toStrictEqual({ text: 'Hello Cursor', reviewerSession: sent.providerSession });
      const loaded = (await wire()).filter(call => call.method === 'session/load').at(-1);
      expect(loaded.params.mcpServers).toHaveLength(1);
      expect(loaded.params.mcpServers[0].env).toEqual(expect.arrayContaining([{ name: 'HARNESS_ACP_MCP_URL', value: reviewMcpServerUrl }]));
      expect((await wire()).filter(call => call.fixture === 'prompt-admission').at(-1)).toMatchObject({ model: 'fixture-beta', thoughts: { reasoning_effort: 'xhigh' } });
      await host.sendPrompt({ ...reviewer, providerSession: result.reviewerSession }, 'Back to normal');
      await vi.waitFor(async () => expect((await snapshot()).busy).toBe(false));
      // The agent's own session was never closed, so it keeps its own tool scope without reloading.
      expect((await wire()).filter(call => call.fixture === 'prompt-admission')).toHaveLength(3);
      expect((await wire()).filter(call => call.method === 'session/load')).toHaveLength(1);
      await expect(rpc.handle('driver/codeReview/dispose', { agent: reviewer, reviewerSession: { kind: 'cursor', conversationId: 'stale' } })).rejects.toThrow(/changed/);
      await rpc.handle('driver/codeReview/dispose', { agent: reviewer, reviewerSession: result.reviewerSession });
    } finally { await rpc.close(); }
  });

  it('preapproves observed review MCP calls without granting native tool access', async () => {
    await writeFile(path.join(root, 'mcp-permission.json'), JSON.stringify({ input: { providerIdentifier: 'korus', toolName: 'report_finding', args: { title: 'Fixture' } } }));
    const rpc = new ProviderDriverRpc(new Map([['cursor', host]]));
    try {
      const reviewMcpServerUrl = 'http://127.0.0.1:1234/review';
      const result = await rpc.handle('driver/codeReview/run', { agent, prompt: 'mcp-permission', cwd: root, reviewMcpServerUrl }) as ProviderCodeReviewResult;
      expect((await wire()).find(call => call.id === 8 && call.result)?.result).toStrictEqual({ outcome: { outcome: 'selected', optionId: 'native-mcp-once' } });
      expect(events.some(event => event.type === 'agentRequest.created')).toBe(false);
      const native = rpc.handle('driver/codeReview/run', { agent, prompt: 'permission', cwd: root, reviewMcpServerUrl, reviewerSession: result.reviewerSession });
      await vi.waitFor(() => expect(events.some(event => event.type === 'agentRequest.created')).toBe(true));
      const request = events.find(event => event.type === 'agentRequest.created')!;
      if (request.type !== 'agentRequest.created') throw new Error('Missing native permission');
      await host.respondToAgentRequest!({ agentId: agent.id, id: request.payload.request.id, outcome: { kind: 'decision', decision: 'deny' } });
      await native;
      await expect(access(path.join(root, 'should-not-exist'))).rejects.toThrow();
    } finally { await rpc.close(); }
  });

  it.each(['wait', 'quota'])('settles a %s review through the normal cancellation and failure path', async prompt => {
    const rpc = new ProviderDriverRpc(new Map([['cursor', host]]));
    try {
      const reviewing = rpc.handle('driver/codeReview/run', { agent, prompt, cwd: root, reviewMcpServerUrl: 'http://127.0.0.1:1234/review' });
      const rejected = expect(reviewing).rejects.toThrow(prompt === 'wait' ? /interrupted/ : /usage limit/);
      if (prompt === 'wait') {
        await vi.waitFor(async () => expect((await wire()).some(call => call.method === 'session/prompt')).toBe(true));
        await host.interrupt(agent);
      }
      await rejected;
      expect(events.some(event => event.type === 'provider.authenticationChanged' && !event.payload.connected)).toBe(false);
    } finally { await rpc.close(); }
  });

  it('rejects unsupported native controls at the driver boundary without launching ACP or falling back to another provider', async () => {
    const rpc = new ProviderDriverRpc(new Map([['cursor', host]]));
    const controls = [
      ['driver/prompt/steer', { prompt: 'Adjust the task', expectedSessionId: null }, 'prompt steering'],
      ['driver/goal/update', { objective: 'Finish the task' }, 'goals'],
      ['driver/conversation/fork', { targetAgent: { ...agent, id: 'fork-target' } }, 'conversation fork'],
    ] as const;
    try {
      for (const [method, params, feature] of controls) {
        await expect(rpc.handle(method, { agent, ...params })).rejects.toThrow(`Cursor does not support ${feature}`);
      }
      await expect(access(path.join(root, 'wire.jsonl'))).rejects.toThrow();
      expect(events).toStrictEqual([]);
      expect(agent.providerSession).toBeUndefined();
    } finally { await rpc.close(); }
  });
  it('refreshes published steering availability immediately when the host setting changes without starting Cursor', async () => {
    const state = createTestSnapshot(); state.agents = [{ ...agent }];
    await host.close();
    host = createProviderDriver('cursor', { getGeneralSettings: () => state.general });
    const server = new AppBackendServer({ version: 'fixture', snapshot: state, driverRpc: new ProviderDriverRpc(new Map([['cursor', host]])) });
    try {
      for (const enabled of [true, false]) {
        const result = await server.handleMessage({ jsonrpc: '2.0', id: 'setting', method: 'settings/update', params: { input: { general: { cursorSteeringFallbackEnabled: enabled } } } });
        expect(result).toMatchObject({ result: { providerRuntimes: expect.arrayContaining([expect.objectContaining({ provider: 'cursor', capabilities: expect.objectContaining({ steerPrompt: enabled }) })]) } });
      }
      await expect(access(path.join(root, 'wire.jsonl'))).rejects.toThrow();
    } finally { await server.close(); }
  });
  it('switches live permission handling through the daemon, persists the choice, and seeds future model/permission defaults, and keeps native plan review explicit', async () => {
    const state = createInitialSnapshot(); state.agents = [{ ...agent }];
    state.providerConnections = [{ provider: 'cursor', installed: true, connected: true, checking: false }];
    const server = new AppBackendServer({ version: 'fixture', snapshot: state, driverRpc: new ProviderDriverRpc(new Map([['cursor', host]])) });
    const select = (mode: string) => server.handleMessage({ jsonrpc: '2.0', id: 'mode', method: 'agent/permissionMode/update', params: { agentId: agent.id, mode } });
    const send = (prompt: string) => server.handleMessage({ jsonrpc: '2.0', id: 'prompt', method: 'agent/prompt/send', params: { agentId: agent.id, prompt } });
    try {
      await send('permission');
      await vi.waitFor(() => expect(state.agentRequests?.[agent.id]).toHaveLength(1));
      await select('full-access');
      await vi.waitFor(() => expect(completions()).toHaveLength(1));
      expect(state.agentRequests?.[agent.id]).toStrictEqual([]);
      expect((await wire()).find(call => call.id === 1 && call.result)?.result).toStrictEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
      await server.handleMessage({ jsonrpc: '2.0', id: 'model', method: 'agent/update', params: { input: { id: agent.id, selection: { provider: 'cursor', model: 'composer-2.5' } } } });
      const restored = snapshotFromPersistedState(JSON.parse(JSON.stringify(persistedStateFromSnapshot(state))));
      expect(restored.agents[0]!.providerDefaults).toMatchObject({ kind: 'cursor', permission: 'full-access' });
      expect(restored.general.providerApprovalDefaults?.cursor).toBe('full-access');
      // Runtime connections are re-established rather than restored from disk.
      restored.providerConnections = structuredClone(state.providerConnections);
      createAgentInSnapshot(restored, { name: 'Next Cursor', folder: root, selection: { provider: 'cursor' } }, undefined, 'next-workspace');
      createQuickChatInSnapshot(restored, { selection: { provider: 'cursor' } }, undefined, 'next-quick-chat');
      const inheritedHost = createProviderDriver('cursor'), inheritedEvents: BackendEvent[] = [];
      inheritedHost.onEvent(event => inheritedEvents.push(event));
      try {
        for (const [index, id] of ['next-workspace', 'next-quick-chat'].entries()) {
          const next = restored.agents.find(candidate => candidate.id === id)!;
          expect(next.providerDefaults).toMatchObject({ kind: 'cursor', model: 'composer-2.5', permission: 'full-access' });
          await inheritedHost.sendPrompt(next, 'permission');
          await vi.waitFor(() => expect(inheritedEvents.filter(event => event.type === 'turn.completed')).toHaveLength(index + 1));
          expect((await wire()).filter(call => call.fixture === 'prompt-admission').at(-1)).toMatchObject({ model: 'composer-2.5' });
        }
        expect(inheritedEvents.some(event => event.type === 'agentRequest.created')).toBe(false);
      } finally { await inheritedHost.close(); }
      await expect(select('auto_edit')).rejects.toThrow(/Unsupported permission mode/);
      expect(state.agents[0]!.providerDefaults).toMatchObject({ permission: 'full-access' });
      await select('default');
      expect(snapshotFromPersistedState(persistedStateFromSnapshot(state)).general.providerApprovalDefaults?.cursor).toBe('default');
      await send('permission');
      await vi.waitFor(() => expect(state.agentRequests?.[agent.id]).toHaveLength(1));
      const pending = state.agentRequests![agent.id]![0]!;
      await server.handleMessage({ jsonrpc: '2.0', id: 'deny', method: 'agent/request/respond', params: { response: { agentId: agent.id, id: pending.id, outcome: { kind: 'decision', decision: 'deny' } } } });
      await vi.waitFor(() => expect(completions()).toHaveLength(2));
      await select('full-access');
      await send('extension');
      await vi.waitFor(() => expect(state.agents[0]!.planReview?.status).toBe('pending'));
      expect(completions()).toHaveLength(2);
      await server.handleMessage({ jsonrpc: '2.0', id: 'plan', method: 'agent/planReview/respond', params: { agentId: agent.id, response: { reviewId: state.agents[0]!.planReview!.id, resolution: 'cancel' } } });
      await vi.waitFor(() => expect(completions()).toHaveLength(3));
      expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(3);
    } finally { await server.close(); }
  });
  it.each([false, true])('restores full-access policy on session startup and uses only once-only permission options (missingOnce=%s)', async missingOnce => {
    await writeFile(path.join(root, 'mcp-permission.json'), JSON.stringify({ noOnce: missingOnce }));
    await host.sendPrompt({ ...agent, providerDefaults: { kind: 'cursor', permission: 'full-access' } }, 'mcp-permission');
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await wire()).find(call => call.id === 8 && call.result)?.result).toStrictEqual({ outcome: missingOnce ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: 'native-mcp-once' } });
    expect((await snapshot()).requests).toStrictEqual([]);
  });
  it('applies a permission choice made while model discovery is opening the session', async () => {
    const loading = host.listModels!(agent);
    const selected = host.setPermissionMode!(agent, 'full-access');
    await Promise.all([loading, selected]);
    await host.sendPrompt(agent, 'permission');
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await snapshot()).requests).toStrictEqual([]);
  });
  it('does not apply one conversation full-access policy to another agent', async () => {
    const full = { ...agent, providerDefaults: { kind: 'cursor' as const, permission: 'full-access' } };
    const manual = { ...agent, id: 'manual-agent' };
    await host.sendPrompt(full, 'permission');
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    await host.sendPrompt(manual, 'permission');
    await vi.waitFor(() => expect(events.some(event => event.type === 'agentRequest.created' && event.agentId === manual.id)).toBe(true));
    expect(completions()).toHaveLength(1);
    const pending = events.find(event => event.type === 'agentRequest.created' && event.agentId === manual.id)!;
    if (pending.type !== 'agentRequest.created') throw new Error('Expected manual permission');
    await host.respondToAgentRequest({ agentId: manual.id, id: pending.payload.request.id, outcome: { kind: 'decision', decision: 'deny' } });
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
  });
  it('attributes TTFT to each acknowledged model even without token counts or after a native model change', async () => {
    const ledger = new UsageLedger(path.join(root, 'usage.sqlite'));
    let now = 0;
    const usage = new UsageService(ledger, () => agent, new TurnClock(() => now), () => now);
    await ledger.load();
    const offUsage = host.onUsage!(event => usage.observe(event));
    const offEvents = host.onEvent(event => {
      {
        if (event.type === 'turn.output') now = 1200;
        if (event.type === 'turn.completed') now = 4000;
      }
      usage.observeEvent(event as never);
    });
    try {
      await host.sendPrompt(agent, 'performance', { selection: { model: 'composer-2.5' } });
      await vi.waitFor(() => expect(completions()).toHaveLength(1));
      now = 0;
      await host.sendPrompt(agent, 'hello', { selection: { model: 'auto' } });
      await vi.waitFor(() => expect(completions()).toHaveLength(2));
      await usage.drain();
      const rows = ledger.query({ provider: 'cursor', group: 'model' }).rows;
      expect(rows.map(row => row.modelVariant?.model).sort()).toEqual(['auto', 'composer-2.5']);
      for (const row of rows) expect(row).toMatchObject({ started: 1, completed: 1, tokens: null,
        speed: { ttftMs: 1200, ttftTurns: 1, outputTokens: 0 }, cost: { usd: null, coverage: 'unavailable' } });
    } finally { offUsage(); offEvents(); await usage.close(); }
  });
  it('reports cumulative ACP tokens once, retains cache categories and excludes resumed history from execution accounting', async () => {
    const ledger = new UsageLedger(path.join(root, 'usage.sqlite'));
    const usage = new UsageService(ledger, () => agent);
    await ledger.load();
    const off = host.onUsage!(event => usage.observe(event));
    const counts = (n: number) => ({ totalTokens: n * 4, inputTokens: n, outputTokens: n, cachedReadTokens: n, cachedWriteTokens: n, thoughtTokens: n });
    let current: Agent = { ...agent };
    const sample = async (n: number, stopReason = 'end_turn') => {
      await writeFile(path.join(root, 'usage-response.json'), JSON.stringify({ result: { stopReason, usage: counts(n) } }));
      const before = completions().length;
      const sent = await host.sendPrompt(current, 'usage');
      current = { ...current, providerSession: sent.providerSession };
      await vi.waitFor(() => expect(completions()).toHaveLength(before + 1));
      await usage.drain();
    };
    try {
      await sample(1); await sample(2); await sample(2, 'cancelled');
      expect(ledger.query({ provider: 'cursor' }).rows[0]).toMatchObject({
        started: 3, completed: 2, interrupted: 1, measuredTurns: 3,
        tokens: { total: 8, input: 6, output: 2, cacheRead: 2, cacheWrite: 2, reasoning: 2 },
        cost: { usd: null, coverage: 'unavailable' },
      });
      await host.releaseConversation!(current.id);
      const before = completions().length;
      const saved = current.providerSession;
      if (saved?.kind !== 'cursor') throw new Error('Expected Cursor session');
      await host.resumeConversation!(current, { ref: { provider: 'cursor', folder: root, conversationId: saved.conversationId }, storageState: 'active' });
      await usage.drain();
      expect(completions()).toHaveLength(before);
      await sample(4); // A cold resume's first cumulative sample establishes a baseline, not new work.
      await sample(5);
      await sample(1); await sample(2); // A decreasing counter resets the baseline without clamping or charging history.
      expect(ledger.query({ provider: 'cursor' }).rows[0]).toMatchObject({
        started: 7, measuredTurns: 5, tokens: { total: 16, input: 12, output: 4, cacheRead: 4, cacheWrite: 4, reasoning: 4 },
        cost: { usd: null, coverage: 'unavailable' },
      });
      expect(ledger.projectDailyTelemetry({ day: new Date().toISOString().slice(0, 10) })).toMatchObject([{
        provider: 'cursor', model: 'auto', turns: 7, measuredTurns: 5, inputTokens: 12, cachedInputTokens: 4, outputTokens: 4, estimatedCostUsd: null,
      }]);
      await usage.close();
      const restored = new UsageLedger(path.join(root, 'usage.sqlite'));
      try { await restored.load(); expect(restored.query({ provider: 'cursor' }).rows[0]?.tokens?.total).toBe(16); }
      finally { await restored.close(); }
    } finally { off(); await usage.close(); }
  });
  it.each([
    undefined,
    { totalTokens: 100 },
    { totalTokens: 4, inputTokens: -1, outputTokens: 1, cachedReadTokens: 1, cachedWriteTokens: 1 },
    { totalTokens: 4, inputTokens: 1.5, outputTokens: 1, cachedReadTokens: 1, cachedWriteTokens: 1 },
    { totalTokens: 999, inputTokens: 1, outputTokens: 1, cachedReadTokens: 1, cachedWriteTokens: 1 },
    { totalTokens: 12, inputTokens: 0, outputTokens: 1, cachedReadTokens: 1, cachedWriteTokens: 10 },
  ])('leaves absent/invalid ACP usage unknown and never counts context occupancy or cumulative USD cost as tokens (%j)', async invalid => {
    const ledger = new UsageLedger(path.join(root, 'usage.sqlite'));
    const usage = new UsageService(ledger, () => agent);
    await ledger.load();
    const off = host.onUsage!(event => usage.observe(event));
    const counts = (n: number) => ({ totalTokens: n * 4, inputTokens: n, outputTokens: n, cachedReadTokens: n, cachedWriteTokens: n });
    try {
      for (const native of [counts(1), invalid, counts(3), counts(4)]) {
        await writeFile(path.join(root, 'usage-response.json'), JSON.stringify({ result: { usage: native }, updates: [{ sessionUpdate: 'usage_update', used: 99999, size: 100000, cost: { amount: 123, currency: 'USD' } }] }));
        const before = completions().length;
        await host.sendPrompt(agent, 'usage');
        await vi.waitFor(() => expect(completions()).toHaveLength(before + 1));
      }
      await usage.drain();
      expect(ledger.query({ provider: 'cursor' }).rows[0]).toMatchObject({ started: 4, completed: 4, measuredTurns: 2,
        tokens: { total: 8, input: 6, output: 2, cacheRead: 2, cacheWrite: 2 }, cost: { usd: null, coverage: 'unavailable' } });
    } finally { off(); await usage.close(); }
  });
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
      expect(ledger.projectDailyTelemetry({ day: new Date().toISOString().slice(0, 10) })).toMatchObject([{provider: 'cursor', model: 'auto', turns: 4, measuredTurns: 0, inputTokens: null, outputTokens: null, estimatedCostUsd: null, costCoverage: 'unavailable'}]);
      await usage.close();
      const restored = new UsageLedger(path.join(root, 'usage.sqlite'));
      try {
        await restored.load();
        expect(restored.query({ provider: 'cursor' }).rows).toMatchObject([{ started: 4, completed: 1, interrupted: 2, failed: 1 }]);
      } finally { await restored.close(); }
    } finally { unsubscribeUsage(); unsubscribeEvents(); await usage.close(); }
  });
  it('cold loads native history once without executing or counting replay, then continues that session', async () => {
    const observations: unknown[] = []; host.onUsage!(event => observations.push(event));
    const saved = { ...agent, providerSession: { kind: 'cursor' as const, conversationId: 'saved-session' } };
    await host.loadConversation!(saved);
    await host.loadConversation!(saved);
    const frames = events.filter(event => event.type === 'conversation.sessionSnapshot');
    const last = frames.at(-1)!;
    const state = { snapshot: { ...(last.payload as { snapshot: { state: SessionState } }).snapshot.state, sessionId: (last.payload as { conversation: string | null }).conversation } };
    expect(state.snapshot).toMatchObject({ sessionId: 'saved-session', busy: false, turns: [{ status: 'completed', startedAt: null, completedAt: null, durationMs: null }] });
    expect(state.snapshot.messages.filter(message => message.role === 'user')).toHaveLength(1);
    expect(state.snapshot.messages.every(message => message.createdAt === '')).toBe(true);
    expect(JSON.stringify(state.snapshot)).toContain('Remember synthetic marker');
    expect(JSON.stringify(state.snapshot)).toContain('replay-tool');
    expect(observations).toStrictEqual([]);
    expect(completions()).toStrictEqual([]);
    expect((await wire()).filter(call => call.method === 'session/load')).toHaveLength(1);
    expect((await wire()).some(call => call.method === 'session/new')).toBe(false);
    await host.sendPrompt(saved, 'continue');
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect(observations).toHaveLength(2);
  });
  it('rejects missing or foreign-workspace native history before load and never creates a replacement', async () => {
    for (const sessionId of ['missing-session', 'foreign-session']) {
      await expect(host.loadConversation!({ ...agent, providerSession: { kind: 'cursor', conversationId: sessionId } })).rejects.toThrow(/missing|workspace/i);
    }
    expect((await wire()).some(call => ['session/new', 'session/load', 'session/prompt'].includes(call.method))).toBe(false);
  });
  it('uses native model values, rejects unknown models and applies selection before prompt', async () => {
    expect(await host.listModels!(agent)).toMatchObject([{ id: 'auto', displayName: 'Auto' }, { id: 'composer-2.5', displayName: 'Composer' }]);
    await expect(host.sendPrompt(agent, 'bad', { selection: { model: 'invented' } })).rejects.toThrow(/model/i);
    for (const configOptions of [[], [{id:'model',currentValue:'auto'}], [{id:'another-model',currentValue:'composer-2.5'}]]) {
      await writeFile(path.join(root,'model-ack.json'),JSON.stringify({configOptions}));
      await expect(host.sendPrompt(agent,'must-not-run',{selection:{model:'composer-2.5'}})).rejects.toThrow(/model/i);
      expect((await wire()).some(call => call.method === 'session/prompt')).toBe(false);
    }
    await rm(path.join(root,'model-ack.json'));
    await host.sendPrompt(agent, 'hello', { selection: { model: 'composer-2.5' } });
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const calls = await wire();
    const setter = calls.findIndex(call => call.method === 'session/set_config_option');
    expect(calls[setter].params).toMatchObject({ configId: 'model', value: 'composer-2.5' });
    expect(setter).toBeLessThan(calls.findIndex(call => call.method === 'session/prompt'));
  });
  it('embeds trusted UTF-8 files and images and rejects binary files before prompt admission', async () => {
    const text = path.join(root, 'notes.txt'); const image = path.join(root, 'sample.png'); const binary = path.join(root, 'binary');
    await writeFile(text, 'ATTACHMENT_MARKER'); await writeFile(image, Buffer.from([137,80,78,71,13,10,26,10])); await writeFile(binary, Buffer.from([0,1,2]));
    await expect(host.sendPrompt(agent, 'bad', { attachments: [{ type: 'file', path: binary }] })).rejects.toThrow(/binary/i);
    await host.sendPrompt(agent, 'hello', { attachments: [{ type: 'file', path: text }, { type: 'image', path: image }] });
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const prompts = (await wire()).filter(call => call.method === 'session/prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].params.prompt.slice(1)).toStrictEqual([
      { type: 'resource', resource: { uri: new URL(`file://${text}`).href, mimeType: 'text/plain', text: 'ATTACHMENT_MARKER' } },
      { type: 'image', mimeType: 'image/png', data: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') },
    ]);
  });
  it('restores presentation and attachments after close/load without exposing developer context', async () => {
    const file = path.join(root, 'notes.txt'), image = path.join(root, 'picture.png'); await writeFile(file, 'MARKER');
    await writeFile(image, Buffer.from([137,80,78,71,13,10,26,10]));
    const first = await host.sendPrompt(agent, 'My prompt', { attachments: [{ type: 'file', path: file }, { type: 'image', path: image, mimeType: 'image/png' }] });
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const liveUser = (await snapshot()).messages.find(message => message.role === 'user')!;
    expect(liveUser.parts).toContainEqual({ type: 'attachment', attachment: { kind: 'file', name: 'notes.txt', path: file } });
    await host.close(); host = createProviderDriver('cursor'); events = []; host.onEvent(event => events.push(event));
    const saved = { ...agent, providerSession: first.providerSession };
    await host.loadConversation!(saved);
    const frame = events.find(event => event.type === 'conversation.sessionSnapshot')!;
    if (frame.type !== 'conversation.sessionSnapshot') throw new Error('No snapshot');
    const user = frame.payload.snapshot.state.messages.find(message => message.role === 'user')!;
    expect(user.parts).toStrictEqual(liveUser.parts);
    expect(user.parts.filter(part => part.type === 'attachment')).toHaveLength(2);
    expect(JSON.stringify(frame)).not.toContain('<context');
    expect(user.createdAt).toBe('');
  });
  it('lists workspace history without creating a session and explicitly resumes only idle validated targets', async () => {
    const history = await host.listConversations!(agent, { searchTerm: 'saved', limit: 1 });
    expect(history).toMatchObject([{ sessionId: 'saved-session', updatedAt: '', ref: { provider: 'cursor', folder: root, conversationId: 'saved-session' } }]);
    expect((await wire()).some(call => call.method === 'session/new')).toBe(false);
    await expect(host.resumeConversation!(agent, { ref: { provider: 'cursor', folder: root, conversationId: 'foreign-session' }, storageState: 'active' })).rejects.toThrow(/workspace/);
    const resumed = await host.resumeConversation!(agent, { ref: history[0]!.ref, storageState: 'active' });
    expect(resumed.providerSession).toStrictEqual({ kind: 'cursor', conversationId: 'saved-session' });
    const active = await host.sendPrompt({ ...agent, providerSession: resumed.providerSession }, 'wait');
    await expect(host.resumeConversation!(agent, { ref: history[0]!.ref, storageState: 'active' })).rejects.toThrow(/current|finish/i);
    await host.interrupt(agent, active.turnId);
  });
  it('cancels an explicit resume during replay without adopting its session', async () => {
    await writeFile(path.join(root, 'hold-load'), '');
    const pending = host.resumeConversation!(agent, { ref: { provider: 'cursor', folder: root, conversationId: 'saved-session' }, storageState: 'active' }).catch(error => error);
    await vi.waitFor(async () => expect((await wire()).some(call => call.method === 'session/load')).toBe(true));
    await host.releaseConversation!(agent.id);
    expect(await pending).toBeInstanceOf(Error);
    expect(events.filter(event => event.type === 'conversation.sessionSnapshot')).toStrictEqual([]);
  });
  it('reads validated stored messages without replacing the live session or emitting execution frames', async () => {
    const first = await host.sendPrompt(agent, 'hello'); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const before = events.length; const observations: unknown[] = []; host.onUsage!(value => observations.push(value));
    const messages = await host.readConversationMessages!({ provider: 'cursor',folder:root,conversationId:'saved-session'},agent.id);
    expect(JSON.stringify(messages)).toContain('Remember synthetic marker');
    expect(events.slice(before).filter(event => event.type.startsWith('cursor.'))).toStrictEqual([]);
    expect(observations).toStrictEqual([]);
    await expect(host.readConversationMessages!({ provider: 'cursor',folder:root,conversationId:'foreign-session'},agent.id)).rejects.toThrow(/workspace/i);
    await host.sendPrompt({...agent,providerSession:first.providerSession},'continue'); await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
  });
  it.each([
    {isAuthenticated:false},
    {isAuthenticated:true,userInfo:{email:'new@example.invalid',teamName:'First'}},
    {isAuthenticated:true,userInfo:{email:'first@example.invalid',teamName:'Second'}},
  ])('invalidates cached sessions and pending callbacks on observed authentication identity changes (%j)', async status => {
    await writeFile(path.join(root,'status.json'),JSON.stringify({isAuthenticated:true,userInfo:{email:'first@example.invalid',teamName:'First'}}));
    await host.sendPrompt(agent,'extension');
    await vi.waitFor(async () => expect((await snapshot()).requests).toHaveLength(1));
    const request = (await snapshot()).requests[0]!;
    await writeFile(path.join(root,'status.json'),JSON.stringify(status));
    await host.authenticate!({action:'check'});
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await snapshot()).requests).toStrictEqual([]);
    await expect(host.respondToAgentRequest({id:request.id,agentId:agent.id,outcome:{kind:'decision',decision:'allow'}})).rejects.toThrow(/pending/i);
    await expect(host.sendPrompt(agent,'must-not-run')).rejects.toThrow(/closed|reconnect|disconnected|identity changed/i);
    expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1);
  });
  it('preserves the signed-out replica and rehydrates the conversation only for the same account after explicit sign-in', async () => {
    const loggedIn = {isAuthenticated:true,userInfo:{email:'owner@example.invalid',teamName:'Team'}};
    await writeFile(path.join(root,'status.json'),JSON.stringify(loggedIn));
    const first = await host.sendPrompt(agent,'hello'); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const saved = {...agent,providerSession:first.providerSession};
    await writeFile(path.join(root,'status.json'),JSON.stringify({isAuthenticated:false})); await host.authenticate!({action:'check'});
    const before = await snapshot();
    await expect(host.sendPrompt(saved,'signed-out')).rejects.toThrow(/sign in|disconnected/i);
    expect((await snapshot()).messages).toStrictEqual(before.messages);
    await writeFile(path.join(root,'status.json'),JSON.stringify(loggedIn)); await host.authenticate!({action:'check'});
    // The agent's conversation is the one this driver opened, whether or not the record handed in names it.
    await host.sendPrompt(agent,'recovered'); await vi.waitFor(() => expect(completions()).toHaveLength(2));
    await host.sendPrompt(saved,'again'); await vi.waitFor(() => expect(completions()).toHaveLength(3));
    expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
    expect((await wire()).filter(call => call.method === 'session/load')).toHaveLength(1);
    await writeFile(path.join(root,'status.json'),JSON.stringify({isAuthenticated:true,userInfo:{email:'other@example.invalid',teamName:'Team'}})); await host.authenticate!({action:'check'});
    await expect(host.sendPrompt(saved,'wrong-account')).rejects.toThrow(/account|identity/i);
    expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(3);
  });
  it('selects catalog plan mode before a prompt and restores agent mode for the following normal prompt', async () => {
    const first = await host.sendPrompt(agent,'hello',{planMode:true}); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    await host.sendPrompt({...agent,providerSession:first.providerSession},'normal'); await vi.waitFor(() => expect(completions()).toHaveLength(2));
    const calls = (await wire()).filter(call => call.method === 'session/set_config_option' || call.method === 'session/prompt');
    expect(calls.map(call => [call.method,call.params.value ?? call.params.prompt[0].text.split('\n')[0]])).toStrictEqual([
      ['session/set_config_option','plan'],['session/prompt','hello'],['session/set_config_option','agent'],['session/prompt','normal'],
    ]);
  });
  it('rejects plan mode missing from the native catalog without sending a prompt', async () => {
    await writeFile(path.join(root,'no-plan'),'');
    await expect(host.sendPrompt(agent,'must-not-run',{planMode:true})).rejects.toThrow(/plan|mode/i);
    expect((await wire()).some(call => call.method === 'session/prompt')).toBe(false);
  });
  it('fails closed on a mode acknowledgment that disagrees and rechecks authoritative mode after a model change', async () => {
    await writeFile(path.join(root,'bad-mode-ack'),'');
    await expect(host.sendPrompt(agent,'must-not-run',{planMode:true})).rejects.toThrow(/mode|confirm/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
    await rm(path.join(root,'bad-mode-ack'));
    await host.sendPrompt(agent,'hello',{planMode:true,selection:{model:'composer-2.5'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    await host.sendPrompt(agent,'again',{planMode:true,selection:{model:'auto'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(2));
    expect((await wire()).filter(call=>call.method==='session/set_config_option' && call.params.configId==='mode').map(call=>call.params.value)).toStrictEqual(['plan','plan','plan']);
  });
  it('rejects an empty mode acknowledgment before prompt admission', async () => {
    await writeFile(path.join(root,'no-mode-ack'),'');
    await expect(host.sendPrompt(agent,'must-not-run',{planMode:true})).rejects.toThrow(/mode|confirm/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
  });
  it('preserves edit changes, locations, resource text and images through live output and cold replay', async () => {
    const first = await host.sendPrompt(agent,'rich-output'); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    const verify = (state: SessionState) => {
      expect(state.turns.at(-1)?.status).toBe('completed');
      const parts = state.messages.flatMap(message=>message.parts);
      const tool = parts.find(part=>part.type==='tool' && part.title==='Edit note.txt');
      expect(tool).toMatchObject({statusText:JSON.stringify({source:'cursor',action:'edit',phase:'completed',params:{target:'note.txt',path:'note.txt'}}),kind:'fileChange',status:'completed',input:{path:'note.txt'},output:{native:'retained'},metadata:{cwd:root,locations:[{path:'note.txt',line:2}],changes:[{path:'note.txt',kind:'update',oldText:'before\nlast line',newText:'after\nlast line\n'}]}});
      if (tool?.type !== 'tool') throw new Error('No edit tool');
      expect(tool.metadata).toStrictEqual({cursorToolKind:'edit',cwd:root,locations:[{path:'note.txt',line:2}],changes:[{path:'note.txt',kind:'update',oldText:'before\nlast line',newText:'after\nlast line\n'}]});
      expect(parts).toContainEqual(expect.objectContaining({type:'tool',title:'Delete removed.txt',metadata:expect.objectContaining({changes:[{path:'removed.txt',kind:'delete',oldText:'gone',newText:''}]})}));
      expect(parts).toContainEqual(expect.objectContaining({type:'tool',title:'Write added.txt',metadata:expect.objectContaining({changes:[{path:'added.txt',kind:'add',oldText:null,newText:'created'}]})}));
      expect(tool.body).toContain('before'); expect(tool.body).toContain('after'); expect(tool.body).toContain('RESOURCE_MARKER');
      expect(parts.filter(part=>part.type==='media').map(part=>part.type==='media' && part.media.url)).toStrictEqual(['data:image/png;base64,iVBORw0KGgo=','data:image/png;base64,iVBORw0KGgo=']);
      expect(parts).toContainEqual({type:'text',text:'Rich output complete'});
      const mcp = parts.find(part=>part.type==='tool' && part.title==='korus: send-message');
      expect(mcp).toMatchObject({kind:'mcp',input:{to:'other-agent',message:'Hello'},output:{recipientName:'Other Agent'},metadata:{server:'korus',tool:'send-message',cursorMcpInput:{providerIdentifier:'korus',toolName:'send-message',args:{to:'other-agent',message:'Hello'}}}});
      expect(mcp?.type==='tool' && mcp.metadata?.displayTitle).toBeUndefined();
    };
    verify(await snapshot());
    await host.close(); host=createProviderDriver('cursor'); events=[]; host.onEvent(event=>events.push(event));
    await host.loadConversation!({...agent,providerSession:first.providerSession});
    verify(await snapshot());
  });
  it.each([false,true])('observes a validated workspace image without claiming generated success (notification=%s)', async notification => {
    const image=path.join(root,'observed.png'); await writeFile(image,Buffer.from(observedPng,'base64'));
    await writeFile(path.join(root,'image-event.json'),JSON.stringify({filePath:image,notification}));
    await host.sendPrompt(agent,'image-observation'); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    expect((await snapshot()).messages.flatMap(message=>message.parts).filter(part=>part.type==='media')).toStrictEqual([{type:'media',itemId:'cursor-file:native-image',media:{url:`data:image/png;base64,${observedPng}`,mimeType:'image/png',alt:'Image file',title:'Image file'}}]);
    expect((await snapshot()).messages.flatMap(message=>message.parts).filter(part=>part.type==='tool')).toContainEqual(expect.objectContaining({status:'failed',output:{native:'unchanged'}}));
    if (!notification) await vi.waitFor(async()=>expect((await wire()).find(call=>call.id===5 && call.result)?.result).toStrictEqual({outcome:{outcome:'cancelled'}}));
  });
  it.each(['missing','outside','symlink','directory','binary','oversized'])('does not display an unverified %s image path', async kind => {
    const outside=await mkdtemp(path.join(tmpdir(),'cursor-image-outside-'));
    try {
      let file=path.join(root,'unverified.png');
      if (kind==='outside' || kind==='symlink') { const target=path.join(outside,'image.png'); await writeFile(target,Buffer.from('iVBORw0KGgo=','base64')); if(kind==='outside') file=target; else await symlink(target,file); }
      if (kind==='directory') await mkdir(file);
      if (kind==='binary') await writeFile(file,'not an image');
      if (kind==='oversized') await writeFile(file,Buffer.alloc(5*1024*1024+1));
      vi.mocked(realpath).mockClear();
      await writeFile(path.join(root,'image-event.json'),JSON.stringify({filePath:file}));
      await host.sendPrompt(agent,'image-observation'); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
      expect((await snapshot()).messages.flatMap(message=>message.parts).filter(part=>part.type==='media')).toStrictEqual([]);
      if(kind==='outside') expect(vi.mocked(realpath).mock.calls.filter(([requested])=>requested===file)).toStrictEqual([]);
    } finally { await rm(outside,{recursive:true,force:true}); }
  });
  it.each(['symlink-swap','release'])('drops an image observation after %s during the open/read boundary', async action => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const image=path.join(root,'delayed.png'), outside=await mkdtemp(path.join(tmpdir(),'cursor-image-race-'));
    let reached=false, resumeRead!:()=>void;
    const resume=new Promise<void>(resolve=>{resumeRead=resolve;});
    await writeFile(image,Buffer.from(observedPng,'base64'));
    await writeFile(path.join(root,'image-event.json'),JSON.stringify({filePath:image,notification:true}));
    vi.mocked(open).mockImplementation(async (file,flags,mode)=>{ const handle=await actual.open(file,flags,mode); if(path.basename(String(file))==='delayed.png'){reached=true;await resume;} return handle; });
    try {
      await host.sendPrompt(agent,'image-observation'); await vi.waitFor(()=>expect(reached).toBe(true));
      let closing:Promise<void>|undefined;
      if(action==='release') closing=host.releaseConversation!(agent.id) as Promise<void>;
      else { const target=path.join(outside,'outside.png'); await writeFile(target,Buffer.from(observedPng,'base64')); await rm(image); await symlink(target,image); }
      resumeRead(); await closing;
      if(action!=='release') await vi.waitFor(()=>expect(completions()).toHaveLength(1));
      expect((await snapshot()).messages.flatMap(message => message.parts).filter(part => part.type === 'media')).toStrictEqual([]);
    } finally {resumeRead();vi.mocked(open).mockImplementation(actual.open);await rm(outside,{recursive:true,force:true});}
  });
  it('discovers model-specific enum effort and admits only exact native config IDs/values without changing thinking', async () => {
    await writeFile(path.join(root,'rich-models'),'');
    const models=await host.listModels!(agent);
    expect(models.find(model=>model.id==='fixture-alpha')).toMatchObject({defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'extra-high'}]});
    expect(models.find(model=>model.id==='fixture-alpha')?.description).toBe('Context: 300K');
    expect(models.find(model=>model.id==='fixture-beta')?.description).toBe('Context: 1M');
    for (const id of ['fixture-dual','fixture-thinking','auto','composer-2.5']) expect(models.find(model=>model.id===id)?.description).toBeUndefined();
    expect(models.find(model=>model.id==='fixture-thinking')?.supportedReasoningEfforts).toBeUndefined();
    expect(models.find(model=>model.id==='auto')?.supportedReasoningEfforts).toBeUndefined();
    await host.sendPrompt(agent,'hello',{selection:{model:'fixture-alpha',reasoningEffort:'extra-high'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    await host.sendPrompt(agent,'hello',{selection:{model:'fixture-beta',reasoningEffort:'xhigh'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(2));
    await host.sendPrompt(agent,'hello',{selection:{model:'fixture-dual',reasoningEffort:'low'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(3));
    await expect(host.sendPrompt(agent,'must-not-run',{selection:{model:'fixture-alpha',reasoningEffort:'xhigh'}})).rejects.toThrow(/effort|reasoning/i);
    expect((await wire()).filter(call=>call.method==='session/set_config_option').some(call=>call.params.configId==='context')).toBe(false);
    const setters=(await wire()).filter(call=>call.method==='session/set_config_option' && !['model','mode'].includes(call.params.configId));
    expect(setters.map(call=>[call.params.configId,call.params.value])).toStrictEqual([['reasoning','extra-high'],['reasoning_effort','xhigh'],['effort','low']]);
    expect((await wire()).filter(call=>call.method==='cursor/list_available_models')).toHaveLength(1);
    const prompts=(await wire()).filter(call=>call.method==='session/prompt').length;
    await expect(host.sendPrompt(agent,'must-not-run',{selection:{serviceTier:'fast'}})).rejects.toThrow(/tier/i);
    expect((await wire()).filter(call=>call.method==='session/prompt')).toHaveLength(prompts);
  });
  it('clears inherited effort on model changes and honors explicit null without resetting native thought settings', async () => {
    await writeFile(path.join(root,'rich-models'),'');
    const defaults={...agent,providerDefaults:{kind:'cursor' as const,model:'fixture-alpha',reasoningEffort:'extra-high'}};
    await host.sendPrompt(defaults,'hello'); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    await host.sendPrompt(defaults,'hello',{selection:{reasoningEffort:null}}); await vi.waitFor(()=>expect(completions()).toHaveLength(2));
    await host.sendPrompt(defaults,'hello',{selection:{model:'fixture-beta'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(3));
    await writeFile(path.join(root,'native-thinking-change'),'');
    // A conversation that stays open keeps its own settings: a change of saved model reaches it as an explicit selection.
    const dual={...agent,providerDefaults:{kind:'cursor' as const,model:'fixture-dual'}};
    await host.sendPrompt(dual,'hello',{selection:{model:'fixture-dual'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(4));
    await host.sendPrompt(dual,'hello',{selection:{reasoningEffort:null}}); await vi.waitFor(()=>expect(completions()).toHaveLength(5));
    expect((await wire()).filter(call=>call.fixture==='prompt-admission').map(call=>({model:call.model,thoughts:call.thoughts}))).toStrictEqual([
      {model:'fixture-alpha',thoughts:{reasoning:'extra-high'}},{model:'fixture-alpha',thoughts:{reasoning:'extra-high'}},{model:'fixture-beta',thoughts:{reasoning_effort:'medium'}},
      {model:'fixture-dual',thoughts:{thinking:'false',effort:'high'}},{model:'fixture-dual',thoughts:{thinking:'true',effort:'high'}},
    ]);
    expect((await wire()).filter(call=>call.method==='session/set_config_option' && !['model','mode'].includes(call.params.configId)).map(call=>[call.params.configId,call.params.value])).toStrictEqual([['reasoning','extra-high']]);
  });
  it.each(['empty','value','config-id','model','model-id','model-category'])('rejects a contradictory %s reasoning acknowledgment before prompt admission', async mismatch => {
    await writeFile(path.join(root,'rich-models'),'');
    if(mismatch==='model-id') await writeFile(path.join(root,'missing-live-model-id'),'');
    const configOptions=mismatch==='empty'?[]:[{...(mismatch==='model-id'?{}:{id:'model'}),category:mismatch==='model-category'?'other':'model',type:'select',currentValue:mismatch==='model'?'fixture-beta':'fixture-alpha',options:[{value:'fixture-alpha',name:'Alpha'}]}, {id:mismatch==='config-id'?'effort':'reasoning',category:'thought_level',type:'select',currentValue:mismatch==='value'?'low':'extra-high',options:[{value:'low',name:'Low'},{value:'extra-high',name:'Extra high'}]}];
    await writeFile(path.join(root,'effort-ack.json'),JSON.stringify({configOptions}));
    await expect(host.sendPrompt(agent,'must-not-run',{selection:{...(mismatch==='model-id'?{}:{model:'fixture-alpha'}),reasoningEffort:'extra-high'}})).rejects.toThrow(/effort|reasoning|confirm/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
  });
  it('falls back only on method-not-found and derives current-model effort from live configuration', async () => {
    await writeFile(path.join(root,'rich-models'),''); await writeFile(path.join(root,'catalog-error.json'),JSON.stringify({code:-32601,message:'private-native-detail'}));
    const models=await host.listModels!(agent);
    expect(models.find(model=>model.id==='fixture-alpha')).toMatchObject({supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'extra-high'}]});
    expect(models.find(model=>model.id==='fixture-beta')?.supportedReasoningEfforts).toBeUndefined();
    await host.sendPrompt(agent,'hello',{selection:{reasoningEffort:'extra-high'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
  });
  it.each(['rpc','malformed'])('does not hide a %s catalog failure as an old-CLI fallback', async failure => {
    await writeFile(path.join(root,failure==='rpc'?'catalog-error.json':'catalog-result.json'),JSON.stringify(failure==='rpc'?{code:-32000,message:'private-native-detail'}:{models:[{value:'bad',name:'Bad',configOptions:'invalid'}]}));
    await expect(host.listModels!(agent)).rejects.toThrow(/Cursor/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('private-native-detail');
  });
  it('cancels held reasoning discovery without attaching an agent snapshot', async () => {
    await writeFile(path.join(root,'hold-model-catalog'),'');
    const pending=host.listModels!(agent).catch(error=>error);
    await vi.waitFor(async()=>expect((await wire()).some(call=>call.method==='cursor/list_available_models')).toBe(true));
    await host.releaseConversation!(agent.id); expect(await pending).toBeInstanceOf(Error);
    expect(events.filter(event=>event.type==='conversation.sessionSnapshot')).toStrictEqual([]);
  });
  it('keeps a failed effort acknowledgment untrusted until model selection is confirmed again', async () => {
    await writeFile(path.join(root,'rich-models'),''); await writeFile(path.join(root,'effort-ack.json'),JSON.stringify({configOptions:[]}));
    await expect(host.sendPrompt(agent,'bad',{selection:{model:'fixture-alpha',reasoningEffort:'extra-high'}})).rejects.toThrow(/reasoning/);
    await rm(path.join(root,'effort-ack.json'));
    await expect(host.sendPrompt(agent,'must-not-run')).rejects.toThrow(/confirm|configuration/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
    await host.sendPrompt(agent,'recovered',{selection:{model:'fixture-alpha',reasoningEffort:'extra-high'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    expect((await wire()).filter(call=>call.method==='session/set_config_option' && call.params.configId==='model')).toHaveLength(1);
  });
  it('validates plan mode after effort has changed authoritative mode metadata', async () => {
    await writeFile(path.join(root,'rich-models'),''); await writeFile(path.join(root,'effort-resets-mode'),'');
    await host.sendPrompt(agent,'hello',{planMode:true,selection:{model:'fixture-beta',reasoningEffort:'xhigh'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    expect((await wire()).filter(call=>call.method==='session/set_config_option').map(call=>[call.params.configId,call.params.value])).toStrictEqual([['model','fixture-beta'],['reasoning_effort','xhigh'],['mode','plan']]);
  });
  it.each(['model','effort'])('rejects a final mode acknowledgment that changes the requested %s', async mismatch => {
    await writeFile(path.join(root,'rich-models'),'');
    await writeFile(path.join(root,'mode-selection-ack.json'),JSON.stringify({configOptions:[
      {id:'mode',category:'mode',currentValue:'plan',options:[{value:'plan',name:'Plan'},{value:'agent',name:'Agent'}]},
      {id:'model',category:'model',currentValue:mismatch==='model'?'fixture-beta':'fixture-alpha',options:[{value:'fixture-alpha',name:'Alpha'}]},
      {id:'reasoning',category:'thought_level',type:'select',currentValue:mismatch==='effort'?'low':'extra-high',options:[{value:'low',name:'Low'},{value:'extra-high',name:'Extra high'}]},
    ]}));
    await expect(host.sendPrompt(agent,'must-not-run',{planMode:true,selection:{model:'fixture-alpha',reasoningEffort:'extra-high'}})).rejects.toThrow(/model|reasoning|selection|confirm/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
  });
  it('switches an untouched agent to Cursor through the app boundary and accepts its first prompt', async () => {
    const state = createTestSnapshot();
    state.agents = [{ ...agent, provider: 'codex', providerDefaults: { kind: 'codex', model: 'must-not-leak' }, providerSession: undefined }];
    state.teams[0]!.agentIds = [agent.id]; state.teams[0]!.activeAgentId = agent.id; state.activeAgentId = agent.id;
    state.providerConnections = [{ provider: 'cursor', installed: true, connected: true, checking: false }];
    const server = new AppBackendServer({ version: 'fixture', snapshot: state, driverRpc: new ProviderDriverRpc(new Map([['cursor', host]])) });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/update', params: { input: { id: agent.id, selection: { provider: 'cursor' } } } });
      expect(state.agents[0]).toMatchObject({ provider: 'cursor', providerDefaults: { kind: 'cursor' } });
      expect(state.agents[0]!.providerDefaults?.model).toBeUndefined();
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'hello', expectedSessionId: null } });
      await vi.waitFor(() => expect(completions()).toHaveLength(1));
      expect(state.agents[0]!.providerSession).toMatchObject({ kind: 'cursor' });
      expect(state.agents[0]!.status.type).toBe('idle');
    } finally { await server.close(); }
  });
  it('starts two independent agents without sharing transcripts or failing a concurrent auth check', async () => {
    const second = { ...agent, id: 'second-cursor-agent' };
    const results = await Promise.all([host.sendPrompt(agent, 'hello'), host.sendPrompt(second, 'hello')]);
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect(results[0]!.providerSession).not.toEqual(results[1]!.providerSession);
    await host.loadConversation!(second);
    const frames = events.filter(event => event.type === 'conversation.sessionSnapshot');
    expect(frames.at(-1)).toMatchObject({ agentId: second.id });
  });
  it('handshakes, streams split text/thought/tool frames and serializes two prompts with developer context', async () => {
    const first = await host.sendPrompt(agent, 'hello');
    const second = await host.sendPrompt({ ...agent, providerSession: first.providerSession }, 'again');
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    const state = await snapshot();
    expect(state.turns.map(turn => turn.status)).toEqual(['completed', 'completed']);
    expect(state.messages.flatMap(message => message.parts).filter(part => part.type === 'text')).toContainEqual({ type: 'text', text: 'Hello Cursor' });
    expect(state.messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({ type: 'tool', title: 'Read synthetic.txt', status: 'completed', body: 'synthetic contents' }));
    expect(second.providerSession).toEqual(first.providerSession);
    const calls = await wire();
    expect(calls.slice(0, 3).map(call => call.method)).toEqual(['initialize', 'authenticate', 'session/new']);
    expect(calls[0].params.clientCapabilities).toEqual({ _meta: { parameterizedModelPicker: true } });
    expect(calls[1].params).toEqual({ methodId: 'cursor_login' });
    expect(calls[2].params).toEqual({ cwd: root, mcpServers: [] });
    expect(calls.find(call => call.method === 'session/prompt').params.prompt[0].text).toContain('<context id=');
    expect(calls.find(call => call.method === 'session/prompt').params.prompt[0].text).toContain(`agent ID is ${agent.id}`);
    expect(host.getCapabilities(agent)).toMatchObject({ interrupt: true, approvals: false, history: true, models: true });
  });
  it('denies permissions using the native reject option and keeps a completed-but-rejected tool visibly failed', async () => {
    await host.sendPrompt(agent, 'permission');
    await vi.waitFor(async () => expect((await snapshot()).requests).toHaveLength(1));
    await host.respondToAgentRequest({ id: (await snapshot()).requests[0]!.id, agentId: agent.id, outcome: { kind: 'decision', decision: 'deny' } });
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await wire()).find(call => call.id === 1 && call.result)?.result).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } });
    await expect(access(path.join(root, 'should-not-exist'))).rejects.toThrow();
    expect((await snapshot()).messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({ type: 'tool', status: 'failed', body: expect.stringMatching(/denied/i) }));
  });
  it.each([
    {prompt:'permission',outcome:{kind:'decision',decision:'deny'},nativeId:1,native:{outcome:{outcome:'selected',optionId:'reject-once'}}},
    {prompt:'extension',outcome:{kind:'decision',decision:'allow'},nativeId:2,native:{outcome:{outcome:'accepted'}}},
    {prompt:'question',outcome:{kind:'answered',answers:{mode:{answers:['Fast']},extras:{answers:['One']}}},nativeId:4,native:{outcome:{outcome:'answered',answers:[{questionId:'mode',selectedOptionIds:['fast-id']},{questionId:'extras',selectedOptionIds:['one-id']}]}}},
  ] as const)('round-trips $prompt through the daemon request registry', async ({prompt,outcome,nativeId,native}) => {
    const state = createTestSnapshot(); state.agents = [{...agent}]; state.activeAgentId=agent.id;
    state.teams[0]!.agentIds=[agent.id]; state.teams[0]!.activeAgentId=agent.id;
    state.providerConnections=[{provider:'cursor',installed:true,connected:true,checking:false}];
    const server = new AppBackendServer({version:'fixture',snapshot:state,driverRpc:new ProviderDriverRpc(new Map([['cursor',host]]))});
    try {
      await server.handleMessage({jsonrpc:'2.0',id:'prompt',method:'agent/prompt/send',params:{agentId:agent.id,prompt,expectedSessionId:null,options:{planMode:prompt==='extension'}}});
      await vi.waitFor(async()=>expect((await snapshot()).requests).toHaveLength(1));
      const request=(await snapshot()).requests[0]!;
      const response={id:request.id,agentId:agent.id,outcome};
      await expect(server.handleMessage({jsonrpc:'2.0',id:'answer',method:'agent/request/respond',params:{response}})).resolves.toMatchObject({result:expect.any(Object)});
      await vi.waitFor(()=>expect(completions()).toHaveLength(1));
      expect((await snapshot()).requests).toStrictEqual([]);
      expect(state.agentRequests?.[agent.id]??[]).toStrictEqual([]);
      expect((await wire()).find(call=>call.id===nativeId&&call.result)?.result).toStrictEqual(native);
      await expect(server.handleMessage({jsonrpc:'2.0',id:'duplicate',method:'agent/request/respond',params:{response}})).rejects.toThrow(/no longer pending/i);
    } finally {await server.close();}
  });
  it.each(['accept','cancel','revise','interrupt'] as const)('uses the shared sidebar review for a blocking native Cursor plan: %s', async resolution => {
    const state=createTestSnapshot();state.agents=[{...agent}];state.activeAgentId=agent.id;state.teams[0]!.agentIds=[agent.id];state.teams[0]!.activeAgentId=agent.id;
    state.providerConnections=[{provider:'cursor',installed:true,connected:true,checking:false}];
    const server=new AppBackendServer({version:'fixture',snapshot:state,driverRpc:new ProviderDriverRpc(new Map([['cursor',host]]))});
    const respond=(response:object)=>server.handleMessage({jsonrpc:'2.0',id:'sidebar',method:'agent/planReview/respond',params:{agentId:agent.id,response}});
    try {
      await server.handleMessage({jsonrpc:'2.0',id:'prompt',method:'agent/prompt/send',params:{agentId:agent.id,prompt:'extension',expectedSessionId:null,options:{planMode:true}}});
      await vi.waitFor(()=>expect(state.agents[0]!.planReview?.status).toBe('pending'));
      const review=state.agents[0]!.planReview!;
      expect(review).toMatchObject({markdown:'# Synthetic plan',requestId:(await snapshot()).requests[0]!.id});
      expect((await wire()).some(call=>call.method==='session/set_config_option' && call.params.value==='plan')).toBe(true);
      if(resolution==='revise') {
        const draft={comments:[{id:'comment',sectionId:'section',quote:'Synthetic plan',body:'Keep English.'}],choices:[{id:'choice',quote:'Language',selected:['French file'],confirmed:true}]};
        await respond({reviewId:review.id,resolution:'save',draftVersion:0,draft});
        await writeFile(path.join(root,'revise-plan'),'');
        await respond({reviewId:review.id,resolution:'revise',draftVersion:1});
        await vi.waitFor(()=>expect(state.agents[0]!.planReview?.markdown).toBe('# Revised synthetic plan'));
        const rejection=(await wire()).find(call=>call.id===2&&call.result)?.result;
        expect(rejection).toMatchObject({outcome:{outcome:'rejected',reason:expect.stringContaining('Keep English.')}});
        expect(rejection.outcome.reason).toContain('French file');
        await respond({reviewId:state.agents[0]!.planReview!.id,resolution:'accept'});
      } else if (resolution === 'interrupt') await host.interrupt(agent);
      else await respond({reviewId:review.id,resolution});
      await vi.waitFor(()=>expect(completions()).toHaveLength(1));
      expect(state.agents[0]!.planReview?.status).toBe(resolution==='cancel'||resolution==='interrupt'?'cancel':'accept');
      expect((await wire()).filter(call=>call.method==='session/prompt')).toHaveLength(1);
      expect((await snapshot()).requests).toStrictEqual([]);
    } finally {await server.close();}
  });
  it('publishes ordinary native Plan-mode Markdown to the shared interactive sidebar', async () => {
    const state=createTestSnapshot();state.agents=[{...agent}];state.activeAgentId=agent.id;state.teams[0]!.agentIds=[agent.id];state.teams[0]!.activeAgentId=agent.id;
    state.providerConnections=[{provider:'cursor',installed:true,connected:true,checking:false}];
    const server=new AppBackendServer({version:'fixture',snapshot:state,driverRpc:new ProviderDriverRpc(new Map([['cursor',host]]))});
    try {
      await server.handleMessage({jsonrpc:'2.0',id:'prompt',method:'agent/prompt/send',params:{agentId:agent.id,prompt:'markdown-plan',expectedSessionId:null,options:{planMode:true}}});
      await vi.waitFor(()=>expect(state.agents[0]!.planReview?.status).toBe('pending'));
      expect(state.agents[0]!.planReview).toMatchObject({markdown:'# Translation\n\n## Where should French live?\n- ( ) Replace English\n- ( ) Add README.fr.md'});
      expect(state.agents[0]!.planReview?.requestId).toBeUndefined();
    } finally {await server.close();}
  });
  it('exposes a once-only plan decision and cancels pending callbacks on interruption', async () => {
    const first = await host.sendPrompt(agent, 'extension');
    await vi.waitFor(async () => expect((await snapshot()).requests).toHaveLength(1));
    const request = (await snapshot()).requests[0]!;
    await expect(host.respondToAgentRequest({ id: request.id, agentId: 'wrong', outcome: { kind: 'decision', decision: 'allow' } })).rejects.toThrow(/pending/i);
    await host.respondToAgentRequest({ id: request.id, agentId: agent.id, outcome: { kind: 'decision', decision: 'allow' } });
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await wire()).find(call => call.id === 2 && call.result)?.result).toStrictEqual({ outcome: { outcome: 'accepted' } });
    expect((await snapshot()).messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({type:'tool',status:'completed',metadata:expect.objectContaining({plan:'# Synthetic plan',todos:[]})}));
    await expect(host.respondToAgentRequest({ id: request.id, agentId: agent.id, outcome: { kind: 'decision', decision: 'allow' } })).rejects.toThrow(/pending/i);
    const next = await host.sendPrompt({ ...agent, providerSession: first.providerSession }, 'extension');
    await vi.waitFor(async () => expect((await snapshot()).requests).toHaveLength(1));
    await host.interrupt(agent, next.turnId);
    expect((await snapshot()).requests).toStrictEqual([]);
  });
  it('maps documented question choices back to exact native IDs and cancels unanswered questions on release', async () => {
    await host.sendPrompt(agent,'question');
    await vi.waitFor(async () => expect((await snapshot()).requests).toHaveLength(1));
    const request = (await snapshot()).requests[0]!;
    expect(request).toMatchObject({kind:'question',question:{questions:[{id:'mode',options:[{label:'Fast'},{label:'Safe'}]},{id:'extras',multiSelect:true}]}});
    expect((await wire()).find(call => call.id === 6 && call.result)?.result).toStrictEqual({outcome:{outcome:'accepted',todos:[{id:'todo-1',content:'Choose mode',status:'in_progress'}]}});
    expect((await wire()).find(call => call.id === 7 && call.result)?.result).toStrictEqual({outcome:{outcome:'cancelled'}});
    expect((await snapshot()).messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({type:'tool',metadata:expect.objectContaining({todos:[{id:'todo-1',content:'Choose mode',status:'in_progress'}]})}));
    await expect(host.respondToAgentRequest({id:request.id,agentId:agent.id,outcome:{kind:'answered',answers:{mode:{answers:['invented']},extras:{answers:['one-id']}}}})).rejects.toThrow(/choice|answer/i);
    await host.respondToAgentRequest({id:request.id,agentId:agent.id,outcome:{kind:'answered',answers:{mode:{answers:['Fast']},extras:{answers:['one-id','two-id']}}}});
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await wire()).find(call => call.id === 4 && call.result)?.result).toStrictEqual({outcome:{outcome:'answered',answers:[{questionId:'mode',selectedOptionIds:['fast-id']},{questionId:'extras',selectedOptionIds:['one-id','two-id']}]}});
    expect((await snapshot()).messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({type:'tool',metadata:expect.objectContaining({todos:[{id:'todo-1',content:'Choose mode',status:'completed'}]})}));
    expect((await snapshot()).messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({type:'tool',metadata:expect.objectContaining({planEntries:[{content:'Choose mode',priority:'medium',status:'in_progress'}]})}));
    await expect(host.respondToAgentRequest({id:request.id,agentId:agent.id,outcome:{kind:'cancelled'}})).rejects.toThrow(/pending/i);
    await host.sendPrompt(agent,'question');
    await vi.waitFor(async () => expect((await snapshot()).requests).toHaveLength(1));
    const next = (await snapshot()).requests[0]!;
    await host.releaseConversation!(agent.id);
    await expect(host.respondToAgentRequest({id:next.id,agentId:agent.id,outcome:{kind:'answered',answers:{}}})).rejects.toThrow(/pending/i);
  });
  it('preapproves only observed app MCP calls in the active turn without persistent permissions', async () => {
    await host.close(); host = createProviderDriver('cursor', { appMcpServerUrl: 'http://127.0.0.1:1234/mcp' }); host.onEvent(event => events.push(event));
    await writeFile(path.join(root,'mcp-permission.json'),JSON.stringify({}));
    const first = await host.sendPrompt(agent,'mcp-permission');
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await snapshot()).requests).toStrictEqual([]);
    expect(events.some(event=>event.type==='agentRequest.created')).toBe(false);
    expect((await wire()).find(call=>call.id===8&&call.result)?.result).toStrictEqual({outcome:{outcome:'selected',optionId:'native-mcp-once'}});
    await writeFile(path.join(root,'mcp-permission.json'),JSON.stringify({omitObservation:true}));
    await host.sendPrompt({...agent,providerSession:first.providerSession},'mcp-permission');
    await vi.waitFor(async()=>expect((await snapshot()).requests).toHaveLength(1));
    await host.respondToAgentRequest({agentId:agent.id,id:(await snapshot()).requests[0]!.id,outcome:{kind:'decision',decision:'deny'}});
    await vi.waitFor(()=>expect(completions()).toHaveLength(2));
  });
  it.each([
    {name:'another MCP server with a Korus-looking title',config:{input:{providerIdentifier:'external',toolName:'set-status'}}},
    {name:'shell with Korus-shaped arguments',config:{kind:'execute'}},
    {name:'missing observed tool identity',config:{omitObservation:true}},
    {name:'contradictory request identity',config:{requestInput:{providerIdentifier:'external',toolName:'set-status'}}},
    {name:'no once-only option',config:{noOnce:true}},
    {name:'no app gateway',config:{},noGateway:true},
    {name:'duplicate server identity',config:{},duplicate:true},
  ])('keeps manual permission for $name', async ({config,noGateway,duplicate}) => {
    await host.close(); host = createProviderDriver('cursor', { ...(!noGateway?{appMcpServerUrl:'http://127.0.0.1:1234/mcp'}:{}), ...(duplicate?{hostedMcpServerUrls:()=>({korus:'http://127.0.0.1:1235/mcp'})}:{}) }); host.onEvent(event=>events.push(event));
    await writeFile(path.join(root,'mcp-permission.json'),JSON.stringify(config));
    await host.sendPrompt(agent,'mcp-permission');
    await vi.waitFor(async()=>expect((await snapshot()).requests).toHaveLength(1));
    await host.respondToAgentRequest({agentId:agent.id,id:(await snapshot()).requests[0]!.id,outcome:{kind:'decision',decision:'deny'}});
    await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    expect((await wire()).find(call=>call.id===8&&call.result)?.result).toStrictEqual({outcome:{outcome:'selected',optionId:'native-mcp-reject'}});
  });
  it('binds each supplied app and hosted MCP bridge to its owning agent', async () => {
    await host.close(); host = createProviderDriver('cursor', { appMcpServerUrl: 'http://127.0.0.1:1234/mcp', hostedMcpServerUrls: () => ({ synthetic: 'http://127.0.0.1:1235/mcp' }) });
    const second = { ...agent, id: 'other-agent' };
    await host.listModels!(agent); await host.listModels!(second);
    const calls = (await wire()).filter(call => call.method === 'session/new');
    expect(calls).toHaveLength(2);
    for (const [index, owner] of [agent.id, second.id].entries()) {
      expect(calls[index].params.mcpServers.map((server: {env: {name:string;value:string}[]}) => new URL(server.env.find(env => env.name === 'HARNESS_ACP_MCP_URL')!.value).searchParams.get('agentId'))).toStrictEqual([owner, owner]);
    }
  });
  it.each([true, false])('keeps quota exhaustion connected and resumes only with a known reset (knownReset=%s)', async knownReset => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const reset = Math.ceil((Date.now() + 300_000) / 1000) * 1000;
    const state = createTestSnapshot(); state.agents = [{ ...agent }];
    state.providerConnections = [{ provider: 'cursor', installed: true, connected: true, checking: false }];
    const server = new AppBackendServer({ version: 'fixture', snapshot: state, driverRpc: new ProviderDriverRpc(new Map([['cursor', host]])) });
    try {
      if (knownReset) server.emitEvent({ type: 'account.rateLimitsUpdated', provider: 'cursor', payload: { rateLimits: {
        limitId: 'cursor', limitName: 'Included', primary: { usedPercent: 100, windowDurationMins: 43200, resetsAt: reset / 1000 }, secondary: null,
        credits: null, individualLimit: null, planType: null, rateLimitReachedType: null,
      } } });
      await server.handleMessage({ jsonrpc: '2.0', id: 'quota', method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'quota' } });
      await vi.waitFor(() => expect(completions()).toHaveLength(1));
      const reference = state.agents[0]!.providerSession;
      expect(host.getRuntimeStatus()).toMatchObject({ status: 'running' });
      expect(state.providerConnections[0]).toMatchObject({ connected: true });
      expect(events.filter(event => event.type === 'provider.authenticationChanged' && !event.payload.connected)).toStrictEqual([]);
      expect(JSON.stringify(events)).not.toContain('private.invalid');
      if (knownReset) {
        expect(state.agents[0]!.rateLimitPause).toMatchObject({ provider: 'cursor', resumeAt: reset, enabled: true });
        await vi.advanceTimersByTimeAsync(reset - Date.now() + 5_000);
      } else {
        expect(state.agents[0]!.rateLimitPause).toBeUndefined();
        await server.handleMessage({ jsonrpc: '2.0', id: 'retry', method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'hello' } });
      }
      await vi.waitFor(() => expect(completions()).toHaveLength(2));
      expect(state.agents[0]!.providerSession).toStrictEqual(reference);
      expect(state.agents[0]!.rateLimitPause).toBeFalsy();
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
      expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(2);
    } finally { vi.useRealTimers(); await server.close(); }
  });
  it('keeps an unanswered native plan alive overnight and settles it only on explicit interruption', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const state = createTestSnapshot(); state.agents = [{ ...agent }];
    state.providerConnections = [{ provider: 'cursor', installed: true, connected: true, checking: false }];
    const server = new AppBackendServer({ version: 'fixture', snapshot: state, driverRpc: new ProviderDriverRpc(new Map([['cursor', host]])) });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 'plan', method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'extension', options: { planMode: true } } });
      await vi.waitFor(() => expect(state.agents[0]!.planReview?.status).toBe('pending'));
      const reference = state.agents[0]!.providerSession;
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
      expect(completions()).toStrictEqual([]);
      expect(state.providerConnections[0]).toMatchObject({ connected: true });
      expect(state.agentRequests?.[agent.id]).toHaveLength(1);
      expect(state.agents[0]!.providerSession).toStrictEqual(reference);
      await server.handleMessage({ jsonrpc: '2.0', id: 'stop', method: 'agent/interrupt', params: { agentId: agent.id } });
      expect(state.agents[0]!.planReview?.status).toBe('cancel');
      expect(state.agentRequests?.[agent.id]).toStrictEqual([]);
      expect(completions()).toHaveLength(1);
    } finally { vi.useRealTimers(); await server.close(); }
  });
  it('keeps provider authentication connected after a conversation process failure and reloads its saved session on retry', async () => {
    const state = createTestSnapshot(); state.agents = [{ ...agent }];
    state.providerConnections = [{ provider: 'cursor', installed: true, connected: true, checking: false }];
    const server = new AppBackendServer({ version: 'fixture', snapshot: state, driverRpc: new ProviderDriverRpc(new Map([['cursor', host]])) });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 'fail', method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'eof' } });
      await vi.waitFor(() => expect(completions()).toHaveLength(1));
      const reference = state.agents[0]!.providerSession;
      expect(events.filter(event => event.type === 'provider.authenticationChanged' && !event.payload.connected)).toStrictEqual([]);
      expect(state.providerConnections[0]).toMatchObject({ connected: true });
      await server.handleMessage({ jsonrpc: '2.0', id: 'retry', method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'hello' } });
      await vi.waitFor(() => expect(completions()).toHaveLength(2));
      expect(state.agents[0]!.providerSession).toStrictEqual(reference);
      expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
      expect((await wire()).filter(call => call.method === 'session/load')).toHaveLength(1);
    } finally { await server.close(); }
  });
  it('interrupts once, ignores stale completion/chunks, and admits the next prompt', async () => {
    const first = await host.sendPrompt(agent, 'wait');
    await vi.waitFor(() => expect(events.some(event => (event.type === 'conversation.sessionPatch' || event.type === 'conversation.sessionSnapshot') && JSON.stringify(event.payload).includes('Hello'))).toBe(true));
    await host.interrupt(agent, first.turnId);
    await host.interrupt(agent, first.turnId);
    const continued = await host.continueInterruptedTurn!({ ...agent, providerSession: first.providerSession });
    expect(continued.providerSession).toStrictEqual(first.providerSession);
    expect(continued.activeTurnId).toBeTypeOf('string');
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
    const state = await snapshot();
    expect(state.turns.map(turn => turn.status)).toEqual(['interrupted', 'completed']);
    expect(JSON.stringify(state)).not.toContain('LATE');
    expect((await wire()).find(call => call.id === 3 && call.result)?.result).toEqual({ outcome: { outcome: 'cancelled' } });
  });
  it.each(['eof', 'protocol', 'auth-rpc', 'team', 'team-stderr', 'policy', 'policy-stderr', 'invalid-completion'])('terminates %s and disconnects authentication only for native auth/policy failures', async input => {
    await host.sendPrompt(agent, input); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const state = await snapshot();
    expect(state).toMatchObject({ busy: false, turns: [{ status: 'failed' }], error: expect.any(String) });
    expect(host.getRuntimeStatus()).toMatchObject({ status: 'error' });
    const disconnected = events.filter(event => event.type === 'provider.authenticationChanged' && !event.payload.connected);
    expect(disconnected).toHaveLength(input === 'auth-rpc' || input.startsWith('team') || input.startsWith('policy') ? 1 : 0);
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
    await expect(host.sendPrompt({ ...agent, providerSession: { kind: 'cursor', conversationId: 'wrong' } }, 'wrong')).rejects.toThrow('identity');
    await expect(host.sendPrompt({ ...agent, folder: path.join(root, 'different') }, 'wrong')).rejects.toThrow(/workspace|identity/);
    expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1);
    expect(first.providerSession.kind).toBe('cursor');
  });
  it('queues a prompt behind the active turn and releases it only after cancellation settles', async () => {
    const first = await host.sendPrompt(agent, 'wait');
    let admitted = false;
    const queued = host.sendPrompt({ ...agent, providerSession: first.providerSession }, 'again').then(result => { admitted = true; return result; });
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
      vi.useRealTimers();
      if (first.providerSession.kind !== 'cursor') throw new Error('Invalid session');
      await host.resumeConversation!(agent, { ref: { provider: 'cursor', folder: root, conversationId: first.providerSession.conversationId }, storageState: 'active' });
      await host.sendPrompt({ ...agent, providerSession: first.providerSession }, 'RECOVERED');
      await vi.waitFor(() => expect(completions()).toHaveLength(2));
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
    expect(events.some(event => event.type === 'conversation.sessionSnapshot')).toBe(false);
  });
});
