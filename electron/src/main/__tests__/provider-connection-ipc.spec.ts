import { describe, expect, it, vi } from 'vitest';
import type { AppApi } from '@workspace/core/contracts';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppController } from '../app-controller';
import { createBackendClient, fakeAppLifecycle } from './app-controller-test-harness';

const bridge = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock('electron', () => ({
  app: {}, BrowserWindow: {}, clipboard: {}, dialog: {}, net: {}, powerMonitor: {}, protocol: {}, shell: {},
  contextBridge: { exposeInMainWorld: (name: string, value: unknown) => bridge.exposed.set(name, value) },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => bridge.handlers.set(channel, handler),
    removeHandler: (channel: string) => bridge.handlers.delete(channel),
  },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = bridge.handlers.get(channel);
      if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
      return handler({}, ...args);
    },
  },
}));

describe('provider sign-out IPC', () => {
  it('routes read-only banked reset reads through preload with owning-host identity and errors', async () => {
    const result = { status: 'ready', summary: { availableCount: '18446744073709551615', credits: null, detailCount: null } };
    const request = vi.fn().mockResolvedValue(result);
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }), fakeAppLifecycle());
    controller.registerIpcHandlers();
    await import('../../preload/index');
    const api = bridge.exposed.get('app') as AppApi;
    await expect(api.getBankedResets('remote')).resolves.toStrictEqual(result);
    expect(request).toHaveBeenLastCalledWith('provider/codex/bankedResets/get', { remoteConnectionId: 'remote' });
    request.mockRejectedValueOnce(new Error('Read failed'));
    await expect(api.getBankedResets()).rejects.toThrow('Read failed');
  });
  it('preserves confirmed reset selections and attempt keys through preload to the owning host', async () => {
    const request = vi.fn().mockResolvedValue({ outcome: 'alreadyRedeemed' });
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }), fakeAppLifecycle());
    controller.registerIpcHandlers(); await import('../../preload/index');
    const api = bridge.exposed.get('app') as AppApi;
    const input = { confirmed: true as const, redemptionToken: 'selection', idempotencyKey: 'attempt' };
    expect(await api.useBankedReset(input, 'remote')).toStrictEqual({ outcome: 'alreadyRedeemed' });
    expect(request).toHaveBeenCalledExactlyOnceWith('provider/codex/bankedResets/use', { input, remoteConnectionId: 'remote' });
    request.mockRejectedValueOnce(new Error('Uncertain response')); await expect(api.useBankedReset(input)).rejects.toThrow('Uncertain response');
  });
  it('routes provider version checks and confirmed upgrades through preload to the owning host', async () => {
    const state = { backend: 'claude', status: 'waiting', method: 'native', canUpgrade: true, busy: true };
    const request = vi.fn().mockResolvedValue(state);
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }), fakeAppLifecycle());
    controller.registerIpcHandlers();
    await import('../../preload/index');
    const api = bridge.exposed.get('app') as AppApi;
    await expect(api.getProviderUpdate('claude', 'wall-e', true)).resolves.toEqual(state);
    expect(request).toHaveBeenLastCalledWith('provider/update/get', { backend: 'claude', remoteConnectionId: 'wall-e', refresh: true });
    const input = { action: 'upgrade' as const, confirmed: true, token: 'checked-installation' };
    await expect(api.setProviderUpdate('claude', input, 'wall-e')).resolves.toEqual(state);
    expect(request).toHaveBeenLastCalledWith('provider/update/set', { backend: 'claude', input, remoteConnectionId: 'wall-e' });
  });
  it('carries sign-out from the real preload API to daemon with the selected engine and host', async () => {
    const result = { kind: 'claude', connected: false, state: { loggedIn: false } };
    const request = vi.fn().mockResolvedValue(result);
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }), fakeAppLifecycle());
    controller.registerIpcHandlers();
    await import('../../preload/index');
    const api = bridge.exposed.get('app') as AppApi;
    await expect(api.disconnectProvider('claude', 'wall-e')).resolves.toEqual(result);
    expect(request).toHaveBeenLastCalledWith('provider/disconnect', { backend: 'claude', remoteConnectionId: 'wall-e' });
    await api.authenticateProvider('antigravity', 'login');
    expect(request).toHaveBeenLastCalledWith('provider/authenticate', { backend: 'antigravity', action: 'login' });
    await api.authenticateProvider('antigravity', 'cancel');
    expect(request).toHaveBeenLastCalledWith('provider/authenticate', { backend: 'antigravity', action: 'cancel' });
    request.mockRejectedValueOnce(new Error('Sign-out failed'));
    await expect(api.disconnectProvider('codex')).rejects.toThrow('Sign-out failed');
    expect(request).toHaveBeenLastCalledWith('provider/disconnect', { backend: 'codex', remoteConnectionId: undefined });
  });
});
