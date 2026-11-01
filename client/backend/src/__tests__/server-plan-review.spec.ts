import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import { AppStateStore } from '../persistence/store';

it('routes a native proposal → saved feedback → revision → explicit approval through the owning server', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'markdown-review-roundtrip-'));
  const store = new AppStateStore(home);
  const snapshot = createInitialSnapshot();
  snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
  const agent = snapshot.agents[0]!;
  agent.backendSession = { kind: 'codex', threadId: 'review-thread' };
  let publish!: (event: BackendEvent) => void;
  const sendPrompt = vi.fn().mockResolvedValue({ backendSession: agent.backendSession, turnId: 'revision-turn' });
  const driver: AgentBackendDriver = {
    backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
    getCapabilities: () => codexBackendCapabilities, sendPrompt,
    interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'review-thread' } }),
    respondToAgentRequest: async () => undefined,
    onEvent: listener => { publish = listener; return () => undefined; }, close: async () => undefined,
  };
  const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])), saveSnapshot: next => store.save(next) });
  const proposal = (turnId: string, markdown: string) => publish({ type: 'plan.readyForReview', agentId: agent.id, conversationId: 'review-thread', turnId, payload: { markdown, itemId: turnId } });
  const respond = (response: object) => server.handleMessage({ jsonrpc: '2.0', id: 'respond', method: 'agent/planReview/respond', params: { agentId: agent.id, response } });
  try {
    proposal('initial-turn', '# Storage\n\n- (x) Local\n- ( ) Synced');
    const reviewId = agent.planReview!.id;
    const draft = { comments: [{ id: 's0', sectionId: 's0', quote: 'Storage', body: 'Include failure recovery.' }], choices: [{ id: 's0-g0', quote: 'Storage\nLocal\nSynced', selected: ['Synced'], confirmed: true }] };
    expect(await respond({ reviewId, resolution: 'save', draftVersion: 0, draft })).not.toHaveProperty('error');
    expect(sendPrompt).not.toHaveBeenCalled();
    expect((await new AppStateStore(home).load()).agents[0]!.planReview?.draft).toStrictEqual(draft);
    expect(await respond({ reviewId, resolution: 'revise', draftVersion: 1 })).not.toHaveProperty('error');
    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: agent.id }), expect.stringContaining('Include failure recovery.'), { planMode: true });
    expect(sendPrompt.mock.calls[0]![1]).toContain('Synced');
    proposal('revision-turn', '# Storage\n\nSynced storage with recovery.');
    expect(agent.planReview).toMatchObject({ status: 'pending', markdown: '# Storage\n\nSynced storage with recovery.' });
    expect(agent.planReview?.draft).toBeUndefined();
    expect(agent.planReview?.history).toContainEqual({ reviewId, draft, status: 'revise' });
    await expect(respond({ reviewId, resolution: 'accept' })).rejects.toThrow('no longer');
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    agent.status = { type: 'idle' };
    expect(await respond({ reviewId: agent.planReview!.id, resolution: 'accept' })).not.toHaveProperty('error');
    expect(sendPrompt).toHaveBeenLastCalledWith(expect.objectContaining({ id: agent.id }), 'implement the plan', { planMode: false });
    expect((await new AppStateStore(home).load()).agents[0]!.planReview?.status).toBe('accept');
  } finally { await server.close(); await rm(home, { recursive: true, force: true }); }
});
