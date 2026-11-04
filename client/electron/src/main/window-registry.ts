import { isEmptyComposerDraft, type ComposerDraft, type NativeOwnerEntry, type NativeResource, type WindowScope, type WindowSetup, type WindowViewState } from '@workspace/core/windows';

export type ManagedWindow = {
  readonly id: number;
  isDestroyed(): boolean;
  isFocused(): boolean;
};

type Entry<W extends ManagedWindow> = {
  window: W;
  ready: boolean;
  scope: WindowScope;
  setup: WindowSetup | null;
  selectedAgentId: string | null;
  viewState: WindowViewState | null;
};

type Ownership<W extends ManagedWindow> = { window: W; claims: number };

export type NativeClaimResult<W extends ManagedWindow> = { granted: boolean; displaced?: W };

/**
 * Everything Electron main knows about its windows: which exist and are ready, which
 * was focused last, what each one has selected, and who owns the per-agent native
 * views. The daemon stays the source of truth for product state; this only holds
 * what is specific to a window.
 */
export class WindowRegistry<W extends ManagedWindow> {
  /** Oldest first; focus moves a window to the end. */
  private readonly entries: Entry<W>[] = [];
  private readonly owners = new Map<string, Ownership<W>>();
  private readonly drafts = new Map<string, ComposerDraft>();

  add(window: W, viewState: WindowViewState | null = null): void {
    if (this.entryOf(window)) return;
    this.entries.push({ window, ready: false, scope: viewState?.scope ?? 'workspace', setup: viewState?.setup ?? null, selectedAgentId: viewState?.agentId ?? null, viewState });
  }

  /** Forgets the window and returns the native views it owned. */
  remove(window: W): NativeOwnerEntry[] {
    const index = this.entries.findIndex(entry => entry.window === window);
    if (index >= 0) this.entries.splice(index, 1);
    const released: NativeOwnerEntry[] = [];
    for (const [key, ownership] of this.owners) {
      if (ownership.window !== window) continue;
      this.owners.delete(key);
      released.push(parseOwnerKey(key, window.id));
    }
    return released;
  }

  /** Windows that can still receive events. */
  live(): W[] {
    return this.entries.filter(entry => !entry.window.isDestroyed()).map(entry => entry.window);
  }

  has(window: W): boolean {
    return this.entryOf(window) !== undefined;
  }

  byId(id: number): W | undefined {
    return this.live().find(window => window.id === id);
  }

  markFocused(window: W): void {
    const index = this.entries.findIndex(entry => entry.window === window);
    if (index < 0) return;
    this.entries.push(...this.entries.splice(index, 1));
  }

  /** The window commands without an explicit target go to: focused, else last focused, else any. */
  focused(): W | undefined {
    const live = this.live();
    return live.find(window => window.isFocused()) ?? live[live.length - 1];
  }

  anyFocused(): boolean {
    return this.live().some(window => window.isFocused());
  }

  setReady(window: W, ready: boolean): void {
    const entry = this.entryOf(window);
    if (entry) entry.ready = ready;
  }

  isReady(window: W): boolean {
    return this.entryOf(window)?.ready === true;
  }

  readyWindows(): W[] {
    return this.live().filter(window => this.isReady(window));
  }

  /** The state to open this window with again: its initial state, following what it has selected since. */
  viewStateOf(window: W): WindowViewState | null {
    const entry = this.entryOf(window);
    if (!entry) return null;
    const { setup: _initialSetup, ...rest } = entry.viewState ?? {};
    const state: WindowViewState = { ...rest, ...(entry.selectedAgentId ? { agentId: entry.selectedAgentId } : {}), ...(entry.setup && Object.keys(entry.setup).length ? { setup: entry.setup } : {}) };
    return Object.keys(state).length ? state : null;
  }

  /** What the window last said it has open: its own, drifting from the setup it started with. */
  setupOf(window: W): WindowSetup | null {
    return this.entryOf(window)?.setup ?? null;
  }

  setSetup(window: W, setup: WindowSetup): void {
    const entry = this.entryOf(window);
    if (entry) entry.setup = setup;
  }

  scopeOf(window: W): WindowScope {
    return this.entryOf(window)?.scope ?? 'workspace';
  }

  /** The window that shows the whole workspace: the focused one, else the one last focused. */
  focusedWorkspace(): W | undefined {
    const workspaces = this.live().filter(window => this.scopeOf(window) === 'workspace');
    return workspaces.find(window => window.isFocused()) ?? workspaces[workspaces.length - 1];
  }

  setSelectedAgent(window: W, agentId: string | null): void {
    const entry = this.entryOf(window);
    if (entry) entry.selectedAgentId = agentId;
  }

  selectedAgentOf(window: W | undefined): string | null {
    return window ? this.entryOf(window)?.selectedAgentId ?? null : null;
  }

  selectedAgentIds(): Set<string> {
    const ids = new Set<string>();
    for (const window of this.live()) {
      const agentId = this.selectedAgentOf(window);
      if (agentId) ids.add(agentId);
    }
    return ids;
  }

  /**
   * Claims count per window: several panels of one agent can share a claim, and the
   * view goes free only when the last one lets go. Without `takeOver`, a view owned
   * by another live window is refused.
   */
  claim(window: W, resource: NativeResource, agentId: string, takeOver = false): NativeClaimResult<W> {
    const key = ownerKey(resource, agentId);
    const current = this.owners.get(key);
    if (current && current.window === window) {
      current.claims += 1;
      return { granted: true };
    }
    if (current && !current.window.isDestroyed() && !takeOver) return { granted: false };
    this.owners.set(key, { window, claims: 1 });
    return { granted: true, ...(current && !current.window.isDestroyed() ? { displaced: current.window } : {}) };
  }

  /** Returns true when the window gave up ownership. */
  release(window: W, resource: NativeResource, agentId: string): boolean {
    const key = ownerKey(resource, agentId);
    const current = this.owners.get(key);
    if (!current || current.window !== window) return false;
    current.claims -= 1;
    if (current.claims > 0) return false;
    this.owners.delete(key);
    return true;
  }

  ownerOf(resource: NativeResource, agentId: string): W | undefined {
    const owner = this.owners.get(ownerKey(resource, agentId))?.window;
    return owner && !owner.isDestroyed() ? owner : undefined;
  }

  nativeOwners(): NativeOwnerEntry[] {
    return [...this.owners].filter(([, ownership]) => !ownership.window.isDestroyed())
      .map(([key, ownership]) => parseOwnerKey(key, ownership.window.id));
  }

  /** One draft per agent; an emptied composer drops its draft so nothing lingers after a send. */
  setDraft(agentId: string, draft: ComposerDraft | null): void {
    if (!draft || isEmptyComposerDraft(draft)) this.drafts.delete(agentId);
    else this.drafts.set(agentId, draft);
  }

  composerDrafts(): Record<string, ComposerDraft> {
    return Object.fromEntries(this.drafts);
  }

  private entryOf(window: W): Entry<W> | undefined {
    return this.entries.find(entry => entry.window === window);
  }
}

function ownerKey(resource: NativeResource, agentId: string): string {
  return `${resource}:${agentId}`;
}

function parseOwnerKey(key: string, windowId: number): NativeOwnerEntry {
  const separator = key.indexOf(':');
  return { resource: key.slice(0, separator) as NativeResource, agentId: key.slice(separator + 1), windowId };
}
