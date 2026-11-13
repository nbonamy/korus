import { product } from '@workspace/core/product';
import { app, clipboard, Menu, MenuItem, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { AppCommand, DesktopUpdateStatus } from '@workspace/core/contracts';
import type { VisualizeDebugScenario } from '@workspace/core/visualize';
import type { MissionReviewDebugState, MissionStage } from '@workspace/core/missions';
import type { ThreadFlagId } from '@workspace/core/thread-flags';
import { shortcutAccelerator } from '@workspace/core/keyboard-shortcuts';
import { detectPngRetinaPixelRatio, readClipboardPngBuffer } from './clipboard-image';
import { sendAppCommand } from './ipc-events';
import { mainT } from './i18n';

export type AppMenuOptions = {
  debugMode: boolean;
  updateStatus?: DesktopUpdateStatus;
};

export type DebugCodeReviewScenario = 'automaticReviewing' | 'reviewing' | 'ready' | 'fixing' | 'readyToFinish';

export type AppMenuCallbacks = {
  restartBackend?: () => void;
  checkForUpdates?: () => void;
  installUpdate?: () => void;
  capturePerformanceProfile?: () => void;
  newWindow?: () => void;
  showWorkspace?: () => void;
  /** The open windows, for platforms whose Window menu does not list them itself. */
  listWindows?: () => Array<{ id: number; title: string; focused: boolean }>;
  focusWindow?: (id: number) => void;
  cycleWindow?: (direction: 1 | -1) => void;
  sendDebugAgentMessage?: () => void;
  toggleDebugExecutionPlan?: () => void;
  hasDebugExecutionPlan?: () => boolean;
  injectDebugPlanReview?: (format: 'text' | 'choices') => void;
  populateDebugVisualize?: (scenario: VisualizeDebugScenario) => void;
  getDebugMissionStage?: () => MissionStage | undefined;
  getDebugMissionReviewState?: () => MissionReviewDebugState | undefined;
  setDebugMissionStage?: (stage: MissionStage, reviewState?: MissionReviewDebugState, preset?: 'screenshot') => void;
  injectDebugCodeReview?: (scenario: DebugCodeReviewScenario) => void;
  isDebugThreadFlagSet?: (id: ThreadFlagId) => boolean;
  setDebugThreadFlag?: (id: ThreadFlagId, value: boolean) => void;
  getDebugDisconnectedEngine?: () => boolean;
  setDebugDisconnectedEngine?: (enabled: boolean) => void;
  getDebugMissingEngines?: () => boolean;
  setDebugMissingEngines?: (enabled: boolean) => void;
  getDebugProviderUpgrades?: () => boolean;
  setDebugProviderUpgrades?: (enabled: boolean) => void;
  getDebugReviewUncommitted?: () => boolean;
  setDebugReviewUncommitted?: (enabled: boolean) => void;
  reload(): void;
  zoom?(direction: -1 | 0 | 1): void;
  sendAppCommand(command: AppCommand): void;
  toggleDeveloperTools(): void;
};

type AppMenuInstallOptions = AppMenuOptions & Partial<Pick<AppMenuCallbacks, 'restartBackend' | 'checkForUpdates' | 'installUpdate' | 'capturePerformanceProfile' | 'newWindow' | 'showWorkspace' | 'listWindows' | 'focusWindow' | 'cycleWindow' | 'sendDebugAgentMessage' | 'toggleDebugExecutionPlan' | 'hasDebugExecutionPlan' | 'injectDebugPlanReview' | 'populateDebugVisualize' | 'getDebugMissionStage' | 'getDebugMissionReviewState' | 'setDebugMissionStage' | 'injectDebugCodeReview' | 'isDebugThreadFlagSet' | 'setDebugThreadFlag' | 'getDebugMissingEngines' | 'setDebugMissingEngines' | 'getDebugDisconnectedEngine' | 'setDebugDisconnectedEngine' | 'getDebugProviderUpgrades' | 'setDebugProviderUpgrades' | 'getDebugReviewUncommitted' | 'setDebugReviewUncommitted'>>;
const editMenuId = 'app-edit-menu';

/** The application menu is shared by every window, so its commands go to whichever window is current. */
export type AppMenuWindow = BrowserWindow | (() => BrowserWindow | undefined);

export function installAppMenu(host: AppMenuWindow, options: AppMenuInstallOptions): void {
  const { checkForUpdates, installUpdate, capturePerformanceProfile, newWindow, showWorkspace, listWindows, focusWindow, cycleWindow, ...menuOptions } = options;
  const current = (): BrowserWindow | undefined => typeof host === 'function' ? host() : host;
  const callbacks: AppMenuCallbacks = {
    restartBackend: options.restartBackend,
    checkForUpdates,
    installUpdate,
    capturePerformanceProfile,
    newWindow,
    showWorkspace,
    listWindows,
    focusWindow,
    cycleWindow,
    reload: () => current()?.webContents.reload(),
    zoom: (direction) => {
      const contents = current()?.webContents;
      if (contents && !contents.isDestroyed()) {
        contents.setZoomLevel(direction === 0 ? 0 : Math.max(-7, Math.min(8, contents.getZoomLevel() + direction * 0.5)));
      }
    },
    sendAppCommand: (command) => {
      const window = current();
      if (window) sendAppCommand(window.webContents, command);
    },
    toggleDeveloperTools: () => current()?.webContents.toggleDevTools(),
    sendDebugAgentMessage: options.sendDebugAgentMessage,
    toggleDebugExecutionPlan: options.toggleDebugExecutionPlan,
    hasDebugExecutionPlan: options.hasDebugExecutionPlan,
    injectDebugPlanReview: options.injectDebugPlanReview,
    populateDebugVisualize: options.populateDebugVisualize,
    getDebugMissionStage: options.getDebugMissionStage,
    getDebugMissionReviewState: options.getDebugMissionReviewState,
    setDebugMissionStage: options.setDebugMissionStage,
    injectDebugCodeReview: options.injectDebugCodeReview,
    isDebugThreadFlagSet: options.isDebugThreadFlagSet,
    setDebugThreadFlag: options.setDebugThreadFlag,
    getDebugDisconnectedEngine: options.getDebugDisconnectedEngine,
    setDebugDisconnectedEngine: options.setDebugDisconnectedEngine,
    getDebugMissingEngines: options.getDebugMissingEngines,
    setDebugMissingEngines: options.setDebugMissingEngines,
    getDebugProviderUpgrades: options.getDebugProviderUpgrades,
    setDebugProviderUpgrades: options.setDebugProviderUpgrades,
    getDebugReviewUncommitted: options.getDebugReviewUncommitted,
    setDebugReviewUncommitted: options.setDebugReviewUncommitted,
  };
  const menu = Menu.buildFromTemplate(buildAppMenuTemplate(callbacks, menuOptions));
  appendDraftActionsToEditMenu(menu, callbacks);
  Menu.setApplicationMenu(menu);
}

export function buildAppMenuTemplate(
  callbacks: AppMenuCallbacks,
  options: AppMenuOptions,
  platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
  return [
    ...(platform === 'darwin' ? [buildAppMenu(callbacks, options)] : []),
    buildFileMenu(callbacks),
    buildEditMenu(),
    buildViewMenu(callbacks, options),
    buildAgentMenu(callbacks),
    ...(options.debugMode ? [buildDebugMenu(callbacks)] : []),
    buildWindowMenu(callbacks, platform),
    buildHelpMenu(callbacks, options, platform),
  ];
}

function buildCommandDiscoveryItems(callbacks: AppMenuCallbacks): MenuItemConstructorOptions[] {
  return [
    {
      label: mainT('menu.commandPalette'),
      accelerator: shortcutAccelerator('commands'),
      registerAccelerator: false,
      click: () => callbacks.sendAppCommand({ type: 'open-command-palette' }),
    },
    {
      label: mainT('menu.keyboardShortcuts'),
      accelerator: shortcutAccelerator('help'),
      registerAccelerator: false,
      click: () => callbacks.sendAppCommand({ type: 'open-keyboard-shortcuts' }),
    },
  ];
}

function buildHelpMenu(callbacks: AppMenuCallbacks, options: AppMenuOptions, platform: NodeJS.Platform): MenuItemConstructorOptions {
  return {
    label: mainT('menu.help'),
    submenu: [
      ...buildCommandDiscoveryItems(callbacks),
      {
        label: mainT('menu.whatsNew'),
        click: () => callbacks.sendAppCommand({ type: 'open-whats-new' }),
      },
      ...(callbacks.capturePerformanceProfile ? [{ type: 'separator' as const }, {
        label: mainT('menu.capturePerformanceProfile'),
        click: () => callbacks.capturePerformanceProfile?.(),
      }] : []),
      ...(platform !== 'darwin' ? [
        ...(options.updateStatus && callbacks.checkForUpdates && callbacks.installUpdate
          ? [createUpdateMenuItem(options.updateStatus, callbacks, true)]
          : []),
        { type: 'separator' as const },
        { label: mainT('menu.aboutApp'), role: 'about' as const },
      ] : []),
    ],
  };
}

function buildDebugMenu(callbacks: AppMenuCallbacks): MenuItemConstructorOptions {
  return {
    label: 'Debug',
    submenu: [
      { label: 'Restart Backend', enabled: Boolean(callbacks.restartBackend), click: () => callbacks.restartBackend?.() },
      { type: 'separator' },
      {
        label: 'Agent Fixtures',
        submenu: buildDebugAgentFixtures(callbacks),
      },
      {
        label: 'Mission Fixtures',
        submenu: buildDebugMissionFixtures(callbacks),
      },
      {
        label: 'Visualize Fixtures',
        submenu: [
          {
            label: 'Populate Suggestions',
            enabled: Boolean(callbacks.populateDebugVisualize),
            click: () => callbacks.populateDebugVisualize?.('suggestions'),
          },
          {
            label: 'Populate Diagrams',
            enabled: Boolean(callbacks.populateDebugVisualize),
            click: () => callbacks.populateDebugVisualize?.('complete'),
          },
        ],
      },
      {
        label: 'Review',
        submenu: buildDebugCodeReviewFixtures(callbacks),
      },
      {
        label: 'Thread Flags',
        submenu: [
          {
            label: 'Work Proposed',
            type: 'checkbox',
            checked: callbacks.isDebugThreadFlagSet?.('work_proposed') ?? false,
            enabled: Boolean(callbacks.setDebugThreadFlag),
            click: (item) => callbacks.setDebugThreadFlag?.('work_proposed', item.checked),
          },
          {
            label: 'Ready for Review',
            type: 'checkbox',
            checked: callbacks.isDebugThreadFlagSet?.('ready_for_review') ?? false,
            enabled: Boolean(callbacks.setDebugThreadFlag),
            click: (item) => callbacks.setDebugThreadFlag?.('ready_for_review', item.checked),
          },
        ],
      },
      {
        label: 'Backends',
        submenu: buildDebugBackends(callbacks),
      },
      {
        label: 'UI Previews',
        submenu: buildDebugUiPreviews(callbacks),
      },
      {
        label: 'Effects',
        submenu: buildDebugEffects(callbacks),
      },
      { type: 'separator' },
      {
        label: `Open ${product.name} Website`,
        click: () => callbacks.sendAppCommand({
          type: 'open-browser',
          url: product.websiteUrl,
        }),
      },
    ],
  };
}

function buildDebugMissionFixtures(callbacks: AppMenuCallbacks): MenuItemConstructorOptions[] {
  const fixtures: Array<{ label: string; stage: MissionStage; reviewState?: MissionReviewDebugState }> = [
    { label: 'Requirements', stage: 'requirements' },
    { label: 'Tickets', stage: 'tickets' },
    { label: 'Implementation', stage: 'implementation' },
    { label: 'Review — Findings Identified', stage: 'review', reviewState: 'identified' },
    { label: 'Review — Findings Remediated', stage: 'review', reviewState: 'remediated' },
    { label: 'Ship', stage: 'ship' },
  ];
  return [...fixtures.map(({ label, stage, reviewState }): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: callbacks.getDebugMissionStage?.() === stage && (stage !== 'review' || callbacks.getDebugMissionReviewState?.() === reviewState),
    enabled: Boolean(callbacks.setDebugMissionStage && callbacks.getDebugMissionStage?.()),
    click: () => callbacks.setDebugMissionStage?.(stage, reviewState),
  })), { type: 'separator' }, {
    label: 'Implementation — Website Screenshot',
    enabled: Boolean(callbacks.setDebugMissionStage && callbacks.getDebugMissionStage?.()),
    click: () => callbacks.setDebugMissionStage?.('implementation', undefined, 'screenshot'),
  }];
}

function buildDebugCodeReviewFixtures(callbacks: AppMenuCallbacks): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Simulate Uncommitted Changes',
      type: 'checkbox',
      checked: callbacks.getDebugReviewUncommitted?.() ?? false,
      enabled: Boolean(callbacks.setDebugReviewUncommitted),
      click: item => callbacks.setDebugReviewUncommitted?.(item.checked),
    },
    { type: 'separator' },
    {
      label: 'Automatic Review in Progress',
      enabled: Boolean(callbacks.injectDebugCodeReview),
      click: () => callbacks.injectDebugCodeReview?.('automaticReviewing'),
    },
    {
      label: 'Manual Review in Progress',
      enabled: Boolean(callbacks.injectDebugCodeReview),
      click: () => callbacks.injectDebugCodeReview?.('reviewing'),
    },
    {
      label: 'Findings Ready for Selection',
      enabled: Boolean(callbacks.injectDebugCodeReview),
      click: () => callbacks.injectDebugCodeReview?.('ready'),
    },
    {
      label: 'Remediation in Progress',
      enabled: Boolean(callbacks.injectDebugCodeReview),
      click: () => callbacks.injectDebugCodeReview?.('fixing'),
    },
    {
      label: 'Ready to Finish (No Findings)',
      enabled: Boolean(callbacks.injectDebugCodeReview),
      click: () => callbacks.injectDebugCodeReview?.('readyToFinish'),
    },
  ];
}

function buildDebugAgentFixtures(callbacks: AppMenuCallbacks): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Send Message',
      enabled: Boolean(callbacks.sendDebugAgentMessage),
      click: () => callbacks.sendDebugAgentMessage?.(),
    },
    {
      label: 'Approval Request',
      click: () => callbacks.sendAppCommand({ type: 'debug-approval-request' }),
    },
    {
      label: 'Multi-question Request',
      click: () => callbacks.sendAppCommand({ type: 'debug-user-questions' }),
    },
    {
      label: 'Provider Safety Block',
      click: () => callbacks.sendAppCommand({ type: 'debug-provider-safety-block' }),
    },
    { type: 'separator' },
    {
      label: 'Mark as Unread',
      click: () => callbacks.sendAppCommand({ type: 'debug-mark-unread' }),
    },
    {
      label: 'Execution Plan',
      type: 'checkbox',
      checked: callbacks.hasDebugExecutionPlan?.() ?? false,
      enabled: Boolean(callbacks.toggleDebugExecutionPlan),
      click: () => callbacks.toggleDebugExecutionPlan?.(),
    },
    {
      label: 'Text Plan Review',
      enabled: Boolean(callbacks.injectDebugPlanReview),
      click: () => callbacks.injectDebugPlanReview?.('text'),
    },
    {
      label: 'Plan Review with Choices',
      enabled: Boolean(callbacks.injectDebugPlanReview),
      click: () => callbacks.injectDebugPlanReview?.('choices'),
    },
  ];
}

function buildDebugBackends(callbacks: AppMenuCallbacks): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Simulate Missing Local Engines',
      type: 'checkbox',
      checked: callbacks.getDebugMissingEngines?.() ?? false,
      enabled: Boolean(callbacks.setDebugMissingEngines),
      click: item => callbacks.setDebugMissingEngines?.(item.checked),
    },
    {
      label: 'Simulate Available Upgrades',
      type: 'checkbox',
      checked: callbacks.getDebugProviderUpgrades?.() ?? false,
      enabled: Boolean(callbacks.setDebugProviderUpgrades),
      click: item => callbacks.setDebugProviderUpgrades?.(item.checked),
    },
  ];
}

function buildDebugUiPreviews(callbacks: AppMenuCallbacks): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Markdown',
      click: () => callbacks.sendAppCommand({ type: 'debug-open-markdown' }),
    },
    debugImageAnnotationMenuItem(callbacks),
    {
      label: 'GitHub Star Reminder',
      click: () => callbacks.sendAppCommand({ type: 'debug-github-star-reminder' }),
    },
    {
      label: 'Disconnected Agent Engine',
      type: 'checkbox',
      checked: callbacks.getDebugDisconnectedEngine?.() ?? false,
      enabled: Boolean(callbacks.setDebugDisconnectedEngine),
      click: item => callbacks.setDebugDisconnectedEngine?.(item.checked),
    },
    { type: 'separator' },
    {
      label: 'Worktree Initialization',
      click: () => callbacks.sendAppCommand({
        type: 'debug-operation-progress',
        kind: 'worktreeInitialization',
      }),
    },
    {
      label: 'Worktree Initialization Indicator',
      click: () => callbacks.sendAppCommand({ type: 'debug-operation-progress', kind: 'worktreeIndicator' }),
    },
    {
      label: 'Flow Initialization',
      click: () => callbacks.sendAppCommand({ type: 'debug-operation-progress', kind: 'flowInitialization' }),
    },
    {
      label: 'Pull Request Progress',
      click: () => callbacks.sendAppCommand({
        type: 'debug-operation-progress',
        kind: 'pullRequest',
      }),
    },
    {
      label: 'Merge Progress',
      click: () => callbacks.sendAppCommand({
        type: 'debug-operation-progress',
        kind: 'merge',
      }),
    },
    {
      label: 'Merge Conflicts',
      click: () => callbacks.sendAppCommand({ type: 'debug-operation-progress', kind: 'conflicts' }),
    },
  ];
}

function buildDebugEffects(callbacks: AppMenuCallbacks): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Confetti',
      click: () => callbacks.sendAppCommand({ type: 'debug-celebrate', kind: 'confetti' }),
    },
    {
      label: 'Stars',
      click: () => callbacks.sendAppCommand({ type: 'debug-celebrate', kind: 'stars' }),
    },
    {
      label: 'Shapes',
      click: () => callbacks.sendAppCommand({ type: 'debug-celebrate', kind: 'shapes' }),
    },
    {
      label: 'School Pride',
      click: () => callbacks.sendAppCommand({ type: 'debug-celebrate', kind: 'schoolPride' }),
    },
  ];
}

function debugImageAnnotationMenuItem(callbacks: AppMenuCallbacks): MenuItemConstructorOptions {
  return {
    label: 'Image Annotation',
    click: () => {
      const image = clipboard.readImage();
      if (image.isEmpty()) {
        callbacks.sendAppCommand({ type: 'debug-image-annotation' });
        return;
      }

      const pngBuffer = readClipboardPngBuffer(clipboard);
      const pixelRatio = detectPngRetinaPixelRatio(pngBuffer ?? Buffer.alloc(0))
        ?? (image.getScaleFactors().some((scaleFactor) => scaleFactor >= 2) ? 2 : 1);
      callbacks.sendAppCommand({
        type: 'debug-image-annotation',
        imageDataUrl: pngBuffer
          ? `data:image/png;base64,${pngBuffer.toString('base64')}`
          : image.toDataURL({ scaleFactor: pixelRatio }),
        ...(pixelRatio === 2 ? { pixelRatio } : {}),
      });
    },
  };
}

function buildAppMenu(callbacks: AppMenuCallbacks, options: AppMenuOptions): MenuItemConstructorOptions {
  return {
    label: mainT('menu.app'),
    submenu: [
      { role: 'about' },
      ...(options.updateStatus && callbacks.checkForUpdates && callbacks.installUpdate
        ? [createUpdateMenuItem(options.updateStatus, callbacks)]
        : []),
      { type: 'separator' },
      {
        label: mainT('menu.settings'),
        accelerator: shortcutAccelerator('settings'),
        click: () => callbacks.sendAppCommand({ type: 'open-settings' }),
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      {
        label: mainT('menu.quitApp'),
        accelerator: shortcutAccelerator('quit'),
        click: () => app.quit(),
      },
    ],
  };
}

function createUpdateMenuItem(status: DesktopUpdateStatus, callbacks: AppMenuCallbacks, manualDownloads = false): MenuItemConstructorOptions {
  if (status.state === 'downloaded') {
    return {
      label: mainT('menu.installUpdate'),
      click: callbacks.installUpdate,
    };
  }

  const busy = status.state === 'checking' || status.state === 'downloading';
  return {
    enabled: (status.state !== 'disabled' || manualDownloads) && !busy,
    label: busy ? mainT('menu.checkingForUpdates') : mainT('menu.checkForUpdates'),
    click: callbacks.checkForUpdates,
  };
}

function buildFileMenu(callbacks: AppMenuCallbacks): MenuItemConstructorOptions {
  return {
    label: mainT('menu.file'),
    submenu: [
      {
        label: mainT('menu.newTeam'),
        accelerator: shortcutAccelerator('newTeam'),
        click: () => callbacks.sendAppCommand({ type: 'new-team' }),
      },
      { type: 'separator' },
      // Closing a window never closes an agent: that is its own command, behind Shift.
      { label: mainT('menu.closeWindow'), accelerator: shortcutAccelerator('closeWindow'), role: 'close' },
      {
        label: mainT('menu.closeAgent'),
        accelerator: shortcutAccelerator('closeAgent'),
        click: () => callbacks.sendAppCommand({ type: 'close-active-agent' }),
      },
      { type: 'separator' },
      {
        label: mainT('menu.quit'),
        accelerator: shortcutAccelerator('quit'),
        click: () => app.quit(),
      },
    ],
  };
}

function buildEditMenu(): MenuItemConstructorOptions {
  return { id: editMenuId, role: 'editMenu' };
}

function appendDraftActionsToEditMenu(menu: Menu, callbacks: AppMenuCallbacks): void {
  const editMenu = menu.getMenuItemById(editMenuId)?.submenu;
  if (!editMenu) return;

  [
    { type: 'separator' as const },
    {
      label: mainT('menu.saveDraft'),
      accelerator: shortcutAccelerator('saveDraft'),
      click: () => callbacks.sendAppCommand({ type: 'save-active-prompt-draft' }),
    },
    {
      label: mainT('menu.savedDrafts'),
      accelerator: shortcutAccelerator('drafts'),
      click: () => callbacks.sendAppCommand({ type: 'open-saved-prompt-drafts' }),
    },
  ].forEach((item) => editMenu.append(new MenuItem(item)));
}

function buildAgentMenu(callbacks: AppMenuCallbacks): MenuItemConstructorOptions {
  return {
    label: mainT('menu.agent'),
    submenu: [
      {
        label: mainT('menu.editAgent'),
        accelerator: shortcutAccelerator('edit'),
        click: () => callbacks.sendAppCommand({ type: 'edit-active-agent' }),
      },
      {
        label: mainT('menu.duplicateAgent'),
        accelerator: shortcutAccelerator('duplicate'),
        click: () => callbacks.sendAppCommand({ type: 'duplicate-active-agent' }),
      },
      {
        label: mainT('menu.forkAgent'),
        click: () => callbacks.sendAppCommand({ type: 'fork-active-agent' }),
      },
      {
        label: mainT('menu.handoffAgent'),
        click: () => callbacks.sendAppCommand({ type: 'handoff-active-agent' }),
      },
      { type: 'separator' },
      {
        label: mainT('menu.compactSession'),
        accelerator: shortcutAccelerator('compact'),
        click: () => callbacks.sendAppCommand({ type: 'compact-active-session' }),
      },
      {
        label: mainT('menu.compressSession'),
        click: () => callbacks.sendAppCommand({ type: 'compress-active-session' }),
      },
      { type: 'separator' },
      {
        label: mainT('menu.resumeSession'),
        click: () => callbacks.sendAppCommand({ type: 'resume-active-session' }),
      },
      {
        label: mainT('menu.restartAgent'),
        click: () => callbacks.sendAppCommand({ type: 'restart-active-agent' }),
      },
    ],
  };
}

function buildViewMenu(callbacks: AppMenuCallbacks, options: AppMenuOptions): MenuItemConstructorOptions {
  return {
    label: mainT('menu.view'),
    submenu: [
      ...buildCommandDiscoveryItems(callbacks),
      { type: 'separator' },
      { label: mainT('menu.zoomIn'), accelerator: 'CommandOrControl+Plus', click: () => callbacks.zoom?.(1) },
      { label: mainT('menu.zoomOut'), accelerator: 'CommandOrControl+-', click: () => callbacks.zoom?.(-1) },
      { label: mainT('menu.resetZoom'), accelerator: 'CommandOrControl+0', click: () => callbacks.zoom?.(0) },
      { type: 'separator' },
      {
        label: mainT('menu.changes'),
        accelerator: shortcutAccelerator('review'),
        click: () => callbacks.sendAppCommand({ type: 'open-review' }),
      },
      {
        label: mainT('menu.browser'),
        accelerator: shortcutAccelerator('browser'),
        click: () => callbacks.sendAppCommand({ type: 'open-browser' }),
      },
      { type: 'separator' },
      {
        label: mainT('menu.goToAgent'),
        accelerator: shortcutAccelerator('palette'),
        click: () => callbacks.sendAppCommand({ type: 'open-agent-palette' }),
      },
      {
        label: mainT('menu.nextAgent'),
        accelerator: shortcutAccelerator('nextAgent'),
        click: () => callbacks.sendAppCommand({ type: 'cycle-agents', direction: 1 }),
      },
      {
        label: mainT('menu.previousAgent'),
        accelerator: shortcutAccelerator('previousAgent'),
        click: () => callbacks.sendAppCommand({ type: 'cycle-agents', direction: -1 }),
      },
      { type: 'separator' },
      {
        label: mainT('menu.nextTeam'),
        accelerator: shortcutAccelerator('nextTeam'),
        click: () => callbacks.sendAppCommand({ type: 'cycle-teams', direction: 1 }),
      },
      {
        label: mainT('menu.previousTeam'),
        accelerator: shortcutAccelerator('previousTeam'),
        click: () => callbacks.sendAppCommand({ type: 'cycle-teams', direction: -1 }),
      },
      ...(options.debugMode ? [
        { type: 'separator' as const },
        {
          label: 'Reload',
          accelerator: 'CommandOrControl+Shift+R',
          click: () => callbacks.reload(),
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+CommandOrControl+I',
          click: () => callbacks.toggleDeveloperTools(),
        },
      ] : []),
    ],
  };
}

function buildWindowMenu(callbacks: AppMenuCallbacks, platform: NodeJS.Platform): MenuItemConstructorOptions {
  // macOS lists the open windows in a menu it knows as the Window menu; elsewhere the list is built here.
  const windows = platform === 'darwin' ? [] : callbacks.listWindows?.() ?? [];
  return {
    label: mainT('menu.window'),
    ...(platform === 'darwin' ? { role: 'window' as const } : {}),
    submenu: [
      ...(callbacks.newWindow ? [{
        label: mainT('menu.newWindow'),
        accelerator: 'CommandOrControl+Shift+N',
        click: () => callbacks.newWindow?.(),
      }, ...(callbacks.showWorkspace ? [{
        label: mainT('menu.showWorkspace'),
        click: () => callbacks.showWorkspace?.(),
      }] : []), { type: 'separator' as const }] : []),
      { role: 'minimize' },
      ...(platform === 'darwin' ? [{ role: 'zoom' as const }] : []),
      ...(callbacks.cycleWindow ? [{ type: 'separator' as const }, {
        label: mainT('menu.nextWindow'),
        ...(platform === 'darwin' ? { accelerator: shortcutAccelerator('nextWindow') } : {}),
        click: () => callbacks.cycleWindow?.(1),
      }, {
        label: mainT('menu.previousWindow'),
        ...(platform === 'darwin' ? { accelerator: shortcutAccelerator('previousWindow') } : {}),
        click: () => callbacks.cycleWindow?.(-1),
      }] : []),
      ...(platform === 'darwin' ? [{ type: 'separator' as const }, { role: 'front' as const }] : []),
      ...(windows.length ? [{ type: 'separator' as const }, ...windows.map((window): MenuItemConstructorOptions => ({
        label: window.title,
        type: 'checkbox',
        checked: window.focused,
        click: () => callbacks.focusWindow?.(window.id),
      }))] : []),
    ],
  };
}
