export type SshHostCandidate = {
  host: string;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  configPath?: string;
  line?: number;
};

export type RemoteConnectionStatus = 'saved' | 'checking' | 'ready' | 'error';

export type RemoteConnectionTransport = {
  type: 'ssh-stdio';
  command: 'ssh';
  args: string[];
};

export type RemoteConnection = {
  providerConnections?: import('./provider-setup').ProviderConnection[];
  id: string;
  kind: 'ssh';
  name: string;
  host: string;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  status: RemoteConnectionStatus;
  daemonVersion?: string;
  codexVersion?: string;
  claudeVersion?: string;
  detail?: string;
  sourceFolderPath?: string;
  transport?: RemoteConnectionTransport;
  installedAt?: string;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type RemoteConnectionsState = {
  connections: RemoteConnection[];
};

export type ClaudeAuthentication = {
  /** Selected executable on the owning host, for user-run login commands. */
  executablePath?: string;
  loggedIn: boolean;
  account?: { type: 'subscription' | 'apiKey'; email?: string; subscription?: string };
  /** Local CLI override; null means leave CLAUDE_CONFIG_DIR unset for the default login. */
  configDirectory?: string | null;
};

export type DevicePairingStatus = {
  status: 'disabled' | 'connecting' | 'connected' | 'errored';
  serverName?: string;
  installationId?: string;
  environmentId?: string | null;
  allowRemoteControl?: boolean | null;
  detail?: string;
};

export type DevicePairingSession = {
  pairingCode: string;
  manualPairingCode?: string | null;
  environmentId: string;
  expiresAt: string;
};

export type PairedDevice = {
  clientId: string;
  displayName?: string | null;
  deviceType?: string | null;
  platform?: string | null;
  osVersion?: string | null;
  deviceModel?: string | null;
  appVersion?: string | null;
  lastSeenAt?: string | null;
};

export type AddSshConnectionInput = SshHostCandidate & {
  name?: string;
};

export type UpdateRemoteConnectionInput = {
  sourceFolderPath?: string;
};
