import { app, BrowserWindow, globalShortcut, nativeTheme, screen, shell, type BrowserWindowConstructorOptions, type Rectangle } from 'electron';
import { closeSync, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isBrowserGuestPartition } from '@workspace/core/browser-guest';
import { product } from '@workspace/core/product';
import { desktopIconPath } from './desktop-identity';
import {
  appCommandFromInput,
  cycleTeamsAccelerator,
  registerCycleTeamsShortcut,
  unregisterCycleTeamsShortcut,
} from './app-shortcuts';
import { installAppMenu, type AppMenuCallbacks, type AppMenuOptions } from './app-menu';
import { logRendererConsole, warnMain } from './log';
import { sendAppCommand } from './ipc-events';

/** Tall enough for every activity section in the agent sidebar to show two rows without scrolling the sidebar. */
const MIN_WINDOW_HEIGHT = 800;
const MIN_WINDOW_WIDTH = 1024;

type MainWindowState = {
  bounds: Rectangle;
  isMaximized: boolean;
};

export function createMainWindow(
  appMenuOptions: Partial<Pick<AppMenuOptions, 'updateStatus'>> & Partial<Pick<AppMenuCallbacks, 'checkForUpdates' | 'installUpdate' | 'sendDebugAgentMessage' | 'toggleDebugExecutionPlan' | 'injectDebugPlanReview' | 'populateDebugVisualize' | 'getDebugMissionStage' | 'setDebugMissionStage' | 'injectDebugCodeReview' | 'isDebugThreadFlagSet' | 'setDebugThreadFlag'>> = {},
): BrowserWindow {
  const releaseMode = isReleaseMode();
  if (process.platform === 'darwin' && !releaseMode) {
    app.dock?.setIcon(desktopIconPath(app));
  }
  const savedState = readWindowState(windowStatePath());
  const restoredState = savedState && isWindowBoundsVisible(savedState.bounds, screen.getAllDisplays().map((display) => display.workArea))
    ? savedState
    : undefined;
  const window = new BrowserWindow(createMainWindowOptions(releaseMode, restoredState?.bounds));
  const updateBackground = (): void => {
    window.setBackgroundColor(mainWindowBackground(process.platform, nativeTheme.shouldUseDarkColors));
  };
  nativeTheme.on('updated', updateBackground);
  window.once('closed', () => nativeTheme.removeListener('updated', updateBackground));
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveState = (): void => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    writeWindowState(windowStatePath(), {
      bounds: window.getNormalBounds(),
      isMaximized: window.isMaximized(),
    });
  };
  const scheduleSave = (): void => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(saveState, 250);
  };

  window.on('move', scheduleSave);
  window.on('resize', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', saveState);

  let shown = false;
  const showWindow = (): void => {
    if (shown) return;
    shown = true;
    if (restoredState?.isMaximized) {
      window.maximize();
    }
    window.show();
  };
  window.once('ready-to-show', showWindow);
  window.once('closed', () => {
    shown = true;
  });

  window.webContents.setWindowOpenHandler(({ url }) => handleExternalWindowOpen(url, (targetUrl) => shell.openExternal(targetUrl)));
  window.webContents.on('will-attach-webview', secureBrowserGuestAttachment);
  window.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    logRendererConsole(level, message, { line, sourceId });
  });
  installAppMenu(window, {
    debugMode: !releaseMode,
    ...appMenuOptions,
  });
  installFocusedAppShortcuts(window);
  window.webContents.on('before-input-event', (event, input) => {
    const command = appCommandFromInput(input);
    if (!command) {
      return;
    }

    event.preventDefault();
    if (command.type === 'quit') app.quit();
    else sendAppCommand(window.webContents, command);
  });

  const loading = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    : window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  // Some compositors do not paint hidden windows. Load completion can reveal
  // the window even when ready-to-show never arrives.
  void loading.then(showWindow, (error: unknown) => {
    warnMain('window', 'failed to load main window', {
      detail: error instanceof Error ? error.message : String(error),
    });
    showWindow();
  });

  return window;
}

/** Reject every guest except App's blank browser host, then lock its privileges. */
export function secureBrowserGuestAttachment(
  event: { preventDefault(): void },
  webPreferences: Electron.WebPreferences,
  params: Record<string, string>,
): void {
  if (params.src !== 'about:blank' || !isBrowserGuestPartition(params.partition ?? '')) {
    event.preventDefault();
    return;
  }
  delete params.preload;
  delete params.allowpopups;
  delete webPreferences.preload;
  webPreferences.devTools = true;
  webPreferences.sandbox = true;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  webPreferences.webSecurity = true;
  webPreferences.allowRunningInsecureContent = false;
  webPreferences.webviewTag = false;
  webPreferences.plugins = false;
}

export function createMainWindowOptions(
  releaseMode: boolean,
  bounds?: Rectangle,
  platform = process.platform,
  dark = nativeTheme.shouldUseDarkColors,
): BrowserWindowConstructorOptions {
  const macOSWindowOptions: BrowserWindowConstructorOptions = platform === 'darwin'
    ? {
        backgroundColor: '#00000000',
        hasShadow: true,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        vibrancy: 'menu',
      }
    : {
        backgroundColor: mainWindowBackground(platform, dark),
        titleBarStyle: 'default',
        autoHideMenuBar: true,
      };

  return {
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 960,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    ...macOSWindowOptions,
    show: false,
    title: product.name,
    ...(platform === 'win32' ? { accentColor: false } : {}),
    ...(platform === 'linux' || platform === 'win32' ? { icon: desktopIconPath(app) } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      devTools: !releaseMode,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  };
}

function mainWindowBackground(platform: string, dark: boolean): string {
  return platform === 'darwin' ? '#00000000' : dark ? '#202020' : '#FAFAFA';
}

export function isWindowBoundsVisible(bounds: Rectangle, workAreas: Rectangle[]): boolean {
  return workAreas.some((workArea) => {
    const intersectionWidth = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const intersectionHeight = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return intersectionWidth > 0 && intersectionHeight > 0;
  });
}

export function parseWindowState(value: string): MainWindowState | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const bounds = ('bounds' in parsed ? parsed.bounds : parsed) as Partial<Rectangle> | undefined;
    if (!bounds) {
      return null;
    }
    const values = [bounds.x, bounds.y, bounds.width, bounds.height];
    if (!values.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
      return null;
    }
    if ((bounds.width ?? 0) < MIN_WINDOW_WIDTH || (bounds.height ?? 0) < MIN_WINDOW_HEIGHT) {
      return null;
    }
    return {
      bounds: bounds as Rectangle,
      isMaximized: parsed.isMaximized === true,
    };
  } catch {
    return null;
  }
}

function windowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState(filePath: string): MainWindowState | null {
  try {
    const file = openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(fstatSync(file).size);
      readSync(file, buffer);
      return parseWindowState(buffer.toString('utf8'));
    } finally {
      closeSync(file);
    }
  } catch {
    return null;
  }
}

function writeWindowState(filePath: string, state: MainWindowState): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  } catch (error) {
    warnMain('window', 'failed to save window bounds', {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export function handleExternalWindowOpen(url: string, openExternal: (url: string) => Promise<unknown> | void): { action: 'deny' } {
  if (isExternalHttpUrl(url)) {
    void openExternal(url);
  }

  return { action: 'deny' };
}

function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isReleaseMode(): boolean {
  return app.isPackaged;
}

function installFocusedAppShortcuts(window: BrowserWindow): void {
  const sendCycleTeamsCommand = (): void => {
    if (window.isFocused()) {
      sendAppCommand(window.webContents, { type: 'cycle-teams' });
    }
  };

  const register = (): void => {
    if (!registerCycleTeamsShortcut(globalShortcut, sendCycleTeamsCommand)) {
      warnMain('shortcuts', 'failed to register cycle teams shortcut', {
        accelerator: cycleTeamsAccelerator,
      });
    }
  };
  const unregister = (): void => {
    unregisterCycleTeamsShortcut(globalShortcut);
  };

  window.on('focus', register);
  window.on('blur', unregister);
  window.on('closed', unregister);

  if (window.isFocused()) {
    register();
  }
}
