import { product } from '@workspace/core/product';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { AppController, requiresSingleInstanceLock, shouldBlockDisplaySleep } from '../app-controller';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot, SetCodexResourceSharingInput, UpdateSettingsInput } from '@workspace/core/contracts';
import type { ProviderAuthentication } from '@workspace/core/contracts/provider-setup';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { OpenInProvider } from '../open-in';
import { createOpenInProvider } from '../open-in';
import { addTestWindow, callPrivate, currentSnapshot, fakeAppLifecycle, createBackendClient, updateSettings } from './app-controller-test-harness';

// Native routing uses explicit backend fixtures, not the operator's login shell.
vi.mock('../backend-client', () => ({ createRuntimeAppBackendClient: () => null }));

describe('AppController', () => {
  it('enforces the single-instance lock only for packaged builds', () => {
    expect(requiresSingleInstanceLock(true)).toBe(true);
    expect(requiresSingleInstanceLock(false)).toBe(false);
  });
  it('validates and applies renderer-owned Dock badge counts', () => {
    const badgeApplication = { setBadgeCount: vi.fn(() => true) };
    const controller = new AppController(
      createInitialSnapshot(),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      badgeApplication,
    );

    controller.setDockBadgeCount(3);

    expect(badgeApplication.setBadgeCount).toHaveBeenCalledWith(3);
    expect(() => controller.setDockBadgeCount(-1)).toThrow('non-negative integer');
    expect(() => controller.setDockBadgeCount(1.5)).toThrow('non-negative integer');
  });

  it('waits for a bounded settings voice preview to finish', async () => {
    let finishPreview: () => void = () => {};
    const completion = new Promise<void>((resolve) => {
      finishPreview = resolve;
    });
    const spokenAnnouncements = {
      dispose: vi.fn(),
      queue: vi.fn().mockReturnValue({ queued: true }),
      queueWithCompletion: vi.fn().mockReturnValue({
        completion,
        result: { queued: true },
      }),
    };
    const controller = new AppController(
      createInitialSnapshot(),
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      spokenAnnouncements,
    );
    const preview = (voice: string) => (controller as unknown as {
      previewSpokenAnnouncementVoice(value: string): Promise<unknown>;
    }).previewSpokenAnnouncementVoice(voice);

    const result = preview('bf_emma');
    let settled = false;
    void result.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(spokenAnnouncements.queueWithCompletion).toHaveBeenCalledWith({
      agentId: 'settings-preview:bf_emma',
      phase: 'start',
      text: `${product.name} is ready. Let's build something.`,
      voice: 'bf_emma',
    });
    finishPreview();
    await expect(result).resolves.toStrictEqual({ queued: true });
    await expect(preview('robot')).rejects.toThrowError('Invalid spoken announcement voice.');
  });

  it('keeps agent and AC-only remote-access sleep prevention independent', () => {
    expect(shouldBlockDisplaySleep({
      sourceFolderPath: '',
      shouldPreventDisplaySleep: true,
      shouldPreventDisplaySleepForRemoteAccess: false,
    }, true)).toBe(true);
    expect(shouldBlockDisplaySleep({
      sourceFolderPath: '',
      shouldPreventDisplaySleep: false,
      shouldPreventDisplaySleepForRemoteAccess: true,
    }, false)).toBe(true);
    expect(shouldBlockDisplaySleep({
      sourceFolderPath: '',
      shouldPreventDisplaySleep: false,
      shouldPreventDisplaySleepForRemoteAccess: true,
    }, true)).toBe(false);
  });

  it('closes the backend before relaunching the app when restart is requested', async () => {
    const order: string[] = [];
    const appLifecycle = {
      quit: vi.fn(),
      relaunch: vi.fn(() => order.push('relaunch')),
      exit: vi.fn(() => order.push('exit')),
    };
    const backendClient = createBackendClient({
      close: vi.fn(async () => {
        order.push('close');
      }),
    });
    const controller = new AppController(createInitialSnapshot(), backendClient, appLifecycle);

    await controller.initialize();
    await restartApp(controller);

    expect(order).toStrictEqual(['close', 'relaunch', 'exit']);
    expect(appLifecycle.relaunch).toHaveBeenCalledOnce();
    expect(appLifecycle.exit).toHaveBeenCalledWith(0);
    expect(appLifecycle.quit).not.toHaveBeenCalled();
  });

  it('restarts the background backend after changing Codex resource sharing', async () => {
    const snapshot = createInitialSnapshot();
    const backendSnapshot = {
      ...snapshot,
      general: { ...snapshot.general, providerHomes: { codex: { isolated: true, shareSkills: false, homePath: "/app/codex-home" } } },
    };
    const request = vi.fn().mockResolvedValue(backendSnapshot);
    const lifecycle: string[] = [];
    const close = vi.fn().mockImplementation(async () => {
      lifecycle.push('backend-close');
    });
    const appLifecycle = fakeAppLifecycle();
    const daemonStatusLoader = vi.fn().mockResolvedValue({
      supported: true,
      installed: true,
      running: true,
      socketPath: '/tmp/daemon.sock',
      launchAgentPath: '/tmp/daemon.plist',
    });
    const daemonRefresher = vi.fn().mockResolvedValue({
      supported: true,
      installed: true,
      running: true,
      socketPath: '/tmp/daemon.sock',
      launchAgentPath: '/tmp/daemon.plist',
    });
    const backendClient = createBackendClient({ request, close });
    const controller = new AppController(
      snapshot,
      backendClient,
      appLifecycle,
      async () => undefined,
      async () => undefined,
      null,
      daemonStatusLoader,
      daemonRefresher,
    );
    const closeAllBrowserPanes = vi.spyOn((controller as unknown as {
      browserPane: { closeAll(): Promise<void> };
    }).browserPane, 'closeAll').mockImplementation(async () => {
      lifecycle.push('browser-panes-close');
    });
    const input: SetCodexResourceSharingInput = { enabled: false, mode: 'fresh' };

    await controller.initialize();
    await expect(setCodexResourceSharing(controller, input)).resolves.toBe(backendSnapshot);

    expect(request).toHaveBeenCalledWith(backendMethods.settingsCodexResourceSharingSet, { input });
    expect(closeAllBrowserPanes).toHaveBeenCalledOnce();
    expect(lifecycle).toStrictEqual(['browser-panes-close', 'backend-close']);
    expect(close).toHaveBeenCalledOnce();
    expect(daemonRefresher).toHaveBeenCalledOnce();
    expect(backendClient.start).toHaveBeenCalledTimes(2);
    expect(appLifecycle.relaunch).not.toHaveBeenCalled();
    expect(appLifecycle.exit).not.toHaveBeenCalled();
  });

  it('closes hosted browser panes before reloading only the renderer', async () => {
    const controller = new AppController(createInitialSnapshot(), null);
    const lifecycle: string[] = [];
    vi.spyOn((controller as unknown as {
      browserPane: { closeHostedBy(window: unknown): Promise<void> };
    }).browserPane, 'closeHostedBy').mockImplementation(async () => {
      lifecycle.push('browser-panes-close');
    });
    const window = setRendererReloadWindow(controller, () => {
      lifecycle.push('renderer-reload');
    });

    await (controller as unknown as { reloadRenderer(window: unknown): Promise<void> }).reloadRenderer(window);

    expect(lifecycle).toStrictEqual(['browser-panes-close', 'renderer-reload']);
  });

  it('reads migration status and keeps the backend running when migration is declined', async () => {
    const snapshot = createInitialSnapshot();
    const backendSnapshot = {
      ...snapshot,
      general: { ...snapshot.general, providerHomes: { codex: { isolated: true, shareSkills: false, homePath: "/app/codex-home" } } },
    };
    const request = vi.fn(async (method: string) => (
      method === backendMethods.settingsCodexResourceSharingGet
        ? { enabled: true, migrationRequired: true }
        : backendSnapshot
    ));
    const close = vi.fn().mockResolvedValue(undefined);
    const appLifecycle = fakeAppLifecycle();
    const controller = new AppController(snapshot, createBackendClient({ request, close }), appLifecycle);

    await controller.initialize();
    await expect(callPrivate(controller, 'getCodexResourceSharingStatus')).resolves.toStrictEqual({
      enabled: true,
      migrationRequired: true,
    });
    await expect(setCodexResourceSharing(controller, { enabled: false, mode: 'keep' })).resolves.toBe(backendSnapshot);

    expect(close).not.toHaveBeenCalled();
    expect(appLifecycle.relaunch).not.toHaveBeenCalled();
    expect(appLifecycle.exit).not.toHaveBeenCalled();
  });

  it('routes local authentication and opens the browser login URL', async () => {
    const state = { account: null, requiresOpenaiAuth: true, login: { status: 'idle', error: null } } as const;
    const authentication: ProviderAuthentication = { kind: 'codex', connected: false, state };
    const login: ProviderAuthentication = { ...authentication, state: { ...state, login: { status: 'pending', error: null } }, login: { method: 'browser', id: 'login-1', url: 'https://auth.openai.com/login' } };
    const request = vi.fn(async (_method: string, params: { action: string }) => (params.action === 'login' ? login : authentication));
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const controller = new AppController(
      createInitialSnapshot(),
      createBackendClient({ request }),
      fakeAppLifecycle(),
      async () => undefined,
      openExternal,
    );
    const auth = controller as unknown as { authenticateProvider(provider: string, action: string, options?: object): Promise<ProviderAuthentication> };
    const authenticate = (action: string, options?: object) => auth.authenticateProvider('codex', action, options);

    await expect(authenticate('check')).resolves.toStrictEqual(authentication);
    await expect(authenticate('login', { method: 'browser' })).resolves.toStrictEqual(login);
    await expect(authenticate('cancel')).resolves.toStrictEqual(authentication);
    await expect(authenticate('logout')).resolves.toStrictEqual(authentication);

    expect(request.mock.calls).toEqual([
      [backendMethods.providerAuthenticate, { provider: 'codex', action: 'check' }],
      [backendMethods.providerAuthenticate, { provider: 'codex', action: 'login', method: 'browser' }],
      [backendMethods.providerAuthenticate, { provider: 'codex', action: 'cancel' }],
      [backendMethods.providerAuthenticate, { provider: 'codex', action: 'logout' }],
    ]);
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://auth.openai.com/login');
  });

  it('keeps remote device-code authentication targeted and does not auto-open a browser', async () => {
    const request = vi.fn().mockResolvedValue({ kind: 'codex', connected: false, state: { account: null, requiresOpenaiAuth: true, login: { status: 'pending', error: null } }, login: { method: 'deviceCode', id: 'device-login', url: 'https://auth.openai.com/codex/device', code: 'ABCD' } });
    const openExternal = vi.fn();
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }), fakeAppLifecycle(), async () => undefined, openExternal);
    const auth = controller as unknown as { authenticateProvider(provider: string, action: string, options?: object): Promise<unknown> };
    await auth.authenticateProvider('codex', 'check', { remoteConnectionId: 'wall-e' });
    await auth.authenticateProvider('codex', 'login', { method: 'deviceCode', remoteConnectionId: 'wall-e' });
    await auth.authenticateProvider('codex', 'cancel', { remoteConnectionId: 'wall-e', loginId: 'device-login' });
    expect(request.mock.calls).toEqual([
      [backendMethods.providerAuthenticate, { provider: 'codex', action: 'check', remoteConnectionId: 'wall-e' }],
      [backendMethods.providerAuthenticate, { provider: 'codex', action: 'login', method: 'deviceCode', remoteConnectionId: 'wall-e' }],
      [backendMethods.providerAuthenticate, { provider: 'codex', action: 'cancel', loginId: 'device-login', remoteConnectionId: 'wall-e' }],
    ]);
    expect(openExternal).not.toHaveBeenCalled();
    await expect(auth.authenticateProvider('codex', 'login', { method: 'deviceCode', remoteConnectionId: '' })).rejects.toThrow('remote connection');
  });

  it('never opens a browser for a remote browser login or a login without a URL', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ kind: 'codex', connected: false, state: { account: null, requiresOpenaiAuth: true, login: { status: 'pending', error: null } }, login: { method: 'browser', id: 'remote-login', url: 'https://auth.openai.com/login' } })
      .mockResolvedValueOnce({ kind: 'antigravity', connected: true, state: { loggedIn: true, homePath: '/synthetic/antigravity' } });
    const openExternal = vi.fn();
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }), fakeAppLifecycle(), async () => undefined, openExternal);
    const auth = controller as unknown as { authenticateProvider(provider: string, action: string, options?: object): Promise<unknown> };
    await auth.authenticateProvider('codex', 'login', { method: 'browser', remoteConnectionId: 'wall-e' });
    await auth.authenticateProvider('antigravity', 'login');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('routes Claude auth status to the selected connection without opening a browser', async () => {
    const result = { kind: 'claude', connected: false, state: { loggedIn: false } };
    const request = vi.fn().mockResolvedValue(result);
    const openExternal = vi.fn();
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }), fakeAppLifecycle(), async () => undefined, openExternal);
    const auth = controller as unknown as { authenticateProvider(provider: string, action: string, options?: object): Promise<unknown> };

    await expect(auth.authenticateProvider('claude', 'check', { remoteConnectionId: 'wall-e' })).resolves.toStrictEqual(result);
    expect(request).toHaveBeenCalledWith(backendMethods.providerAuthenticate, { provider: 'claude', action: 'check', remoteConnectionId: 'wall-e' });
    await expect(auth.authenticateProvider('claude', 'check')).resolves.toStrictEqual(result);
    expect(request).toHaveBeenLastCalledWith(backendMethods.providerAuthenticate, { provider: 'claude', action: 'check' });
    expect(openExternal).not.toHaveBeenCalled();
    await expect(auth.authenticateProvider('claude', 'check', { remoteConnectionId: '' })).rejects.toThrow('remote connection');
  });

  it('restarts the app when the Codex executable setting changes', async () => {
    const snapshot = createInitialSnapshot();
    const backendSnapshot = {
      ...snapshot,
      general: {
        ...snapshot.general,
        codexBinaryPath: '/opt/homebrew/bin/codex',
      },
    };
    const request = vi.fn().mockResolvedValue(backendSnapshot);
    const appLifecycle = fakeAppLifecycle();
    const controller = new AppController(snapshot, createBackendClient({ request }), appLifecycle);
    const input: UpdateSettingsInput = {
      general: {
        codexBinaryPath: ' /opt/homebrew/bin/codex ',
      },
    };

    await controller.initialize();

    await expect(updateSettings(controller, input)).resolves.toBe(backendSnapshot);

    expect(request).toHaveBeenCalledWith('settings/update', { input });
    expect(appLifecycle.relaunch).toHaveBeenCalledOnce();
    expect(appLifecycle.exit).toHaveBeenCalledWith(0);
  });

  it('opens local project paths and persists the selected application per agent', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].folder = path.resolve(__dirname, '../../../../..');
    const updatedSnapshot = structuredClone(snapshot);
    updatedSnapshot.agents[0].openInApplication = 'vscode';
    const request = vi.fn().mockResolvedValue(updatedSnapshot);
    const open = vi.fn().mockResolvedValue(undefined);
    const controller = new AppController(snapshot, createBackendClient({ request }));
    (controller as unknown as { openInProvider: OpenInProvider }).openInProvider = {
      list: vi.fn(),
      open,
      openFile: vi.fn(),
    };

    await expect(openAgentPath(controller, 'agent-dina', 'vscode', 'README.md')).resolves.toBe(updatedSnapshot);

    expect(open).toHaveBeenCalledWith('vscode', path.join(snapshot.agents[0].folder, 'README.md'));
    expect(request).toHaveBeenCalledWith(backendMethods.clientAgentExternalApplicationUpdate, {
      agentId: 'agent-dina',
      application: 'vscode',
    });
    expect(currentSnapshot(controller).agents[0].openInApplication).toBe('vscode');
  });

  it('opens and reveals local files without changing app preferences, and rejects non-local targets', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.folder = path.resolve(__dirname, '../../../../..');
    const openPath = vi.fn().mockResolvedValue('');
    const showItemInFolder = vi.fn();
    const controller = new AppController(snapshot, createBackendClient());
    (controller as unknown as { openInProvider: OpenInProvider }).openInProvider = createOpenInProvider({ openPath, showItemInFolder });
    const act = (filePath: string, action: 'open' | 'reveal') => (controller as unknown as {
      openAgentFile(id: string, file: string, action: 'open' | 'reveal'): Promise<void>;
    }).openAgentFile(agent.id, filePath, action);
    await act('README.md', 'open');
    expect(openPath).toHaveBeenCalledWith(path.join(agent.folder, 'README.md'));
    await act('README.md', 'reveal');
    expect(showItemInFolder).toHaveBeenCalledWith(path.join(agent.folder, 'README.md'));
    expect(agent.openInApplication).toBeUndefined();
    openPath.mockResolvedValueOnce('No associated application');
    await expect(act('README.md', 'open')).rejects.toThrow('No associated application');
    await expect(act('README.md', 'invalid' as never)).rejects.toThrow('Invalid file action');
    agent.remoteConnectionId = 'remote';
    await expect(act('README.md', 'open')).rejects.toThrow('only available for local agents');
    delete agent.remoteConnectionId;
    agent.sharedConversation = { joinId: 'shared' };
    await expect(act('README.md', 'reveal')).rejects.toThrow('only available for local agents');
    expect(openPath).toHaveBeenCalledTimes(2);
    expect(showItemInFolder).toHaveBeenCalledOnce();
  });

  it('opens and reveals explicitly selected external files, including symlinks and workspace-free Quick Chats', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'native-file-actions-'));
    try {
      const folder = path.join(directory, 'project');
      const external = path.join(directory, 'generated report.txt');
      await mkdir(folder);
      await writeFile(external, 'Generated output');
      await symlink(external, path.join(folder, 'report.txt'));
      const snapshot = createInitialSnapshot();
      const agent = snapshot.agents[0]!;
      agent.folder = folder;
      const openPath = vi.fn().mockResolvedValue('');
      const showItemInFolder = vi.fn();
      const controller = new AppController(snapshot, createBackendClient());
      (controller as unknown as { openInProvider: OpenInProvider }).openInProvider = createOpenInProvider({ openPath, showItemInFolder });
      const act = (file: string, action: 'open' | 'reveal') => (controller as unknown as {
        openAgentFile(id: string, file: string, action: 'open' | 'reveal'): Promise<void>;
      }).openAgentFile(agent.id, file, action);
      const expected = await realpath(external);
      for (const file of [external, '../generated report.txt', 'report.txt']) {
        await act(file, 'open');
        expect(openPath).toHaveBeenLastCalledWith(expected);
        await act(file, 'reveal');
        expect(showItemInFolder).toHaveBeenLastCalledWith(expected);
      }
      agent.folder = null;
      agent.sessionKind = 'quickChat';
      for (const action of ['open', 'reveal'] as const) await act(external, action);
      await expect(act('report.txt', 'open')).rejects.toThrow('does not have a project workspace');
      await expect(act(path.join(directory, 'missing.txt'), 'reveal')).rejects.toThrow('ENOENT');
      expect(openPath).toHaveBeenCalledTimes(4);
      expect(showItemInFolder).toHaveBeenCalledTimes(4);
      expect(agent.openInApplication).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('rejects Open In for remote agents and files outside the project', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].folder = path.resolve(__dirname, '../../../../..');
    const open = vi.fn();
    const controller = new AppController(snapshot, createBackendClient());
    (controller as unknown as { openInProvider: OpenInProvider }).openInProvider = {
      list: vi.fn(),
      open,
      openFile: vi.fn(),
    };

    const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), 'open-in-controller-'));
    try {
      const outsideFile = path.join(outsideDirectory, 'outside.txt');
      await writeFile(outsideFile, 'outside the project');
      await expect(openAgentPath(controller, 'agent-dina', 'finder', outsideFile))
        .rejects.toThrow('only available for files inside');

      currentSnapshot(controller).agents.find(agent => agent.id === 'agent-dina')!.remoteConnectionId = 'connection-devbox';
      await expect(openAgentPath(controller, 'agent-dina', 'finder')).rejects.toThrow('only available for local agents');
      expect(open).not.toHaveBeenCalled();
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });
});

function setRendererReloadWindow(controller: AppController, reload: () => void) {
  return addTestWindow(controller, { webContents: { reload } });
}

function restartApp(controller: AppController): Promise<void> {
  return (controller as unknown as { restartApp(): Promise<void> }).restartApp();
}

async function setCodexResourceSharing(controller: AppController, input: SetCodexResourceSharingInput): Promise<AppSnapshot> {
  return (controller as unknown as {
    setCodexResourceSharing(input: SetCodexResourceSharingInput): Promise<AppSnapshot>;
  }).setCodexResourceSharing(input);
}

async function openAgentPath(
  controller: AppController,
  agentId: string,
  application: 'vscode' | 'finder',
  filePath?: string,
): Promise<AppSnapshot> {
  return (controller as unknown as {
    openAgentPath(agentId: string, application: 'vscode' | 'finder', filePath?: string): Promise<AppSnapshot>;
  }).openAgentPath(agentId, application, filePath);
}
