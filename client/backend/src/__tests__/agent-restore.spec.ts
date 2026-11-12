import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { Agent } from '@workspace/core/contracts';
import type { ProviderDriverRpc } from '../driver-rpc';
import { AppStateStore } from '../persistence/store';
import { AppBackendServer } from '../server';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function harness() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agent-restore-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const snapshot = createInitialSnapshot();
  snapshot.providerConnections = [{ provider: 'codex', installed: true, connected: true, checking: false }];
  const first = snapshot.agents[0]!;
  const middle: Agent = { ...first, id: 'middle', name: 'Middle', status: { type: 'idle' }, providerSession: { kind: 'codex', conversationId: 'middle-thread' } };
  const last: Agent = { ...first, id: 'last', name: 'Last', status: { type: 'idle' } };
  snapshot.agents = [first, middle, last];
  snapshot.teams[0]!.agentIds = [first.id, middle.id, last.id];
  const store = new AppStateStore(path.join(home, 'state'));
  const handle = vi.fn(async () => ({ supported: true }));
  const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: { handle, onEvent: () => () => undefined, close: async () => undefined } as unknown as ProviderDriverRpc, saveSnapshot: value => store.save(value) });
  cleanup.push(() => server.close());
  const call = async (method: string, params: Record<string, unknown>) => {
    const response = await server.handleMessage({ jsonrpc: '2.0', id: 'request', method, params } as never);
    if (!response || 'error' in response) throw new Error(response && 'error' in response ? response.error.message : 'No response');
    return response.result as typeof snapshot;
  };
  return { snapshot, first, middle, last, handle, call };
}

it('brings a closed agent back under its id, in its place, with its conversation', async () => {
  const f = await harness();

  const record = { agent: structuredClone(f.middle), index: 1, teamPosition: 1, nextAgentId: 'last' };
  const closed = await f.call(backendMethods.agentDelete, { agentId: 'middle' });
  expect(closed.agents.map(agent => agent.id)).toEqual([f.first.id, 'last']);
  expect(f.handle).toHaveBeenCalledWith(backendMethods.driverConversationArchive, { agent: expect.objectContaining({ id: 'middle' }) });

  const restored = await f.call(backendMethods.agentRestore, { record });
  expect(restored.agents.map(agent => agent.id)).toEqual([f.first.id, 'middle', 'last']);
  expect(restored.teams[0]!.agentIds).toEqual([f.first.id, 'middle', 'last']);
  expect(restored.agents[1]).toMatchObject({ name: 'Middle', providerSession: { conversationId: 'middle-thread' } });
  expect(restored.activeAgentId).toBe('middle');
  expect(f.handle).toHaveBeenCalledWith(backendMethods.driverConversationUnarchive, { agent: expect.objectContaining({ id: 'middle' }) });
});

it('restores in the team position when the agent that followed it is gone', async () => {
  const f = await harness();
  const record = { agent: structuredClone(f.middle), index: 1, teamPosition: 1, nextAgentId: 'gone' };
  await f.call(backendMethods.agentDelete, { agentId: 'middle' });
  await f.call(backendMethods.agentDelete, { agentId: 'last' });

  const restored = await f.call(backendMethods.agentRestore, { record });
  expect(restored.teams[0]!.agentIds).toEqual([f.first.id, 'middle']);
});
