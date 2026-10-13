import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentBackend, AppSnapshot, CodexResourceSharingStatus, SetCodexResourceSharingInput } from '@workspace/core/contracts';
import type { ProviderHomeSettings, ProviderSetupChoice } from '@workspace/core/contracts/provider-setup';
import { backendHomeDir } from './state';
import { createCodexLifecycle } from './codex/provider-lifecycle';
import { createClaudeLifecycle } from './claude/provider-lifecycle';
import { createAntigravityLifecycle } from './antigravity/provider-lifecycle';

/** Provider-owned lifecycle policy; setup owns serialization and persistence. */
export type ProviderLifecycle = {
  home(snapshot: AppSnapshot, choice?: ProviderSetupChoice): ProviderHomeSettings;
  installed(snapshot: AppSnapshot): boolean;
  install?(): Promise<void>;
  prepareHome(home: ProviderHomeSettings, configuring: boolean): Promise<void>;
  applyHome?(home: ProviderHomeSettings): void;
  sharing?: {
    status(home: ProviderHomeSettings): Promise<CodexResourceSharingStatus>;
    set(home: ProviderHomeSettings, input: SetCodexResourceSharingInput): Promise<void>;
  };
};

export function createProviderLifecycles(): ReadonlyMap<AgentBackend, ProviderLifecycle> {
  return new Map([['codex', createCodexLifecycle()], ['claude', createClaudeLifecycle()], ['antigravity', createAntigravityLifecycle()]]);
}

export function providerHomePaths(backend: AgentBackend, configured: string | undefined) {
  const isolated = path.join(backendHomeDir(), `${backend}-home`);
  const candidate = configured ? path.resolve(configured) : null;
  // A launcher can inherit App's private home; that is not the external setup.
  const existing = candidate && candidate !== isolated ? candidate : path.join(homedir(), `.${backend}`);
  return { isolated, existing };
}
