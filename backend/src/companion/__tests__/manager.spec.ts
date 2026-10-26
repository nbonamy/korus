import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const transport = vi.hoisted(() => ({ start: vi.fn(async (..._args: unknown[]) => {}), stop: vi.fn(async () => {}), advertise: vi.fn(async () => true) }));
vi.mock('../connector', () => ({ CompanionOutboundConnector: class {
  connected = false;
  async start(...args: unknown[]) { await transport.start(...args); this.connected = true; }
  async stop() { await transport.stop(); this.connected = false; }
  async advertise() { return transport.advertise(); }
  revoke() {}
  disablePhone() {}
} }));
import { CompanionManager } from '../manager';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { AppBackendServer } from '../../server';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); vi.clearAllMocks(); vi.unstubAllGlobals(); });
async function fixture(onAccessChanged?: (enabled: boolean) => void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-manager-')); directories.push(directory);
  const manager = new CompanionManager(directory, { request: vi.fn(), onAccessChanged }, {});
  return { directory, manager };
}
describe('daemon companion persistence', () => {
  it('reuses the durable endpoint for sharing without enabling paired-phone access', async () => {
    const { directory, manager } = await fixture();
    const first = await manager.shareEndpoint();
    expect(first?.ownerId).toEqual(expect.any(String));
    expect(transport.start).not.toHaveBeenCalled();
    const status = await manager.control({ action: 'status' });
    expect(status.status.enabled).toBe(false);
    expect(status.status.devices).toStrictEqual([]);
    await manager.stop();
    const restored = new CompanionManager(directory, { request: vi.fn() }, {});
    try { expect(await restored.shareEndpoint()).toStrictEqual(first); }
    finally { await restored.stop(); }
  });
  it('starts sharing connectivity without enabling phone access and keeps it across mobile disable', async () => {
    const { manager, directory } = await fixture();
    const endpoint = (await manager.shareEndpoint())!;
    const routes = [{ ...endpoint, handle: 'a'.repeat(32) }];
    await manager.updateShareRoutes(routes);
    expect(transport.start).toHaveBeenCalledOnce();
    expect((await manager.control({ action: 'status' })).status.enabled).toBe(false);
    expect(JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')).enabled).toBe(false);
    await manager.control({ action: 'resume' });
    const stops = transport.stop.mock.calls.length;
    await manager.control({ action: 'disable' });
    expect(transport.stop).toHaveBeenCalledTimes(stops);
    await manager.updateShareRoutes([]);
    expect(transport.stop).toHaveBeenCalledTimes(stops + 1);
    await manager.stop();
  });
  it('publishes mobile keep-awake policy through enablement, relay failure, preference changes, restart and disable', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-manager-')); directories.push(directory);
    const onEvent = vi.fn();
    const snapshot = createTestSnapshot();
    const server = new AppBackendServer({ version: 'test', snapshot, onEvent });
    const port = { request: vi.fn(), onAccessChanged: (enabled: boolean) => server.setCompanionAccessEnabled(enabled) };
    let manager = new CompanionManager(directory, port, {});
    const expectPolicy = async (enabled: boolean) => {
      const clientState = { sourceFolderPath: '', shouldPreventDisplaySleep: false, shouldPreventDisplaySleepForRemoteAccess: enabled };
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 'state', method: 'client/state/get' })).resolves.toStrictEqual({ jsonrpc: '2.0', id: 'state', result: clientState });
      expect(onEvent.mock.lastCall?.[0].clientState).toStrictEqual(clientState);
    };
    try {
      await manager.control({ action: 'status' });
      transport.start.mockRejectedValueOnce(new Error('Relay unavailable'));
      await expect(manager.control({ action: 'resume' })).rejects.toThrow('Relay unavailable');
      await expectPolicy(true);
      for (const enabled of [false, true]) {
        await server.handleMessage({ jsonrpc: '2.0', id: 'settings', method: 'settings/update', params: { input: { general: { preventSleepWhenRemoteAccessEnabled: enabled } } } });
        await expectPolicy(enabled);
      }
      await manager.stop();
      await expectPolicy(false);
      manager = new CompanionManager(directory, port, {});
      await manager.control({ action: 'status' });
      await expectPolicy(true);
      await manager.control({ action: 'disable' });
      await expectPolicy(false);
    } finally {
      await manager.stop();
      await server.close();
    }
  });
  it('keeps a protected stable host identity across daemon restart and refuses corrupt identity replacement', async () => {
    const { directory, manager } = await fixture(); const first = await manager.control({ action: 'status' });
    expect((await stat(path.join(directory, 'state.json'))).mode & 0o777).toBe(0o600);
    await manager.stop();
    const restored = new CompanionManager(directory, { request: vi.fn() }, {});
    expect((await restored.control({ action: 'status' })).status.hostId).toBe(first.status.hostId);
    await restored.stop();
    await writeFile(path.join(directory, 'state.json'), '{broken');
    await expect(new CompanionManager(directory, { request: vi.fn() }, {}).control({ action: 'status' })).rejects.toThrow('identity cannot be loaded');
    expect(await readFile(path.join(directory, 'state.json'), 'utf8')).toBe('{broken');
  });
  it('does not enable access or mutate saved settings when the durable write fails', async () => {
    const onAccessChanged = vi.fn();
    const { directory, manager } = await fixture(onAccessChanged); await manager.control({ action: 'status' });
    await rm(path.join(directory, 'state.json')); await mkdir(path.join(directory, 'state.json'));
    const relayPeerId = peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString();
    await expect(manager.control({ action: 'enable', relayOrigin: 'wss://relay.example', relayPeerId })).rejects.toThrow();
    expect((await manager.control({ action: 'status' })).status).toMatchObject({ enabled: false, connected: false, relayOrigin: 'wss://relay.meetkorus.dev' });
    expect(transport.start).not.toHaveBeenCalled();
    expect(onAccessChanged).not.toHaveBeenCalledWith(true);
    await expect((await import('node:fs/promises')).readdir(directory)).resolves.toEqual(['state.json']);
    await manager.stop();
  });

  describe('environment relay', () => {
    it.each([
      { name: 'packaged relay', env: {}, expected: 'wss://packaged.example' },
      { name: 'runtime override', env: { APP_COMPANION_RELAY_URL: 'wss://runtime.example' }, expected: 'wss://runtime.example' },
    ])('prefers the $name to stale saved development settings without replacing identity or grants', async ({ env, expected }) => {
      const { directory, manager } = await fixture();
      const relayPeerId = peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString();
      const initial = await manager.control({ action: 'enable', relayOrigin: 'ws://localhost:47800', relayPeerId });
      await manager.stop(); transport.start.mockClear();
      const file = path.join(directory, 'state.json');
      const saved = JSON.parse(await readFile(file, 'utf8'));
      const grant = { peerId: peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString(), name: 'My phone', createdAt: 1 };
      saved.gateway.grants = [grant];
      await writeFile(file, JSON.stringify(saved));
      vi.stubGlobal('__APP_COMPANION_RELAY__', { origin: 'wss://packaged.example', peerId: relayPeerId });
      const runtime = 'APP_COMPANION_RELAY_URL' in env ? { ...env, APP_COMPANION_RELAY_PEER_ID: relayPeerId } : env;
      const restored = new CompanionManager(directory, { request: vi.fn() }, runtime);
      try {
        const { status, invitation } = await restored.control({ action: 'invite' });
        expect(status).toMatchObject({ configured: true, enabled: true, connected: true, relayOrigin: expected, hostId: initial.status.hostId, devices: [grant] });
        expect(invitation?.code).toBeTruthy();
        expect(transport.start).toHaveBeenCalledExactlyOnceWith(expected, relayPeerId);
        expect(JSON.parse(await readFile(file, 'utf8')).identity).toBe(saved.identity);
      } finally { await restored.stop(); }
    });
    it('does not combine a partial runtime override with a packaged relay', async () => {
      const { directory, manager } = await fixture();
      await manager.stop();
      const relayPeerId = peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString();
      vi.stubGlobal('__APP_COMPANION_RELAY__', { origin: 'wss://packaged.example', peerId: relayPeerId });
      const restored = new CompanionManager(directory, { request: vi.fn() }, { APP_COMPANION_RELAY_URL: 'wss://runtime.example' });
      try {
        expect((await restored.control({ action: 'status' })).status).toMatchObject({ configured: false, error: expect.any(String) });
        await expect(restored.control({ action: 'invite' })).rejects.toThrow('not configured');
        expect(transport.start).not.toHaveBeenCalled();
      } finally { await restored.stop(); }
    });
    async function configured(env: NodeJS.ProcessEnv = {}) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-manager-')); directories.push(directory);
      const relayPeerId = peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString();
      const manager = new CompanionManager(directory, { request: vi.fn() }, { APP_COMPANION_RELAY_URL: 'wss://relay.example', APP_COMPANION_RELAY_PEER_ID: relayPeerId, ...env });
      return { directory, manager, relayPeerId };
    }
    it('uses the bundled public relay for first-time pairing without operator configuration', async () => {
      const { manager } = await fixture();
      expect((await manager.control({ action: 'status' })).status).toMatchObject({ configured: true, enabled: false, relayOrigin: 'wss://relay.meetkorus.dev' });
      expect(transport.start).not.toHaveBeenCalled();
      expect((await manager.control({ action: 'invite' })).invitation?.code).toBeTruthy();
      expect(transport.start).toHaveBeenCalledWith('wss://relay.meetkorus.dev', expect.any(String));
      await manager.stop();
    });
    it('does not show a code the relay rejected and permits retry without exhausting invitations', async () => {
      const { manager } = await fixture();
      for (let attempt = 0; attempt < 6; attempt++) {
        transport.advertise.mockResolvedValueOnce(false);
        await expect(manager.control({ action: 'invite' })).rejects.toThrow('register the pairing code');
      }
      expect((await manager.control({ action: 'invite' })).invitation?.code).toBeTruthy();
      await manager.stop();
    });
    it('disables and resumes existing grants across restarts without creating a new invitation', async () => {
      const { directory, manager, relayPeerId } = await configured();
      await manager.control({ action: 'status' });
      await manager.stop();
      const file = path.join(directory, 'state.json');
      const saved = JSON.parse(await readFile(file, 'utf8'));
      const grant = { peerId: peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString(), name: 'My phone', createdAt: 1 };
      saved.gateway.grants = [grant];
      await writeFile(file, JSON.stringify(saved));
      const env = { APP_COMPANION_RELAY_URL: 'wss://relay.example', APP_COMPANION_RELAY_PEER_ID: relayPeerId };
      const current = new CompanionManager(directory, { request: vi.fn() }, env);
      const resumed = await current.control({ action: 'resume' });
      expect(resumed.invitation).toBeUndefined();
      expect(resumed.status).toMatchObject({ enabled: true, connected: true, devices: [grant], pending: [] });
      const starts = transport.start.mock.calls.length;
      await current.control({ action: 'resume' });
      expect(transport.start).toHaveBeenCalledTimes(starts);
      const disabled = await current.control({ action: 'disable' });
      expect(disabled.status).toMatchObject({ enabled: false, connected: false, devices: [grant] });
      await current.stop();
      const restored = new CompanionManager(directory, { request: vi.fn() }, env);
      expect((await restored.control({ action: 'status' })).status).toMatchObject({ enabled: false, connected: false, devices: [grant] });
      expect(transport.start).toHaveBeenCalledTimes(starts);
      expect((await restored.control({ action: 'resume' })).status).toMatchObject({ enabled: true, connected: true, devices: [grant] });
      expect(transport.start).toHaveBeenLastCalledWith('wss://relay.example', relayPeerId);
      await restored.stop();
    });
    it('turns mobile access on when the first invitation is requested', async () => {
      const { manager, relayPeerId } = await configured();
      expect((await manager.control({ action: 'status' })).status).toMatchObject({ configured: true, enabled: false, relayOrigin: 'wss://relay.example' });
      const { status, invitation } = await manager.control({ action: 'invite' });
      expect(transport.start).toHaveBeenCalledWith('wss://relay.example', relayPeerId);
      expect(status).toMatchObject({ configured: true, enabled: true, connected: true });
      expect(invitation).toStrictEqual({ code: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/), expiresAt: expect.any(Number) });
      await manager.stop();
    });
    it('resumes on restart with the environment relay and ignores a stale saved one', async () => {
      const { directory, manager, relayPeerId } = await configured();
      await manager.control({ action: 'invite' }); await manager.stop(); transport.start.mockClear();
      const restarted = new CompanionManager(directory, { request: vi.fn() }, { APP_COMPANION_RELAY_URL: 'wss://other.example', APP_COMPANION_RELAY_PEER_ID: relayPeerId });
      await restarted.control({ action: 'status' });
      expect(transport.start).toHaveBeenCalledWith('wss://other.example', relayPeerId);
      await restarted.stop();
    });
    it('rejects manual relay changes while the environment owns the relay', async () => {
      const { manager, relayPeerId } = await configured();
      await expect(manager.control({ action: 'enable', relayOrigin: 'wss://elsewhere.example', relayPeerId })).rejects.toThrow('environment');
      expect(transport.start).not.toHaveBeenCalled();
    });
    it('reports an invalid environment relay instead of connecting', async () => {
      const { manager } = await configured({ APP_COMPANION_RELAY_URL: 'ws://plain.example' });
      expect((await manager.control({ action: 'status' })).status).toMatchObject({ configured: false, error: expect.stringContaining('APP_COMPANION_RELAY') });
      await expect(manager.control({ action: 'invite' })).rejects.toThrow();
      expect(transport.start).not.toHaveBeenCalled();
    });
  });
});
