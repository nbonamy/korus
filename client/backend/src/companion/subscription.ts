import type { CompanionConversationSync } from '@workspace/core/companion-journal';
import type { CompanionNotification } from '@workspace/core/companion-notification';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import {
  companionAgents, companionConversationFrame, companionFrameRevision, companionIdleTimeoutMs, companionTarget, followsCompanionConversation, isCompanionConversationFrame, sameCompanionStream,
  type CompanionConversation, type CompanionConversationFrame, type CompanionTarget, type CompanionUpdate, type CompanionWorkspace,
} from '@workspace/core/companion-protocol';
import { warnMain } from '../log';

export type SubscriptionPort = {
  onClose?(): void;
  onNotification?(listener: (notification: CompanionNotification) => void): () => void;
  request(method: string, args: unknown): Promise<unknown>;
  onEvent(listener: (event: AppBackendEvent) => void): () => void;
  authorized(): boolean;
};
/** Live frames held while a catch-up reads; past this the catch-up fails instead of the whole stream. */
const maxBufferedFrames = 256;
const maxWatched = 64;
/** `last` is the latest frame the phone has, so a late one from its stream is not sent again. */
type Watched = { target: CompanionTarget; last: CompanionConversationFrame | null; revision: number; pending: boolean; overflowed: boolean; buffered: CompanionConversationFrame[] };
const isConversation = (event: AppBackendEvent): event is AppBackendEvent & CompanionConversationFrame => isCompanionConversationFrame(event);

/** One phone's scoped subscriptions; neutral session frames pass through unchanged. */
export class CompanionSubscription {
  private readonly watched = new Map<string, Watched>();
  private readonly unlisten: () => void;
  private readonly unlistenNotifications: () => void;
  private closed = false;
  private notificationsEnabled = false;
  private lastRequestAt = 0;
  get foreground() { return !this.closed && this.port.authorized() && this.notificationsEnabled && this.now() - this.lastRequestAt < companionIdleTimeoutMs; }
  private workspace: CompanionWorkspace | undefined;
  private workspaceJSON = '';
  private iconsVersion = '';
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshing = false;
  private dirty = false;
  constructor(private readonly port: SubscriptionPort, private readonly emit: (update: CompanionUpdate) => void | Promise<void>, private readonly fail: () => void, private readonly now = Date.now) {
    this.unlistenNotifications = port.onNotification?.(notification => {
      if (!this.closed && (this.notificationsEnabled || notification.kind === 'read') && port.authorized()) this.emit({ type: 'notification', notification });
    }) ?? (() => {});
    this.unlisten = port.onEvent((event) => {
      if (this.closed) return;
      if (!port.authorized()) { this.close(); fail(); return; }
      if (isConversation(event)) {
        const entry = this.watched.get(event.agentId);
        if (!entry) return;
        // Never include the daemon's app snapshot/clientState on the mobile stream.
        const frame = companionConversationFrame(event as CompanionConversationFrame);
        if (entry.pending) {
          if (entry.overflowed) return;
          if (entry.buffered.length >= maxBufferedFrames) {
            // The conversation moved faster than the catch-up could read it: the phone retries from a fresh read.
            warnMain('companion', 'catch-up overflowed', { agentId: event.agentId });
            entry.overflowed = true; entry.buffered = [];
            return;
          }
          entry.buffered.push(frame);
        } else this.deliver(entry, frame);
      } else if (event.type !== 'conversation.contextUsageUpdated'
        && event.type !== 'conversation.turnDiffUpdated'
        && event.type !== 'workspace.fileActivityDetected') {
        // These high-frequency projections have no fields in the companion workspace.
        // The subscribed provider stream already carries the conversation's content.
        this.refreshSoon();
      }
    });
  }
  async request(method: string, args: unknown): Promise<unknown> {
    if (this.closed || !this.port.authorized()) throw new Error('Subscription closed.');
    this.lastRequestAt = this.now();
    if (method === 'ping') return {};
    if (method === 'snapshot.get') {
      const result = await this.port.request(method, args) as CompanionWorkspace;
      this.notificationsEnabled = (args as { notifications?: boolean })?.notifications === true;
      this.acceptWorkspace(result);
      return result;
    }
    if (method === 'conversation.unsubscribe') {
      // A late unsubscribe must not remove a replacement session for the same agent.
      const target = args as CompanionTarget;
      if (!target || typeof target.agentId !== 'string') throw new Error('Invalid target.');
      const entry = this.watched.get(target.agentId);
      if (entry && JSON.stringify(entry.target) === JSON.stringify(target)) this.watched.delete(target.agentId);
      return {};
    }
    if (method !== 'conversation.subscribe' && method !== 'conversation.synchronize') throw new Error('Unsupported subscription operation.');
    const target = (method === 'conversation.synchronize' ? (args as { target: CompanionTarget })?.target : args) as CompanionTarget;
    if (!target || typeof target.agentId !== 'string') throw new Error('Invalid target.');
    if (!this.watched.has(target.agentId) && this.watched.size >= maxWatched) throw new Error('Too many subscriptions.');
    const entry: Watched = { target, last: null, revision: -1, pending: true, overflowed: false, buffered: [] };
    this.watched.set(target.agentId, entry);
    try {
      // Listen before reading. Events newer than the reset are flushed after it.
      const result = await this.port.request(method, args);
      const sync = method === 'conversation.synchronize' ? result as CompanionConversationSync : null;
      const frames = sync?.frames ?? [result as CompanionConversation];
      this.assertCurrent(entry);
      // The stream's writer drains asynchronously. A long replay waits on it instead of
      // queueing every frame at once, and live frames stay buffered until it has finished.
      for (const frame of frames) {
        await this.emit({ type: 'conversation', frame: companionConversationFrame(frame) });
        this.assertCurrent(entry);
      }
      entry.last = frames.at(-1) ?? null;
      entry.revision = sync?.checkpoint.revision ?? companionFrameRevision(frames[0]!);
      while (entry.buffered.length) {
        await this.deliver(entry, entry.buffered.shift()!);
        this.assertCurrent(entry);
      }
      if (entry.overflowed) throw new Error('Conversation changed faster than the catch-up.');
      entry.pending = false;
      return sync ? { checkpoint: sync.checkpoint } : {};
    } catch (error) {
      if (this.watched.get(target.agentId) === entry) this.watched.delete(target.agentId);
      throw error;
    }
  }
  private assertCurrent(entry: Watched) {
    if (this.closed || !this.port.authorized() || this.watched.get(entry.target.agentId) !== entry) throw new Error('Subscription changed.');
  }
  close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.refreshTimer); this.unlisten(); this.unlistenNotifications(); this.watched.clear(); this.port.onClose?.();
  }
  /**
   * A frame of another conversation waits for the workspace to name it. Within the stream the phone has, older frames
   * are dropped; a snapshot of a new stream always goes, and so does a patch of another stream, which tells the phone to reload.
   */
  private deliver(entry: Watched, frame: CompanionConversationFrame): void | Promise<void> {
    if (this.closed || !this.port.authorized()) return;
    const agent = this.workspace && companionAgents(this.workspace).find((agent) => agent.id === frame.agentId);
    if (!agent) return;
    if (!followsCompanionConversation(frame, agent)) { if (agent.provider === frame.provider) this.refreshSoon(); return; }
    const revision = companionFrameRevision(frame);
    const same = !entry.last || sameCompanionStream(entry.last, frame);
    if (same && (frame.type === 'conversation.sessionSnapshot' ? revision < entry.revision : revision <= entry.revision)) return;
    entry.last = frame; entry.revision = revision;
    return this.emit({ type: 'conversation', frame });
  }
  private acceptWorkspace(next: CompanionWorkspace) {
    if (this.closed || !this.port.authorized()) return;
    const versioned = next as CompanionWorkspace & { iconsVersion?: string };
    if (versioned.iconsVersion) this.iconsVersion = versioned.iconsVersion;
    const combined = { ...next, repositoryIcons: next.repositoryIcons ?? this.workspace?.repositoryIcons };
    this.workspace = combined;
    for (const [id, entry] of this.watched) {
      const agent = companionAgents(next).find((agent) => agent.id === id);
      const team = next.teams.find((team) => team.id === agent?.teamId);
      if (!agent || !team || JSON.stringify(companionTarget(entry.target.hostId, team, agent)) !== JSON.stringify(entry.target)) this.watched.delete(id);
    }
    const serialized = JSON.stringify(combined);
    if (serialized !== this.workspaceJSON) { this.workspaceJSON = serialized; this.emit({ type: 'workspace', workspace: next }); }
  }
  private refreshSoon() {
    this.dirty = true;
    if (this.refreshTimer || this.refreshing || this.closed) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined; this.refreshing = true; this.dirty = false;
      void this.port.request('snapshot.get', { iconsVersion: this.iconsVersion, notifications: this.notificationsEnabled }).then((next) => this.acceptWorkspace(next as CompanionWorkspace))
        .catch(() => { warnMain('companion', 'subscription failed', { reason: 'workspace-refresh' }); this.close(); this.fail(); })
        .finally(() => { this.refreshing = false; if (this.dirty) this.refreshSoon(); });
    }, 50);
  }
}
