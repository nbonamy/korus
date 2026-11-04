import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { product } from '@workspace/core/product';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { ipcChannels } from '@workspace/core/ipc';
import type { ComposerDraft } from '@workspace/core/windows';

const host = vi.hoisted(() => ({ createWindow: vi.fn(), installMenu: vi.fn() }));
vi.mock('electron', () => ({
  app: { isPackaged: false, isReady: () => true, getAppPath: () => '/app' },
  powerMonitor: { isOnBatteryPower: () => false, on: vi.fn(), removeListener: vi.fn() },
  nativeTheme: { themeSource: 'system' },
}));
vi.mock('../main-window', () => ({ createMainWindow: host.createWindow }));
vi.mock('../app-menu', () => ({ installAppMenu: host.installMenu }));
import { AppController } from '../app-controller';
import { addTestWindow, createBackendClient, emitBackendEvent } from './app-controller-test-harness';

type TestWindow = ReturnType<typeof windowFixture>;
let windowCount = 0;

function windowFixture(overrides: { focused?: boolean } = {}) {
  const webContents = Object.assign(new EventEmitter(), { send: vi.fn(), reload: vi.fn() });
  return Object.assign(new EventEmitter(), {
    id: ++windowCount,
    webContents,
    focused: overrides.focused ?? false,
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    isFocused() { return this.focused; },
    isMinimized: () => false, restore: vi.fn(), show: vi.fn(), focus: vi.fn(),
    getNormalBounds: () => ({ x: 100, y: 100, width: 1200, height: 800 }),
    isMaximized: (): boolean => false,
    setAutoHideMenuBar: vi.fn(), setMenuBarVisibility: vi.fn(),
  });
}

function controllerWithWindows(count = 2) {
  const controller = new AppController(createInitialSnapshot(), createBackendClient());
  const windows = Array.from({ length: count }, () => addTestWindow(controller, windowFixture()));
  return { controller, windows: windows as unknown as TestWindow[] };
}

type Private = {
  windows: { setReady(window: unknown, ready: boolean): void; focused(): unknown; markFocused(window: unknown): void; composerDrafts(): Record<string, ComposerDraft>; nativeOwners(): unknown[] };
  claimNativeResource(window: unknown, resource: string, agentId: string, takeOver: boolean): Promise<boolean>;
  releaseNativeResource(window: unknown, resource: string, agentId: string): void;
  syncComposerDraft(origin: unknown, agentId: string, draft: ComposerDraft | null): void;
  getWindowContext(window: unknown): { windowId: number; viewState: unknown; nativeOwners: unknown[]; composerDrafts: Record<string, ComposerDraft> };
  requestBrowserOpen(agentId: string, browserId: string, url: string): Promise<unknown>;
  executeMobileSimulator(agentId: string, input: unknown, userInitiated?: boolean): Promise<unknown>;
  browserOpen(window: unknown, agentId: string, browserId: string, url: string, guestId: number): Promise<unknown>;
  hostsBrowserPane(event: unknown, agentId: string, browserId: string): boolean;
  windowOf(event: unknown): unknown;
  focusWindowById(id: number): void;
  cycleWindow(direction: 1 | -1): void;
  flushPendingDeepLinkCommands(): void;
  openWindow(viewState?: unknown): unknown;
  openNewWindow(): void;
  openWindowFromRenderer(viewState: unknown): void;
  showWorkspace(): void;
  handleWindowClosed(window: unknown): void;
  enableWindowLayout(file: string): void;
  openStartupWindows(): void;
  updateMenuOptions(): { newWindow(): void };
  browserPane: { closeHostedBy(window: unknown, agentId?: string): Promise<void>; isHostedBy(agentId: string, browserId: string, window: unknown): boolean };
};
const internals = (controller: AppController) => controller as unknown as Private;

const sentChannels = (window: TestWindow, channel: string) => window.webContents.send.mock.calls.filter(([name]) => name === channel);
const draft = (text: string): ComposerDraft => ({ state: { text, selectionStart: text.length, selectionEnd: text.length }, attachments: [] });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AppController with several windows', () => {
  describe('shared events', () => {
    it('delivers daemon events to every window', () => {
      const { controller, windows } = controllerWithWindows(3);
      emitBackendEvent(controller, { type: 'snapshot.updated', payload: createInitialSnapshot() } as never);
      for (const window of windows) expect(sentChannels(window, ipcChannels.event)).toHaveLength(1);
    });

    it('delivers connection changes and update status to every window', () => {
      const { controller, windows } = controllerWithWindows(2);
      controller.setDesktopUpdateStatus({ state: 'downloaded', version: '9.0.0' });
      for (const window of windows) {
        expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.updateStatusChanged, { state: 'downloaded', version: '9.0.0' });
      }
    });

    it('stops sending to a window once it is destroyed', () => {
      const { controller, windows: [first, second] } = controllerWithWindows(2);
      first!.destroyed = true;
      emitBackendEvent(controller, { type: 'snapshot.updated', payload: createInitialSnapshot() } as never);
      expect(sentChannels(first!, ipcChannels.event)).toHaveLength(0);
      expect(sentChannels(second!, ipcChannels.event)).toHaveLength(1);
    });
  });

  describe('window-specific commands', () => {
    it('sends deep links to the focused window only, after it has loaded', () => {
      const { controller, windows: [first, second] } = controllerWithWindows(2);
      second!.focused = true;
      expect(controller.openDeepLink(`${product.protocolScheme}://new?prompt=hello`)).toBe(true);
      expect(sentChannels(second!, ipcChannels.appCommand)).toHaveLength(0);

      internals(controller).windows.setReady(second, true);
      internals(controller).flushPendingDeepLinkCommands();
      expect(sentChannels(second!, ipcChannels.appCommand)).toHaveLength(1);
      expect(sentChannels(first!, ipcChannels.appCommand)).toHaveLength(0);

      expect(controller.openDeepLink(`${product.protocolScheme}://new?prompt=again`)).toBe(true);
      expect(sentChannels(second!, ipcChannels.appCommand)).toHaveLength(2);
      expect(sentChannels(first!, ipcChannels.appCommand)).toHaveLength(0);
    });

    it('routes agent browser requests to the window that owns the browser, else the focused one', async () => {
      const { controller, windows: [first, second] } = controllerWithWindows(2);
      first!.focused = true;
      void internals(controller).requestBrowserOpen('agent-1', 'primary', 'https://example.com').catch(() => undefined);
      expect(first!.webContents.send).toHaveBeenCalledWith(ipcChannels.appCommand, expect.objectContaining({ type: 'open-browser', agentId: 'agent-1' }));

      await internals(controller).claimNativeResource(second, 'browser', 'agent-2', false);
      void internals(controller).requestBrowserOpen('agent-2', 'primary', 'https://example.com').catch(() => undefined);
      expect(second!.webContents.send).toHaveBeenCalledWith(ipcChannels.appCommand, expect.objectContaining({ type: 'open-browser', agentId: 'agent-2' }));
      expect(sentChannels(first!, ipcChannels.appCommand)).toHaveLength(1);
    });

    it('opens the simulator pane in the window that owns the agent’s simulator', async () => {
      const { controller, windows: [first, second] } = controllerWithWindows(2);
      first!.focused = true;
      await internals(controller).claimNativeResource(second, 'simulator', 'agent-dina', false);
      const simulator = (controller as unknown as { mobileSimulator: { execute: unknown } }).mobileSimulator;
      simulator.execute = vi.fn().mockResolvedValue({ ok: true });
      await internals(controller).executeMobileSimulator('agent-dina', { action: 'attach' });
      expect(second!.webContents.send).toHaveBeenCalledWith(ipcChannels.appCommand, { type: 'open-simulator', agentId: 'agent-dina' });
      expect(sentChannels(first!, ipcChannels.appCommand)).toHaveLength(0);
    });

    it('applies menu bar visibility to every window', () => {
      const { controller, windows } = controllerWithWindows(2);
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      try {
        controller.setMenuBarVisible(true);
      } finally {
        Object.defineProperty(process, 'platform', platform);
      }
      for (const window of windows) expect(window.setMenuBarVisibility).toHaveBeenCalledWith(true);
    });

    it('lists the windows by title for the Window menu and brings the chosen one forward', () => {
      const { controller, windows: [first, second] } = controllerWithWindows(2);
      Object.assign(first!, { getTitle: () => 'Dina · Korus' });
      Object.assign(second!, { getTitle: () => 'Jesse' });
      first!.focused = true;
      const menu = internals(controller).updateMenuOptions() as unknown as { listWindows(): unknown[] };
      expect(menu.listWindows()).toEqual([
        { id: first!.id, title: 'Dina · Korus', focused: true },
        { id: second!.id, title: 'Jesse', focused: false },
      ]);
      internals(controller).focusWindowById(second!.id);
      expect(second!.show).toHaveBeenCalled();
      expect(second!.focus).toHaveBeenCalled();
      internals(controller).focusWindowById(9999);
    });

    it('cycles windows in the order they were opened, wrapping around, whichever has focus', () => {
      const { controller, windows: [first, second, third] } = controllerWithWindows(3);
      const shown = () => [first, second, third].findIndex(window => window!.focus.mock.calls.length > 0);
      second!.focused = true;
      internals(controller).windows.markFocused(second);
      internals(controller).cycleWindow(1);
      expect(third!.focus).toHaveBeenCalled();
      third!.focused = true; second!.focused = false;
      internals(controller).windows.markFocused(third);
      internals(controller).cycleWindow(1);
      expect(first!.focus).toHaveBeenCalled();
      first!.focused = true; third!.focused = false;
      internals(controller).windows.markFocused(first);
      internals(controller).cycleWindow(-1);
      expect(third!.focus).toHaveBeenCalledTimes(2);
      expect(shown()).toBeGreaterThanOrEqual(0);
    });

    it('does nothing to cycle windows when there is only one', () => {
      const { controller, windows: [only] } = controllerWithWindows(1);
      only!.focused = true;
      internals(controller).cycleWindow(1);
      expect(only!.focus).not.toHaveBeenCalled();
    });

    it('resolves the window behind an IPC sender and falls back to the current one', () => {
      const { controller, windows: [first, second] } = controllerWithWindows(2);
      first!.focused = true;
      expect(internals(controller).windowOf({ sender: second!.webContents })).toBe(second);
      expect(internals(controller).windowOf({ sender: {} })).toBe(first);
      expect(internals(controller).windowOf({})).toBe(first);
    });
  });

  describe('debug toggles', () => {
    it('apply to the current window only and are remembered per window', () => {
      const { controller, windows: [first, second] } = controllerWithWindows(2);
      const menu = () => (host.installMenu.mock.lastCall![1]) as { getDebugMissingEngines(): boolean; setDebugMissingEngines(enabled: boolean): void };
      first!.focused = true;
      (controller as unknown as { refreshAppMenu(): void }).refreshAppMenu();
      menu().setDebugMissingEngines(true);
      expect(first!.webContents.send).toHaveBeenCalledWith(ipcChannels.appCommand, { type: 'debug-missing-engines', enabled: true });
      expect(sentChannels(second!, ipcChannels.appCommand)).toHaveLength(0);
      expect(menu().getDebugMissingEngines()).toBe(true);

      first!.focused = false;
      second!.focused = true;
      expect(menu().getDebugMissingEngines()).toBe(false);
      first!.focused = true;
      second!.focused = false;
      expect(menu().getDebugMissingEngines()).toBe(true);
    });
  });

  describe('native views', () => {
    it('lets one window own an agent’s browser and refuses the others', async () => {
      const { controller, windows: [first, second] } = controllerWithWindows(2);
      expect(await internals(controller).claimNativeResource(first, 'browser', 'agent-1', false)).toBe(true);
      expect(await internals(controller).claimNativeResource(second, 'browser', 'agent-1', false)).toBe(false);
      await expect(internals(controller).browserOpen(second, 'agent-1', 'primary', 'https://example.com', 1))
        .rejects.toThrow('open in another window');
    });

    it('tells every window who owns what whenever ownership changes', async () => {
      const { controller, windows: [first, second] } = controllerWithWindows(2);
      await internals(controller).claimNativeResource(first, 'browser', 'agent-1', false);
      const owners = [{ resource: 'browser', agentId: 'agent-1', windowId: first!.id }];
      for (const window of [first!, second!]) {
        expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.nativeOwnersChanged, owners);
      }
      internals(controller).releaseNativeResource(first, 'browser', 'agent-1');
      expect(second!.webContents.send).toHaveBeenLastCalledWith(ipcChannels.nativeOwnersChanged, []);
    });

    it('closes the previous owner’s browser before another window takes it over', async () => {
      const { controller, windows: [first, second] } = controllerWithWindows(2);
      const closeHostedBy = vi.spyOn(internals(controller).browserPane, 'closeHostedBy').mockResolvedValue(undefined);
      await internals(controller).claimNativeResource(first, 'browser', 'agent-1', false);
      expect(await internals(controller).claimNativeResource(second, 'browser', 'agent-1', true)).toBe(true);
      expect(closeHostedBy).toHaveBeenCalledWith(first, 'agent-1');
      expect(internals(controller).windows.nativeOwners()).toEqual([{ resource: 'browser', agentId: 'agent-1', windowId: second!.id }]);
    });

    it('ignores browser lifecycle calls from a window that does not host the pane', async () => {
      const { controller, windows: [first, second] } = controllerWithWindows(2);
      vi.spyOn(internals(controller).browserPane, 'isHostedBy').mockImplementation((_agent, _browser, window) => window === first);
      expect(internals(controller).hostsBrowserPane({ sender: first!.webContents }, 'agent-1', 'primary')).toBe(true);
      expect(internals(controller).hostsBrowserPane({ sender: second!.webContents }, 'agent-1', 'primary')).toBe(false);
    });
  });

  describe('composer drafts', () => {
    it('mirrors a draft to every other window and keeps one per agent', () => {
      const { controller, windows: [first, second, third] } = controllerWithWindows(3);
      internals(controller).syncComposerDraft(first, 'agent-1', draft('hello'));
      expect(sentChannels(first!, ipcChannels.composerDraftChanged)).toHaveLength(0);
      for (const window of [second!, third!]) {
        expect(window.webContents.send).toHaveBeenCalledWith(ipcChannels.composerDraftChanged, { agentId: 'agent-1', draft: draft('hello') });
      }
      internals(controller).syncComposerDraft(second, 'agent-1', draft('hello world'));
      expect(internals(controller).windows.composerDrafts()).toEqual({ 'agent-1': draft('hello world') });
    });

    it('hands the live drafts to a window that opens later and forgets them once sent', () => {
      const { controller, windows: [first] } = controllerWithWindows(2);
      internals(controller).syncComposerDraft(first, 'agent-1', draft('typing'));
      const late = addTestWindow(controller, windowFixture());
      expect(internals(controller).getWindowContext(late).composerDrafts).toEqual({ 'agent-1': draft('typing') });

      internals(controller).syncComposerDraft(first, 'agent-1', draft(''));
      expect(internals(controller).getWindowContext(late).composerDrafts).toEqual({});
    });
  });

  describe('opening and closing windows', () => {
    function openedWindows() {
      const controller = new AppController(createInitialSnapshot(), createBackendClient());
      const created: TestWindow[] = [];
      host.createWindow.mockImplementation(() => {
        const window = windowFixture();
        created.push(window);
        return window;
      });
      return { controller, created };
    }

    it('opens every window through one call that takes its initial view state', () => {
      const { controller, created } = openedWindows();
      internals(controller).openWindow({ agentId: 'agent-1' });
      expect(internals(controller).getWindowContext(created[0])).toMatchObject({ windowId: created[0]!.id, viewState: { agentId: 'agent-1' } });
      expect(host.createWindow).toHaveBeenCalledWith({});
    });

    it('opens New Window beside the focused window, on the agent it shows', () => {
      const { controller, created } = openedWindows();
      internals(controller).openWindow();
      created[0]!.focused = true;
      internals(controller).windows.markFocused(created[0]);
      (controller as unknown as { snapshot: { activeAgentId: string | null } }).snapshot.activeAgentId = 'agent-dina';

      internals(controller).updateMenuOptions().newWindow();

      expect(host.createWindow).toHaveBeenLastCalledWith({ cascadeFrom: created[0]!.getNormalBounds() });
      expect(internals(controller).getWindowContext(created[1])).toMatchObject({ viewState: { agentId: 'agent-dina' } });
    });

    it('opens team and feature windows full size, only on teams and agents that exist', () => {
      const { controller, created } = openedWindows();
      internals(controller).openWindow();
      const snapshot = (controller as unknown as { snapshot: { teams: Array<{ id: string }>; agents: Array<{ id: string }> } }).snapshot;
      const teamId = snapshot.teams[0]!.id;
      const [first] = snapshot.agents.map(agent => agent.id);
      // The first agent works on feat1.
      (snapshot.agents[0] as unknown as { teamId: string; workspace: unknown }).teamId = teamId;
      (snapshot.agents[0] as unknown as { teamId: string; workspace: unknown }).workspace = { kind: 'git', branch: 'feat1' };

      internals(controller).openWindowFromRenderer({ teamId, scope: 'team' });
      expect(host.createWindow).toHaveBeenLastCalledWith(expect.not.objectContaining({ compact: true }));
      expect(internals(controller).getWindowContext(created[1])).toMatchObject({ viewState: { teamId, scope: 'team' } });

      internals(controller).openWindowFromRenderer({ teamId, branch: 'feat1', agentId: first, scope: 'feature' });
      expect(internals(controller).getWindowContext(created[2])).toMatchObject({ viewState: { teamId, branch: 'feat1', scope: 'feature' } });

      host.createWindow.mockClear();
      internals(controller).openWindowFromRenderer({ teamId: 'team-gone', scope: 'team' });
      internals(controller).openWindowFromRenderer({ teamId, branch: 'feat-gone', scope: 'feature' });
      internals(controller).openWindowFromRenderer({ teamId: 'team-gone', branch: 'feat1', scope: 'feature' });
      expect(host.createWindow).not.toHaveBeenCalled();
    });

    it('opens an agent window compact, on a known agent only', () => {
      const { controller, created } = openedWindows();
      internals(controller).openWindow();
      internals(controller).openWindowFromRenderer({ agentId: 'agent-dina', scope: 'agent' });
      expect(host.createWindow).toHaveBeenLastCalledWith(expect.objectContaining({ compact: true, cascadeFrom: expect.anything() }));
      expect(internals(controller).getWindowContext(created[1])).toMatchObject({ viewState: { agentId: 'agent-dina', scope: 'agent' } });

      host.createWindow.mockClear();
      internals(controller).openWindowFromRenderer({ agentId: 'agent-gone', scope: 'agent' });
      internals(controller).openWindowFromRenderer({ scope: 'agent' });
      internals(controller).openWindowFromRenderer('nope');
      expect(host.createWindow).not.toHaveBeenCalled();
    });

    it('opens the workspace when only agent windows are left, and reuses it otherwise', () => {
      const { controller, created } = openedWindows();
      internals(controller).openWindow({ agentId: 'agent-dina', scope: 'agent' });
      expect(created).toHaveLength(1);
      controller.createWindow();
      expect(created).toHaveLength(2);
      expect(host.createWindow).toHaveBeenLastCalledWith(expect.not.objectContaining({ compact: true }));
      controller.createWindow();
      expect(created).toHaveLength(2);
    });

    it('sends deep links to the workspace window, not to an agent window', () => {
      const { controller, created } = openedWindows();
      internals(controller).openWindow();
      internals(controller).openWindow({ agentId: 'agent-dina', scope: 'agent' });
      created[1]!.focused = true;
      for (const window of created) window.webContents.emit('did-finish-load');
      controller.openDeepLink(`${product.protocolScheme}://new?prompt=hi`);
      expect(sentChannels(created[0]!, ipcChannels.appCommand)).toHaveLength(1);
      expect(sentChannels(created[1]!, ipcChannels.appCommand)).toHaveLength(0);
    });

    it('keeps one window when asked to create the main window again, and loads each window on its own', () => {
      const { controller, created } = openedWindows();
      controller.createWindow();
      controller.createWindow();
      expect(created).toHaveLength(1);

      internals(controller).openWindow();
      created[0]!.webContents.emit('did-finish-load');
      expect(internals(controller).windows.focused()).toBe(created[1]);
      created[1]!.focused = true;
      controller.openDeepLink(`${product.protocolScheme}://new?prompt=hi`);
      expect(sentChannels(created[1]!, ipcChannels.appCommand)).toHaveLength(0);
      created[1]!.webContents.emit('did-finish-load');
      expect(sentChannels(created[1]!, ipcChannels.appCommand)).toHaveLength(1);
      expect(sentChannels(created[0]!, ipcChannels.appCommand)).toHaveLength(0);
    });

    it('releases a closed window’s native views and keeps the others running', async () => {
      const { controller, created } = openedWindows();
      internals(controller).openWindow();
      internals(controller).openWindow();
      const closeHostedBy = vi.spyOn(internals(controller).browserPane, 'closeHostedBy').mockResolvedValue(undefined);
      await internals(controller).claimNativeResource(created[0], 'browser', 'agent-1', false);
      created[1]!.webContents.send.mockClear();

      created[0]!.destroyed = true;
      created[0]!.emit('closed');

      expect(closeHostedBy).toHaveBeenCalledWith(created[0]);
      expect(created[1]!.webContents.send).toHaveBeenCalledWith(ipcChannels.nativeOwnersChanged, []);
      emitBackendEvent(controller, { type: 'snapshot.updated', payload: createInitialSnapshot() } as never);
      expect(sentChannels(created[1]!, ipcChannels.event)).toHaveLength(1);
      expect(sentChannels(created[0]!, ipcChannels.event)).toHaveLength(0);
    });
  });

  describe('saving and restoring the windows', () => {
    const frame = (x: number) => ({ bounds: { x, y: 40, width: 1100, height: 820 }, isMaximized: false });
    let dir = '';
    let file = '';

    function layoutController() {
      dir = mkdtempSync(path.join(os.tmpdir(), 'korus-layout-'));
      file = path.join(dir, 'window-layout.json');
      const controller = new AppController(createInitialSnapshot(), createBackendClient());
      internals(controller).enableWindowLayout(file);
      const created: TestWindow[] = [];
      host.createWindow.mockImplementation(() => {
        const window = windowFixture();
        created.push(window);
        return window;
      });
      return { controller, created };
    }
    const saved = () => JSON.parse(readFileSync(file, 'utf8')) as { windows: Array<{ viewState: unknown; frame: unknown }> };

    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

    it('writes every window with what it shows and where it is, once things settle', () => {
      const { controller, created } = layoutController();
      const snapshot = (controller as unknown as { snapshot: { agents: Array<{ id: string }>; teams: Array<{ id: string }> } }).snapshot;
      const [agentA, agentB] = snapshot.agents.map(agent => agent.id) as [string, string];
      const teamId = snapshot.teams[0]!.id;
      internals(controller).openWindow();
      internals(controller).openWindow({ agentId: agentA, scope: 'agent' });
      internals(controller).openWindow({ teamId, scope: 'team' });
      internals(controller).openWindow({ teamId, branch: 'feat1', agentId: agentA, scope: 'feature' });
      created.forEach((window, index) => { window.getNormalBounds = () => frame(index * 50).bounds; });
      created[1]!.isMaximized = () => true;

      expect(() => readFileSync(file)).toThrow();
      created[0]!.emit('move');
      created[0]!.emit('resize');
      vi.advanceTimersByTime(499);
      expect(() => readFileSync(file)).toThrow();
      vi.advanceTimersByTime(1);

      expect(saved().windows).toEqual([
        { viewState: null, frame: frame(0) },
        { viewState: { agentId: agentA, scope: 'agent' }, frame: { ...frame(50), isMaximized: true } },
        { viewState: { teamId, scope: 'team' }, frame: frame(100) },
        { viewState: { teamId, branch: 'feat1', agentId: agentA, scope: 'feature' }, frame: frame(150) },
      ]);
    });

    it('lists windows from the least to the most recently focused, and follows what a window selects', () => {
      const { controller, created } = layoutController();
      internals(controller).openWindow();
      internals(controller).openWindow();
      created[0]!.emit('focus');
      vi.advanceTimersByTime(500);
      expect(saved().windows.map(window => window.frame)).toHaveLength(2);
      expect(internals(controller).windows.focused()).toBe(created[0]);

      const [first] = created as [TestWindow];
      (controller as unknown as { windows: { setSelectedAgent(window: unknown, id: string): void } }).windows.setSelectedAgent(first, 'agent-jesse');
      first.emit('focus');
      vi.advanceTimersByTime(500);
      expect(saved().windows.at(-1)!.viewState).toEqual({ agentId: 'agent-jesse' });
    });

    it('forgets a closed window, but keeps the layout when the last one closes with the app', () => {
      const { controller, created } = layoutController();
      internals(controller).openWindow();
      internals(controller).openWindow();
      vi.advanceTimersByTime(500);
      expect(saved().windows).toHaveLength(2);

      created[1]!.destroyed = true;
      created[1]!.emit('closed');
      vi.advanceTimersByTime(500);
      expect(saved().windows).toHaveLength(1);

      created[0]!.destroyed = true;
      created[0]!.emit('closed');
      vi.advanceTimersByTime(500);
      expect(saved().windows).toHaveLength(1);
    });

    it('writes the final layout when the app quits, with its windows still open', async () => {
      const { controller, created } = layoutController();
      internals(controller).openWindow();
      created[0]!.getNormalBounds = () => frame(300).bounds;
      created[0]!.emit('move');
      await controller.shutdown();
      expect(saved().windows).toEqual([{ viewState: null, frame: frame(300) }]);
      created[0]!.emit('move');
      vi.advanceTimersByTime(1000);
      expect(saved().windows).toHaveLength(1);
    });

    it('brings every saved window back in its place, skipping those that cannot open again', () => {
      const { controller, created } = layoutController();
      const snapshot = (controller as unknown as { snapshot: { agents: Array<{ id: string; teamId?: string; workspace?: unknown }>; teams: Array<{ id: string }> } }).snapshot;
      const agentA = snapshot.agents[0]!.id;
      const teamId = snapshot.teams[0]!.id;
      snapshot.agents[0]!.teamId = teamId;
      snapshot.agents[0]!.workspace = { kind: 'git', branch: 'feat1' };
      writeFileSync(file, JSON.stringify({ version: 1, windows: [
        { viewState: null, frame: frame(0) },
        { viewState: { agentId: agentA, scope: 'agent' }, frame: frame(40) },
        { viewState: { agentId: 'agent-gone', scope: 'agent' }, frame: frame(80) },
        { viewState: { teamId, branch: 'feat1', agentId: agentA, scope: 'feature' }, frame: { ...frame(120), isMaximized: true } },
      ] }));

      internals(controller).openStartupWindows();

      expect(created).toHaveLength(3);
      expect(host.createWindow.mock.calls.map(([placement]) => placement)).toEqual([
        { frame: frame(0) },
        { frame: frame(40), compact: true },
        { frame: { ...frame(120), isMaximized: true } },
      ]);
      expect(created.map(window => internals(controller).getWindowContext(window).viewState)).toEqual([
        null,
        { agentId: agentA, scope: 'agent' },
        { teamId, branch: 'feat1', agentId: agentA, scope: 'feature' },
      ]);
    });

    it.each([
      ['there is nothing saved', () => undefined],
      ['the saved layout is damaged', () => writeFileSync(file, '{"version":1,"windows":"x"}')],
      ['nothing in it can open again', () => writeFileSync(file, JSON.stringify({ version: 1, windows: [{ viewState: { teamId: 'team-gone', scope: 'team' }, frame: frame(0) }] }))],
    ])('opens the default workspace window when %s', (_name, prepare) => {
      const { controller, created } = layoutController();
      prepare();
      internals(controller).openStartupWindows();
      expect(created).toHaveLength(1);
      expect(host.createWindow).toHaveBeenCalledWith({});
    });

    it('adds a workspace window when only agent windows come back and a link is waiting for one', () => {
      const { controller, created } = layoutController();
      const agentA = (controller as unknown as { snapshot: { agents: Array<{ id: string }> } }).snapshot.agents[0]!.id;
      writeFileSync(file, JSON.stringify({ version: 1, windows: [{ viewState: { agentId: agentA, scope: 'agent' }, frame: frame(0) }] }));
      controller.openDeepLink(`${product.protocolScheme}://new?prompt=hi`);
      internals(controller).openStartupWindows();
      expect(created).toHaveLength(2);
    });
  });
});
