import { product } from '@workspace/core/product';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
vi.mock('electron', () => ({ app: { getAppPath: () => '/app' }, nativeTheme: { shouldUseDarkColors: false } }));
import {
  cascadedBounds,
  createMainWindowOptions,
  ensureWorkspaceWindowSize,
  handleExternalWindowOpen,
  isWindowBoundsVisible,
  parseWindowState,
  secureBrowserGuestAttachment,
} from '../main-window';

describe('main window options', () => {
  it('keeps the native Windows title bar neutral', () => {
    expect(createMainWindowOptions(false, undefined, 'win32').accentColor).toBe(false);
    expect(createMainWindowOptions(false, undefined, 'darwin').accentColor).toBeUndefined();
    expect(createMainWindowOptions(false, undefined, 'linux').accentColor).toBeUndefined();
  });
  it('disables BrowserWindow developer tools in release mode', () => {
    expect(createMainWindowOptions(true).webPreferences?.devTools).toBe(false);
    expect(createMainWindowOptions(false).webPreferences?.devTools).toBe(true);
  });

  it(`admits only isolated ${product.name} browser guests with no preload or Node access`, () => {
    const deny = { preventDefault: vi.fn() };
    const preferences = {
      preload: '/tmp/untrusted.js', nodeIntegration: true, sandbox: false, webviewTag: true, devTools: false,
    };
    secureBrowserGuestAttachment(deny, preferences, {
      src: 'about:blank', partition: 'persist:workspace-browser', preload: '/tmp/untrusted.js', allowpopups: '',
    });
    expect(deny.preventDefault).not.toHaveBeenCalled();
    expect(preferences).toMatchObject({ nodeIntegration: false, sandbox: true, webviewTag: false, devTools: true });
    expect(preferences).not.toHaveProperty('preload');

    const reject = { preventDefault: vi.fn() };
    secureBrowserGuestAttachment(reject, {}, { src: 'https://example.com', partition: 'persist:workspace-browser' });
    expect(reject.preventDefault).toHaveBeenCalledOnce();
    reject.preventDefault.mockClear();
    secureBrowserGuestAttachment(reject, {}, { src: 'about:blank', partition: 'persist:untrusted' });
    expect(reject.preventDefault).toHaveBeenCalledOnce();
  });

  it('restores saved window bounds in the BrowserWindow options', () => {
    const bounds = { x: 120, y: 80, width: 1280, height: 800 };

    expect(createMainWindowOptions(false, bounds)).toMatchObject(bounds);
  });

  it('uses native macOS vibrancy and shadow behind the translucent shell', () => {
    expect(createMainWindowOptions(false, undefined, 'darwin')).toMatchObject({
      backgroundColor: '#00000000',
      hasShadow: true,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      vibrancy: 'menu',
    });
    expect(createMainWindowOptions(false, undefined, 'win32')).toMatchObject({
      backgroundColor: '#FAFAFA',
      titleBarStyle: 'default',
      autoHideMenuBar: true,
    });
    expect(createMainWindowOptions(false, undefined, 'win32').vibrancy).toBeUndefined();
  });

  it.each(['linux', 'win32'] as const)('uses a light or dark native background on %s', (platform) => {
    expect(createMainWindowOptions(false, undefined, platform, false).backgroundColor).toBe('#FAFAFA');
    expect(createMainWindowOptions(false, undefined, platform, true).backgroundColor).toBe('#202020');
  });

  it('supplies the product title and window icon on Linux', () => {
    expect(createMainWindowOptions(false, undefined, 'linux')).toMatchObject({
      title: product.name, icon: path.join('/app', 'assets', 'icon-dev.png'),
    });
  });

  it.each(['linux', 'win32'] as const)('keeps the native %s title bar and window controls available before onboarding', (platform) => {
    expect(createMainWindowOptions(false, undefined, platform)).toMatchObject({
      titleBarStyle: 'default',
      autoHideMenuBar: true,
    });
    expect(createMainWindowOptions(true, undefined, platform)).toMatchObject({
      titleBarStyle: 'default',
      autoHideMenuBar: true,
    });
  });

  it('accepts persisted bounds with maximized state', () => {
    expect(parseWindowState('{"bounds":{"x":120,"y":80,"width":1280,"height":800},"isMaximized":true}')).toStrictEqual({
      bounds: { x: 120, y: 80, width: 1280, height: 800 },
      isMaximized: true,
    });
  });

  it('migrates bounds saved before maximized state was introduced', () => {
    expect(parseWindowState('{"x":120,"y":80,"width":1280,"height":800}')).toStrictEqual({
      bounds: { x: 120, y: 80, width: 1280, height: 800 },
      isMaximized: false,
    });
  });

  it('rejects malformed or undersized persisted window state', () => {
    expect(parseWindowState('{"bounds":{"x":120,"y":80,"width":800,"height":600}}')).toBeNull();
    expect(parseWindowState('{"bounds":{"x":"nope"}}')).toBeNull();
    expect(parseWindowState('not json')).toBeNull();
  });

  it('only restores bounds that intersect a connected display', () => {
    const displays = [
      { x: 0, y: 0, width: 1512, height: 944 },
      { x: 1512, y: 0, width: 1920, height: 1080 },
    ];

    expect(isWindowBoundsVisible({ x: 120, y: 80, width: 1280, height: 800 }, displays)).toBe(true);
    expect(isWindowBoundsVisible({ x: 3400, y: 100, width: 1280, height: 800 }, displays)).toBe(true);
    expect(isWindowBoundsVisible({ x: -2000, y: 100, width: 1280, height: 800 }, displays)).toBe(false);
  });

  it('opens safe external URLs in the system browser while denying the popup', () => {
    const opened: string[] = [];

    expect(handleExternalWindowOpen('https://github.com/nbonamy/agent-workspace/issues/12', (url) => {
      opened.push(url);
    })).toStrictEqual({ action: 'deny' });

    expect(opened).toStrictEqual(['https://github.com/nbonamy/agent-workspace/issues/12']);
  });

  it('denies non-http window opens without opening them externally', () => {
    const opened: string[] = [];

    expect(handleExternalWindowOpen('file:///Users/nbonamy/.ssh/id_rsa', (url) => {
      opened.push(url);
    })).toStrictEqual({ action: 'deny' });
    expect(handleExternalWindowOpen('javascript:alert(1)', (url) => {
      opened.push(url);
    })).toStrictEqual({ action: 'deny' });
    expect(handleExternalWindowOpen('not a url', (url) => {
      opened.push(url);
    })).toStrictEqual({ action: 'deny' });

    expect(opened).toStrictEqual([]);
  });
});

describe('cascadedBounds', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

  it('offsets a new window from the one it opens beside', () => {
    expect(cascadedBounds({ x: 100, y: 80, width: 1280, height: 800 }, [workArea])).toStrictEqual({ x: 128, y: 108, width: 1280, height: 800 });
  });

  it('wraps back to the corner of the work area when the offset would leave it', () => {
    expect(cascadedBounds({ x: 640, y: 280, width: 1280, height: 800 }, [workArea])).toStrictEqual({ x: 0, y: 0, width: 1280, height: 800 });
  });

  it('stays on the display the source window is on', () => {
    const second = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(cascadedBounds({ x: 2000, y: 40, width: 1280, height: 800 }, [workArea, second])).toStrictEqual({ x: 2028, y: 68, width: 1280, height: 800 });
    expect(cascadedBounds({ x: 2560, y: 280, width: 1280, height: 800 }, [workArea, second])).toStrictEqual({ x: 1920, y: 0, width: 1280, height: 800 });
  });
});

describe('agent windows', () => {
  it('open smaller than the workspace and may shrink further', () => {
    expect(createMainWindowOptions(false, undefined, 'darwin', false, true)).toMatchObject({ width: 1000, height: 880, minWidth: 640, minHeight: 560 });
    expect(createMainWindowOptions(false, undefined, 'darwin', false)).toMatchObject({ width: 1440, height: 960, minWidth: 1024, minHeight: 800 });
  });

  it('get the workspace minimum size and room for the sidebar when they grow into a workspace', () => {
    const window = { getSize: () => [900, 700], setMinimumSize: vi.fn(), setSize: vi.fn() };
    ensureWorkspaceWindowSize(window as never);
    expect(window.setMinimumSize).toHaveBeenCalledWith(1024, 800);
    expect(window.setSize).toHaveBeenCalledWith(1024, 800);
    window.setSize.mockClear();
    window.getSize = () => [1500, 1000];
    ensureWorkspaceWindowSize(window as never);
    expect(window.setSize).not.toHaveBeenCalled();
  });
});
