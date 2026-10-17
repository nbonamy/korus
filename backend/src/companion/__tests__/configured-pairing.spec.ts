import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2p } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { companionRendezvousProtocol } from '@workspace/core/companion-relay';
import { companionProtocol, encodeCompanionFrame, readFirstCompanionFrame } from '@workspace/core/companion-protocol';
import { normalizePairingCode } from '@workspace/core/companion-pairing';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { CompanionManager, type CompanionBackendPort } from '../manager';
import { runCompanionRelay } from '../relay-cli';

vi.mock('../../log', () => ({ logMain: vi.fn(), warnMain: vi.fn() }));
const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });
const shownCode = 'ABCD-EFGH';
const code = normalizePairingCode(shownCode)!;
async function phone() {
  const node = await createLibp2p({ transports: [webSockets(), circuitRelayTransport()], connectionEncrypters: [noise()], streamMuxers: [yamux()], services: { identify: identify() } });
  cleanup.push(() => node.stop()); return node;
}
async function call<T>(node: Libp2p, address: string, method: string, args: unknown): Promise<T> {
  const peer = address.split('/p2p/').at(-1)!;
  const existing = node.getConnections(peerIdFromString(peer)).find(connection => connection.status === 'open' && connection.remoteAddr.toString() === address);
  const options = { signal: AbortSignal.timeout(5000), runOnLimitedConnection: true };
  const stream = await (existing ? existing.newStream(companionProtocol, options) : node.dialProtocol(multiaddr(address), companionProtocol, options))
    .catch(cause => { throw new Error(`Could not open ${method}`, { cause }); });
  try {
    stream.send(encodeCompanionFrame({ v: 1, id: randomUUID(), method, args })); await stream.close();
    const reply = await readFirstCompanionFrame(stream) as { error?: string; result: T };
    if (reply.error) throw new Error(reply.error);
    return reply.result;
  } finally { stream.abort(new Error('Test call finished')); }
}
async function lookup(node: Libp2p, address: string, input = code) {
  const stream = await node.dialProtocol(multiaddr(address), companionRendezvousProtocol, { signal: AbortSignal.timeout(5000) });
  try { stream.send(encodeCompanionFrame({ code: input })); await stream.close(); return (await readFirstCompanionFrame(stream) as { hostId: string }).hostId; }
  finally { stream.abort(new Error('Lookup finished')); }
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'configured-pairing-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const snapshot = createEmptySnapshot();
  snapshot.teams = [{ id: 'demo-team', name: 'Shared demo', agentIds: [] }];
  const backend: CompanionBackendPort = { request: async (method) => {
    if (method !== backendMethods.snapshotGet) throw new Error('Unexpected backend operation');
    return { snapshot } as never;
  } };
  const state = path.join(directory, 'companion');
  const initial = new CompanionManager(state, backend, {});
  const hostId = (await initial.control({ action: 'status' })).status.hostId;
  await initial.stop();
  const policyFile = path.join(directory, 'pairing.json');
  await writeFile(policyFile, JSON.stringify({ code: shownCode, hostId }));
  const env = { APP_COMPANION_PAIRING_CONFIG: policyFile };
  const configFile = path.join(directory, 'relay.json');
  const config = { listen: '/ip4/127.0.0.1/tcp/0/ws', stateDirectory: path.join(directory, 'relay') };
  await writeFile(configFile, JSON.stringify(config));
  const relay = await runCompanionRelay(configFile, env);
  cleanup.push(() => relay.stop());
  const address = relay.getMultiaddrs()[0]!.toString();
  const port = relay.getMultiaddrs()[0]!.getComponents().find(part => part.name === 'tcp')!.value;
  const runtime = { ...env, APP_COMPANION_RELAY_URL: `ws://127.0.0.1:${port}`, APP_COMPANION_RELAY_PEER_ID: relay.peerId.toString() };
  const manager = new CompanionManager(state, backend, runtime);
  cleanup.push(() => manager.stop());
  await manager.control({ action: 'resume' });
  return { directory, state, policyFile, runtime, manager, hostId, address, backend };
}

describe('shared configured companion pairing', () => {
  it('routes the reusable code to real korusd, persists approval and restores normal access after restart', async () => {
    const f = await fixture();
    const first = await phone(); const second = await phone();
    const circuit = `${f.address}/p2p-circuit/p2p/${f.hostId}`;
    for (const node of [first, second]) {
      expect(await lookup(node, f.address)).toBe(f.hostId);
      await expect(call(node, circuit, 'snapshot.get', {})).rejects.toThrow();
      const claim = await call<{ pendingId: string }>(node, circuit, 'pair.claim', { code, name: 'Review phone' });
      expect(await call(node, circuit, 'pair.status', { pendingId: claim.pendingId })).toMatchObject({ state: 'approved', grant: { peerId: node.peerId.toString() } });
      expect(await call(node, circuit, 'snapshot.get', {})).toMatchObject({ teams: [{ name: 'Shared demo' }] });
    }
    const status = (await f.manager.control({ action: 'status' })).status;
    expect(status.pending).toStrictEqual([]);
    expect(status.devices.map(device => device.peerId).sort()).toStrictEqual([first.peerId.toString(), second.peerId.toString()].sort());
    await f.manager.stop();
    const restarted = new CompanionManager(f.state, f.backend, f.runtime);
    cleanup.push(() => restarted.stop());
    expect((await restarted.control({ action: 'status' })).status.devices).toStrictEqual(status.devices);
    await expect.poll(() => call(first, circuit, 'snapshot.get', {})).toMatchObject({ teams: [{ name: 'Shared demo' }] });
    await restarted.control({ action: 'revoke', peerId: first.peerId.toString() });
    await expect(call(first, circuit, 'snapshot.get', {})).rejects.toThrow();
    expect(await call(second, circuit, 'snapshot.get', {})).toMatchObject({ teams: [{ name: 'Shared demo' }] });
  }, 20_000);

  it('keeps automatic approval off for other daemon identities and preserves ordinary desktop approval', async () => {
    const f = await fixture(); const node = await phone();
    const ordinary = new CompanionManager(path.join(f.directory, 'ordinary'), f.backend, f.runtime);
    cleanup.push(() => ordinary.stop());
    const { status, invitation } = await ordinary.control({ action: 'invite' });
    const circuit = `${f.address}/p2p-circuit/p2p/${status.hostId}`;
    await expect(call(node, circuit, 'pair.claim', { code, name: 'Phone' })).rejects.toThrow();
    const normalCode = normalizePairingCode(invitation!.code)!;
    expect(await lookup(node, f.address, normalCode)).toBe(status.hostId);
    // The route is now valid: rejection here proves the daemon independently checks its identity/code.
    await expect(call(node, circuit, 'pair.claim', { code, name: 'Phone' })).rejects.toThrow();
    const pending = await call<{ pendingId: string }>(node, circuit, 'pair.claim', { code: normalCode, name: 'Phone' });
    expect(await call(node, circuit, 'pair.status', { pendingId: pending.pendingId })).toStrictEqual({ state: 'awaitingApproval' });
    await expect(call(node, circuit, 'snapshot.get', {})).rejects.toThrow();
    await ordinary.control({ action: 'decide', pendingId: pending.pendingId, approve: true });
    expect(await call(node, circuit, 'snapshot.get', {})).toMatchObject({ teams: [{ name: 'Shared demo' }] });
  }, 15_000);

  it('never authorizes a phone when saving its grant fails', async () => {
    const f = await fixture(); const node = await phone();
    const stateFile = path.join(f.state, 'state.json'); const saved = await readFile(stateFile, 'utf8');
    await rm(stateFile); await mkdir(stateFile);
    const circuit = `${f.address}/p2p-circuit/p2p/${await lookup(node, f.address)}`;
    await expect(call(node, circuit, 'pair.claim', { code, name: 'Phone' })).rejects.toThrow();
    await expect(call(node, circuit, 'snapshot.get', {})).rejects.toThrow();
    expect((await f.manager.control({ action: 'status' })).status.devices).toStrictEqual([]);
    await rm(stateFile, { recursive: true }); await writeFile(stateFile, saved);
    const claim = await call<{ pendingId: string }>(node, circuit, 'pair.claim', { code, name: 'Phone' });
    expect(await call(node, circuit, 'pair.status', { pendingId: claim.pendingId })).toMatchObject({ state: 'approved' });
  }, 15_000);

  it('rejects malformed shared configuration instead of silently enabling a different pairing policy', async () => {
    const f = await fixture(); await f.manager.stop();
    await writeFile(f.policyFile, JSON.stringify({ code: 'invalid', hostId: f.hostId }));
    const invalid = new CompanionManager(f.state, f.backend, f.runtime);
    cleanup.push(() => invalid.stop());
    await expect(invalid.control({ action: 'status' })).rejects.toThrow('pairing configuration');
  });
});
