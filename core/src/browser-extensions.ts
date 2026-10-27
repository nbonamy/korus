export type BrowserExtensionDefinition = {
  id: string;
  name: string;
  storageRelayPage?: string;
  setupPage?: string;
  nativeHosts?: readonly string[];
};
export const supportedBrowserExtensions = [
  {
    id: 'nngceckbapebfimnlniiiahkandclblb',
    name: 'Bitwarden',
    storageRelayPage: 'sidepanel-disabled.html',
    nativeHosts: ['com.8bit.bitwarden'],
  },
  { id: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', name: '1Password', setupPage: 'app/app.html#/page/welcome' },
] as const satisfies readonly BrowserExtensionDefinition[];

export type BrowserExtensionAction =
  | 'list'
  | 'install'
  | 'update'
  | 'reinstall'
  | 'enable'
  | 'disable'
  | 'remove'
  | 'open';
export type BrowserExtensionStatus = {
  id: string;
  name: string;
  version?: string;
  enabled: boolean;
  permissions: string[];
  error?: string;
};
export type BrowserExtensionState = { extensions: BrowserExtensionStatus[]; message?: string };
/** Desktop/backend contract; package paths never enter renderer state. */
export type BrowserExtensionPackage = BrowserExtensionStatus & { path?: string; optionalPermissions?: string[] };
export type BrowserExtensionPackageState = {
  extensions: BrowserExtensionPackage[];
  nativeHost?: { name: string; path: string };
  cleanupPath?: string;
  candidate?: { token: string; id: string; version: string; permissions: string[]; addedPermissions: string[] };
};
export type BrowserExtensionPackageRequest =
  | { action: 'list' }
  | { action: 'prepare'; id: string; chromeVersion: string }
  | { action: 'commit' | 'cancel'; token: string }
  | { action: 'enabled'; id: string; enabled: boolean }
  | { action: 'remove'; id: string }
  | { action: 'cleanup'; id: string }
  | { action: 'nativeHost'; id: string; host: string }
  | { action: 'permissions'; id: string; permissions: string[]; remove?: boolean };
