import type { HarnessProvider, AppSnapshot, SetCodexResourceSharingInput } from '@workspace/core/contracts';
import { clearRuntimeDiscoveryCache } from '@workspace/core/runtime-discovery';
import type { ProviderHomeSettings, ProviderSetupChange, ProviderSetupStatus } from '@workspace/core/contracts/provider-setup';
import { resolveProviderSetupCapabilities } from '@workspace/core/contracts/provider-setup';
import { createProviderLifecycles, type ProviderLifecycle } from './provider-lifecycle';
import { localProviderAgents, resetProviderRoster, validateProviderReset } from './provider-roster-reset';

/** Owns local provider homes. Never copies authentication or moves existing chats. */
export class ProviderSetup {
  private busy = false;
  private changingProvider: HarnessProvider | null = null;
  private readonly installations = new Map<HarnessProvider, boolean>();

  constructor(
    private readonly snapshot: AppSnapshot,
    private readonly persist: () => Promise<void>,
    private readonly reconnect: (provider: HarnessProvider) => Promise<void>,
    private readonly lifecycles: ReadonlyMap<HarnessProvider, ProviderLifecycle> = createProviderLifecycles(),
    private readonly backup?: () => Promise<void>,
  ) {}

  async initialize(): Promise<void> {
    for (const [provider, lifecycle] of this.lifecycles) {
      if (!this.snapshot.general.providerHomes?.[provider]) {
        this.snapshot.general.providerHomes = {
          ...this.snapshot.general.providerHomes,
          [provider]: lifecycle.home(this.snapshot),
        };
      }
      const home = this.home(provider);
      await lifecycle.prepareHome(home, false);
      lifecycle.applyHome?.(home);
    }
    await this.persist();
  }

  list(): ProviderSetupStatus[] {
    return [...this.lifecycles.keys()].map(provider => this.status(provider));
  }

  skillLocations(): import('@workspace/core/skill-manager').SkillProviderLocation[] {
    for (const backend of this.lifecycles.keys()) this.invalidateInstallation(backend);
    return this.list().filter(provider => provider.installed).flatMap(provider =>
      [
        ...(this.lifecycle(provider.provider).skillDirectories?.(provider) ?? []).map(directory => ({ provider: provider.provider, directory })),
        ...(this.lifecycle(provider.provider).skillDiscoveryDirectories?.(provider) ?? []).map(directory => ({ provider: provider.provider, directory, discoveryOnly: true })),
      ]);
  }

  isChanging(provider?: HarnessProvider): boolean { return this.changingProvider !== null && (!provider || this.changingProvider === provider); }

  async configure(provider: HarnessProvider, choice: ProviderSetupChange): Promise<ProviderSetupStatus> {
    if (this.busy) throw new Error('Provider setup is already in progress.');
    const lifecycle = this.lifecycle(provider);
    lifecycle.validateChoice?.(choice);
    const previous = this.home(provider);
    const capabilities = resolveProviderSetupCapabilities(provider, lifecycle.capabilities);
    if ((!capabilities.homeSelection && previous.isolated !== choice.isolated)
      || (!capabilities.skillSharing && previous.shareSkills !== choice.shareSkills)) throw new Error('This provider does not support changing this setup.');
    const changesHome = previous.isolated !== choice.isolated;
    const changesSharing = previous.shareSkills !== choice.shareSkills;
    if (!changesHome && !changesSharing && this.locked(provider)) throw new Error('This provider already has chats. Only its conversation setup can be changed here.');
    const sharingAgentIds = !changesHome && changesSharing ? localProviderAgents(this.snapshot, provider).map(agent => agent.id) : null;
    if (sharingAgentIds) validateProviderReset(this.snapshot, provider, sharingAgentIds);
    const confirmedIds = changesHome ? validateProviderReset(this.snapshot, provider, choice.removeAgentIds) : [];
    this.busy = true;
    this.changingProvider = provider;
    let undoRoster: (() => void) | undefined;
    let setupStarted = false;
    try {
      if (confirmedIds.length) await this.backup?.();
      setupStarted = true;
      const next = changesHome
        ? lifecycle.home(this.snapshot, { isolated: choice.isolated, shareSkills: choice.shareSkills })
        : { ...previous, shareSkills: choice.shareSkills };
      await lifecycle.prepareHome(next, true);
      this.snapshot.general.providerHomes = { ...this.snapshot.general.providerHomes, [provider]: next };
      lifecycle.applyHome?.(next);
      await this.reconnect(provider);
      if (sharingAgentIds) validateProviderReset(this.snapshot, provider, sharingAgentIds);
      if (changesHome) {
        // Recheck after async setup: a new or now-active agent invalidates consent.
        validateProviderReset(this.snapshot, provider, choice.removeAgentIds);
        if (confirmedIds.length) undoRoster = resetProviderRoster(this.snapshot, confirmedIds);
      }
      await this.persist();
      return this.status(provider);
    } catch (error) {
      if (!setupStarted) throw error;
      undoRoster?.();
      this.snapshot.general.providerHomes = { ...this.snapshot.general.providerHomes, [provider]: previous };
      lifecycle.applyHome?.(previous);
      await lifecycle.prepareHome(previous, false);
      await this.reconnect(provider);
      await this.persist();
      throw error;
    } finally { this.busy = false; this.changingProvider = null; }
  }

  async refresh(provider: HarnessProvider): Promise<ProviderSetupStatus> {
    if (this.busy) throw new Error('Provider setup is already in progress.');
    // An explicit refresh must see the shell as it is now, not the answer remembered for the last few minutes.
    clearRuntimeDiscoveryCache();
    const wasInstalled = this.status(provider).installed;
    this.busy = true;
    try {
      this.invalidateInstallation(provider);
      if (this.status(provider).installed && !wasInstalled) await this.reconnect(provider);
      return this.status(provider);
    } catch (error) {
      this.installations.set(provider, wasInstalled);
      throw error;
    } finally { this.busy = false; }
  }

  async install(provider: HarnessProvider): Promise<ProviderSetupStatus> {
    if (this.busy) throw new Error('Provider setup is already in progress.');
    const lifecycle = this.lifecycle(provider);
    if (!lifecycle.install) throw new Error('Install this provider using its official instructions.');
    clearRuntimeDiscoveryCache();
    this.invalidateInstallation(provider);
    if (this.status(provider).installed) return this.status(provider);
    this.busy = true;
    try {
      await lifecycle.install();
      this.invalidateInstallation(provider);
      if (!this.status(provider).installed) throw new Error('The provider installation could not be detected.');
      await this.reconnect(provider);
      return this.status(provider);
    } finally { this.invalidateInstallation(provider); this.busy = false; }
  }

  private home(provider: HarnessProvider): ProviderHomeSettings {
    return this.snapshot.general.providerHomes?.[provider] ?? this.lifecycle(provider).home(this.snapshot);
  }

  private locked(provider: HarnessProvider): boolean {
    return localProviderAgents(this.snapshot, provider).length > 0;
  }

  invalidateInstallation(provider: HarnessProvider): void { this.installations.delete(provider); }

  private status(provider: HarnessProvider): ProviderSetupStatus {
    const installed = this.installations.get(provider) ?? this.lifecycle(provider).installed(this.snapshot);
    this.installations.set(provider, installed);
    return { provider: provider, ...this.home(provider), installed, locked: this.locked(provider), affectedAgentIds: localProviderAgents(this.snapshot, provider).map(agent => agent.id),
      capabilities: resolveProviderSetupCapabilities(provider, this.lifecycle(provider).capabilities) };
  }

  private lifecycle(provider: HarnessProvider): ProviderLifecycle {
    const lifecycle = this.lifecycles.get(provider);
    if (!lifecycle) throw new Error(`Provider setup is unavailable for ${provider}.`);
    return lifecycle;
  }

  getResourceSharingStatus(provider: HarnessProvider) {
    const sharing = this.lifecycle(provider).sharing;
    if (!sharing) throw new Error(`Resource sharing is unavailable for ${provider}.`);
    return sharing.status(this.home(provider));
  }

  async setResourceSharing(provider: HarnessProvider, input: SetCodexResourceSharingInput): Promise<void> {
    const sharing = this.lifecycle(provider).sharing;
    if (!sharing) throw new Error(`Resource sharing is unavailable for ${provider}.`);
    await sharing.set(this.home(provider), input);
  }
}
