import { ref, shallowRef } from 'vue';
import { matchingBranchUpstream } from '@workspace/core/git-remote';
import type { CompanionCloseOptions, CompanionClosePreview, CompanionTarget } from '@workspace/core/companion-protocol';
import type { CompanionSession } from './companion-port';
import { sameTarget } from './companion-target';

/**
 * What the person can do to the chat they are looking at: rename, interrupt, restart or close it. One action runs at
 * a time, and its result is dropped if the connection or the selected chat changed while the laptop worked.
 */
export function createSessionActions(deps: {
  session(): CompanionSession | null;
  connected(): boolean;
  conversationReady(): boolean;
  agentId(): string;
  /** Changes whenever another chat is selected or the connection is replaced. */
  selection(): number;
  currentTarget(): CompanionTarget | null;
  /** Reads the laptop's workspace; false if the session changed meanwhile. */
  refreshWorkspace(active: CompanionSession): Promise<boolean>;
  /** Shows a chat from scratch: after a restart, or once the chat is gone (an empty id). */
  reopen(agentId: string): Promise<void>;
}) {
  const action = ref<'interrupt' | 'restart' | 'close' | 'previewClose' | 'rename' | null>(null);
  const failed = ref(false);
  const closePreview = shallowRef<CompanionClosePreview | null>(null);

  async function rename(target: CompanionTarget, value: string) {
    const active = deps.session(); const epoch = deps.selection(); const current = deps.currentTarget(); const name = value.trim();
    if (!active || !deps.connected() || action.value || !name || name.length > 200 || !current || !sameTarget(current, target)) return;
    action.value = 'rename'; failed.value = false;
    try {
      if (!active.renameAgent) throw new Error('Agent renaming is unavailable.');
      await active.renameAgent(target, name);
      await deps.refreshWorkspace(active);
    } catch {
      if (active === deps.session() && epoch === deps.selection()) failed.value = true;
    } finally { action.value = null; }
  }

  async function control(kind: 'interrupt' | 'restart' | 'close', input?: CompanionCloseOptions) {
    const id = deps.agentId(); const active = deps.session(); const epoch = deps.selection();
    if (!id || !active || !deps.connected() || !deps.conversationReady() || action.value) return;
    const preview = closePreview.value;
    if (kind === 'close' && preview?.target.agentId !== id) return;
    action.value = kind; failed.value = false;
    try {
      if (kind === 'close' && active.closeSession && preview) await active.closeSession(preview.target, input);
      else if (kind === 'restart' && active.restartSession) await active.restartSession(id);
      else if (kind === 'interrupt' && active.interrupt) await active.interrupt(id);
      else throw new Error('Session action unavailable.');
      if (!(await deps.refreshWorkspace(active)) || epoch !== deps.selection()) return;
      if (kind !== 'interrupt') await deps.reopen(kind === 'restart' ? id : '');
    } catch {
      if (active === deps.session() && epoch === deps.selection()) failed.value = true;
    } finally { action.value = null; }
  }

  async function requestClose() {
    const id = deps.agentId(); const active = deps.session(); const epoch = deps.selection();
    if (!id || !active || !deps.connected() || action.value) return;
    action.value = 'previewClose'; failed.value = false;
    closePreview.value = null;
    try {
      if (!active.previewCloseSession) throw new Error('Close preview unavailable.');
      const preview = await active.previewCloseSession(id);
      if (epoch !== deps.selection() || active !== deps.session()) return;
      closePreview.value = { ...preview, upstream: matchingBranchUpstream(preview.branch, preview.upstream) ?? null };
    } catch {
      if (epoch === deps.selection() && active === deps.session()) failed.value = true;
    } finally { action.value = null; }
    if (closePreview.value && !closePreview.value.isLinkedWorktree) await control('close');
  }

  async function confirmClose(id: string, deleteWorktree: boolean, deleteRemoteBranch = false, discardChanges = false) {
    const preview = closePreview.value;
    if (!preview || preview.target.agentId !== id || id !== deps.agentId()) return;
    if (deleteWorktree && (!preview.isLinkedWorktree || (preview.hasChanges && !discardChanges))) return;
    await control('close', deleteWorktree ? { deleteWorktree: true, deleteRemoteBranch: deleteRemoteBranch && Boolean(preview.upstream), discardChanges, confirmed: true } : undefined);
  }

  return {
    action, failed, closePreview, rename, requestClose, confirmClose,
    interrupt: () => control('interrupt'),
    restart: () => control('restart'),
    cancelClose() { if (!action.value) { closePreview.value = null; failed.value = false; } },
    dismissError() { failed.value = false; },
    /** The selection or connection changed: nothing pending applies to the new one. */
    reset() { closePreview.value = null; failed.value = false; },
  };
}
