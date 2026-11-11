import type { HarnessProvider } from '@workspace/core/contracts';
import type { ProviderAuthentication, ProviderConnection } from '@workspace/core/contracts/provider-setup';

type ConnectionProbe = { provider: HarnessProvider; installed: boolean; homePath: string };

/** One host's authentication observations; process health is deliberately separate. */
export class ProviderConnections {
  private readonly states = new Map<HarnessProvider, ProviderConnection>();
  private readonly pending = new Map<HarnessProvider, Promise<void>>();
  private readonly revisions = new Map<HarnessProvider, number>();
  private probes?: ConnectionProbe[];
  private disposed = false;

  constructor(private readonly options: {
    detect(): ConnectionProbe[];
    authenticate(provider: HarnessProvider): Promise<ProviderAuthentication>;
    changed(connections: ProviderConnection[]): void;
    enabled?: (provider: HarnessProvider) => boolean;
  }) {}

  list(): ProviderConnection[] {
    return [...this.states.values()].map(state => ({ ...state, enabled: this.options.enabled?.(state.provider) ?? true }));
  }

  async refresh(): Promise<ProviderConnection[]> {
    this.probes ??= this.options.detect();
    await Promise.all(this.probes.map(probe => this.check(probe)));
    return this.list();
  }

  /** Re-checks engines last seen disconnected so a login done outside the app is noticed on the next admission. */
  async refreshDisconnected(provider?: HarnessProvider): Promise<ProviderConnection[]> {
    for (const [candidate, state] of this.states) {
      if ((provider === undefined || candidate === provider) && state.installed && !state.connected && !state.checking) this.states.delete(candidate);
    }
    return await this.refresh();
  }

  /** Refresh auth for admission while retaining the last observation until a result arrives. */
  async recheck(provider: HarnessProvider): Promise<void> {
    this.probes ??= this.options.detect();
    const probe = this.probes.find(candidate => candidate.provider === provider);
    if (probe) await this.check(probe, true);
    const error = this.states.get(provider)?.error;
    if (error) throw new Error(error);
  }

  observe(provider: HarnessProvider, connected: boolean, authentication?: ProviderAuthentication): void {
    this.revisions.set(provider, (this.revisions.get(provider) ?? 0) + 1);
    this.pending.delete(provider);
    this.probes ??= this.options.detect();
    const probe = this.probes.find(candidate => candidate.provider === provider);
    if (!probe) return;
    this.states.set(provider, { provider: provider, installed: probe.installed, connected: probe.installed && connected, checking: false, ...(authentication ? { authentication } : {}) });
    this.publish();
  }

  invalidate(provider: HarnessProvider): void {
    this.revisions.set(provider, (this.revisions.get(provider) ?? 0) + 1);
    this.pending.delete(provider);
    this.probes = undefined;
    this.states.delete(provider);
    this.publish();
  }

  close(): void { this.disposed = true; }

  updateEnabled(): void { this.publish(); }

  private check(probe: ConnectionProbe, force = false): Promise<void> {
    const { provider: backend, installed } = probe;
    const pending = this.pending.get(backend);
    if (pending) return pending;
    if (!force && this.states.has(backend)) return Promise.resolve();
    const revision = this.revisions.get(backend) ?? 0;
    const current = () => !this.disposed && revision === (this.revisions.get(backend) ?? 0);
    const previous = this.states.get(backend);
    this.states.set(backend, { provider: backend, installed, connected: installed && Boolean(previous?.connected), checking: installed,
      ...(previous?.authentication ? { authentication: previous.authentication } : {}) });
    this.publish();
    const work = Promise.resolve().then(async () => {
      try {
        const authentication = installed ? await this.options.authenticate(backend) : undefined;
        if (!current()) return;
        this.states.set(backend, { provider: backend, installed, connected: Boolean(authentication?.connected), checking: false, ...(authentication ? { authentication } : {}) });
      } catch {
        if (!current()) return;
        this.states.set(backend, {
          provider: backend, installed, connected: installed && Boolean(previous?.connected), checking: false,
          ...(previous?.authentication ? { authentication: previous.authentication } : {}),
          error: 'Could not check the engine connection. Retry in Settings.',
        });
      } finally {
        if (current()) {
          this.pending.delete(backend);
          this.publish();
        }
      }
    });
    this.pending.set(backend, work);
    return work;
  }

  private publish(): void { if (!this.disposed) this.options.changed(this.list()); }
}
