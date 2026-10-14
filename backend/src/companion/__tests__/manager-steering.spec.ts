import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { companionTarget } from '@workspace/core/companion-protocol';
import { AppBackendServer } from '../../server';
import { BackendDriverRpc } from '../../driver-rpc';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { CompanionManager, type CompanionBackendPort } from '../manager';
import type { CompanionGateway } from '../gateway';

// The transport supplies authenticated peer identities; admission and backend routing stay real.
const transport = vi.hoisted(() => ({ gateway: null as CompanionGateway | null }));
vi.mock('../connector', () => ({ CompanionOutboundConnector: class {
  connected = false;
  constructor(_key: unknown, gateway: CompanionGateway) { transport.gateway = gateway; }
  async stop() {}
} }));

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function fixture(status: 'idle' | 'working' | 'awaitingInput', rejectSteer = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-steering-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const snapshot = createTestSnapshot();
  const agent = {
    id: 'agent-phone', teamId: 'team-test', name: 'Phone', backend: 'codex' as const,
    folder: '/workspace/phone', status: { type: status },
    backendSession: { kind: 'codex' as const, threadId: 'thread-phone' },
    createdAt: '', updatedAt: '',
  };
  snapshot.agents = [agent]; snapshot.teams[0]!.agentIds = [agent.id];
  const result = { backendSession: agent.backendSession, turnId: 'turn-phone' };
  const sendPrompt = vi.fn(async () => result);
  const steerPrompt = vi.fn(async () => { if (rejectSteer) throw new Error('Steering failed'); return result; });
  const driver: AgentBackendDriver = {
    backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
    getCapabilities: () => codexBackendCapabilities, sendPrompt, steerPrompt,
    listSkills: async () => [{ name: 'review', path: '/skills/review/SKILL.md', enabled: true }],
    interrupt: async () => result, respondToAgentRequest: async () => undefined,
    onEvent: () => () => undefined, close: async () => undefined,
  };
  const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])) });
  cleanup.push(() => server.close());
  const backend: CompanionBackendPort = {
    async request<Result>(method: string, params?: unknown): Promise<Result> {
      const response = await server.handleMessage({ jsonrpc: '2.0', id: randomUUID(), method, params });
      if (!response || !('result' in response)) throw new Error('Backend request failed');
      return response.result as Result;
    },
  };
  const initial = new CompanionManager(directory, backend, {});
  const { status: host } = await initial.control({ action: 'status' });
  await initial.stop();
  const file = path.join(directory, 'state.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.gateway.grants = [{ peerId: 'phone', name: 'Phone', createdAt: 1 }];
  await writeFile(file, JSON.stringify(saved));
  const manager = new CompanionManager(directory, backend, {});
  cleanup.push(() => manager.stop());
  await manager.control({ action: 'status' });
  return { gateway: transport.gateway!, snapshot, sendPrompt, steerPrompt,
    command: { target: companionTarget(host.hostId, snapshot.teams[0]!, agent), text: 'Use the smaller change', clientCommandId: randomUUID(), options: { model: 'gpt', planMode: false } } };
}

describe('mobile prompt admission', () => {
  it('routes the companion skill catalog and a selected skill to the owning provider', async () => {
    const f = await fixture('idle');
    const skill = { name: 'review', path: '/skills/review/SKILL.md' };
    expect(await f.gateway.request('phone', 'skills.list', f.command.target)).toStrictEqual({ skills: [{ ...skill, enabled: true }] });
    const options = { ...f.command.options, skills: [skill] };
    expect(await f.gateway.request('phone', 'prompt.submit', { ...f.command, text: '$review', options })).toMatchObject({ state: 'accepted' });
    expect(f.sendPrompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'agent-phone' }), '$review', expect.objectContaining(options));
  });

  it.each(['idle', 'working', 'awaitingInput'] as const)('starts idle work or steers active work without queuing (%s)', async (status) => {
    const f = await fixture(status);
    expect(await f.gateway.request('phone', 'prompt.submit', f.command)).toMatchObject({ state: 'accepted' });
    const operation = status === 'idle' ? f.sendPrompt : f.steerPrompt;
    expect(operation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'agent-phone' }), f.command.text, expect.objectContaining(f.command.options));
    expect(status === 'idle' ? f.steerPrompt : f.sendPrompt).not.toHaveBeenCalled();
    expect(f.snapshot.queuedPrompts ?? []).toEqual([]);
    // A retry must remain a receipt lookup even if the agent has since become idle.
    f.snapshot.agents[0]!.status = { type: 'idle' };
    await f.gateway.request('phone', 'prompt.submit', f.command);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(f.snapshot.queuedPrompts ?? []).toEqual([]);
  });

  it('does not queue, start a replacement turn, or replay a failed steering attempt', async () => {
    const f = await fixture('working', true);
    expect(await f.gateway.request('phone', 'prompt.submit', f.command)).toMatchObject({ state: 'unresolved' });
    await f.gateway.request('phone', 'prompt.submit', f.command);
    expect(f.steerPrompt).toHaveBeenCalledTimes(1);
    expect(f.sendPrompt).not.toHaveBeenCalled();
    expect(f.snapshot.queuedPrompts ?? []).toEqual([]);
  });
});
