import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  flushPendingDeepLinkCommands(): void;
  openWindow(viewState?: unknown): unknown;
  openNewWindow(): void;
  handleWindowClosed(window: unknown): void;
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
});
