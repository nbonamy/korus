import { product } from '@workspace/core/product';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { AppController, requiresSingleInstanceLock, shouldBlockDisplaySleep } from '../app-controller';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot, CodexAuthentication, CodexChatGptLogin, SetCodexResourceSharingInput, UpdateSettingsInput } from '@workspace/core/contracts';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { OpenInProvider } from '../open-in';
import { callPrivate, currentSnapshot, fakeAppLifecycle, createBackendClient, updateSettings } from './app-controller-test-harness';

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
      browserPane: { closeAll(): Promise<void> };
    }).browserPane, 'closeAll').mockImplementation(async () => {
      lifecycle.push('browser-panes-close');
    });
    setRendererReloadWindow(controller, () => {
      lifecycle.push('renderer-reload');
    });

    await callPrivate(controller, 'reloadRenderer');

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

  it('routes isolated Codex authentication and opens the ChatGPT login URL', async () => {
    const authentication: CodexAuthentication = {
      account: null,
      requiresOpenaiAuth: true,
      login: { status: 'idle', error: null },
    };
    const login: CodexChatGptLogin = {
      loginId: 'login-1',
      authUrl: 'https://auth.openai.com/login',
    };
    const request = vi.fn(async (method: string) => (
      method === backendMethods.codexChatGptLoginStart ? login : authentication
    ));
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const controller = new AppController(
      createInitialSnapshot(),
      createBackendClient({ request }),
      fakeAppLifecycle(),
      async () => undefined,
      openExternal,
    );

    await expect(callPrivate<CodexAuthentication>(controller, 'getCodexAuthentication'))
      .resolves.toStrictEqual(authentication);
    await expect(callPrivate<CodexChatGptLogin>(controller, 'startCodexChatGptLogin'))
      .resolves.toStrictEqual(login);
    await expect(callPrivate<CodexAuthentication>(controller, 'cancelCodexChatGptLogin'))
      .resolves.toStrictEqual(authentication);
    await expect(callPrivate<CodexAuthentication>(controller, 'logoutCodex'))
      .resolves.toStrictEqual(authentication);

    expect(request).toHaveBeenCalledWith(backendMethods.codexAuthenticationGet, undefined);
    expect(request).toHaveBeenCalledWith(backendMethods.codexChatGptLoginStart, undefined);
    expect(request).toHaveBeenCalledWith(backendMethods.codexLoginCancel, undefined);
    expect(request).toHaveBeenCalledWith(backendMethods.codexLogout, undefined);
    expect(openExternal).toHaveBeenCalledWith(login.authUrl);
  });

  it('keeps remote device-code authentication targeted and does not auto-open a browser', async () => {
    const request = vi.fn().mockResolvedValue({ loginId: 'device-login', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD' });
    const openExternal = vi.fn();
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }), fakeAppLifecycle(), async () => undefined, openExternal);
    const auth = controller as unknown as {
      getCodexAuthentication(id: string): Promise<unknown>;
      startCodexChatGptDeviceCodeLogin(id: string): Promise<unknown>;
      cancelCodexChatGptLogin(id: string, loginId: string): Promise<unknown>;
    };
    await auth.getCodexAuthentication('wall-e');
    await auth.startCodexChatGptDeviceCodeLogin('wall-e');
    await auth.cancelCodexChatGptLogin('wall-e', 'device-login');
    expect(request.mock.calls).toEqual([
      [backendMethods.codexAuthenticationGet, { remoteConnectionId: 'wall-e' }],
      [backendMethods.codexChatGptDeviceCodeLoginStart, { remoteConnectionId: 'wall-e' }],
      [backendMethods.codexLoginCancel, { remoteConnectionId: 'wall-e', loginId: 'device-login' }],
    ]);
    expect(openExternal).not.toHaveBeenCalled();
    expect(() => auth.startCodexChatGptDeviceCodeLogin('')).toThrow('remote connection');
  });

  it('routes Claude auth status to the selected connection without opening a browser', async () => {
    const request = vi.fn().mockResolvedValue({ loggedIn: false });
    const openExternal = vi.fn();
    const controller = new AppController(createInitialSnapshot(), createBackendClient({ request }), fakeAppLifecycle(), async () => undefined, openExternal);
    const auth = controller as unknown as { getClaudeAuthentication(id?: string): Promise<unknown> };

    await expect(auth.getClaudeAuthentication('wall-e')).resolves.toStrictEqual({ loggedIn: false });
    expect(request).toHaveBeenCalledWith(backendMethods.claudeAuthenticationGet, { connectionId: 'wall-e' });
    await expect(auth.getClaudeAuthentication()).resolves.toStrictEqual({ loggedIn: false });
    expect(request).toHaveBeenLastCalledWith(backendMethods.claudeAuthenticationGet, undefined);
    expect(openExternal).not.toHaveBeenCalled();
    expect(() => auth.getClaudeAuthentication('')).toThrow('remote connection');
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
    snapshot.agents[0].folder = path.resolve(__dirname, '../../../..');
    const updatedSnapshot = structuredClone(snapshot);
    updatedSnapshot.agents[0].openInApplication = 'vscode';
    const request = vi.fn().mockResolvedValue(updatedSnapshot);
    const open = vi.fn().mockResolvedValue(undefined);
    const controller = new AppController(snapshot, createBackendClient({ request }));
    (controller as unknown as { openInProvider: OpenInProvider }).openInProvider = {
      list: vi.fn(),
      open,
    };

    await expect(openAgentPath(controller, 'agent-dina', 'vscode', 'README.md')).resolves.toBe(updatedSnapshot);

    expect(open).toHaveBeenCalledWith('vscode', path.join(snapshot.agents[0].folder, 'README.md'));
    expect(request).toHaveBeenCalledWith(backendMethods.clientAgentExternalApplicationUpdate, {
      agentId: 'agent-dina',
      application: 'vscode',
    });
    expect(currentSnapshot(controller).agents[0].openInApplication).toBe('vscode');
  });

  it('rejects Open In for remote agents and files outside the project', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].folder = path.resolve(__dirname, '../../../..');
    const open = vi.fn();
    const controller = new AppController(snapshot, createBackendClient());
    (controller as unknown as { openInProvider: OpenInProvider }).openInProvider = {
      list: vi.fn(),
      open,
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

function setRendererReloadWindow(controller: AppController, reload: () => void): void {
  (controller as unknown as {
    mainWindow: { isDestroyed(): boolean; webContents: { reload(): void } };
  }).mainWindow = {
    isDestroyed: () => false,
    webContents: { reload },
  };
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
