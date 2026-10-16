import { describe, expect, it, vi } from 'vitest';
import type { AppApi } from '@workspace/core/contracts';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppController } from '../app-controller';
import { createBackendClient, fakeAppLifecycle, currentSnapshot } from './app-controller-test-harness';

const bridge = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock('electron', () => ({
  app: {}, BrowserWindow: {}, clipboard: {}, dialog: {}, nativeTheme: {}, net: {}, powerMonitor: {}, protocol: {}, shell: {},
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
  it('carries a reviewed profile target and stop identity through the real preload bridge', async () => {
    const run = { id: 'run', agentId: 'agent-remote', state: 'running' };
    const request = vi.fn().mockResolvedValue(run);
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }), fakeAppLifecycle());
    controller.registerIpcHandlers();
    await import('../../preload/index');
    const api = bridge.exposed.get('app') as AppApi;
    const input = { profileId: 'dev', command: 'npm run dev', cwd: '/remote/worktree' };
    await api.getRunProfileActions('agent-remote', 'app');
    expect(request).toHaveBeenLastCalledWith('agent/runProfileActions/get', { agentId: 'agent-remote', directory: 'app' });
    await expect(api.startRunProfile('agent-remote', input)).resolves.toStrictEqual(run);
    expect(request).toHaveBeenLastCalledWith('agent/runProfile/start', { agentId: 'agent-remote', input });
    request.mockRejectedValueOnce(new Error('Owner disconnected. Reconnect before stopping.'));
    await expect(api.stopProfileRun('agent-remote', 'run')).rejects.toThrow('Owner disconnected');
    expect(request).toHaveBeenLastCalledWith('agent/profileRun/stop', { agentId: 'agent-remote', runId: 'run' });
  });

  it('carries explicit installation through preload to the selected host and returns failures for retry', async () => {
    const result = { backend: 'antigravity', installed: true, locked: false, isolated: true, shareSkills: false, homePath: '/app/antigravity-home' };
    const request = vi.fn().mockResolvedValue(result);
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }), fakeAppLifecycle());
    controller.registerIpcHandlers();
    await import('../../preload/index');
    const api = bridge.exposed.get('app') as AppApi;
    await expect(api.installProvider('antigravity', 'remote')).resolves.toStrictEqual(result);
    expect(request).toHaveBeenCalledExactlyOnceWith('provider/install', { backend: 'antigravity', remoteConnectionId: 'remote' });
    request.mockRejectedValueOnce(new Error('Download failed'));
    await expect(api.installProvider('antigravity')).rejects.toThrow('Download failed');
    expect(request).toHaveBeenLastCalledWith('provider/install', { backend: 'antigravity', remoteConnectionId: undefined });
  });
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

describe('plan review IPC', () => {
  it('preserves revision-owned feedback through real preload and adopts only successful daemon responses', async () => {
    const snapshot = createInitialSnapshot();
    const accepted = structuredClone(snapshot);
    accepted.agents[0]!.statusText = 'Feedback submitted';
    const response = { reviewId: 'plan', resolution: 'revise' as const, draftVersion: 3 };
    const request = vi.fn().mockResolvedValue(accepted);
    const controller = new AppController(snapshot, createBackendClient({ request }), fakeAppLifecycle());
    controller.registerIpcHandlers();
    await import('../../preload/index');
    const api = bridge.exposed.get('app') as AppApi;
    await expect(api.respondToPlanReview('remote-owner', response)).resolves.toBe(accepted);
    expect(currentSnapshot(controller)).toBe(accepted);
    expect(request).toHaveBeenCalledExactlyOnceWith('agent/planReview/respond', { agentId: 'remote-owner', response });
    request.mockRejectedValueOnce(new Error('Plan revision changed'));
    await expect(api.respondToPlanReview('remote-owner', response)).rejects.toThrow('Plan revision changed');
    expect(currentSnapshot(controller)).toBe(accepted);
  });
});
