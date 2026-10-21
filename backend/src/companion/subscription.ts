import type { CompanionSync } from '@workspace/core/companion-journal';
import type { CompanionNotification } from '@workspace/core/companion-notification';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { ProviderConversationFrame } from '@workspace/core/contracts';
import { companionTarget, type CompanionReset, type CompanionTarget, type CompanionUpdate, type CompanionWorkspace } from '@workspace/core/companion-protocol';
import { warnMain } from '../log';

export type SubscriptionPort = {
  onClose?(): void;
  onNotification?(listener: (notification: CompanionNotification) => void): () => void;
  request(method: string, args: unknown): Promise<unknown>;
  onEvent(listener: (event: AppBackendEvent) => void): () => void;
  authorized(): boolean;
};
type Watched = { target: CompanionTarget; revision: number; pending: boolean; buffered: ProviderConversationFrame[] };
const cleanFrame = (event: ProviderConversationFrame): ProviderConversationFrame => {
  const { type, agentId, backend, threadId, backendSessionId, conversationId, turnId, seq, occurredAt, payload } = event;
  return { type, agentId, backend, threadId, backendSessionId, conversationId, turnId, seq, occurredAt, payload } as ProviderConversationFrame;
};
const isConversation = (event: AppBackendEvent): event is ProviderConversationFrame =>
  /^(codex|claude|antigravity)\.conversation(SnapshotChanged|EventReceived)$/.test(event.type);

/** One phone's scoped subscriptions; provider payloads pass through unchanged. */
export class CompanionSubscription {
  private readonly watched = new Map<string, Watched>();
  private readonly unlisten: () => void;
  private readonly unlistenNotifications: () => void;
  private closed = false;
  private notificationsEnabled = false;
  private lastRequestAt = 0;
  get foreground() { return !this.closed && this.port.authorized() && this.notificationsEnabled && this.now() - this.lastRequestAt < 45_000; }
  private workspace: CompanionWorkspace | undefined;
  private workspaceJSON = '';
  private iconsVersion = '';
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshing = false;
  private dirty = false;
  constructor(private readonly port: SubscriptionPort, private readonly emit: (update: CompanionUpdate) => void, private readonly fail: () => void, private readonly now = Date.now) {
    this.unlistenNotifications = port.onNotification?.(notification => {
      if (!this.closed && this.notificationsEnabled && port.authorized()) this.emit({ type: 'notification', notification });
    }) ?? (() => {});
    this.unlisten = port.onEvent((event) => {
      if (this.closed) return;
      if (!port.authorized()) { this.close(); fail(); return; }
      if (isConversation(event)) {
        const entry = this.watched.get(event.agentId);
        if (!entry) return;
        // Never include the daemon's app snapshot/clientState on the mobile stream.
        const frame = cleanFrame(event);
        if (entry.pending) {
          if (entry.buffered.length >= 256) { warnMain('companion', 'subscription failed', { reason: 'conversation-buffer-limit', agentId: event.agentId }); this.close(); fail(); return; }
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
    if (!this.watched.has(target.agentId) && this.watched.size >= 64) throw new Error('Too many subscriptions.');
    const entry: Watched = { target, revision: -1, pending: true, buffered: [] };
    this.watched.set(target.agentId, entry);
    try {
      // Listen before reading. Events newer than the reset are flushed after it.
      const result = await this.port.request(method, args);
      const sync = method === 'conversation.synchronize' ? result as CompanionSync : null;
      const frames = sync?.frames ?? [result as CompanionReset];
      if (this.closed || !this.port.authorized() || this.watched.get(target.agentId) !== entry) throw new Error('Subscription changed.');
      for (const frame of frames) this.emit({ type: 'conversation', frame: cleanFrame(frame) });
      entry.revision = sync?.checkpoint.revision ?? frames[0]!.payload.revision;
      entry.pending = false;
      for (const buffered of entry.buffered) this.deliver(entry, buffered);
      entry.buffered = [];
      return sync ? { checkpoint: sync.checkpoint } : {};
    } catch (error) {
      if (this.watched.get(target.agentId) === entry) this.watched.delete(target.agentId);
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.refreshTimer); this.unlisten(); this.unlistenNotifications(); this.watched.clear(); this.port.onClose?.();
  }
  private deliver(entry: Watched, frame: ProviderConversationFrame) {
    if (this.closed || !this.port.authorized()) return;
    const agent = this.workspace?.agents.find((agent) => agent.id === frame.agentId);
    if (!agent || agent.backend !== frame.backend) return;
    if (frame.backend === 'codex' && agent.backendSession?.kind === 'codex' && frame.threadId !== agent.backendSession.threadId) { this.refreshSoon(); return; }
    if (frame.payload.revision <= entry.revision) return;
    entry.revision = frame.payload.revision;
    this.emit({ type: 'conversation', frame });
  }
  private acceptWorkspace(next: CompanionWorkspace) {
    if (this.closed || !this.port.authorized()) return;
    const versioned = next as CompanionWorkspace & { iconsVersion?: string };
    if (versioned.iconsVersion) this.iconsVersion = versioned.iconsVersion;
    const combined = { ...next, repositoryIcons: next.repositoryIcons ?? this.workspace?.repositoryIcons };
    this.workspace = combined;
    for (const [id, entry] of this.watched) {
      const agent = next.agents.find((agent) => agent.id === id);
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
