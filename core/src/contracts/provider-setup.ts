import type { AgentBackend, ClaudeAuthentication, CodexAuthentication } from '../contracts';

export type ProviderAuthenticationAction = { action: 'check' | 'cancel' | 'logout' | 'login'; loginId?: string };

/** App-owned authentication metadata, cached only for the life of the host. */
export type ProviderAuthentication =
  | { kind: 'codex'; connected: boolean; state: CodexAuthentication }
  | { kind: 'claude'; connected: boolean; state: ClaudeAuthentication }
  | { kind: 'antigravity'; connected: boolean; state: { loggedIn: boolean; homePath: string } };

/** Runtime observation, never persisted as an enable/disable preference. */
export type ProviderConnection = {
  backend: AgentBackend;
  installed: boolean;
  connected: boolean;
  /** Missing on older snapshots means enabled. Disabling never logs out. */
  enabled?: boolean;
  checking: boolean;
  error?: string;
  authentication?: ProviderAuthentication;
};

export function isProviderConnection(value: unknown): value is ProviderConnection {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.backend === 'codex' || candidate.backend === 'claude' || candidate.backend === 'antigravity')
    && typeof candidate.installed === 'boolean' && typeof candidate.connected === 'boolean'
    && typeof candidate.checking === 'boolean' && (candidate.enabled === undefined || typeof candidate.enabled === 'boolean')
    && (candidate.error === undefined || typeof candidate.error === 'string')
    && (candidate.authentication === undefined || (isProviderAuthentication(candidate.authentication) && candidate.authentication.kind === candidate.backend));
}

export function isProviderAuthentication(value: unknown): value is ProviderAuthentication {
  if (!record(value) || typeof value.connected !== 'boolean' || !record(value.state)) return false;
  const state = value.state;
  if (value.kind === 'antigravity') return typeof state.loggedIn === 'boolean' && typeof state.homePath === 'string';
  if (value.kind === 'claude') return typeof state.loggedIn === 'boolean'
    && (state.executablePath === undefined || typeof state.executablePath === 'string')
    && (state.configDirectory === undefined || state.configDirectory === null || typeof state.configDirectory === 'string')
    && (state.account === undefined || (record(state.account) && ['subscription', 'apiKey'].includes(String(state.account.type))
      && (state.account.email === undefined || typeof state.account.email === 'string')
      && (state.account.subscription === undefined || typeof state.account.subscription === 'string')));
  if (value.kind !== 'codex' || typeof state.requiresOpenaiAuth !== 'boolean' || !record(state.login)) return false;
  const account = state.account;
  return ['idle', 'starting', 'pending', 'completed', 'cancelled', 'error'].includes(String(state.login.status))
    && (state.login.error === null || typeof state.login.error === 'string')
    && (account === null || (record(account) && (account.type === 'apiKey'
      || (account.type === 'chatgpt' && (account.email === null || typeof account.email === 'string') && typeof account.planType === 'string')
      || (account.type === 'amazonBedrock' && ['codexManaged', 'awsManaged'].includes(String(account.credentialSource))))));
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

export type ProviderSetupChoice = { isolated: boolean; shareSkills: boolean };
/** Destructive setup changes must name the exact local roster shown in the confirmation. */
export type ProviderSetupChange = ProviderSetupChoice & { removeAgentIds?: string[] };
export type ProviderHomeSettings = ProviderSetupChoice & { homePath: string };
export type ProviderSetupStatus = ProviderHomeSettings & {
  backend: AgentBackend;
  installed: boolean;
  locked: boolean;
  affectedAgentIds?: string[];
};
