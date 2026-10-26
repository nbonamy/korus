import { companionAdmissionLeaseMs } from '@workspace/core/companion-relay';
import { shareDirectoryCapacity, shareHandlePattern, type ShareRoutingStatus } from '@workspace/core/conversation-share-relay';
import { WindowBudget } from '../companion/source-budget';

/** Routing only: handles and authenticated peers, never a conversation credential. */
export class ShareRelayDirectory {
  private readonly owners = new Map<string, { handles: Set<string>; until: number }>();
  private readonly permissions = new Map<string, { owner: string; guest: string; handle: string; source: string; until: number }>();
  // A full snapshot may decode ~175 KiB: bound renewals by network as well as peer.
  private readonly registrations: WindowBudget;
  private readonly ownerRegistrations: WindowBudget;
  private readonly lookups: WindowBudget;
  private readonly peerLookups: WindowBudget;
  constructor(private readonly now = Date.now) {
    this.registrations = new WindowBudget(60, 60_000, 10_000, now);
    this.ownerRegistrations = new WindowBudget(30, 60_000, 1000, now);
    this.lookups = new WindowBudget(120, 60_000, 10_000, now);
    this.peerLookups = new WindowBudget(30, 60_000, 10_000, now);
  }
  private prune() {
    for (const [owner, entry] of this.owners) if (entry.until <= this.now()) this.owners.delete(owner);
    for (const [key, permission] of this.permissions) {
      if (permission.until <= this.now() || !this.owners.get(permission.owner)?.handles.has(permission.handle)) this.permissions.delete(key);
    }
  }
  /** Owner-scoped replacement. Capacity refusal renews retained routes, rejecting additions. */
  register(owner: string, source: string, handles: string[]): ShareRoutingStatus {
    this.prune();
    if (!this.registrations.take(source) || !this.ownerRegistrations.take(owner)) return 'rateLimited';
    if (handles.some(handle => !shareHandlePattern.test(handle)) || new Set(handles).size !== handles.length) return 'unavailable';
    const others = [...this.owners].reduce((count, [id, entry]) => count + (id === owner ? 0 : entry.handles.size), 0);
    if (others + handles.length > shareDirectoryCapacity) {
      const previous = this.owners.get(owner);
      if (previous) {
        const requested = new Set(handles);
        previous.handles = new Set([...previous.handles].filter(handle => requested.has(handle)));
        previous.until = this.now() + companionAdmissionLeaseMs;
        this.prune();
      }
      return 'capacity';
    }
    if (handles.length) this.owners.set(owner, { handles: new Set(handles), until: this.now() + companionAdmissionLeaseMs });
    else this.owners.delete(owner);
    this.prune();
    return 'ready';
  }
  resolve(guest: string, source: string, owner: string, handle: string): ShareRoutingStatus {
    this.prune();
    if (!this.lookups.take(source) || !this.peerLookups.take(guest)) return 'rateLimited';
    if (!this.owners.get(owner)?.handles.has(handle)) return 'unavailable';
    const key = `${owner}\0${guest}\0${handle}`;
    const previous = this.permissions.get(key);
    if ((!previous && (this.permissions.size >= 10_000
      || [...this.permissions.values()].filter(p => p.owner === owner).length >= 200))
      || (previous?.source !== source && [...this.permissions.values()].filter(p => p.source === source).length >= 200)) return 'capacity';
    this.permissions.set(key, { owner, guest, handle, source, until: this.now() + companionAdmissionLeaseMs });
    return 'ready';
  }
  route(guest: string, owner: string): boolean {
    this.prune();
    return [...this.permissions.values()].some(p => p.guest === guest && p.owner === owner);
  }
}
