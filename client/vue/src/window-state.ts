import { ref } from 'vue';
import type { AppApi } from '@workspace/core/contracts';
import type { ComposerDraft, NativeOwnerEntry, NativeResource } from '@workspace/core/windows';

/**
 * What this window knows about the other windows. Product state (agents, conversations,
 * settings) is replicated from the daemon into every window; this is the little that is
 * about windows themselves: who owns an agent's native views, and what its initial
 * selection was. Without a desktop host there is one implicit window that owns everything.
 */
export type WindowStateHost = {
  api(): AppApi | undefined;
  /** Selects an agent in this window only. */
  showAgent(agentId: string): void;
  agentExists(agentId: string): boolean;
  /** Puts a draft that was edited in another window into this window's composer. */
  applyDraft(agentId: string, draft: ComposerDraft | null): void;
};

export function createWindowState() {
  const windowId = ref<number | null>(null);
  const nativeOwners = ref<NativeOwnerEntry[]>([]);
  let unsubscribe: Array<() => void> = [];
  let reportedAgentId: string | null | undefined;

  /** Reads the window context and follows the other windows from here on. Safe to call again after a reload. */
  async function start(host: WindowStateHost): Promise<void> {
    stop();
    const api = host.api();
    if (!api?.getWindowContext) return;
    const context = await api.getWindowContext();
    windowId.value = context.windowId;
    nativeOwners.value = context.nativeOwners;
    for (const [agentId, draft] of Object.entries(context.composerDrafts)) host.applyDraft(agentId, draft);
    const initialAgentId = context.viewState?.agentId;
    if (initialAgentId && host.agentExists(initialAgentId)) host.showAgent(initialAgentId);
    reportedAgentId = undefined;
    unsubscribe = [
      api.onNativeOwnersChanged?.((owners) => { nativeOwners.value = owners; }),
      api.onComposerDraftChanged?.(({ agentId, draft }) => host.applyDraft(agentId, draft)),
    ].filter((entry): entry is () => void => entry !== undefined);
  }

  function stop(): void {
    for (const release of unsubscribe) release();
    unsubscribe = [];
  }

  /** Tells main which agent this window shows, for the commands and notices that follow the window the user is in. */
  function reportSelection(api: AppApi | undefined, agentId: string | null): void {
    if (!api?.setWindowSelection || reportedAgentId === agentId) return;
    reportedAgentId = agentId;
    void api.setWindowSelection(agentId).catch(() => undefined);
  }

  /** True while no other window holds the agent's native view. */
  function ownsNative(resource: NativeResource, agentId: string): boolean {
    const owner = nativeOwners.value.find((entry) => entry.resource === resource && entry.agentId === agentId);
    return !owner || owner.windowId === windowId.value;
  }

  return { windowId, nativeOwners, start, stop, reportSelection, ownsNative };
}

export const windowState = createWindowState();
