import { product } from '@workspace/core/product';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { ipcChannels } from '@workspace/core/ipc';
import type { AppBackendClientPort } from '../backend-client';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';

const native = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  exposed: new Map<string, unknown>(),
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn(), showMessageBoxSync: vi.fn(), showErrorBox: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), beep: vi.fn() },
  access: vi.fn(), applicationExists: true,
  factory: vi.fn(), createWindow: vi.fn(), maintenance: vi.fn(), capture: vi.fn(),
  keyStart: vi.fn((_hotkey: string, _capture: () => void) => true), keyStop: vi.fn(), ready: false,
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    app: Object.assign(new EventEmitter(), {
      isPackaged: true, getAppPath: () => '/test/app',
      getPath: (name: string) => name === 'exe' ? '/Volumes/Install/Test.app/Contents/MacOS/Test' : '/test/data',
      isReady: () => native.ready, whenReady: vi.fn(), requestSingleInstanceLock: vi.fn(() => true),
      isInApplicationsFolder: vi.fn(() => true), moveToApplicationsFolder: vi.fn(),
      quit: vi.fn(), exit: vi.fn(), relaunch: vi.fn(), setAsDefaultProtocolClient: vi.fn(),
    }),
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => any) => native.handlers.set(channel, handler),
      removeHandler: (channel: string) => native.handlers.delete(channel),
    },
    contextBridge: { exposeInMainWorld: (name: string, value: unknown) => native.exposed.set(name, value) },
    ipcRenderer: {
      invoke: async (channel: string, ...args: unknown[]) => native.handlers.get(channel)!({}, ...args),
    },
    powerMonitor: Object.assign(new EventEmitter(), { isOnBatteryPower: () => false }),
    powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
    clipboard: {}, dialog: native.dialog, shell: native.shell,
    protocol: { handle: vi.fn() }, net: { fetch: vi.fn() },
  };
});
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  const overrides = {
    accessSync: native.access,
    existsSync: (file: string) => file === '/Applications/Test.app' ? native.applicationExists : original.existsSync(file),
  };
  return { ...original, ...overrides, default: { ...original, ...overrides } };
});
vi.mock('../mobile/adapter', () => ({ AVD_PREFIX: 'avd:', NativeMobileAdapter: class {
  list = async () => ({ devices: [{ id: 'phone', name: 'iPhone', platform: 'ios', state: 'booted' }], setup: [] });
  boot = async () => undefined;
  detach = vi.fn();
  screen = async () => ({ png: Buffer.from('image'), width: 1200, height: 2400, scale: 3 });
  inspect = async () => 'Settings';
  perform = async () => undefined;
  rotate = async () => undefined;
  displayRotation = async () => 0;
  isRunning = async () => true;
  shutdown = async () => undefined;
  startView = (_device: unknown, _screen: unknown, frame: (jpeg: Buffer) => void) => {
    frame(Buffer.from('jpeg-video'));
    return { touch: vi.fn(), stop: vi.fn() };
  };
} }));
vi.mock('../log', () => ({ initializeMainLogging: vi.fn(), installProcessErrorLogging: vi.fn(), logMain: vi.fn(), warnMain: vi.fn() }));
vi.mock('../main-window', () => ({ createMainWindow: native.createWindow }));
vi.mock('../app-menu', () => ({ installAppMenu: vi.fn() }));
vi.mock('../backend-client', () => ({ createRuntimeAppBackendClient: native.factory }));
vi.mock('../daemon-startup-maintenance', () => ({ ensureCurrentDaemonForStartup: native.maintenance }));
vi.mock('../appshots', () => ({ captureAppshot: native.capture }));
vi.mock('../spoken-announcements', async (importOriginal) => ({
  ...await importOriginal<typeof import('../spoken-announcements')>(),
  createRuntimeSpokenAnnouncementQueue: () => ({ dispose: vi.fn(), queue: vi.fn(), queueWithCompletion: vi.fn() }),
}));
vi.mock('../appshots-key-monitor', () => ({
  AppshotsKeyMonitor: class { start = native.keyStart; stop = native.keyStop; },
}));
vi.mock('../auto-update', () => ({
  DesktopAutoUpdateService: class {
    start = vi.fn(); stop = vi.fn(); getStatus = () => ({ state: 'idle' });
  },
}));
import { app, powerMonitor, BrowserWindow } from 'electron';
import { AppController, startMainApp } from '../app-controller';
import { AppshotsKeyMonitor } from '../appshots-key-monitor';
import { installAppMenu } from '../app-menu';
import type { DesktopAutoUpdateService } from '../auto-update';

let controllers: AppController[] = [];
function windowFixture() {
  return Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { send: vi.fn(), reload: vi.fn() }),
    isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => false),
    isFocused: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn(),
    setAutoHideMenuBar: vi.fn(), setMenuBarVisibility: vi.fn(),
  });
}
function backendFixture() {
  const snapshot = createInitialSnapshot();
  const state = { snapshot, lastEventSeq: 0, clientState: { sourceFolderPath: '/projects', shouldPreventDisplaySleep: false } };
  let emit = (_event: AppBackendEvent) => {};
  let disconnect = (_state: 'connected' | 'disconnected', _error?: Error) => {};
  const unsubscribe = vi.fn();
  const unsubscribeConnection = vi.fn();
  const backend = {
    start: vi.fn().mockResolvedValue(undefined),
    health: vi.fn().mockResolvedValue({ ok: true, name: 'daemon', version: 'test', pid: 123 }),
    request: vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'snapshot/get') return state;
      if (method === 'client/state/get') return state.clientState;
      throw new Error('Unexpected request: ' + method);
    }),
    onEvent: vi.fn((listener: typeof emit) => { emit = listener; return unsubscribe; }),
    onConnectionState: vi.fn((listener: typeof disconnect) => { disconnect = listener; return unsubscribeConnection; }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { backend, state, unsubscribe, unsubscribeConnection, emit: (event: AppBackendEvent) => emit(event),
    disconnect: (error?: Error) => disconnect('disconnected', error) };
}
function setup() {
  const fixture = backendFixture();
  const window = windowFixture();
  native.createWindow.mockReturnValue(window);
  const controller = new AppController(fixture.state.snapshot, fixture.backend as AppBackendClientPort,
    undefined, undefined, undefined, new AppshotsKeyMonitor());
  controllers.push(controller);
  controller.registerIpcHandlers();
  return { ...fixture, window, controller };
}
function invoke(channel: string, ...args: unknown[]) { return native.handlers.get(channel)!({}, ...args); }
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
beforeEach(() => {
  Object.defineProperty(process, 'resourcesPath', { value: '/test/resources', configurable: true });
  vi.clearAllMocks();
  vi.useFakeTimers();
  native.handlers.clear();
  native.factory.mockReturnValue(null);
  native.createWindow.mockImplementation(() => windowFixture());
  native.maintenance.mockResolvedValue(undefined);
  native.ready = false;
  native.access.mockReset();
  native.applicationExists = true;
  native.shell.openPath.mockResolvedValue('');
  app.removeAllListeners();
  powerMonitor.removeAllListeners();
  vi.mocked(app.requestSingleInstanceLock).mockReturnValue(true);
  vi.mocked(app.isInApplicationsFolder).mockReturnValue(true);
});
afterEach(async () => {
  if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
  else delete (process as unknown as Record<string, unknown>).resourcesPath;
  for (const controller of controllers) await controller.shutdown();
  controllers = [];
  app.removeAllListeners();
  powerMonitor.removeAllListeners();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('controller desktop lifecycle', () => {
  it('hands a review to manual through the preload and IPC without an interruption request', async () => {
    const { backend, state } = setup();
    backend.request.mockImplementation(async method => method === 'agent/codeReview/manual' ? state.snapshot : state.clientState);
    await import('../../preload/index');
    const api = native.exposed.get('app') as import('@workspace/core/contracts').AppApi;
    await expect(api.switchCodeReviewToManual('reviewer', 'review')).resolves.toStrictEqual(state.snapshot);
    expect(backend.request.mock.calls).toStrictEqual([
      ['agent/codeReview/manual', { agentId: 'reviewer', sessionId: 'review' }],
      ['client/state/get'],
    ]);
  });

  it('limits the simulator to local agents through IPC and revokes control on disconnect', async () => {
    const { controller, state, window, disconnect } = setup();
    const agentId = state.snapshot.agents[0]!.id;
    state.snapshot.agents.push({ ...state.snapshot.agents[0]!, id: 'remote-agent', teamId: 'remote-team' });
    state.snapshot.teams.push({ id: 'remote-team', name: 'Remote', agentIds: ['remote-agent'], remoteConnectionId: 'remote' });
    await controller.initialize(); controller.createWindow();
    await expect(invoke(ipcChannels.mobileSimulator, 'missing', { action: 'list' })).rejects.toThrow('Agent not found');
    await expect(invoke(ipcChannels.mobileSimulator, 'remote-agent', { action: 'list' })).rejects.toThrow('local agents');
    await expect(invoke(ipcChannels.mobileSimulatorView, 'remote-agent', { action: 'start', attachmentId: 'unknown' })).rejects.toThrow('local agents');
    const { attachment } = await invoke(ipcChannels.mobileSimulator, agentId, { action: 'attach', deviceId: 'phone' });
    expect(native.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.appCommand, { type: 'open-simulator', agentId });
    expect((await invoke(ipcChannels.mobileSimulator, agentId, { action: 'screenshot', attachmentId: attachment.id })).frame.data).toBe(Buffer.from('image').toString('base64'));
    const { viewId } = await invoke(ipcChannels.mobileSimulatorView, agentId, { action: 'start', attachmentId: attachment.id });
    expect((await invoke(ipcChannels.mobileSimulatorView, agentId, { action: 'frame', attachmentId: attachment.id, viewId })).frame.data).toEqual(new Uint8Array(Buffer.from('jpeg-video')));
    disconnect();
    await expect(invoke(ipcChannels.mobileSimulatorView, agentId, { action: 'frame', attachmentId: attachment.id, viewId })).rejects.toThrow('No matching');
    await expect(invoke(ipcChannels.mobileSimulator, agentId, { action: 'screenshot', attachmentId: attachment.id })).rejects.toThrow('No matching');
  });

  it('lets an agent attach without a prompt and ties the pane to its attach and detach', async () => {
    const fixture = backendFixture();
    native.factory.mockReturnValue(fixture.backend);
    const window = windowFixture();
    native.createWindow.mockReturnValue(window);
    const controller = new AppController(fixture.state.snapshot);
    controllers.push(controller);
    controller.registerIpcHandlers();
    controller.createWindow();
    const agentId = fixture.state.snapshot.agents[0]!.id;
    const agent = native.factory.mock.calls[0]![0].mobileSimulator as (agent: string, input: unknown) => Promise<{ attachment: { id: string } | null }>;
    const { attachment } = await agent(agentId, { action: 'attach', deviceId: 'phone' });
    expect(native.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.appCommand, { type: 'open-simulator', agentId });
    await agent(agentId, { action: 'shutdown', attachmentId: attachment!.id });
    expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.appCommand, { type: 'close-simulator', agentId });
    window.webContents.send.mockClear();
    const paneAttachment = (await invoke(ipcChannels.mobileSimulator, agentId, { action: 'attach', deviceId: 'phone' })).attachment;
    window.webContents.send.mockClear();
    await invoke(ipcChannels.mobileSimulator, agentId, { action: 'detach', attachmentId: paneAttachment.id });
    expect(window.webContents.send).not.toHaveBeenCalledWith(ipcChannels.appCommand, { type: 'close-simulator', agentId });
  });

  it('synchronizes the execution-plan checkmark after removal, agent selection, and failed toggles', async () => {
    const { controller, backend, state, emit } = setup();
    const packaged = app.isPackaged;
    Object.defineProperty(app, 'isPackaged', { value: false, configurable: true });
    try {
      const snapshot = structuredClone(state.snapshot);
      snapshot.agents[0]!.plan = {
        kind: 'execution', status: 'inProgress', explanation: 'Debug execution plan', markdown: '- [ ] Test',
        steps: [{ step: 'Test', status: 'pending' }], threadId: 'debug-thread', turnId: 'debug-turn', updatedAt: '2026-10-08T00:00:00Z',
      };
      state.snapshot = snapshot;
      await controller.initialize();
      controller.createWindow();
      const menu = native.createWindow.mock.lastCall![0];
      expect(menu.hasDebugExecutionPlan()).toBe(true);
      const withoutPlan = structuredClone(snapshot);
      delete withoutPlan.agents[0]!.plan;
      backend.request.mockImplementation(async method => method === 'debug/executionPlan/toggle' ? withoutPlan : state.clientState);
      menu.toggleDebugExecutionPlan();
      await vi.advanceTimersByTimeAsync(0);
      expect(backend.request).toHaveBeenCalledWith('debug/executionPlan/toggle', { agentId: snapshot.activeAgentId });
      expect(vi.mocked(installAppMenu).mock.lastCall![1].hasDebugExecutionPlan!()).toBe(false);

      emit({ seq: 1, occurredAt: '2026-10-08T00:00:00Z', type: 'snapshot.updated', payload: snapshot });
      expect(vi.mocked(installAppMenu).mock.lastCall![1].hasDebugExecutionPlan!()).toBe(true);
      const switched = structuredClone(snapshot);
      switched.activeAgentId = snapshot.agents[1]!.id;
      emit({ seq: 2, occurredAt: '2026-10-08T00:00:01Z', type: 'snapshot.updated', payload: switched });
      expect(vi.mocked(installAppMenu).mock.lastCall![1].hasDebugExecutionPlan!()).toBe(false);

      vi.mocked(installAppMenu).mockClear();
      backend.request.mockRejectedValueOnce(new Error('Unavailable'));
      menu.toggleDebugExecutionPlan();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.mocked(installAppMenu).mock.lastCall![1].hasDebugExecutionPlan!()).toBe(false);
    } finally {
      Object.defineProperty(app, 'isPackaged', { value: packaged, configurable: true });
    }
  });

  it.each([
    { get: 'getDebugMissingEngines', set: 'setDebugMissingEngines', type: 'debug-missing-engines' },
    { get: 'getDebugProviderUpgrades', set: 'setDebugProviderUpgrades', type: 'debug-provider-upgrades' },
    { get: 'getDebugReviewUncommitted', set: 'setDebugReviewUncommitted', type: 'debug-review-uncommitted' },
  ] as const)('keeps $type client-only, resets it on reload, and rejects it in packaged builds', ({ get, set, type }) => {
    const { controller, window, backend } = setup();
    const packaged = app.isPackaged;
    Object.defineProperty(app, 'isPackaged', { value: false, configurable: true });
    try {
      controller.createWindow();
      const menu = native.createWindow.mock.calls[0]![0];
      expect(menu[get]()).toBe(false);
      menu[set](true);
      expect(window.webContents.send).toHaveBeenLastCalledWith(ipcChannels.appCommand, { type, enabled: true });
      expect(vi.mocked(installAppMenu).mock.lastCall![1][get]!()).toBe(true);
      menu[set](false);
      expect(window.webContents.send).toHaveBeenLastCalledWith(ipcChannels.appCommand, { type, enabled: false });
      menu[set](true);
      window.webContents.emit('did-start-loading');
      expect(vi.mocked(installAppMenu).mock.lastCall![1][get]!()).toBe(false);
      Object.defineProperty(app, 'isPackaged', { value: true, configurable: true });
      window.webContents.send.mockClear();
      menu[set](true);
      expect(menu[get]()).toBe(false);
      expect(window.webContents.send).not.toHaveBeenCalled();
      expect(backend.request).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(app, 'isPackaged', { value: packaged, configurable: true });
    }
  });

  it.each(['/Applications', '/Applications/Test.app'])('keeps the existing installation untouched when %s requires authorization', async (protectedPath) => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
    vi.mocked(app.isInApplicationsFolder).mockReturnValue(false);
    vi.mocked(app.whenReady).mockResolvedValue(undefined);
    native.access.mockImplementation((file) => {
      if (file === protectedPath) throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    });
    native.dialog.showMessageBoxSync.mockReturnValue(0);

    startMainApp();
    await vi.advanceTimersByTimeAsync(0);

    expect(app.moveToApplicationsFolder).not.toHaveBeenCalled();
    expect(native.shell.openPath).toHaveBeenCalledWith('/Applications');
    expect(app.quit).toHaveBeenCalledOnce();
    expect(native.factory).not.toHaveBeenCalled();
  });

  it('allows fresh installation without testing a nonexistent destination for write access', async () => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
    vi.mocked(app.isInApplicationsFolder).mockReturnValue(false);
    vi.mocked(app.whenReady).mockResolvedValue(undefined);
    vi.mocked(app.moveToApplicationsFolder).mockReturnValue(true);
    native.applicationExists = false;
    native.access.mockImplementation((file) => {
      if (file === '/Applications/Test.app') throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
    });

    startMainApp();
    await vi.advanceTimersByTimeAsync(0);

    expect(app.moveToApplicationsFolder).toHaveBeenCalledOnce();
    expect(native.dialog.showErrorBox).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'finder-error'] as const)('leaves protected installs untouched on manual-install %s', async (outcome) => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
    vi.mocked(app.isInApplicationsFolder).mockReturnValue(false);
    vi.mocked(app.whenReady).mockResolvedValue(undefined);
    native.access.mockImplementation(() => { throw new Error('Permission denied'); });
    native.dialog.showMessageBoxSync.mockReturnValue(outcome === 'cancel' ? 1 : 0);
    native.shell.openPath.mockResolvedValue('Could not open Applications');

    startMainApp();
    await vi.advanceTimersByTimeAsync(0);

    expect(app.moveToApplicationsFolder).not.toHaveBeenCalled();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(native.shell.openPath).toHaveBeenCalledTimes(outcome === 'cancel' ? 0 : 1);
    expect(native.dialog.showErrorBox).toHaveBeenCalledTimes(outcome === 'cancel' ? 0 : 1);
    expect(native.factory).not.toHaveBeenCalled();
  });

  it.each([
    { platform: 'darwin', packaged: false, installed: false },
    { platform: 'darwin', packaged: true, installed: true },
    { platform: 'win32', packaged: true, installed: false },
    { platform: 'linux', packaged: true, installed: false },
  ])('starts normally without relocation for $platform packaged=$packaged installed=$installed', async ({ platform, packaged, installed }) => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: platform } }));
    const originalPackaged = app.isPackaged;
    Object.defineProperty(app, 'isPackaged', { value: packaged, configurable: true });
    vi.mocked(app.isInApplicationsFolder).mockReturnValue(installed);
    vi.mocked(app.whenReady).mockResolvedValue(undefined);
    try {
      startMainApp();
      await vi.advanceTimersByTimeAsync(0);
      expect(app.moveToApplicationsFolder).not.toHaveBeenCalled();
      expect(native.createWindow).toHaveBeenCalledOnce();
      app.emit('before-quit', { preventDefault: vi.fn() });
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      Object.defineProperty(app, 'isPackaged', { value: originalPackaged, configurable: true });
    }
  });

  it('installs a packaged Mac app before creating backend resources or taking the single-instance lock', async () => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
    vi.mocked(app.isInApplicationsFolder).mockReturnValue(false);
    vi.mocked(app.whenReady).mockResolvedValue(undefined);
    vi.mocked(app.moveToApplicationsFolder).mockReturnValue(true);

    startMainApp();
    app.emit('activate');
    await vi.advanceTimersByTimeAsync(0);

    expect(app.moveToApplicationsFolder).toHaveBeenCalledOnce();
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(native.factory).not.toHaveBeenCalled();
    expect(native.maintenance).not.toHaveBeenCalled();
    expect(native.createWindow).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled(); // Electron owns the successful relaunch.
  });

  it.each(['cancel', 'error'] as const)('stops startup after installation %s', async (outcome) => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
    vi.mocked(app.isInApplicationsFolder).mockReturnValue(false);
    vi.mocked(app.whenReady).mockResolvedValue(undefined);
    vi.mocked(app.moveToApplicationsFolder).mockImplementation(() => {
      if (outcome === 'error') throw new Error('Destination is not writable');
      return false;
    });

    startMainApp();
    await vi.advanceTimersByTimeAsync(0);

    expect(app.quit).toHaveBeenCalledOnce();
    expect(native.factory).not.toHaveBeenCalled();
    expect(native.createWindow).not.toHaveBeenCalled();
    expect(native.dialog.showErrorBox).toHaveBeenCalledTimes(outcome === 'error' ? 1 : 0);
  });

  it('confirms replacing an installed app but lets Electron focus an already running copy', async () => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
    vi.mocked(app.isInApplicationsFolder).mockReturnValue(false);
    vi.mocked(app.whenReady).mockResolvedValue(undefined);
    const decisions: boolean[] = [];
    vi.mocked(app.moveToApplicationsFolder).mockImplementation((options) => {
      native.dialog.showMessageBoxSync.mockReturnValueOnce(1).mockReturnValueOnce(0);
      decisions.push(options!.conflictHandler!('exists'));
      decisions.push(options!.conflictHandler!('exists'));
      decisions.push(options!.conflictHandler!('existsAndRunning'));
      return true;
    });

    startMainApp();
    await vi.advanceTimersByTimeAsync(0);

    expect(decisions).toStrictEqual([false, true, true]);
    expect(native.dialog.showMessageBoxSync).toHaveBeenCalledTimes(2);
    expect(native.factory).not.toHaveBeenCalled();
  });

  it.each(['linux', 'win32', 'darwin'] as const)('applies menu visibility through the real preload bridge on %s without a backend request', async (platform) => {
    const { controller, window, backend } = setup();
    controller.createWindow();
    vi.stubGlobal('process', Object.create(process, { platform: { value: platform } }));
    await import('../../preload/index');
    const api = native.exposed.get('app') as import('@workspace/core/contracts').AppApi;

    await api.setMenuBarVisible(false);
    await api.setMenuBarVisible(true);

    expect(window.setAutoHideMenuBar.mock.calls).toStrictEqual(platform === 'darwin' ? [] : [[true], [false]]);
    expect(window.setMenuBarVisibility.mock.calls).toStrictEqual(platform === 'darwin' ? [] : [[false], [true]]);
    expect(backend.request).not.toHaveBeenCalled();

    await expect(api.setMenuBarVisible('false' as unknown as boolean)).rejects.toThrow('must be a boolean');
    expect(window.setMenuBarVisibility).toHaveBeenCalledTimes(platform === 'darwin' ? 0 : 2);
    window.isDestroyed.mockReturnValue(true);
    await api.setMenuBarVisible(false);
    expect(window.setMenuBarVisibility).toHaveBeenCalledTimes(platform === 'darwin' ? 0 : 2);
  });

  it('settles backend browser requests on replacement, timeout, IPC failure, and shutdown', async () => {
    const fixture = backendFixture();
    native.factory.mockReturnValue(fixture.backend);
    native.createWindow.mockReturnValue(windowFixture());
    const controller = new AppController(fixture.state.snapshot);
    controllers.push(controller);
    controller.registerIpcHandlers();
    const browserOpen = native.factory.mock.calls[0]![0].browserOpen as (agent: string, browser: string, url: string) => Promise<unknown>;
    await expect(browserOpen('agent-dina', 'primary', 'https://example.com')).rejects.toThrow('window is not available');
    controller.createWindow();
    const first = browserOpen('agent-dina', 'primary', 'https://one.example');
    const firstRejected = expect(first).rejects.toThrow('superseded');
    const second = browserOpen('agent-dina', 'primary', 'https://two.example');
    const secondRejected = expect(second).rejects.toThrow('Timed out');
    await firstRejected;
    await vi.advanceTimersByTimeAsync(30000);
    await secondRejected;
    const missing = browserOpen('missing-agent', 'primary', 'https://example.com');
    const missingRejected = expect(missing).rejects.toThrow('Agent not found');
    await expect(invoke(ipcChannels.browserOpen, 'missing-agent', 'primary', 'https://example.com', 99)).rejects.toThrow('Agent not found');
    await missingRejected;
    const final = browserOpen('agent-dina', 'primary', 'https://example.com');
    const finalRejected = expect(final).rejects.toThrow('shutting down');
    await controller.shutdown();
    controllers = [];
    await finalRejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles native deep-link and activation events after successful startup', async () => {
    const fixture = backendFixture();
    native.factory.mockReturnValue(fixture.backend);
    const window = windowFixture();
    native.createWindow.mockReturnValue(window);
    vi.mocked(app.whenReady).mockResolvedValue(undefined);
    startMainApp();
    await vi.advanceTimersByTimeAsync(0);
    window.webContents.emit('did-finish-load');
    native.ready = true;
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([window as never]);
    const event = { preventDefault: vi.fn() };
    app.emit('open-url', event, `${product.protocolScheme}://new?prompt=from-url`);
    app.emit('second-instance', {}, ['app', `${product.protocolScheme}://new?prompt=from-argv`]);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.appCommand, {
      type: 'open-agent-composer', prompt: 'from-argv', submit: true,
    });
    app.emit('activate');
    expect(native.createWindow).toHaveBeenCalledOnce();
    window.isDestroyed.mockReturnValue(true);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    native.createWindow.mockReturnValue(windowFixture());
    app.emit('activate');
    expect(native.createWindow).toHaveBeenCalledTimes(2);
    app.emit('before-quit', { preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    expect(fixture.backend.close).toHaveBeenCalledOnce();
  });

  it('serializes appshot capture, queues it across loading, and recovers after capture failure', async () => {
    const { controller, window } = setup();
    controller.createWindow();
    await controller.initialize();
    const capture = native.keyStart.mock.calls[0]![1];
    let complete!: (value: unknown) => void;
    native.capture.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    capture();
    capture();
    expect(native.capture).toHaveBeenCalledOnce();
    const appshot = { appName: 'Editor', windowTitle: 'Test', accessibilityText: 'Selected text' };
    complete(appshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(window.webContents.send.mock.calls.filter(([channel]) => channel === ipcChannels.appCommand)).toHaveLength(0);
    expect(native.shell.beep).toHaveBeenCalledOnce();
    window.webContents.emit('did-finish-load');
    expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.appCommand, { type: 'attach-appshot', ...appshot });
    native.capture.mockRejectedValueOnce(new Error('capture denied'));
    capture();
    await vi.advanceTimersByTimeAsync(0);
    expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.appCommand, { type: 'appshot-failed', message: 'capture denied' });
    native.capture.mockResolvedValueOnce(appshot);
    capture();
    await vi.advanceTimersByTimeAsync(0);
    expect(native.capture).toHaveBeenCalledTimes(3);
    expect(window.focus).toHaveBeenCalledTimes(3);
  });

  it.each(['win32', 'linux'] as const)('opens stable downloads for a disabled updater on %s', async (platform) => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: platform } }));
    native.shell.openExternal.mockResolvedValue(undefined);
    const { controller } = setup();
    const service = {
      getStatus: () => ({ state: 'disabled' }), start: vi.fn(), stop: vi.fn(),
      check: vi.fn(), install: vi.fn(),
    };
    controller.setAutoUpdateService(service as unknown as DesktopAutoUpdateService);
    controller.createWindow();
    native.createWindow.mock.calls[0]![0].checkForUpdates();
    await vi.advanceTimersByTimeAsync(0);
    expect(native.shell.openExternal).toHaveBeenCalledWith(`${product.repositoryUrl}/releases/latest`);
    expect(service.check).not.toHaveBeenCalled();
    expect(native.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('routes menu update checks, renderer status, and confirmed installation through one service', async () => {
    const { controller, window } = setup();
    const service = {
      getStatus: () => ({ state: 'idle' }), start: vi.fn(), stop: vi.fn(),
      check: vi.fn(() => true), install: vi.fn(),
    };
    controller.setAutoUpdateService(service as unknown as DesktopAutoUpdateService);
    controller.createWindow();
    const menu = native.createWindow.mock.calls[0]![0];
    menu.checkForUpdates();
    expect(service.check).toHaveBeenCalledOnce();
    native.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    controller.setDesktopUpdateStatus({ state: 'error', error: 'network unavailable' });
    await vi.advanceTimersByTimeAsync(0);
    expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.updateStatusChanged, { state: 'error', error: 'network unavailable' });
    expect(native.dialog.showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({ type: 'error', detail: 'network unavailable' }));
    controller.setDesktopUpdateStatus({ state: 'downloaded', version: '9.0.0' });
    menu.installUpdate();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.install).toHaveBeenCalledOnce();
    await controller.shutdown();
    controllers = [];
    expect(service.stop).toHaveBeenCalledOnce();
  });

  it('delivers deep links only after each renderer load and reuses or replaces its native window', async () => {
    const { controller, window } = setup();
    controller.openDeepLink(`${product.protocolScheme}://new?prompt=first`);
    controller.createWindow();
    expect(window.webContents.send).not.toHaveBeenCalled();
    window.webContents.emit('did-finish-load');
    expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.appCommand, {
      type: 'open-agent-composer', prompt: 'first', submit: true,
    });
    window.webContents.send.mockClear();
    window.webContents.emit('did-start-loading');
    controller.openDeepLink(`${product.protocolScheme}://new?prompt=second`);
    expect(window.webContents.send).not.toHaveBeenCalled();
    window.webContents.emit('did-finish-load');
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
    window.isMinimized.mockReturnValue(true);
    controller.createWindow();
    expect(native.createWindow).toHaveBeenCalledOnce();
    expect(window.restore).toHaveBeenCalledOnce();
    window.isDestroyed.mockReturnValue(true);
    native.createWindow.mockReturnValue(windowFixture());
    controller.createWindow();
    expect(native.createWindow).toHaveBeenCalledTimes(2);
  });

  it('backs off failed reconnects, exposes cached state, and cancels retries and subscriptions at shutdown', async () => {
    const { controller, backend, state, disconnect, unsubscribe, unsubscribeConnection } = setup();
    controller.createWindow();
    await controller.initialize();
    backend.start.mockRejectedValue(new Error('daemon down'));
    disconnect(new Error('socket closed'));
    disconnect(new Error('socket closed again'));
    await vi.advanceTimersByTimeAsync(249);
    expect(backend.start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.start).toHaveBeenCalledTimes(2);
    expect(await invoke(ipcChannels.getSnapshotState)).toMatchObject({
      snapshot: state.snapshot, connection: { status: 'reconnecting', detail: 'daemon down' },
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(backend.start).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.start).toHaveBeenCalledTimes(3);
    await controller.shutdown();
    controllers = [];
    disconnect();
    await vi.advanceTimersByTimeAsync(20000);
    expect(backend.start).toHaveBeenCalledTimes(3);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(unsubscribeConnection).toHaveBeenCalledOnce();
    expect(powerMonitor.listenerCount('on-ac')).toBe(0);
    expect(powerMonitor.listenerCount('on-battery')).toBe(0);
  });

  it('subscribes to backend events when startup first fails and the scheduled retry connects', async () => {
    const { controller, backend, emit, window } = setup();
    controller.createWindow();
    backend.start.mockRejectedValueOnce(new Error('daemon still starting'));
    await controller.initialize();
    await vi.advanceTimersByTimeAsync(250);
    emit({ seq: 1, occurredAt: '2026-10-04T00:00:00Z', type: 'agent.statusChanged',
      agentId: 'agent-dina', payload: { type: 'working' } });
    expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.event, expect.objectContaining({
      type: 'agent.statusChanged', agentId: 'agent-dina', payload: { type: 'working' },
    }));
    expect(backend.onConnectionState).toHaveBeenCalledOnce();
  });

  it('retries an inconsistent snapshot and publishes only the recovered state after a sequence gap', async () => {
    const { controller, backend, state, emit, window } = setup();
    controller.createWindow();
    await controller.initialize();
    const event = (seq: number): AppBackendEvent => ({
      seq, occurredAt: '2026-10-04T00:00:00Z', type: 'agent.statusChanged',
      agentId: 'agent-dina', payload: { type: 'working' },
    });
    let reads = 0;
    backend.request.mockImplementation(async () => {
      reads++;
      if (reads === 1) { emit(event(4)); return { ...state, lastEventSeq: 1 }; }
      return { ...state, lastEventSeq: 4 };
    });
    emit(event(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(2);
    expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.event, expect.objectContaining({
      type: 'snapshot.updated', payload: state.snapshot,
    }));
    const sent = window.webContents.send.mock.calls.length;
    emit(event(4));
    expect(window.webContents.send).toHaveBeenCalledTimes(sent);
  });

  it('returns native chooser cancellation and uses the client source folder as its default', async () => {
    const { controller } = setup();
    await controller.initialize();
    native.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/chosen'] });
    expect(await invoke(ipcChannels.chooseSourceFolder)).toBe('/chosen');
    expect(native.dialog.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({
      defaultPath: '/projects', properties: ['openDirectory'],
    }));
    native.dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: ['/ignored'] });
    expect(await invoke(ipcChannels.chooseAgentFolder)).toBeNull();
    native.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await native.handlers.get(ipcChannels.chooseDocumentSavePath)!({}, '/projects/proposal.md')).toBeNull();
    native.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/projects/proposal.md' });
    expect(await native.handlers.get(ipcChannels.chooseDocumentSavePath)!({}, '/projects/proposal.md')).toBe('/projects/proposal.md');
    expect(native.dialog.showSaveDialog).toHaveBeenLastCalledWith({
      defaultPath: '/projects/proposal.md', filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }], properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    native.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/projects/branch' });
    expect(await invoke(ipcChannels.chooseSourceWorktreeDestination, '/projects/suggested')).toBe('/projects/branch');
    expect(native.dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: '/projects/suggested', properties: ['createDirectory'],
    }));
  });

  it('rejects a second packaged instance before registering application handlers', () => {
    vi.mocked(app.requestSingleInstanceLock).mockReturnValue(false);
    startMainApp();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(native.handlers.size).toBe(0);
    expect(native.createWindow).not.toHaveBeenCalled();
  });

  it('opens recovery UI after maintenance failure and waits for cleanup before exiting', async () => {
    const fixture = backendFixture();
    native.factory.mockReturnValue(fixture.backend);
    native.createWindow.mockReturnValue(windowFixture());
    native.maintenance.mockRejectedValue(new Error('maintenance failed'));
    vi.mocked(app.whenReady).mockResolvedValue(undefined);
    startMainApp();
    await vi.advanceTimersByTimeAsync(0);
    expect(native.createWindow).toHaveBeenCalledOnce();
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith(product.protocolScheme);
    let release!: () => void;
    fixture.backend.close.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    const quit = { preventDefault: vi.fn() };
    app.emit('before-quit', quit);
    await vi.advanceTimersByTimeAsync(0);
    expect(quit.preventDefault).toHaveBeenCalledOnce();
    expect(app.exit).not.toHaveBeenCalled();
    app.emit('before-quit', quit);
    expect(quit.preventDefault).toHaveBeenCalledOnce();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(native.keyStop).toHaveBeenCalledOnce();
  });
});
