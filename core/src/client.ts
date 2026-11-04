import type { AppApi } from './contracts';

export type AppClientPlatform = 'desktop' | 'web';

export type AppHostCapabilities = {
  appLifecycle: boolean;
  appshots: boolean;
  appUpdates: boolean;
  computerUse: boolean;
  daemonManagement: boolean;
  dockBadge: boolean;
  embeddedBrowser: boolean;
  nativeFileDialogs: boolean;
  openInApplications: boolean;
  systemPermissions: boolean;
};

export type AppClient = {
  api: AppApi;
  platform: AppClientPlatform;
  traceConversationLoad?: boolean;
};

export const desktopAppHostCapabilities: Readonly<AppHostCapabilities> = Object.freeze({
  appLifecycle: true,
  appshots: true,
  appUpdates: true,
  computerUse: true,
  daemonManagement: true,
  dockBadge: true,
  embeddedBrowser: true,
  nativeFileDialogs: true,
  openInApplications: true,
  systemPermissions: true,
});

export const webAppHostCapabilities: Readonly<AppHostCapabilities> = Object.freeze({
  appLifecycle: false,
  appshots: false,
  appUpdates: false,
  computerUse: false,
  daemonManagement: false,
  dockBadge: false,
  embeddedBrowser: false,
  nativeFileDialogs: false,
  openInApplications: false,
  systemPermissions: false,
});
