import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { app, BrowserWindow, shell } from 'electron';
import type { SystemPermissionsStatus } from '@workspace/core/contracts';
import { type AnnouncementPhase, type SpokenAnnouncementRequest, type SpokenAnnouncementVoice } from '@workspace/core/contracts';
import { executeComputerUseCommand, getComputerUseStatus, isComputerUseCommand, requestComputerUseAccessibility, requestComputerUseScreenCapture, stopComputerUseHelper, type ComputerUseOptions } from './computer-use-tools';
import { getSystemPermissionsStatus, openAccessibilitySettings } from './system-permissions';
import { createRuntimeSpokenAnnouncementQueue, type SpokenAnnouncementQueue } from './spoken-announcements';

export type ClientRequestHandler = (params: unknown) => unknown | Promise<unknown>;

export type ClientRequestHandlersOptions = {
  desktopFocused?: () => boolean;
  openExternal: (url: string) => Promise<unknown>;
  getSystemPermissionsStatus: () => SystemPermissionsStatus;
  openAccessibilitySettings: () => Promise<SystemPermissionsStatus>;
  computerUseOptions: () => ComputerUseOptions;
  mobileSimulator?: (agentId: string, input: import('@workspace/core/mobile-simulator').MobileRequest) => Promise<import('@workspace/core/mobile-simulator').MobileResult>;
  browserOpen?: (agentId: string, browserId: string, url: string) => Promise<unknown>;
  browserExecute?: (agentId: string, browserId: string, command: string, arguments_: Record<string, unknown>) => Promise<unknown>;
  spokenAnnouncements?: Pick<SpokenAnnouncementQueue, 'queue'>;
  spokenAnnouncementVoice?: () => SpokenAnnouncementVoice;
};

export function createRuntimeClientRequestHandlers(overrides: Pick<ClientRequestHandlersOptions, 'mobileSimulator' | 'browserExecute' | 'browserOpen' | 'spokenAnnouncements' | 'spokenAnnouncementVoice'> = {}): Record<string, ClientRequestHandler> {
  const spokenAnnouncements = overrides.spokenAnnouncements ?? createRuntimeSpokenAnnouncementQueue({
    appPath: app?.getAppPath?.() ?? process.cwd(),
    isPackaged: app?.isPackaged ?? false,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
  });
  return createClientRequestHandlers({
    openExternal: (url) => shell.openExternal(url),
    getSystemPermissionsStatus,
    openAccessibilitySettings,
    computerUseOptions: () => ({
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: process.resourcesPath,
    }),
    spokenAnnouncements,
    desktopFocused: () => BrowserWindow.getFocusedWindow() !== null,
    ...overrides,
  });
}

export function createClientRequestHandlers(options: ClientRequestHandlersOptions): Record<string, ClientRequestHandler> {
  return {
    [backendMethods.clientFocusGet]: () => ({ focused: options.desktopFocused?.() === true }),
    [backendMethods.clientExternalOpen]: async (params) => {
      const record = requireRecord(params);
      const url = requireString(record.url, 'url');
      await options.openExternal(url);
      return true;
    },
    [backendMethods.clientMobileSimulatorExecute]: params => {
      if (!options.mobileSimulator) throw new Error('Mobile simulators are unavailable on this host.');
      const input = requireRecord(params);
      return options.mobileSimulator(requireString(input.agentId, 'agentId'), requireRecord(input.input) as import('@workspace/core/mobile-simulator').MobileRequest);
    },
    [backendMethods.clientBrowserExecute]: async (params) => {
      if (!options.browserExecute) throw new Error('In-app browser tools are unavailable.');
      const input = requireRecord(params);
      return options.browserExecute(requireString(input.agentId, 'agentId'), requireString(input.browserId, 'browserId'), requireString(input.command, 'command'), requireRecord(input.arguments));
    },
    [backendMethods.clientBrowserOpen]: async (params) => {
      if (!options.browserOpen) throw new Error('In-app browser tools are unavailable.');
      const input = requireRecord(params);
      return options.browserOpen(requireString(input.agentId, 'agentId'), requireString(input.browserId, 'browserId'), requireString(input.url, 'url'));
    },
    [backendMethods.clientSpokenAnnouncementQueue]: (params) => {
      const input = requireRecord(params);
      const text = requireString(input.text, 'text').trim();
      if (text.length > 160) throw new Error('Invalid text.');
      const phase = requireAnnouncementPhase(input.phase);
      const request: SpokenAnnouncementRequest = {
        agentId: requireString(input.agentId, 'agentId'),
        phase,
        text,
        voice: options.spokenAnnouncementVoice?.() ?? 'af_heart',
      };
      return options.spokenAnnouncements?.queue(request) ?? { queued: false, reason: 'unsupported' };
    },
    [backendMethods.clientSystemPermissionsGet]: async () => mergeComputerUsePermissions(
      options.getSystemPermissionsStatus(),
      await getComputerUseStatus(options.computerUseOptions()),
    ),
    [backendMethods.clientSystemPermissionsAccessibilityOpen]: async () => mergeComputerUsePermissions(
      await options.openAccessibilitySettings(),
      await getComputerUseStatus(options.computerUseOptions()),
    ),
    [backendMethods.clientSystemPermissionsScreenRecordingOpen]: async () => mergeComputerUsePermissions(
      options.getSystemPermissionsStatus(),
      await requestComputerUseScreenCapture(options.computerUseOptions()),
    ),
    [backendMethods.clientComputerUseStatusGet]: () => getComputerUseStatus(options.computerUseOptions()),
    [backendMethods.clientComputerUseRequestAccessibility]: () => requestComputerUseAccessibility(options.computerUseOptions()),
    [backendMethods.clientComputerUseStop]: () => {
      stopComputerUseHelper();
      return { stopped: true };
    },
    [backendMethods.clientComputerUseExecute]: async (params) => {
      const input = requireRecord(params);
      if (!isComputerUseCommand(input.command)) {
        throw new Error('Invalid Computer Use command.');
      }
      return executeComputerUseCommand({
        arguments: requireRecord(input.arguments),
        command: input.command,
        options: options.computerUseOptions(),
      });
    },
  };
}

function mergeComputerUsePermissions(
  permissions: SystemPermissionsStatus,
  computerUse: Awaited<ReturnType<typeof getComputerUseStatus>>,
): SystemPermissionsStatus {
  return {
    ...permissions,
    screenRecording: {
      required: computerUse.platform === 'darwin',
      trusted: computerUse.platform !== 'darwin' || computerUse.screenCaptureTrusted,
    },
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Invalid client request params.');
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${name}.`);
  }
  return value;
}

function requireAnnouncementPhase(value: unknown): AnnouncementPhase {
  if (value !== 'start' && value !== 'finish') throw new Error('Invalid phase.');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
