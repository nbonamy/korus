import { randomUUID } from 'node:crypto';
import { workActivityState, type LiveActivityRegistration, type LiveActivityPush, type WorkActivityState } from '@workspace/core/companion-live-activity';
import type { CompanionWorkspace } from '@workspace/core/companion-protocol';
import type { PushResult } from './apns';

type SavedActivity = { start?: LiveActivityRegistration; update?: LiveActivityRegistration; instanceId?: string; startedAt?: number;
  state?: WorkActivityState; timestamp?: number; sentAt?: number; dismissed?: boolean; accepted?: boolean };
export type SavedLiveActivities = Record<string, SavedActivity>;
type Port = { hostId: string; hostName?: string; initial?: SavedLiveActivities; authorized(peerId: string): boolean;
  workspace(): Promise<CompanionWorkspace>; save(state: SavedLiveActivities): Promise<void>;
  push(peerId: string, registration: LiveActivityRegistration, activity: LiveActivityPush): Promise<PushResult>; now?: () => number };

/** One durable activity per paired phone. No transcript data, sockets, or unbounded event queue. */
export class CompanionLiveActivities {
  private state: SavedLiveActivities;
  private work = Promise.resolve();
  private refreshing?: Promise<void>;
  private readonly now: () => number;
  constructor(private readonly port: Port) { this.state = structuredClone(port.initial ?? {}); this.now = port.now ?? Date.now; }
  private enqueue(operation: () => Promise<void>) {
    const work = this.work.then(operation); this.work = work.catch(() => {}); return work;
  }
  register(peerId: string, registration: LiveActivityRegistration | null): Promise<void> {
    return this.enqueue(async () => {
      if (!this.port.authorized(peerId)) throw new Error('Device is not authorized.');
      const current = this.state[peerId] ?? {};
      if (!registration) {
        if (current.update && current.instanceId) await this.send(peerId, current, current.update, 'end', { running: 0, attention: 0, agents: [], more: 0 });
        const next = { ...this.state }; delete next[peerId]; await this.save(next); return;
      }
      if (registration.kind === 'update' && registration.instanceId !== current.instanceId) throw new Error('Activity changed.');
      // An app update can remove the native activity after Apple accepted its
      // start. Recover only on a renewed registration after the stale window;
      // never retry automatically or replace a live update-token instance.
      const orphaned = registration.kind === 'start' && current.accepted && !current.update && !current.dismissed
        && this.now() - (current.sentAt ?? this.now()) >= 900_000;
      const next = orphaned ? { start: registration } : { ...current, [registration.kind]: registration };
      // A token rotation must send the current state even if the counts have not changed.
      if (registration.kind === 'update') delete next.sentAt;
      await this.save({ ...this.state, [peerId]: next });
      await this.update(peerId);
    });
  }
  refresh() {
    return this.refreshing ??= this.enqueue(() => this.update()).finally(() => { this.refreshing = undefined; });
  }
  private async save(state: SavedLiveActivities) {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return;
    await this.port.save(state); this.state = structuredClone(state);
  }
  private async update(registeredPeer?: string) {
    if (!Object.keys(this.state).length) return;
    const workspace = await this.port.workspace();
    for (const [peerId, saved] of Object.entries(this.state)) {
      if (registeredPeer && peerId !== registeredPeer) continue;
      if (!this.port.authorized(peerId)) { const next = { ...this.state }; delete next[peerId]; await this.save(next); continue; }
      const state = { ...workActivityState(workspace, saved.state, this.now()),
        ...(this.port.hostName ? { hostName: this.port.hostName.slice(0, 160) } : {}) };
      const busy = state.running + state.attention > 0;
      let current = { ...saved };
      if (!busy && current.dismissed) current = { start: current.start };
      // ActivityKit stops updates after eight hours; never keep an expired update token alive.
      if (current.startedAt && this.now() - current.startedAt >= 8 * 3600_000) current = { start: current.start };
      const starting = !current.instanceId && busy && Boolean(current.start);
      if (starting) {
        current = { ...current, instanceId: randomUUID(), startedAt: this.now() };
        // Persist BEFORE sending. An ambiguous APNs timeout must not start a second activity.
        await this.save({ ...this.state, [peerId]: current });
      }
      let unavailable = false;
      if (busy && current.start && current.instanceId && !current.update && !current.accepted
        && (registeredPeer === peerId || starting)) {
        const result = await this.send(peerId, current, current.start, 'start', state);
        current.accepted = result === 'sent'; unavailable = result !== 'sent';
      } else if (current.update && current.instanceId && (!busy || JSON.stringify(current.state) !== JSON.stringify(state)
        || this.now() - (current.sentAt ?? 0) >= 600_000)) {
        const result = await this.send(peerId, current, current.update, busy ? 'update' : 'end', state);
        unavailable = result === 'unavailable';
        if (result === 'sent' && !busy) current = { start: current.start };
        // A dismissed activity must not be recreated repeatedly during the same work cycle.
        else if (result === 'invalid') { delete current.update; current.dismissed = true; if (!busy) current = { start: current.start }; }
      }
      await this.save({ ...this.state, [peerId]: current });
      if (unavailable && registeredPeer) throw new Error('Live Activity delivery is unavailable.');
    }
  }
  private async send(peerId: string, current: SavedActivity, registration: LiveActivityRegistration, event: LiveActivityPush['event'], state: WorkActivityState) {
    if (!this.port.authorized(peerId)) return 'unavailable';
    const timestamp = Math.max(Math.floor(this.now() / 1000), (current.timestamp ?? 0) + 1);
    const result = await this.port.push(peerId, registration, { hostId: this.port.hostId, instanceId: current.instanceId!, startedAt: current.startedAt!, timestamp, event, state }).catch(() => 'unavailable' as const);
    if (result === 'sent') { current.state = state; current.timestamp = timestamp; current.sentAt = this.now(); }
    return result;
  }
}
