import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { claudeBackendCapabilities, codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { Agent } from '@workspace/core/contracts';
import { AppBackendServer } from '../../server';
import { BackendDriverRpc } from '../../driver-rpc';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { AppMcpService } from '../service';

const execute = promisify(execFile);
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function harness(backend: 'codex' | 'claude' = 'codex') {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'automatic-review-tool-'));
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  const git = async (...args: string[]) => (await execute('git', args, { cwd: folder })).stdout.trim();
  await git('init', '-b', 'main');
  await git('-c', 'user.name=Review Test', '-c', 'user.email=review@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'base');
  await writeFile(path.join(folder, 'change.txt'), 'review this\n');
  const snapshot = createTestSnapshot();
  const owner: Agent = {
    id: 'owner', name: 'Owner', teamId: 'team-test', folder, backend,
    backendSession: backend === 'codex' ? { kind: 'codex', threadId: 'owner-thread' } : { kind: 'claude', sessionId: 'owner-thread', transport: 'stdio' },
    backendDefaults: { kind: backend, model: 'stale-model', reasoningEffort: 'low' },
    status: { type: 'working' }, createdAt: 'now', updatedAt: 'now',
  };
  snapshot.agents.push(owner);
  snapshot.teams[0]!.agentIds.push(owner.id);
  snapshot.activeAgentId = owner.id;
  snapshot.general.codeReviewDefaults = {
    backend: backend === 'codex' ? 'claude' : 'codex', providers: { [backend]: { model: 'old-review-model', reasoningEffort: 'medium' } },
    automation: { enabled: true, maxPriority: 'p1', maxRounds: 4, autoCommit: true },
  };
  let emit: (event: BackendEvent) => void = () => undefined;
  let complete!: () => void;
  const pending = new Promise<void>(resolve => { complete = resolve; });
  const runCodeReview = vi.fn<NonNullable<AgentBackendDriver['runCodeReview']>>(async (agent, input) => {
    await pending;
    const result = await rpc(input.reviewMcpServerUrl, 'tools/call', { name: 'finish_review_round', arguments: { findingCount: 0 } });
    expect(result.isError).toBe(false);
    return { text: 'No findings.', reviewerSession: agent.backend === 'codex'
      ? { kind: 'codex', threadId: 'review-thread' }
      : { kind: 'claude', sessionId: 'review-thread', transport: 'stdio' } };
  });
  const driver = (kind: 'codex' | 'claude'): AgentBackendDriver => ({
    backend: kind, getRuntimeStatus: () => ({ backend: kind, status: 'running' }),
    getCapabilities: () => kind === 'codex' ? codexBackendCapabilities : claudeBackendCapabilities, runCodeReview,
    sendPrompt: vi.fn(), interrupt: vi.fn(), respondToAgentRequest: vi.fn(),
    onEvent: listener => { if (kind === backend) emit = listener; return () => undefined; }, close: vi.fn(),
  });
  let server!: AppBackendServer;
  const mcp = new AppMcpService({ snapshot, startAutomaticReview: (id, input) => server.startAutomaticReview(id, input) });
  const url = await mcp.start();
  cleanups.push(() => mcp.stop());
  const sendAgentMessage = vi.fn();
  const saveCodeReviewReport = vi.fn().mockResolvedValue('/reports/review.md');
  const saveSnapshot = vi.fn().mockResolvedValue(undefined);
  server = new AppBackendServer({
    version: 'test', snapshot, codeReviewTools: mcp, sendAgentMessage, saveCodeReviewReport, saveSnapshot,
    driverRpc: new BackendDriverRpc(new Map([['codex', driver('codex')], ['claude', driver('claude')]])),
  });
  cleanups.push(() => server.close());
  emit({
    agentId: owner.id, backend, conversationId: 'owner-thread', type: 'conversation.settingsUpdated',
    payload: { settings: { model: 'thread-model', reasoningEffort: 'high' } },
  });
  const call = (input: Record<string, unknown>, id = owner.id) => rpc(`${url}?agentId=${id}`, 'tools/call', { name: 'start_automatic_review', arguments: input });
  return { snapshot, owner, server, url, call, runCodeReview, complete, sendAgentMessage, saveCodeReviewReport, saveSnapshot, git };
}

async function rpc<T = CallToolResult>(url: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json() as { error?: { message: string }; result: T };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

describe('automatic-review launch over MCP', () => {
  it.each(['codex', 'claude'] as const)('launches independently with live %s settings, returns before completion, and reports back to that caller', async backend => {
    const test = await harness(backend);
    const savedDefaults = structuredClone(test.snapshot.general.codeReviewDefaults);
    const result = await test.call({ scope: { type: 'uncommitted' } });
    expect(result.isError).toBe(false);
    const reviewer = test.snapshot.agents.find(agent => agent.id !== test.owner.id)!;
    expect(result.structuredContent).toMatchObject({ success: true, reviewerAgentId: reviewer.id, reviewId: reviewer.codeReview!.id });
    expect(test.snapshot.activeAgentId).toBe(test.owner.id);
    expect(reviewer.codeReview).toMatchObject({
      targetAgentId: test.owner.id, threadMode: 'independent', scope: { type: 'uncommitted' },
      automation: { enabled: true, maxPriority: 'p1', maxRounds: 4, autoCommit: false },
    });
    await vi.waitFor(() => expect(test.runCodeReview).toHaveBeenCalledOnce());
    expect(test.runCodeReview.mock.calls[0]![0]).toMatchObject({ backend, backendDefaults: { model: 'thread-model', reasoningEffort: 'high' } });
    expect(test.sendAgentMessage).not.toHaveBeenCalled();
    test.complete();
    await vi.waitFor(() => expect(test.sendAgentMessage).toHaveBeenCalledWith(reviewer.id, test.owner.id, expect.stringContaining('No review findings to report.')));
    expect(test.saveCodeReviewReport).toHaveBeenCalledOnce();
    expect(test.snapshot.agents).toEqual([test.owner]);
    expect(test.owner.backendDefaults).toMatchObject({ model: 'thread-model', reasoningEffort: 'high' });
    expect(test.snapshot.general.codeReviewDefaults).toEqual(savedDefaults);
    expect(await test.git('rev-list', '--count', 'HEAD')).toBe('1');
    expect(await test.git('status', '--porcelain')).toBe('?? change.txt');
  });

  it('rejects malformed scope, unsupported options, and duplicate or nested launches without creating extra reviewers', async () => {
    const test = await harness();
    for (const input of [{}, { scope: { type: 'branch' } }, { scope: { type: 'uncommitted' }, maxRounds: 0 },
      { scope: { type: 'uncommitted' }, autoCommit: 'true' }, { scope: { type: 'uncommitted' }, agentId: 'someone-else' },
      { scope: { type: 'uncommitted' }, threadMode: 'current' }]) {
      expect((await test.call(input)).isError).toBe(true);
    }
    expect(test.snapshot.agents).toEqual([test.owner]);
    expect(test.runCodeReview).not.toHaveBeenCalled();
    await test.call({ scope: { type: 'uncommitted' } });
    const reviewer = test.snapshot.agents.find(agent => agent.id !== test.owner.id)!;
    const duplicate = await test.call({ scope: { type: 'uncommitted' } });
    expect(duplicate.isError).toBe(true);
    expect(duplicate.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('already has an active code review') });
    const catalog = await rpc<ListToolsResult>(`${test.url}?agentId=${reviewer.id}`, 'tools/list');
    expect(catalog.tools.map(tool => tool.name)).not.toContain('start_automatic_review');
    await expect(test.server.startAutomaticReview(reviewer.id, { scope: { type: 'uncommitted' } })).rejects.toThrow('Reviewers cannot launch');
    expect(test.snapshot.agents).toHaveLength(2);
    test.complete();
    await vi.waitFor(() => expect(test.sendAgentMessage).toHaveBeenCalledOnce());
  });

  it('honors explicit provider, model, effort, scope, and automation overrides', async () => {
    const test = await harness();
    const result = await test.call({ scope: { type: 'branch', baseRef: 'main' }, maxPriority: 'p3', maxRounds: 2, autoCommit: true, selection: { backend: 'claude', model: 'requested-model', reasoningEffort: 'medium', serviceTier: null } });
    expect(result.isError).toBe(false);
    await vi.waitFor(() => expect(test.runCodeReview).toHaveBeenCalledOnce());
    expect(test.runCodeReview.mock.calls[0]![0]).toMatchObject({
      backend: 'claude', backendDefaults: { model: 'requested-model', reasoningEffort: 'medium', serviceTier: null },
      codeReview: { scope: { type: 'branch', baseRef: 'main' }, automation: { maxPriority: 'p3', maxRounds: 2, autoCommit: true } },
    });
    test.complete();
    await vi.waitFor(() => expect(test.sendAgentMessage).toHaveBeenCalledOnce());
  });

  it('uses safe first-run limits and does not transfer the caller model to a different provider', async () => {
    const test = await harness();
    delete test.snapshot.general.codeReviewDefaults;
    expect((await test.call({ scope: { type: 'uncommitted' }, selection: { backend: 'claude' } })).isError).toBe(false);
    await vi.waitFor(() => expect(test.runCodeReview).toHaveBeenCalledOnce());
    const reviewer = test.runCodeReview.mock.calls[0]![0];
    expect(reviewer.backend).toBe('claude');
    expect(reviewer.backendDefaults?.model).not.toBe('thread-model');
    expect(reviewer.codeReview?.automation).toMatchObject({ maxPriority: 'p2', maxRounds: 3, autoCommit: false });
    test.complete();
    await vi.waitFor(() => expect(test.sendAgentMessage).toHaveBeenCalledOnce());
  });

  it('does not offer launches to quick chats or agents without a workspace', async () => {
    const test = await harness();
    for (const quickChat of [true, false]) {
      test.owner.sessionKind = quickChat ? 'quickChat' : undefined;
      if (!quickChat) test.owner.folder = null;
      const catalog = await rpc<ListToolsResult>(`${test.url}?agentId=${test.owner.id}`, 'tools/list');
      expect(catalog.tools.map(tool => tool.name)).not.toContain('start_automatic_review');
      expect((await test.call({ scope: { type: 'uncommitted' } })).isError).toBe(true);
      await expect(test.server.startAutomaticReview(test.owner.id, { scope: { type: 'uncommitted' } })).rejects.toThrow(/workspace/);
    }
    expect(test.snapshot.agents).toEqual([test.owner]);
    expect(test.runCodeReview).not.toHaveBeenCalled();
  });
});
