import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { CompanionManager } from '../manager';
import type { CompanionGateway } from '../gateway';

const transport = vi.hoisted(() => ({ gateway: null as CompanionGateway | null }));
vi.mock('../connector', () => ({ CompanionOutboundConnector: class {
  connected = false;
  constructor(_key: unknown, gateway: CompanionGateway) { transport.gateway = gateway; }
  async start() { this.connected = true; }
  async stop() { this.connected = false; }
  async advertise() { return true; }
  revoke() {}
} }));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-usage-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const snapshot = createTestSnapshot();
  snapshot.providerConnections = ['codex', 'claude', 'antigravity'].map(backend => ({
    backend, installed: true, enabled: true, connected: true, checking: false,
  })) as typeof snapshot.providerConnections;
  const limits = { primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 2_000_000_000 }, secondary: null };
  const request = vi.fn(async (method: string, _params?: unknown): Promise<unknown> => {
    if (method === backendMethods.snapshotGet) return { snapshot };
    if (method === backendMethods.providerUsageGet) return { ...limits, credits: { balance: '10' }, planType: 'pro' };
    throw new Error('Unexpected operation');
  });
  const manager = new CompanionManager(directory, { request: request as never }, {});
  cleanup.push(() => manager.stop());
  await manager.control({ action: 'status' });
  const invitation = await manager.control({ action: 'invite' });
  const gateway = transport.gateway!;
  const pending = await gateway.request('phone', 'pair.claim', { code: invitation.invitation!.code.replace('-', ''), name: 'Phone' }) as { pendingId: string };
  await manager.control({ action: 'decide', pendingId: pending.pendingId, approve: true });
  return { gateway, snapshot, request, limits };
}

describe('companion usage from the paired laptop', () => {
  it('reads the same quota providers as desktop and isolates failures by provider', async () => {
    const f = await fixture();
    expect(await f.gateway.request('phone', 'usage.get', {})).toStrictEqual([
      { backend: 'codex', limits: f.limits, failed: false }, { backend: 'claude', limits: f.limits, failed: false },
    ]);
    expect(f.request.mock.calls.filter(([method]) => method === backendMethods.providerUsageGet).map(([, params]) => params))
      .toStrictEqual([{ backend: 'codex' }, { backend: 'claude' }]);
    f.request.mockImplementation(async (method, params) => {
      if (method === backendMethods.snapshotGet) return { snapshot: f.snapshot };
      if ((params as { backend: string }).backend === 'claude') throw new Error('Provider unavailable');
      return null;
    });
    expect(await f.gateway.request('phone', 'usage.get', {})).toStrictEqual([
      { backend: 'codex', limits: null, failed: false }, { backend: 'claude', limits: null, failed: true },
    ]);
    f.snapshot.providerConnections!.find(item => item.backend === 'codex')!.authentication = {
      kind: 'codex', connected: true, state: { account: { type: 'apiKey' }, requiresOpenaiAuth: false, login: { status: 'idle', error: null } },
    };
    f.snapshot.providerConnections!.find(item => item.backend === 'claude')!.enabled = false;
    expect(await f.gateway.request('phone', 'usage.get', {})).toStrictEqual([]);
  });

  it('requires a current grant, rejects extra parameters and withholds results after revocation', async () => {
    const f = await fixture();
    await expect(f.gateway.request('stranger', 'usage.get', {})).rejects.toThrow('not authorized');
    await expect(f.gateway.request('phone', 'usage.get', { method: 'shell.exec' })).rejects.toThrow();
    let release!: () => void;
    f.request.mockImplementation(async method => {
      if (method === backendMethods.snapshotGet) { await new Promise<void>(done => { release = done; }); return { snapshot: f.snapshot }; }
      return f.limits;
    });
    const loading = f.gateway.request('phone', 'usage.get', {});
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await f.gateway.revoke('phone'); release();
    await expect(loading).rejects.toThrow('not authorized');
  });
});
