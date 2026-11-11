import { createCursorLifecycle } from './cursor/provider-lifecycle';
import { homedir } from 'node:os';
import path from 'node:path';
import type { HarnessProvider, AppGeneralSettings, AppSnapshot, CodexResourceSharingStatus, SetCodexResourceSharingInput } from '@workspace/core/contracts';
import type { ProviderHomeSettings, ProviderSetupCapabilities, ProviderSetupChange, ProviderSetupChoice } from '@workspace/core/contracts/provider-setup';
import { backendHomeDir } from './state';
import { createCodexLifecycle } from './codex/provider-lifecycle';
import { createClaudeLifecycle } from './claude/provider-lifecycle';
import { createAntigravityLifecycle } from './antigravity/provider-lifecycle';

/** The setting that points at each harness's own executable, for harnesses that have one. */
export const providerBinaryPathSettings = [['codex', 'codexBinaryPath']] as const satisfies readonly (readonly [HarnessProvider, keyof AppGeneralSettings])[];

/** Provider-owned lifecycle policy; setup owns serialization and persistence. */
export type ProviderLifecycle = {
  capabilities?: ProviderSetupCapabilities;
  validateChoice?(choice: ProviderSetupChange): void;
  home(snapshot: AppSnapshot, choice?: ProviderSetupChoice): ProviderHomeSettings;
  installed(snapshot: AppSnapshot): boolean;
  install?(): Promise<void>;
  prepareHome(home: ProviderHomeSettings, configuring: boolean): Promise<void>;
  skillDirectories?(home: ProviderHomeSettings): string[];
  skillDiscoveryDirectories?(home: ProviderHomeSettings): string[];
  applyHome?(home: ProviderHomeSettings): void;
  sharing?: {
    status(home: ProviderHomeSettings): Promise<CodexResourceSharingStatus>;
    set(home: ProviderHomeSettings, input: SetCodexResourceSharingInput): Promise<void>;
  };
};

export function createProviderLifecycles(): ReadonlyMap<HarnessProvider, ProviderLifecycle> {
  return new Map([['codex', createCodexLifecycle()], ['claude', createClaudeLifecycle()], ['antigravity', createAntigravityLifecycle()], ['cursor', createCursorLifecycle()]]);
}

export function providerHomePaths(provider: HarnessProvider, configured: string | undefined) {
  const isolated = path.join(backendHomeDir(), `${provider}-home`);
  const candidate = configured ? path.resolve(configured) : null;
  // A launcher can inherit App's private home; that is not the external setup.
  const existing = candidate && candidate !== isolated ? candidate : path.join(homedir(), `.${provider}`);
  return { isolated, existing };
}
