import type { AgentBackend } from '@workspace/core/contracts';
import type { ProviderAuthentication, ProviderConnection } from '@workspace/core/contracts/provider-setup';

type ConnectionProbe = { backend: AgentBackend; installed: boolean; homePath: string };

/** One host's authentication observations; process health is deliberately separate. */
export class ProviderConnections {
  private readonly states = new Map<AgentBackend, ProviderConnection>();
  private readonly pending = new Map<AgentBackend, Promise<void>>();
  private readonly revisions = new Map<AgentBackend, number>();
  private probes?: ConnectionProbe[];
  private disposed = false;

  constructor(private readonly options: {
    detect(): ConnectionProbe[];
    authenticate(backend: AgentBackend): Promise<ProviderAuthentication>;
    changed(connections: ProviderConnection[]): void;
    enabled?: (backend: AgentBackend) => boolean;
  }) {}

  list(): ProviderConnection[] {
    return [...this.states.values()].map(state => ({ ...state, enabled: this.options.enabled?.(state.backend) ?? true }));
  }

  async refresh(): Promise<ProviderConnection[]> {
    this.probes ??= this.options.detect();
    await Promise.all(this.probes.map(probe => this.check(probe)));
    return this.list();
  }

  /** Re-checks engines last seen disconnected so a login done outside the app is noticed on the next admission. */
  async refreshDisconnected(backend?: AgentBackend): Promise<ProviderConnection[]> {
    for (const [candidate, state] of this.states) {
      if ((backend === undefined || candidate === backend) && state.installed && !state.connected && !state.checking) this.states.delete(candidate);
    }
    return await this.refresh();
  }

  observe(backend: AgentBackend, connected: boolean, authentication?: ProviderAuthentication): void {
    this.revisions.set(backend, (this.revisions.get(backend) ?? 0) + 1);
    this.pending.delete(backend);
    this.probes ??= this.options.detect();
    const probe = this.probes.find(candidate => candidate.backend === backend);
    if (!probe) return;
    this.states.set(backend, { backend, installed: probe.installed, connected: probe.installed && connected, checking: false, ...(authentication ? { authentication } : {}) });
    this.publish();
  }

  invalidate(backend: AgentBackend): void {
    this.revisions.set(backend, (this.revisions.get(backend) ?? 0) + 1);
    this.pending.delete(backend);
    this.probes = undefined;
    this.states.delete(backend);
    this.publish();
  }

  close(): void { this.disposed = true; }

  updateEnabled(): void { this.publish(); }

  private check(probe: ConnectionProbe): Promise<void> {
    const { backend, installed } = probe;
    const pending = this.pending.get(backend);
    if (pending) return pending;
    if (this.states.has(backend)) return Promise.resolve();
    const revision = this.revisions.get(backend) ?? 0;
    const current = () => !this.disposed && revision === (this.revisions.get(backend) ?? 0);
    const previous = this.states.get(backend);
    this.states.set(backend, { backend, installed, connected: installed && Boolean(previous?.connected), checking: installed });
    this.publish();
    const work = Promise.resolve().then(async () => {
      try {
        const authentication = installed ? await this.options.authenticate(backend) : undefined;
        if (!current()) return;
        this.states.set(backend, { backend, installed, connected: Boolean(authentication?.connected), checking: false, ...(authentication ? { authentication } : {}) });
      } catch {
        if (!current()) return;
        this.states.set(backend, {
          backend, installed, connected: installed && Boolean(previous?.connected), checking: false,
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
