import { randomUUID } from 'node:crypto';
import type { AgentBackend } from '@workspace/core/contracts';
import type { ProviderUpdateInput, ProviderUpdateStatus } from '@workspace/core/contracts/provider-updates';

export type ProviderInstallation = {
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
  private readonly states = new Map<AgentBackend, ProviderUpdateStatus>();
  private readonly installations = new Map<AgentBackend, ProviderInstallation>();
  private readonly checkedAt = new Map<AgentBackend, number>();
  private readonly checks = new Map<AgentBackend, Promise<ProviderUpdateStatus>>();
  private job?: Promise<void>;
  private closed = false;

  constructor(private readonly options: {
    inspect(backend: AgentBackend): Promise<ProviderInstallation>;
    upgrade(installation: ProviderInstallation): Promise<void>;
    withStoppedProvider(backend: AgentBackend, work: () => Promise<void>): Promise<void>;
    busy(backend: AgentBackend): boolean;
  }) {}

  isUpdating(backend?: AgentBackend): boolean {
    return [...this.states.values()].some(state => (!backend || state.backend === backend) && state.status === 'upgrading');
  }

  async get(backend: AgentBackend, refresh = false): Promise<ProviderUpdateStatus> {
    const state = this.states.get(backend);
    if (state && (['waiting', 'upgrading', 'error'].includes(state.status) || (!refresh && Date.now() - (this.checkedAt.get(backend) ?? 0) < 3_600_000))) {
      if (!refresh || ['waiting', 'upgrading'].includes(state.status)) return this.observation(backend);
    }
    const pending = this.checks.get(backend);
    if (pending) return pending;
    const check = this.check(backend).finally(() => this.checks.delete(backend));
    this.checks.set(backend, check);
    return check;
  }

  request(backend: AgentBackend, input: ProviderUpdateInput): ProviderUpdateStatus {
    if (this.closed) throw new Error('Provider updates are shutting down.');
    if (this.checks.has(backend)) throw new Error('Wait for the provider version check to finish.');
    const state = this.states.get(backend);
    if (input.action === 'cancel') {
      if (state?.status === 'waiting') state.status = 'available';
      return this.observation(backend);
    }
    if (input.confirmed !== true || !state?.canUpgrade || !input.token || input.token !== state.token) throw new Error('Check the provider version and confirm this upgrade first.');
    if (state.status === 'waiting' || state.status === 'upgrading') return this.observation(backend);
    if (state.status !== 'available') throw new Error('No verified provider upgrade is available.');
    state.status = 'waiting';
    void this.tick();
    return this.observation(backend);
  }

  async tick(): Promise<void> {
    if (this.closed) return;
    if (this.job) return this.job;
    const state = [...this.states.values()].find(candidate => candidate.status === 'waiting' && !this.options.busy(candidate.backend));
    if (!state) return;
    // Synchronous admission lock before the first asynchronous probe.
    state.status = 'upgrading';
    this.job = this.run(state.backend).finally(() => { this.job = undefined; });
    return this.job;
  }

  async settle(): Promise<void> { await this.job; }
  async close(): Promise<void> { this.closed = true; await this.settle(); }

  private observation(backend: AgentBackend): ProviderUpdateStatus {
    return { ...(this.states.get(backend) ?? { backend, status: 'unavailable', method: 'manual', canUpgrade: false }), busy: this.options.busy(backend) };
  }

  private async check(backend: AgentBackend): Promise<ProviderUpdateStatus> {
    try {
      const installation = await this.options.inspect(backend);
      this.installations.set(backend, structuredClone(installation));
      const available = newer(installation.latestVersion, installation.version);
      const comparable = stableVersion(installation.version) && stableVersion(installation.latestVersion);
      this.states.set(backend, {
        backend, method: installation.method, channel: installation.channel,
        installedVersion: installation.version, latestVersion: installation.latestVersion,
        status: !installation.version ? 'unavailable' : !comparable ? 'manual' : available ? 'available' : 'current',
        canUpgrade: available && Boolean(installation.command), busy: false, token: randomUUID(),
      });
      this.checkedAt.set(backend, Date.now());
    } catch {
      this.states.set(backend, { ...this.observation(backend), status: 'error', error: 'checkFailed', canUpgrade: false });
    }
    return this.observation(backend);
  }

  private async run(backend: AgentBackend): Promise<void> {
    const approved = this.installations.get(backend)!;
    const state = this.states.get(backend)!;
    try {
      const fresh = await this.options.inspect(backend);
      if (fresh.identity !== approved.identity || !fresh.command || fresh.latestVersion !== approved.latestVersion) {
        state.status = 'error'; state.error = 'installationChanged'; return;
      }
      if (this.closed || this.options.busy(backend)) { state.status = 'waiting'; return; }
      let verified = false;
      await this.options.withStoppedProvider(backend, async () => {
        await this.options.upgrade(fresh);
        const after = await this.options.inspect(backend);
        verified = Boolean(after.version && after.version === approved.latestVersion);
        if (after.version) state.installedVersion = after.version;
      });
      if (!verified) { state.status = 'error'; state.error = 'verificationFailed'; return; }
      await this.check(backend);
    } catch {
      state.status = 'error'; state.error = 'upgradeFailed';
    }
  }
}

function newer(candidate?: string, installed?: string): boolean {
  if (!stableVersion(candidate) || !stableVersion(installed)) return false;
  const a = candidate.split('.').map(Number), b = installed.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

function stableVersion(value?: string): value is string { return Boolean(value && /^\d+\.\d+\.\d+$/.test(value)); }
