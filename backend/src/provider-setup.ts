import type { AgentBackend, AppSnapshot, SetCodexResourceSharingInput } from '@workspace/core/contracts';
import type { ProviderHomeSettings, ProviderSetupChange, ProviderSetupStatus } from '@workspace/core/contracts/provider-setup';
import { createProviderLifecycles, type ProviderLifecycle } from './provider-lifecycle';
import { localProviderAgents, resetProviderRoster, validateProviderReset } from './provider-roster-reset';

/** Owns local provider homes. Never copies authentication or moves existing chats. */
export class ProviderSetup {
  private busy = false;
  private changingBackend: AgentBackend | null = null;
  private readonly installations = new Map<AgentBackend, boolean>();

  constructor(
    private readonly snapshot: AppSnapshot,
    private readonly persist: () => Promise<void>,
    private readonly reconnect: (backend: AgentBackend) => Promise<void>,
    private readonly lifecycles: ReadonlyMap<AgentBackend, ProviderLifecycle> = createProviderLifecycles(),
    private readonly backup?: () => Promise<void>,
  ) {}

  async initialize(): Promise<void> {
    for (const [backend, lifecycle] of this.lifecycles) {
      if (!this.snapshot.general.providerHomes?.[backend]) {
        this.snapshot.general.providerHomes = {
          ...this.snapshot.general.providerHomes,
          [backend]: lifecycle.home(this.snapshot),
        };
      }
      const home = this.home(backend);
      await lifecycle.prepareHome(home, false);
      lifecycle.applyHome?.(home);
    }
    await this.persist();
  }

  list(): ProviderSetupStatus[] {
    return [...this.lifecycles.keys()].map(backend => this.status(backend));
  }

  skillLocations(): import('@workspace/core/skill-manager').SkillProviderLocation[] {
    for (const backend of this.lifecycles.keys()) this.invalidateInstallation(backend);
    return this.list().filter(provider => provider.installed).flatMap(provider =>
      [
        ...(this.lifecycle(provider.backend).skillDirectories?.(provider) ?? []).map(directory => ({ backend: provider.backend, directory })),
        ...(this.lifecycle(provider.backend).skillDiscoveryDirectories?.(provider) ?? []).map(directory => ({ backend: provider.backend, directory, discoveryOnly: true })),
      ]);
  }

  isChanging(backend?: AgentBackend): boolean { return this.changingBackend !== null && (!backend || this.changingBackend === backend); }

  async configure(backend: AgentBackend, choice: ProviderSetupChange): Promise<ProviderSetupStatus> {
    if (this.busy) throw new Error('Provider setup is already in progress.');
    const lifecycle = this.lifecycle(backend);
    const previous = this.home(backend);
    const changesHome = previous.isolated !== choice.isolated;
    const changesSharing = previous.shareSkills !== choice.shareSkills;
    if (!changesHome && !changesSharing && this.locked(backend)) throw new Error('This provider already has chats. Only its conversation setup can be changed here.');
    const sharingAgentIds = !changesHome && changesSharing ? localProviderAgents(this.snapshot, backend).map(agent => agent.id) : null;
    if (sharingAgentIds) validateProviderReset(this.snapshot, backend, sharingAgentIds);
    const confirmedIds = changesHome ? validateProviderReset(this.snapshot, backend, choice.removeAgentIds) : [];
    this.busy = true;
    this.changingBackend = backend;
    let undoRoster: (() => void) | undefined;
    let setupStarted = false;
    try {
      if (confirmedIds.length) await this.backup?.();
      setupStarted = true;
      const next = changesHome
        ? lifecycle.home(this.snapshot, { isolated: choice.isolated, shareSkills: choice.shareSkills })
        : { ...previous, shareSkills: choice.shareSkills };
      await lifecycle.prepareHome(next, true);
      this.snapshot.general.providerHomes = { ...this.snapshot.general.providerHomes, [backend]: next };
      lifecycle.applyHome?.(next);
      await this.reconnect(backend);
      if (sharingAgentIds) validateProviderReset(this.snapshot, backend, sharingAgentIds);
      if (changesHome) {
        // Recheck after async setup: a new or now-active agent invalidates consent.
        validateProviderReset(this.snapshot, backend, choice.removeAgentIds);
        if (confirmedIds.length) undoRoster = resetProviderRoster(this.snapshot, confirmedIds);
      }
      await this.persist();
      return this.status(backend);
    } catch (error) {
      if (!setupStarted) throw error;
      undoRoster?.();
      this.snapshot.general.providerHomes = { ...this.snapshot.general.providerHomes, [backend]: previous };
      lifecycle.applyHome?.(previous);
      await lifecycle.prepareHome(previous, false);
      await this.reconnect(backend);
      await this.persist();
      throw error;
    } finally { this.busy = false; this.changingBackend = null; }
  }

  async refresh(backend: AgentBackend): Promise<ProviderSetupStatus> {
    if (this.busy) throw new Error('Provider setup is already in progress.');
    const wasInstalled = this.status(backend).installed;
    this.busy = true;
    try {
      this.invalidateInstallation(backend);
      if (this.status(backend).installed && !wasInstalled) await this.reconnect(backend);
      return this.status(backend);
    } catch (error) {
      this.installations.set(backend, wasInstalled);
      throw error;
    } finally { this.busy = false; }
  }

  async install(backend: AgentBackend): Promise<ProviderSetupStatus> {
    if (this.busy) throw new Error('Provider setup is already in progress.');
    const lifecycle = this.lifecycle(backend);
    if (!lifecycle.install) throw new Error('Install this provider using its official instructions.');
    this.invalidateInstallation(backend);
    if (this.status(backend).installed) return this.status(backend);
    this.busy = true;
    try {
      await lifecycle.install();
      this.invalidateInstallation(backend);
      if (!this.status(backend).installed) throw new Error('The provider installation could not be detected.');
      await this.reconnect(backend);
      return this.status(backend);
    } finally { this.invalidateInstallation(backend); this.busy = false; }
  }

  private home(backend: AgentBackend): ProviderHomeSettings {
    return this.snapshot.general.providerHomes?.[backend] ?? this.lifecycle(backend).home(this.snapshot);
  }

  private locked(backend: AgentBackend): boolean {
    return localProviderAgents(this.snapshot, backend).length > 0;
  }

  invalidateInstallation(backend: AgentBackend): void { this.installations.delete(backend); }

  private status(backend: AgentBackend): ProviderSetupStatus {
    const installed = this.installations.get(backend) ?? this.lifecycle(backend).installed(this.snapshot);
    this.installations.set(backend, installed);
    return { backend, ...this.home(backend), installed, locked: this.locked(backend), affectedAgentIds: localProviderAgents(this.snapshot, backend).map(agent => agent.id) };
  }

  private lifecycle(backend: AgentBackend): ProviderLifecycle {
    const lifecycle = this.lifecycles.get(backend);
    if (!lifecycle) throw new Error(`Provider setup is unavailable for ${backend}.`);
    return lifecycle;
  }

  getResourceSharingStatus(backend: AgentBackend) {
    const sharing = this.lifecycle(backend).sharing;
    if (!sharing) throw new Error(`Resource sharing is unavailable for ${backend}.`);
    return sharing.status(this.home(backend));
  }

  async setResourceSharing(backend: AgentBackend, input: SetCodexResourceSharingInput): Promise<void> {
    const sharing = this.lifecycle(backend).sharing;
    if (!sharing) throw new Error(`Resource sharing is unavailable for ${backend}.`);
    await sharing.set(this.home(backend), input);
  }
}
