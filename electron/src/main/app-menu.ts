import { product } from '@workspace/core/product';
import { clipboard, Menu, MenuItem, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { AppCommand, DesktopUpdateStatus } from '@workspace/core/contracts';
import type { VisualizeDebugScenario } from '@workspace/core/visualize';
import type { MissionReviewDebugState, MissionStage } from '@workspace/core/missions';
import type { ThreadFlagId } from '@workspace/core/thread-flags';
import { cycleTeamsAccelerator } from './app-shortcuts';
import { detectPngRetinaPixelRatio, readClipboardPngBuffer } from './clipboard-image';
import { sendAppCommand } from './ipc-events';
import { mainT } from './i18n';

export type AppMenuOptions = {
  debugMode: boolean;
  updateStatus?: DesktopUpdateStatus;
};

export type DebugCodeReviewScenario = 'automaticReviewing' | 'reviewing' | 'ready' | 'fixing' | 'readyToFinish';

export type AppMenuCallbacks = {
  checkForUpdates?: () => void;
  installUpdate?: () => void;
  sendDebugAgentMessage?: () => void;
  toggleDebugExecutionPlan?: () => void;
  hasDebugExecutionPlan?: () => boolean;
  injectDebugPlanReview?: () => void;
  populateDebugVisualize?: (scenario: VisualizeDebugScenario) => void;
  getDebugMissionStage?: () => MissionStage | undefined;
  getDebugMissionReviewState?: () => MissionReviewDebugState | undefined;
  setDebugMissionStage?: (stage: MissionStage, reviewState?: MissionReviewDebugState) => void;
  injectDebugCodeReview?: (scenario: DebugCodeReviewScenario) => void;
  isDebugThreadFlagSet?: (id: ThreadFlagId) => boolean;
  setDebugThreadFlag?: (id: ThreadFlagId, value: boolean) => void;
  getDebugMissingEngines?: () => boolean;
  setDebugMissingEngines?: (enabled: boolean) => void;
  getDebugProviderUpgrades?: () => boolean;
  setDebugProviderUpgrades?: (enabled: boolean) => void;
  getDebugReviewUncommitted?: () => boolean;
  setDebugReviewUncommitted?: (enabled: boolean) => void;
  reload(): void;
  sendAppCommand(command: AppCommand): void;
  toggleDeveloperTools(): void;
};

type AppMenuInstallOptions = AppMenuOptions & Partial<Pick<AppMenuCallbacks, 'checkForUpdates' | 'installUpdate' | 'sendDebugAgentMessage' | 'toggleDebugExecutionPlan' | 'hasDebugExecutionPlan' | 'injectDebugPlanReview' | 'populateDebugVisualize' | 'getDebugMissionStage' | 'getDebugMissionReviewState' | 'setDebugMissionStage' | 'injectDebugCodeReview' | 'isDebugThreadFlagSet' | 'setDebugThreadFlag' | 'getDebugMissingEngines' | 'setDebugMissingEngines' | 'getDebugProviderUpgrades' | 'setDebugProviderUpgrades' | 'getDebugReviewUncommitted' | 'setDebugReviewUncommitted'>>;
const editMenuId = 'app-edit-menu';

export function installAppMenu(window: BrowserWindow, options: AppMenuInstallOptions): void {
  const { checkForUpdates, installUpdate, ...menuOptions } = options;
  const callbacks: AppMenuCallbacks = {
    checkForUpdates,
    installUpdate,
    reload: () => window.webContents.reload(),
    sendAppCommand: (command) => sendAppCommand(window.webContents, command),
    toggleDeveloperTools: () => window.webContents.toggleDevTools(),
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

function buildHelpMenu(callbacks: AppMenuCallbacks, options: AppMenuOptions, platform: NodeJS.Platform): MenuItemConstructorOptions {
  return {
    label: mainT('menu.help'),
    submenu: [
      {
        label: mainT('menu.whatsNew'),
        click: () => callbacks.sendAppCommand({ type: 'open-whats-new' }),
      },
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
            label: 'Delegate to Worktree',
            type: 'checkbox',
            checked: callbacks.isDebugThreadFlagSet?.('delegate_to_worktree') ?? false,
            enabled: Boolean(callbacks.setDebugThreadFlag),
            click: (item) => callbacks.setDebugThreadFlag?.('delegate_to_worktree', item.checked),
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
  return fixtures.map(({ label, stage, reviewState }) => ({
    label,
    type: 'radio',
    checked: callbacks.getDebugMissionStage?.() === stage && (stage !== 'review' || callbacks.getDebugMissionReviewState?.() === reviewState),
    enabled: Boolean(callbacks.setDebugMissionStage && callbacks.getDebugMissionStage?.()),
    click: () => callbacks.setDebugMissionStage?.(stage, reviewState),
  }));
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
      label: 'Plan Review',
      enabled: Boolean(callbacks.injectDebugPlanReview),
      click: () => callbacks.injectDebugPlanReview?.(),
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
    { type: 'separator' },
    {
      label: 'Worktree Initialization',
      click: () => callbacks.sendAppCommand({
        type: 'debug-operation-progress',
        kind: 'worktreeInitialization',
      }),
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
        accelerator: 'CommandOrControl+,',
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
        accelerator: 'CommandOrControl+Q',
        click: () => callbacks.sendAppCommand({ type: 'quit' }),
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
        accelerator: 'CommandOrControl+N',
        click: () => callbacks.sendAppCommand({ type: 'new-team' }),
      },
      { type: 'separator' },
      {
        label: mainT('menu.closeAgent'),
        accelerator: 'CommandOrControl+W',
        click: () => callbacks.sendAppCommand({ type: 'close-active-agent' }),
      },
      {
        label: mainT('menu.closeTeam'),
        accelerator: 'CommandOrControl+Shift+W',
        click: () => callbacks.sendAppCommand({ type: 'close-active-team' }),
      },
      { type: 'separator' },
      {
        label: mainT('menu.quit'),
        accelerator: 'CommandOrControl+Q',
        click: () => callbacks.sendAppCommand({ type: 'quit' }),
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
      accelerator: 'CommandOrControl+Shift+X',
      click: () => callbacks.sendAppCommand({ type: 'save-active-prompt-draft' }),
    },
    {
      label: mainT('menu.savedDrafts'),
      accelerator: 'CommandOrControl+Shift+V',
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
        accelerator: 'CommandOrControl+E',
        click: () => callbacks.sendAppCommand({ type: 'edit-active-agent' }),
      },
      {
        label: mainT('menu.duplicateAgent'),
        accelerator: 'CommandOrControl+D',
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
        accelerator: 'CommandOrControl+Shift+K',
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
      {
        label: mainT('menu.changes'),
        accelerator: 'CommandOrControl+G',
        click: () => callbacks.sendAppCommand({ type: 'open-review' }),
      },
      {
        label: mainT('menu.browser'),
        accelerator: 'CommandOrControl+B',
        click: () => callbacks.sendAppCommand({ type: 'open-browser' }),
      },
      { type: 'separator' },
      {
        label: mainT('menu.goToAgent'),
        accelerator: 'CommandOrControl+K',
        click: () => callbacks.sendAppCommand({ type: 'open-agent-palette' }),
      },
      {
        label: mainT('menu.nextAgent'),
        accelerator: 'Control+Tab',
        click: () => callbacks.sendAppCommand({ type: 'cycle-agents', direction: 1 }),
      },
      {
        label: mainT('menu.previousAgent'),
        accelerator: 'Control+Shift+Tab',
        click: () => callbacks.sendAppCommand({ type: 'cycle-agents', direction: -1 }),
      },
      { type: 'separator' },
      {
        label: mainT('menu.nextTeam'),
        accelerator: cycleTeamsAccelerator,
        click: () => callbacks.sendAppCommand({ type: 'cycle-teams' }),
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
  return {
    label: mainT('menu.window'),
    submenu: [
      { role: 'minimize' },
      ...(platform === 'darwin' ? [{ role: 'zoom' as const }] : []),
      { type: 'separator' },
      {
        label: mainT('menu.nextTeam'),
        accelerator: cycleTeamsAccelerator,
        acceleratorWorksWhenHidden: true,
        visible: false,
        click: () => callbacks.sendAppCommand({ type: 'cycle-teams' }),
      },
      ...(platform === 'darwin'
        ? [{ type: 'separator' as const }, { role: 'front' as const }]
        : [{ role: 'close' as const }]),
    ],
  };
}
