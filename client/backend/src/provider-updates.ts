import { randomUUID } from 'node:crypto';
import type { HarnessProvider } from '@workspace/core/contracts';
import type { ProviderUpdateInput, ProviderUpdateStatus } from '@workspace/core/contracts/provider-updates';

export type ProviderInstallation = {
  /** Normalized by the provider adapter, including provider-native version comparisons. */
  status: Extract<ProviderUpdateStatus['status'], 'unavailable' | 'manual' | 'current' | 'available'>;
  provider?: HarnessProvider;
  executable?: string;
  version?: string;
  latestVersion?: string;
  method: ProviderUpdateStatus['method'];
  channel?: string;
  identity: string;
  command?: { file: string; args: string[] };
};

/** Owns explicit upgrade consent, waiting, serialization and admission locks on one host. */
export class ProviderUpdates {
  private readonly states = new Map<HarnessProvider, ProviderUpdateStatus>();
  private readonly installations = new Map<HarnessProvider, ProviderInstallation>();
  private readonly checkedAt = new Map<HarnessProvider, number>();
  private readonly checks = new Map<HarnessProvider, Promise<ProviderUpdateStatus>>();
  private job?: Promise<void>;
  private closed = false;

  constructor(private readonly options: {
    inspect(provider: HarnessProvider): Promise<ProviderInstallation>;
    upgrade(installation: ProviderInstallation): Promise<void>;
    withStoppedProvider(provider: HarnessProvider, work: () => Promise<void>): Promise<void>;
    busy(provider: HarnessProvider): boolean;
  }) {}

  isUpdating(backend?: HarnessProvider): boolean {
    return [...this.states.values()].some(state => (!backend || state.provider === backend) && state.status === 'upgrading');
  }

  async get(provider: HarnessProvider, refresh = false): Promise<ProviderUpdateStatus> {
    const state = this.states.get(provider);
    if (state && (['waiting', 'upgrading', 'error'].includes(state.status) || (!refresh && Date.now() - (this.checkedAt.get(provider) ?? 0) < 3_600_000))) {
      if (!refresh || ['waiting', 'upgrading'].includes(state.status)) return this.observation(provider);
    }
    const pending = this.checks.get(provider);
    if (pending) return pending;
    const check = this.check(provider).finally(() => this.checks.delete(provider));
    this.checks.set(provider, check);
    return check;
  }

  request(provider: HarnessProvider, input: ProviderUpdateInput): ProviderUpdateStatus {
    if (this.closed) throw new Error('Provider updates are shutting down.');
    if (this.checks.has(provider)) throw new Error('Wait for the provider version check to finish.');
    const state = this.states.get(provider);
    if (input.action === 'cancel') {
      if (state?.status === 'waiting') state.status = 'available';
      return this.observation(provider);
    }
    if (input.confirmed !== true || !state?.canUpgrade || !input.token || input.token !== state.token) throw new Error('Check the provider version and confirm this upgrade first.');
    if (state.status === 'waiting' || state.status === 'upgrading') return this.observation(provider);
    if (state.status !== 'available') throw new Error('No verified provider upgrade is available.');
    state.status = 'waiting';
    void this.tick();
    return this.observation(provider);
  }

  async tick(): Promise<void> {
    if (this.closed) return;
    if (this.job) return this.job;
    const state = [...this.states.values()].find(candidate => candidate.status === 'waiting' && !this.options.busy(candidate.provider));
    if (!state) return;
    // Synchronous admission lock before the first asynchronous probe.
    state.status = 'upgrading';
    this.job = this.run(state.provider).finally(() => { this.job = undefined; });
    return this.job;
  }

  async settle(): Promise<void> { await this.job; }
  async close(): Promise<void> { this.closed = true; await this.settle(); }

  private observation(provider: HarnessProvider): ProviderUpdateStatus {
    return { ...(this.states.get(provider) ?? { provider: provider, status: 'unavailable', method: 'manual', canUpgrade: false }), busy: this.options.busy(provider) };
  }

  private async check(provider: HarnessProvider): Promise<ProviderUpdateStatus> {
    try {
      const installation = await this.options.inspect(provider);
      this.installations.set(provider, structuredClone(installation));
      this.states.set(provider, {
        provider: provider, method: installation.method, channel: installation.channel,
        installedVersion: installation.version, latestVersion: installation.latestVersion,
        status: installation.status,
        canUpgrade: installation.status === 'available' && Boolean(installation.command), busy: false, token: randomUUID(),
      });
      this.checkedAt.set(provider, Date.now());
    } catch {
      this.states.set(provider, { ...this.observation(provider), status: 'error', error: 'checkFailed', canUpgrade: false });
    }
    return this.observation(provider);
  }

  private async run(provider: HarnessProvider): Promise<void> {
    const approved = this.installations.get(provider)!;
    const state = this.states.get(provider)!;
    try {
      const fresh = await this.options.inspect(provider);
      if (fresh.status !== 'available' || fresh.identity !== approved.identity || !fresh.command || fresh.latestVersion !== approved.latestVersion) {
        state.status = 'error'; state.error = 'installationChanged'; return;
      }
      if (this.closed || this.options.busy(provider)) { state.status = 'waiting'; return; }
      let verified = false;
      await this.options.withStoppedProvider(provider, async () => {
        await this.options.upgrade(fresh);
        const after = await this.options.inspect(provider);
        verified = Boolean(after.version && after.version === approved.latestVersion);
        if (after.version) state.installedVersion = after.version;
      });
      if (!verified) { state.status = 'error'; state.error = 'verificationFailed'; return; }
      await this.check(provider);
    } catch {
      state.status = 'error'; state.error = 'upgradeFailed';
    }
  }
}
