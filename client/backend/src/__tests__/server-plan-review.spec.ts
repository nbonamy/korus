import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppBackendServer } from '../server';
import { ProviderDriverRpc } from '../driver-rpc';
import { AppStateStore } from '../persistence/store';
import { scriptedDriver } from './support/scripted-driver';

it('routes a native proposal → saved feedback → revision → explicit approval through the owning server', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'markdown-review-roundtrip-'));
  const store = new AppStateStore(home);
  const snapshot = createInitialSnapshot();
  snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
  const agent = snapshot.agents[0]!;
  agent.providerSession = { kind: 'codex', conversationId: 'review-thread' };
  const { driver, admit, sentPrompts, proposePlan } = scriptedDriver('codex');
  await admit(agent);
  const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])), saveSnapshot: next => store.save(next) });
  const proposal = (turnId: string, markdown: string) => proposePlan(agent.id, turnId, markdown);
  const respond = (response: object) => server.handleMessage({ jsonrpc: '2.0', id: 'respond', method: 'agent/planReview/respond', params: { agentId: agent.id, response } });
  try {
    proposal('initial-turn', '# Storage\n\n- (x) Local\n- ( ) Synced');
    const reviewId = agent.planReview!.id;
    const draft = { comments: [{ id: 's0', sectionId: 's0', quote: 'Storage', body: 'Include failure recovery.' }], choices: [{ id: 's0-g0', quote: 'Storage\nLocal\nSynced', selected: ['Synced'], confirmed: true }] };
    expect(await respond({ reviewId, resolution: 'save', draftVersion: 0, draft })).not.toHaveProperty('error');
    expect(sentPrompts()).toHaveLength(0);
    expect((await new AppStateStore(home).load()).agents[0]!.planReview?.draft).toStrictEqual(draft);
    expect(await respond({ reviewId, resolution: 'revise', draftVersion: 1 })).not.toHaveProperty('error');
    expect(sentPrompts()).toEqual([{ agent: expect.objectContaining({ id: agent.id }), prompt: expect.stringContaining('Include failure recovery.'), options: { planMode: true } }]);
    expect(sentPrompts()[0]!.prompt).toContain('Synced');
    proposal('revision-turn', '# Storage\n\nSynced storage with recovery.');
    expect(agent.planReview).toMatchObject({ status: 'pending', markdown: '# Storage\n\nSynced storage with recovery.' });
    expect(agent.planReview?.draft).toBeUndefined();
    expect(agent.planReview?.history).toContainEqual({ reviewId, draft, status: 'revise' });
    await expect(respond({ reviewId, resolution: 'accept' })).rejects.toThrow('no longer');
    expect(sentPrompts()).toHaveLength(1);
    agent.status = { type: 'idle' };
    expect(await respond({ reviewId: agent.planReview!.id, resolution: 'accept' })).not.toHaveProperty('error');
    expect(sentPrompts().at(-1)).toEqual({ agent: expect.objectContaining({ id: agent.id }), prompt: 'implement the plan', options: { planMode: false } });
    expect((await new AppStateStore(home).load()).agents[0]!.planReview?.status).toBe('accept');
  } finally { await server.close(); await rm(home, { recursive: true, force: true }); }
});
