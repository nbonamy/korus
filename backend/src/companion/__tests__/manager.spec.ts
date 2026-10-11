import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const transport = vi.hoisted(() => ({ start: vi.fn(async (..._args: unknown[]) => {}), stop: vi.fn(async () => {}) }));
vi.mock('../connector', () => ({ CompanionOutboundConnector: class {
  connected = false;
  async start(...args: unknown[]) { await transport.start(...args); this.connected = true; }
  async stop() { await transport.stop(); this.connected = false; }
  async advertise() {}
  revoke() {}
} }));
import { CompanionManager } from '../manager';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); vi.clearAllMocks(); });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-manager-')); directories.push(directory);
  const manager = new CompanionManager(directory, { request: vi.fn() });
  return { directory, manager };
}
describe('daemon companion persistence', () => {
  it('keeps a protected stable host identity across daemon restart and refuses corrupt identity replacement', async () => {
    const { directory, manager } = await fixture(); const first = await manager.control({ action: 'status' });
    expect((await stat(path.join(directory, 'state.json'))).mode & 0o777).toBe(0o600);
    await manager.stop();
    const restored = new CompanionManager(directory, { request: vi.fn() });
    expect((await restored.control({ action: 'status' })).status.hostId).toBe(first.status.hostId);
    await restored.stop();
    await writeFile(path.join(directory, 'state.json'), '{broken');
    await expect(new CompanionManager(directory, { request: vi.fn() }).control({ action: 'status' })).rejects.toThrow('identity cannot be loaded');
    expect(await readFile(path.join(directory, 'state.json'), 'utf8')).toBe('{broken');
  });
  it('does not enable access or mutate saved settings when the durable write fails', async () => {
    const { directory, manager } = await fixture(); await manager.control({ action: 'status' });
    await rm(path.join(directory, 'state.json')); await mkdir(path.join(directory, 'state.json'));
    const relayPeerId = peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString();
    await expect(manager.control({ action: 'enable', relayOrigin: 'wss://relay.example', relayPeerId })).rejects.toThrow();
    expect((await manager.control({ action: 'status' })).status).toMatchObject({ enabled: false, connected: false, relayOrigin: '' });
    expect(transport.start).not.toHaveBeenCalled();
    await expect((await import('node:fs/promises')).readdir(directory)).resolves.toEqual(['state.json']);
    await manager.stop();
  });
});
