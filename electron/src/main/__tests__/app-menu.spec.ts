import { product } from '@workspace/core/product';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { buildAppMenuTemplate, installAppMenu, type AppMenuCallbacks } from '../app-menu';
import { sendAppCommand } from '../ipc-events';

vi.mock('../ipc-events', () => ({ sendAppCommand: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

const electronMenuMocks = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({
    items: template.map((options) => {
      if (options.role !== 'editMenu') return { ...options };
      const items: MenuItemConstructorOptions[] = [];
      return {
        label: 'Edit',
        id: options.id,
        role: 'editmenu',
        submenu: {
          items,
          append(item: MenuItemConstructorOptions): void {
            items.push(item);
          },
        },
      };
    }),
    getMenuItemById(id: string) {
      return this.items.find((item) => item.id === id);
    },
  })),
  MenuItem: class {
    constructor(options: MenuItemConstructorOptions) {
      Object.assign(this, options);
    }
  },
  setApplicationMenu: vi.fn(),
}));
const electronClipboardMocks = vi.hoisted(() => {
  const image = {
    getScaleFactors: vi.fn((): number[] => [2]),
    isEmpty: (): boolean => false,
    toDataURL: vi.fn((): string => 'data:image/png;base64,clipboard-image'),
  };
  return {
    availableFormats: vi.fn((): string[] => []),
    image,
    readBuffer: vi.fn((_format: string): Buffer => Buffer.alloc(0)),
    readImage: vi.fn(() => image),
  };
});

vi.mock('electron', () => ({
  clipboard: electronClipboardMocks,
  Menu: electronMenuMocks,
  MenuItem: electronMenuMocks.MenuItem,
}));

beforeEach(() => {
  vi.mocked(sendAppCommand).mockClear();
  electronMenuMocks.buildFromTemplate.mockClear();
  electronMenuMocks.setApplicationMenu.mockClear();
  electronClipboardMocks.availableFormats.mockReturnValue([]);
  electronClipboardMocks.image.getScaleFactors.mockReturnValue([2]);
});

const callbacks = (): AppMenuCallbacks => ({
  reload: vi.fn(),
  sendAppCommand: vi.fn(),
  sendDebugAgentMessage: vi.fn(),
  toggleDeveloperTools: vi.fn(),
  toggleDebugExecutionPlan: vi.fn(),
  injectDebugPlanReview: vi.fn(),
  populateDebugVisualize: vi.fn(),
  getDebugMissionStage: vi.fn(() => 'tickets' as const),
  getDebugMissionReviewState: vi.fn(() => 'identified' as const),
  setDebugMissionStage: vi.fn(),
  injectDebugCodeReview: vi.fn(),
  isDebugThreadFlagSet: vi.fn(() => false),
  setDebugThreadFlag: vi.fn(),
});

describe('app menu', () => {
  it('shows Execution Plan as a checkbox reflecting the selected agent plan', () => {
    const cb = callbacks();
    cb.hasDebugExecutionPlan = () => true;
    const item = () => nestedMenuItem(buildAppMenuTemplate(cb, { debugMode: true }), 'Debug', 'Agent Fixtures', 'Execution Plan')!;
    expect(item()).toMatchObject({ type: 'checkbox', checked: true });
    item().click!({ checked: false } as never, undefined, {} as never);
    expect(cb.toggleDebugExecutionPlan).toHaveBeenCalledOnce();
    cb.hasDebugExecutionPlan = () => false;
    expect(item().checked).toBe(false);
  });

  it('shows missing-engine simulation as a checked toggle backed by the current preview state', () => {
    let enabled = false;
    const cb = callbacks();
    cb.getDebugMissingEngines = () => enabled;
    cb.setDebugMissingEngines = value => { enabled = value; };
    const item = () => nestedMenuItem(buildAppMenuTemplate(cb, { debugMode: true }), 'Debug', 'Backends', 'Simulate Missing Local Engines')!;
    expect(item()).toMatchObject({ type: 'checkbox', checked: false, enabled: true });
    item().click!({ checked: true } as never, undefined, {} as never);
    expect(item().checked).toBe(true);
    item().click!({ checked: false } as never, undefined, {} as never);
    expect(item().checked).toBe(false);
  });

  it('shows upgrade simulation as a checked toggle in Backends', () => {
    let enabled = false;
    const cb = callbacks();
    cb.getDebugProviderUpgrades = () => enabled;
    cb.setDebugProviderUpgrades = value => { enabled = value; };
    const item = () => nestedMenuItem(buildAppMenuTemplate(cb, { debugMode: true }), 'Debug', 'Backends', 'Simulate Available Upgrades')!;
    expect(item()).toMatchObject({ type: 'checkbox', checked: false, enabled: true });
    item().click!({ checked: true } as never, undefined, {} as never);
    expect(item().checked).toBe(true);
    item().click!({ checked: false } as never, undefined, {} as never);
    expect(item().checked).toBe(false);
  });

  it('shows the uncommitted-changes simulation as a checked toggle in Code review fixtures', () => {
    let enabled = false;
    const cb = callbacks();
    cb.getDebugReviewUncommitted = () => enabled;
    cb.setDebugReviewUncommitted = value => { enabled = value; };
    const item = () => nestedMenuItem(buildAppMenuTemplate(cb, { debugMode: true }), 'Debug', 'Review', 'Simulate Uncommitted Changes')!;
    expect(item()).toMatchObject({ type: 'checkbox', checked: false, enabled: true });
    item().click!({ checked: true } as never, undefined, {} as never);
    expect(item().checked).toBe(true);
    item().click!({ checked: false } as never, undefined, {} as never);
    expect(item().checked).toBe(false);
  });

  it('builds app-owned file, view, and agent menus with the native Edit menu', () => {
    const menu = buildAppMenuTemplate(callbacks(), { debugMode: false }, 'darwin');

    expect(menu.map((item) => item.label)).toStrictEqual([`${product.name}`, 'File', undefined, 'View', 'Agent', 'Window', 'Help']);

    expect(menuLabels(submenu(menu, 'File'))).toStrictEqual([
      'New Team',
      'Close Agent',
      'Close Team',
      'Quit',
    ]);
    expect(menu.find((item) => item.role === 'editMenu')).toBeDefined();
    expect(menuLabels(submenu(menu, 'View'))).toStrictEqual([
      'Changes',
      'Browser',
      'Go to Agent...',
      'Next Agent',
      'Previous Agent',
      'Next Team',
    ]);
    expect(submenu(menu, 'Agent').map((item) => item.type ?? item.label)).toStrictEqual([
      'Edit Agent',
      'Duplicate Agent',
      'Fork Agent',
      'Hand off…',
      'separator',
      'Compact Session',
      'Compress Session',
      'separator',
      'Resume Session',
      'Restart Agent',
    ]);
    expect(menuLabels(submenu(menu, 'Help'))).toStrictEqual(['What’s New']);
    expect(JSON.stringify(menu)).not.toMatch(/viewMenu|reload|forceReload|toggleDevTools/i);
  });

  it('keeps only draft actions in the realized native Edit menu', () => {
    installAppMenu({
      webContents: {
        reload: vi.fn(),
        toggleDevTools: vi.fn(),
      },
    } as never, { debugMode: false });

    const editItems = installedEditItems();
    expect(editItems.map((item) => item.type ?? item.label)).toStrictEqual([
      'separator',
      'Save Draft for Later',
      'Saved Drafts...',
    ]);
    expect(editItems[1]?.accelerator).toBe('CommandOrControl+Shift+X');
    expect(editItems[2]?.accelerator).toBe('CommandOrControl+Shift+V');
    editItems[1]?.click?.(undefined as never, undefined as never, undefined as never);
    editItems[2]?.click?.(undefined as never, undefined as never, undefined as never);
    expect(vi.mocked(sendAppCommand).mock.calls.map(([, command]) => command)).toStrictEqual([
      { type: 'save-active-prompt-draft' },
      { type: 'open-saved-prompt-drafts' },
    ]);
  });

  it('routes Agent menu actions to the active session in context-menu order', () => {
    const nextCallbacks = callbacks();
    const menu = buildAppMenuTemplate(nextCallbacks, { debugMode: false }, 'darwin');
    const actions = [
      'Edit Agent',
      'Duplicate Agent',
      'Fork Agent',
      'Hand off…',
      'Compact Session',
      'Compress Session',
      'Resume Session',
      'Restart Agent',
    ];

    actions.forEach((label) => clickItem(menu, 'Agent', label));

    expect(nextCallbacks.sendAppCommand).toHaveBeenCalledTimes(actions.length);
    expect(vi.mocked(nextCallbacks.sendAppCommand).mock.calls.map(([command]) => command)).toStrictEqual([
      { type: 'edit-active-agent' },
      { type: 'duplicate-active-agent' },
      { type: 'fork-active-agent' },
      { type: 'handoff-active-agent' },
      { type: 'compact-active-session' },
      { type: 'compress-active-session' },
      { type: 'resume-active-session' },
      { type: 'restart-active-agent' },
    ]);
    expect(menuItem(menu, 'Agent', 'Edit Agent')?.accelerator).toBe('CommandOrControl+E');
    expect(menuItem(menu, 'Agent', 'Duplicate Agent')?.accelerator).toBe('CommandOrControl+D');
    expect(menuItem(menu, 'Agent', 'Compact Session')?.accelerator).toBe('CommandOrControl+Shift+K');
  });

  it('sends app commands from menu items', () => {
    const nextCallbacks = callbacks();
    const menu = buildAppMenuTemplate(nextCallbacks, { debugMode: false }, 'darwin');

    [
      ['File', 'New Team'],
      ['File', 'Close Agent'],
      ['File', 'Close Team'],
      ['File', 'Quit'],
      ['View', 'Go to Agent...'],
      ['View', 'Changes'],
      ['View', 'Browser'],
      ['View', 'Next Team'],
      ['View', 'Next Agent'],
      ['View', 'Previous Agent'],
    ].forEach(([menuLabel, itemLabel]) => clickItem(menu, menuLabel, itemLabel));

    expect(nextCallbacks.sendAppCommand).toHaveBeenNthCalledWith(1, { type: 'new-team' });
    expect(nextCallbacks.sendAppCommand).toHaveBeenNthCalledWith(2, { type: 'close-active-agent' });
    expect(nextCallbacks.sendAppCommand).toHaveBeenNthCalledWith(3, { type: 'close-active-team' });
    expect(nextCallbacks.sendAppCommand).toHaveBeenNthCalledWith(4, { type: 'quit' });
    expect(nextCallbacks.sendAppCommand).toHaveBeenNthCalledWith(5, { type: 'open-agent-palette' });
    expect(nextCallbacks.sendAppCommand).toHaveBeenNthCalledWith(6, { type: 'open-review' });
    expect(nextCallbacks.sendAppCommand).toHaveBeenNthCalledWith(7, { type: 'open-browser' });
    expect(nextCallbacks.sendAppCommand).toHaveBeenNthCalledWith(8, { type: 'cycle-teams' });
    expect(nextCallbacks.sendAppCommand).toHaveBeenNthCalledWith(9, { type: 'cycle-agents', direction: 1 });
    expect(nextCallbacks.sendAppCommand).toHaveBeenNthCalledWith(10, { type: 'cycle-agents', direction: -1 });
    clickItem(menu, 'Help', 'What’s New');
    expect(nextCallbacks.sendAppCommand).toHaveBeenNthCalledWith(11, { type: 'open-whats-new' });
  });

  it('uses the expected file menu accelerators', () => {
    const menu = buildAppMenuTemplate(callbacks(), { debugMode: false }, 'darwin');

    expect(menuItem(menu, 'File', 'New Team')?.accelerator).toBe('CommandOrControl+N');
    expect(menuItem(menu, 'File', 'Close Agent')?.accelerator).toBe('CommandOrControl+W');
    expect(menuItem(menu, 'File', 'Close Team')?.accelerator).toBe('CommandOrControl+Shift+W');
    expect(menuItem(menu, 'File', 'Quit')?.accelerator).toBe('CommandOrControl+Q');
    expect(menuItem(menu, 'View', 'Go to Agent...')?.accelerator).toBe('CommandOrControl+K');
    expect(menuItem(menu, 'View', 'Changes')?.accelerator).toBe('CommandOrControl+G');
    expect(menuItem(menu, 'View', 'Browser')?.accelerator).toBe('CommandOrControl+B');
  });

  it(`offers update installation or checking in the ${product.name} menu`, () => {
    const checkForUpdates = vi.fn();
    const installUpdate = vi.fn();
    const menu = buildAppMenuTemplate({
      ...callbacks(),
      checkForUpdates,
      installUpdate,
    }, { debugMode: false, updateStatus: { state: 'downloaded', version: '0.4.0' } }, 'darwin');

    clickItem(menu, `${product.name}`, 'Install Update and Relaunch');
    expect(installUpdate).toHaveBeenCalledOnce();

    const checkingMenu = buildAppMenuTemplate({
      ...callbacks(),
      checkForUpdates,
      installUpdate,
    }, { debugMode: false, updateStatus: { state: 'checking' } }, 'darwin');
    expect(menuItem(checkingMenu, `${product.name}`, 'Checking for Updates...')).toMatchObject({ enabled: false });

    const idleMenuCallbacks = {
      ...callbacks(),
      checkForUpdates,
      installUpdate,
    };
    const idleMenu = buildAppMenuTemplate(
      idleMenuCallbacks,
      { debugMode: false, updateStatus: { state: 'idle' } },
      'darwin',
    );
    clickItem(idleMenu, `${product.name}`, 'Check for Updates...');
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(menuItem(idleMenu, `${product.name}`, 'Settings...')?.accelerator).toBe('CommandOrControl+,');
    clickItem(idleMenu, `${product.name}`, 'Settings...');
    expect((idleMenu[0]?.submenu as MenuItemConstructorOptions[]).map((item) => item.type ?? item.role ?? item.label)).toStrictEqual([
      'about',
      'Check for Updates...',
      'separator',
      'Settings...',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      `Quit ${product.name}`,
    ]);
    expect(idleMenuCallbacks.sendAppCommand).toHaveBeenCalledWith({ type: 'open-settings' });
  });

  it.each(['darwin', 'win32', 'linux'] as const)('passes update callbacks through the native menu installer on %s', (platform) => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: platform } }));
    const checkForUpdates = vi.fn();
    const installUpdate = vi.fn();
    installAppMenu({
      webContents: {
        reload: vi.fn(),
        toggleDevTools: vi.fn(),
      },
    } as never, {
      debugMode: false,
      updateStatus: { state: 'idle' },
      checkForUpdates,
      installUpdate,
    });

    const template = electronMenuMocks.buildFromTemplate.mock.calls.at(-1)?.[0];
    if (!Array.isArray(template)) throw new Error('Menu template was not built');
    clickItem(template, platform === 'darwin' ? product.name : 'Help', 'Check for Updates...');
    if (platform !== 'darwin') {
      expect(menuItem(template, 'Help', `About ${product.name}`)).toMatchObject({ role: 'about' });
      expect(template.some((item) => item.label === product.name)).toBe(false);
    }

    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(electronMenuMocks.setApplicationMenu).toHaveBeenCalledOnce();
  });

  it.each(['win32', 'linux'] as const)('keeps the Help update action useful across updater states on %s', (platform) => {
    const actions = { ...callbacks(), checkForUpdates: vi.fn(), installUpdate: vi.fn() };
    for (const state of ['disabled', 'checking', 'downloading', 'downloaded'] as const) {
      const menu = buildAppMenuTemplate(actions, { debugMode: false, updateStatus: { state } }, platform);
      if (state === 'downloaded') {
        clickItem(menu, 'Help', 'Install Update and Relaunch');
        expect(actions.installUpdate).toHaveBeenCalledOnce();
      } else if (state === 'disabled') {
        expect(menuItem(menu, 'Help', 'Check for Updates...')).toMatchObject({ enabled: true });
        clickItem(menu, 'Help', 'Check for Updates...');
        expect(actions.checkForUpdates).toHaveBeenCalledOnce();
      } else {
        expect(menuItem(menu, 'Help', 'Checking for Updates...')).toMatchObject({ enabled: false });
      }
    }
  });

  it('passes the message fixture callback through the startup menu installer', () => {
    const sendDebugAgentMessage = vi.fn();
    installAppMenu({
      webContents: {
        reload: vi.fn(),
        toggleDevTools: vi.fn(),
      },
    } as never, {
      debugMode: true,
      sendDebugAgentMessage,
    });

    const template = electronMenuMocks.buildFromTemplate.mock.calls.at(-1)?.[0];
    if (!Array.isArray(template)) throw new Error('Menu template was not built');
    expect(nestedMenuItem(template, 'Debug', 'Agent Fixtures', 'Send Message')).toMatchObject({ enabled: true });
    clickNestedItem(template, 'Debug', 'Agent Fixtures', 'Send Message');
    expect(sendDebugAgentMessage).toHaveBeenCalledOnce();
  });

  it('dispatches the multi-question fixture from the debug agent menu', () => {
    const debugCallbacks = callbacks();
    const menu = buildAppMenuTemplate(debugCallbacks, { debugMode: true }, 'darwin');

    clickNestedItem(menu, 'Debug', 'Agent Fixtures', 'Multi-question Request');

    expect(debugCallbacks.sendAppCommand).toHaveBeenCalledOnce();
    expect(debugCallbacks.sendAppCommand).toHaveBeenCalledWith({ type: 'debug-user-questions' });
  });

  it('adds reload and developer tools only in debug mode', () => {
    const debugCallbacks = callbacks();
    const debugMenu = buildAppMenuTemplate(debugCallbacks, { debugMode: true }, 'darwin');
    const releaseMenu = buildAppMenuTemplate(callbacks(), { debugMode: false }, 'darwin');

    expect(menuLabels(submenu(debugMenu, 'View'))).toStrictEqual([
      'Changes',
      'Browser',
      'Go to Agent...',
      'Next Agent',
      'Previous Agent',
      'Next Team',
      'Reload',
      'Toggle Developer Tools',
    ]);
    const debugItems = submenu(debugMenu, 'Debug');
    expect(debugItems.map((item) => item.type === 'separator' ? 'separator' : item.label)).toStrictEqual([
      'Agent Fixtures',
      'Mission Fixtures',
      'Visualize Fixtures',
      'Review',
      'Thread Flags',
      'Backends',
      'UI Previews',
      'Effects',
      'separator',
      `Open ${product.name} Website`,
    ]);
    expect(submenuLabels(debugMenu, 'Debug', 'Agent Fixtures')).toStrictEqual([
      'Send Message',
      'Approval Request',
      'Multi-question Request',
      'Mark as Unread',
      'Execution Plan',
      'Plan Review',
    ]);
    expect(submenuLabels(debugMenu, 'Debug', 'Mission Fixtures')).toStrictEqual([
      'Requirements',
      'Tickets',
      'Implementation',
      'Review — Findings Identified',
      'Review — Findings Remediated',
      'Ship',
    ]);
    expect(submenuLabels(debugMenu, 'Debug', 'Visualize Fixtures')).toStrictEqual([
      'Populate Suggestions',
      'Populate Diagrams',
    ]);
    expect(nestedMenuItem(debugMenu, 'Debug', 'Mission Fixtures', 'Tickets')).toMatchObject({
      type: 'radio',
      checked: true,
      enabled: true,
    });
    expect(nestedMenuItem(debugMenu, 'Debug', 'Thread Flags', 'Delegate to Worktree')).toMatchObject({
      type: 'checkbox',
      checked: false,
    });
    expect(nestedSubmenu(debugMenu, 'Debug', 'Review').map(menuEntryLabel)).toStrictEqual([
      'Simulate Uncommitted Changes',
      'separator',
      'Automatic Review in Progress',
      'separator',
      'Manual Review in Progress',
      'Findings Ready for Selection',
      'Remediation in Progress',
      'Ready to Finish (No Findings)',
    ]);
    expect(submenuLabels(debugMenu, 'Debug', 'Thread Flags')).toStrictEqual([
      'Delegate to Worktree',
      'Ready for Review',
    ]);
    expect(submenuLabels(debugMenu, 'Debug', 'Backends')).toStrictEqual([
      'Simulate Missing Local Engines',
      'Simulate Available Upgrades',
    ]);
    expect(submenuLabels(debugMenu, 'Debug', 'UI Previews')).toStrictEqual([
      'Markdown',
      'Image Annotation',
      'Worktree Initialization',
      'Pull Request Progress',
      'Merge Progress',
    ]);
    expect(submenuLabels(debugMenu, 'Debug', 'Effects')).toStrictEqual([
      'Confetti',
      'Stars',
      'Shapes',
      'School Pride',
    ]);
    expect(nestedSubmenu(debugMenu, 'Debug', 'Agent Fixtures').map(menuEntryLabel)).toStrictEqual([
      'Send Message',
      'Approval Request',
      'Multi-question Request',
      'separator',
      'Mark as Unread',
      'Execution Plan',
      'Plan Review',
    ]);
    expect(nestedSubmenu(debugMenu, 'Debug', 'UI Previews').map(menuEntryLabel)).toStrictEqual([
      'Markdown',
      'Image Annotation',
      'separator',
      'Worktree Initialization',
      'Pull Request Progress',
      'Merge Progress',
    ]);
    expect(menuItem(debugMenu, 'View', 'Next Team')?.accelerator).toBe('Command+`');
    expect(menuItem(debugMenu, 'View', 'Next Agent')?.accelerator).toBe('Control+Tab');
    expect(menuItem(debugMenu, 'View', 'Previous Agent')?.accelerator).toBe('Control+Shift+Tab');
    expect(menuItem(debugMenu, 'View', 'Reload')?.accelerator).toBe('CommandOrControl+Shift+R');
    expect(menuItem(debugMenu, 'View', 'Toggle Developer Tools')?.accelerator).toBe('Alt+CommandOrControl+I');

    clickItem(debugMenu, 'View', 'Reload');
    clickItem(debugMenu, 'View', 'Toggle Developer Tools');
    clickNestedItem(debugMenu, 'Debug', 'Agent Fixtures', 'Send Message');
    clickNestedItem(debugMenu, 'Debug', 'Agent Fixtures', 'Approval Request');
    clickNestedItem(debugMenu, 'Debug', 'Agent Fixtures', 'Mark as Unread');
    clickNestedItem(debugMenu, 'Debug', 'Agent Fixtures', 'Execution Plan');
    clickNestedItem(debugMenu, 'Debug', 'Agent Fixtures', 'Plan Review');
    clickNestedItem(debugMenu, 'Debug', 'Mission Fixtures', 'Requirements');
    clickNestedItem(debugMenu, 'Debug', 'Mission Fixtures', 'Tickets');
    clickNestedItem(debugMenu, 'Debug', 'Mission Fixtures', 'Implementation');
    clickNestedItem(debugMenu, 'Debug', 'Mission Fixtures', 'Review — Findings Identified');
    clickNestedItem(debugMenu, 'Debug', 'Mission Fixtures', 'Review — Findings Remediated');
    clickNestedItem(debugMenu, 'Debug', 'Mission Fixtures', 'Ship');
    clickNestedItem(debugMenu, 'Debug', 'Visualize Fixtures', 'Populate Suggestions');
    clickNestedItem(debugMenu, 'Debug', 'Visualize Fixtures', 'Populate Diagrams');
    clickNestedItem(debugMenu, 'Debug', 'Review', 'Manual Review in Progress');
    clickNestedItem(debugMenu, 'Debug', 'Review', 'Findings Ready for Selection');
    clickNestedItem(debugMenu, 'Debug', 'Review', 'Remediation in Progress');
    clickNestedItem(debugMenu, 'Debug', 'Review', 'Ready to Finish (No Findings)');
    clickNestedItem(debugMenu, 'Debug', 'Review', 'Automatic Review in Progress');
    clickThreadFlagItem(debugMenu, 'Delegate to Worktree', true);
    clickThreadFlagItem(debugMenu, 'Delegate to Worktree', false);
    clickThreadFlagItem(debugMenu, 'Ready for Review', true);
    clickThreadFlagItem(debugMenu, 'Ready for Review', false);
    clickNestedItem(debugMenu, 'Debug', 'UI Previews', 'Markdown');
    clickNestedItem(debugMenu, 'Debug', 'UI Previews', 'Image Annotation');
    clickNestedItem(debugMenu, 'Debug', 'UI Previews', 'Worktree Initialization');
    clickNestedItem(debugMenu, 'Debug', 'UI Previews', 'Pull Request Progress');
    clickNestedItem(debugMenu, 'Debug', 'UI Previews', 'Merge Progress');
    clickNestedItem(debugMenu, 'Debug', 'Effects', 'Confetti');
    clickNestedItem(debugMenu, 'Debug', 'Effects', 'Stars');
    clickNestedItem(debugMenu, 'Debug', 'Effects', 'Shapes');
    clickNestedItem(debugMenu, 'Debug', 'Effects', 'School Pride');
    clickItem(debugMenu, 'Debug', `Open ${product.name} Website`);

    expect(debugCallbacks.reload).toHaveBeenCalledOnce();
    expect(debugCallbacks.toggleDeveloperTools).toHaveBeenCalledOnce();
    expect(debugCallbacks.sendDebugAgentMessage).toHaveBeenCalledOnce();
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(1, {
      type: 'debug-approval-request',
    });
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(2, {
      type: 'debug-mark-unread',
    });
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(3, { type: 'debug-open-markdown' });
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(4, {
      type: 'debug-image-annotation',
      imageDataUrl: 'data:image/png;base64,clipboard-image',
      pixelRatio: 2,
    });
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(5, {
      type: 'debug-operation-progress',
      kind: 'worktreeInitialization',
    });
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(6, {
      type: 'debug-operation-progress',
      kind: 'pullRequest',
    });
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(7, {
      type: 'debug-operation-progress',
      kind: 'merge',
    });
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(8, {
      type: 'debug-celebrate',
      kind: 'confetti',
    });
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(9, {
      type: 'debug-celebrate',
      kind: 'stars',
    });
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(10, {
      type: 'debug-celebrate',
      kind: 'shapes',
    });
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(11, {
      type: 'debug-celebrate',
      kind: 'schoolPride',
    });
    expect(debugCallbacks.sendAppCommand).toHaveBeenNthCalledWith(12, {
      type: 'open-browser',
      url: product.websiteUrl,
    });
    expect(electronClipboardMocks.readImage).toHaveBeenCalledOnce();
    expect(electronClipboardMocks.image.toDataURL).toHaveBeenCalledWith({ scaleFactor: 2 });
    expect(debugCallbacks.toggleDebugExecutionPlan).toHaveBeenCalledOnce();
    expect(debugCallbacks.injectDebugPlanReview).toHaveBeenCalledOnce();
    expect(debugCallbacks.setDebugMissionStage).toHaveBeenNthCalledWith(1, 'requirements', undefined);
    expect(debugCallbacks.setDebugMissionStage).toHaveBeenNthCalledWith(2, 'tickets', undefined);
    expect(debugCallbacks.setDebugMissionStage).toHaveBeenNthCalledWith(3, 'implementation', undefined);
    expect(debugCallbacks.setDebugMissionStage).toHaveBeenNthCalledWith(4, 'review', 'identified');
    expect(debugCallbacks.setDebugMissionStage).toHaveBeenNthCalledWith(5, 'review', 'remediated');
    expect(debugCallbacks.setDebugMissionStage).toHaveBeenNthCalledWith(6, 'ship', undefined);
    expect(debugCallbacks.populateDebugVisualize).toHaveBeenNthCalledWith(1, 'suggestions');
    expect(debugCallbacks.populateDebugVisualize).toHaveBeenNthCalledWith(2, 'complete');
    expect(debugCallbacks.injectDebugCodeReview).toHaveBeenNthCalledWith(1, 'reviewing');
    expect(debugCallbacks.injectDebugCodeReview).toHaveBeenNthCalledWith(2, 'ready');
    expect(debugCallbacks.injectDebugCodeReview).toHaveBeenNthCalledWith(3, 'fixing');
    expect(debugCallbacks.injectDebugCodeReview).toHaveBeenNthCalledWith(4, 'readyToFinish');
    expect(debugCallbacks.injectDebugCodeReview).toHaveBeenNthCalledWith(5, 'automaticReviewing');
    expect(debugCallbacks.setDebugThreadFlag).toHaveBeenNthCalledWith(1, 'delegate_to_worktree', true);
    expect(debugCallbacks.setDebugThreadFlag).toHaveBeenNthCalledWith(2, 'delegate_to_worktree', false);
    expect(debugCallbacks.setDebugThreadFlag).toHaveBeenNthCalledWith(3, 'ready_for_review', true);
    expect(debugCallbacks.setDebugThreadFlag).toHaveBeenNthCalledWith(4, 'ready_for_review', false);
    expect(JSON.stringify(releaseMenu)).not.toMatch(/reload|forceReload|developer tools|toggleDevTools/i);
  });

  it('reflects an active worktree delegation flag in the native checkbox', () => {
    const nextCallbacks = callbacks();
    nextCallbacks.isDebugThreadFlagSet = vi.fn((id) => id === 'delegate_to_worktree');

    const menu = buildAppMenuTemplate(nextCallbacks, { debugMode: true }, 'darwin');

    expect(nestedMenuItem(menu, 'Debug', 'Thread Flags', 'Delegate to Worktree')).toMatchObject({
      type: 'checkbox',
      checked: true,
    });
    expect(nestedMenuItem(menu, 'Debug', 'Thread Flags', 'Ready for Review')).toMatchObject({
      type: 'checkbox',
      checked: false,
    });
  });

  it('omits image data when the native clipboard has no image', () => {
    electronClipboardMocks.readImage.mockReturnValueOnce({
      getScaleFactors: vi.fn(() => [1]),
      isEmpty: () => true,
      toDataURL: vi.fn(() => ''),
    });
    const nextCallbacks = callbacks();
    const menu = buildAppMenuTemplate(nextCallbacks, { debugMode: true }, 'darwin');

    clickNestedItem(menu, 'Debug', 'UI Previews', 'Image Annotation');

    expect(nextCallbacks.sendAppCommand).toHaveBeenCalledWith({ type: 'debug-image-annotation' });
  });

  it('detects Retina screenshots from raw PNG density when Electron reports only a 1x image', () => {
    const retinaPng = pngWithDensity(5_669, 5_669);
    electronClipboardMocks.availableFormats.mockReturnValueOnce(['image/png']);
    electronClipboardMocks.readBuffer.mockImplementationOnce(() => Buffer.alloc(0));
    electronClipboardMocks.readBuffer.mockImplementationOnce(() => retinaPng);
    electronClipboardMocks.image.getScaleFactors.mockReturnValueOnce([1]);
    const nextCallbacks = callbacks();
    const menu = buildAppMenuTemplate(nextCallbacks, { debugMode: true }, 'darwin');

    clickNestedItem(menu, 'Debug', 'UI Previews', 'Image Annotation');

    expect(nextCallbacks.sendAppCommand).toHaveBeenCalledWith({
      type: 'debug-image-annotation',
      imageDataUrl: `data:image/png;base64,${retinaPng.toString('base64')}`,
      pixelRatio: 2,
    });
  });
});

function pngWithDensity(xPixelsPerMeter: number, yPixelsPerMeter: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = Buffer.alloc(21);
  chunk.writeUInt32BE(9, 0);
  chunk.write('pHYs', 4, 'ascii');
  chunk.writeUInt32BE(xPixelsPerMeter, 8);
  chunk.writeUInt32BE(yPixelsPerMeter, 12);
  chunk[16] = 1;
  return Buffer.concat([signature, chunk]);
}

function submenu(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const item = template.find((entry) => entry.label === label);
  if (!item || !Array.isArray(item.submenu)) {
    throw new Error(`${label} menu not found`);
  }

  return item.submenu;
}

function menuItem(template: MenuItemConstructorOptions[], menuLabel: string, itemLabel: string): MenuItemConstructorOptions | undefined {
  return submenu(template, menuLabel).find((item) => item.label === itemLabel);
}

function nestedMenuItem(
  template: MenuItemConstructorOptions[],
  menuLabel: string,
  parentLabel: string,
  itemLabel: string,
): MenuItemConstructorOptions | undefined {
  return nestedSubmenu(template, menuLabel, parentLabel).find((item) => item.label === itemLabel);
}

function nestedSubmenu(
  template: MenuItemConstructorOptions[],
  menuLabel: string,
  parentLabel: string,
): MenuItemConstructorOptions[] {
  const parent = menuItem(template, menuLabel, parentLabel);
  if (!parent || !Array.isArray(parent.submenu)) throw new Error(`${parentLabel} submenu not found`);
  return parent.submenu;
}

function submenuLabels(
  template: MenuItemConstructorOptions[],
  menuLabel: string,
  parentLabel: string,
): string[] {
  return menuLabels(nestedSubmenu(template, menuLabel, parentLabel));
}

function menuEntryLabel(item: MenuItemConstructorOptions): string | undefined {
  return item.type === 'separator' ? 'separator' : item.label;
}

function menuLabels(items: MenuItemConstructorOptions[]): string[] {
  return items
    .filter((item) => item.type !== 'separator')
    .map((item) => item.label)
    .filter((label): label is string => typeof label === 'string');
}

function clickItem(template: MenuItemConstructorOptions[], menuLabel: string, itemLabel: string): void {
  const item = menuItem(template, menuLabel, itemLabel);
  if (!item?.click) {
    throw new Error(`${itemLabel} menu item not found`);
  }

  item.click({ checked: true } as never, undefined as never, undefined as never);
}

function clickNestedItem(
  template: MenuItemConstructorOptions[],
  menuLabel: string,
  parentLabel: string,
  itemLabel: string,
): void {
  const item = nestedMenuItem(template, menuLabel, parentLabel, itemLabel);
  if (!item?.click) throw new Error(`${itemLabel} menu item not found`);
  item.click({ checked: true } as never, undefined as never, undefined as never);
}

function clickThreadFlagItem(template: MenuItemConstructorOptions[], label: string, checked: boolean): void {
  const item = nestedMenuItem(template, 'Debug', 'Thread Flags', label);
  if (!item?.click) throw new Error(`${label} menu item not found`);
  item.click({ checked } as never, undefined as never, undefined as never);
}

function installedEditItems(): MenuItemConstructorOptions[] {
  const installedMenu = electronMenuMocks.setApplicationMenu.mock.calls.at(-1)?.[0] as {
    items?: Array<{ label?: string; submenu?: { items?: MenuItemConstructorOptions[] } }>;
  } | undefined;
  const items = installedMenu?.items?.find((item) => item.label === 'Edit')?.submenu?.items;
  if (!items) throw new Error('Installed native Edit menu not found');
  return items;
}
