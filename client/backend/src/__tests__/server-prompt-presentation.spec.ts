import { describe, expect, it, vi } from 'vitest';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { AgentBackendDriver, BackendSendResult } from '@workspace/core/backend-driver';
import type { Agent } from '@workspace/core/contracts';
import { createTestSnapshot } from './server-test-fixtures';
import type { ReviewToolHandlers } from '../review/review-tool-registry';

describe('injected prompt presentation', () => {
  it.each([
    { source: 'mission', outcome: 'accepted' }, { source: 'mission', outcome: 'failed' },
    { source: 'review', outcome: 'accepted' }, { source: 'review', outcome: 'failed' },
  ] as const)('publishes $source injections before provider acceptance and cleans up when $outcome', async ({ source, outcome }) => {
    const snapshot = createTestSnapshot();
    const agent: Agent = { id: 'worker', name: 'Worker', folder: '/repo', backend: 'codex', teamId: 'team-test',
      pendingPrompts: [{ id: 'stale', text: 'Old injection', createdAt: '2026-11-09T00:00:00.000Z' }],
      backendSession: { kind: 'codex', threadId: 'thread' }, status: { type: 'idle' }, createdAt: 'now', updatedAt: 'now' };
    snapshot.agents = [agent]; snapshot.teams[0]!.agentIds = [agent.id];
    let release!: () => void;
    let fail!: (error: Error) => void;
    let handlers!: ReviewToolHandlers;
    const gate = new Promise<void>((resolve, reject) => { release = resolve; fail = reject; });
    const sendPrompt = vi.fn(async (): Promise<BackendSendResult> => { await gate; return { backendSession: agent.backendSession!, turnId: 'injected-turn' }; });
    const runCodeReview = vi.fn(async () => { await gate; await handlers.finishReviewRound({ findingCount: 0 }); return { text: 'Reviewed', reviewerSession: agent.backendSession! }; });
    const driver: AgentBackendDriver = { backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities, sendPrompt, runCodeReview, interrupt: vi.fn(), respondToAgentRequest: vi.fn(), onEvent: () => () => {}, close: vi.fn() };
    const published: unknown[] = [];
    const server = new AppBackendServer({ snapshot, version: 'test', driverRpc: new BackendDriverRpc(new Map([['codex', driver]])), saveSnapshot: vi.fn(),
      onEvent: event => { if (event.type === 'agent.updated') published.push(structuredClone(event.payload)); },
      codeReviewTools: { createReviewToolContext: (_agent, _review, tools) => { handlers = tools; return { id: 'ctx', url: 'http://review.test/mcp' }; }, closeReviewToolContext: vi.fn() },
    });
    try {
      expect(agent.pendingPrompts).toBeUndefined();
      const request = source === 'mission' ? server.sendTaskPrompt(agent, 'Implement the assigned Mission ticket.')
        : server.handleMessage({ jsonrpc: '2.0', id: 'review', method: backendMethods.agentCodeReviewStart, params: { agentId: agent.id, input: { scope: { type: 'uncommitted' }, threadMode: 'current' } } });
      const settled = request.catch(() => undefined);
      await vi.waitFor(() => expect(source === 'mission' ? sendPrompt : runCodeReview).toHaveBeenCalledOnce());
      expect(agent).toHaveProperty('pendingPrompts', [expect.objectContaining({ id: expect.any(String), text: expect.any(String), createdAt: expect.any(String) })]);
      expect(published).toContainEqual(expect.objectContaining({ id: agent.id, pendingPrompts: expect.arrayContaining([expect.objectContaining({ text: expect.any(String) })]) }));
      if (outcome === 'accepted') release(); else fail(new Error('Provider rejected the injected prompt'));
      await settled;
      await vi.waitFor(() => expect(agent.pendingPrompts).toEqual([]));
      expect(published.at(-1)).toMatchObject({ id: agent.id, pendingPrompts: [] });
    } finally { release(); await server.close(); }
  });
});
