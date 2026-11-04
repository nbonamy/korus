import { ref } from 'vue';
import type { AppApi } from '@workspace/core/contracts';
import type { ComposerDraft, NativeOwnerEntry, NativeResource, WindowScope, WindowSetup } from '@workspace/core/windows';

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
  /** Selects a team in this window only. */
  showTeam(teamId: string): void;
  teamExists(teamId: string): boolean;
  /** Puts a draft that was edited in another window into this window's composer. */
  applyDraft(agentId: string, draft: ComposerDraft | null): void;
};

export function createWindowState() {
  const windowId = ref<number | null>(null);
  const nativeOwners = ref<NativeOwnerEntry[]>([]);
  const scope = ref<WindowScope>('workspace');
  /** The team a team or feature window is about; it stays selected whatever the other windows do. */
  const teamId = ref<string | null>(null);
  /** The agent an agent window is about. */
  const agentId = ref<string | null>(null);
  /** The Git branch a feature window is about. Its agents are worked out from what the team has on it, so new ones appear. */
  const branch = ref<string | null>(null);
  const missionId = ref<string | null>(null);
  /** `replace` is a window starting from its saved panes; `patch` is panes handed over later, such as a Browser moved here. */
  type SetupMode = 'replace' | 'patch';
  const setupListeners = new Set<(setup: WindowSetup, mode: SetupMode) => void>();
  // The starting panes go to the first window shell that is listening, once, so a shell that remounts never resets itself.
  let initialSetupPending: WindowSetup | null = null;
  let initialSetupSeen = false;
  let unsubscribe: Array<() => void> = [];
  let reportedAgentId: string | null | undefined;
  // Main learns this window's selection only after the initial view state was applied, or it would overwrite it.
  let started = false;

  /** Reads the window context and follows the other windows from here on. Safe to call again after a reload. */
  async function start(host: WindowStateHost): Promise<void> {
    stop();
    const api = host.api();
    if (!api?.getWindowContext) return;
    const context = await api.getWindowContext();
    windowId.value = context.windowId;
    nativeOwners.value = context.nativeOwners;
    scope.value = context.viewState?.scope ?? 'workspace';
    teamId.value = scope.value === 'team' || scope.value === 'feature' || scope.value === 'mission' ? context.viewState?.teamId ?? null : null;
    agentId.value = scope.value === 'agent' ? context.viewState?.agentId ?? null : null;
    branch.value = scope.value === 'feature' ? context.viewState?.branch ?? null : null;
    missionId.value = scope.value === 'mission' ? context.viewState?.missionId ?? null : null;
    for (const [agentId, draft] of Object.entries(context.composerDrafts)) host.applyDraft(agentId, draft);
    if (teamId.value && host.teamExists(teamId.value)) host.showTeam(teamId.value);
    const initialAgentId = context.viewState?.agentId;
    if (initialAgentId && host.agentExists(initialAgentId)) host.showAgent(initialAgentId);
    reportedAgentId = undefined;
    started = true;
    if (!initialSetupSeen && context.viewState?.setup) {
      initialSetupPending = context.viewState.setup;
      deliverInitialSetup();
    }
    unsubscribe = [
      api.onWindowSetupApply?.((setup) => { for (const listener of setupListeners) listener(setup, 'patch'); }),
      api.onNativeOwnersChanged?.((owners) => { nativeOwners.value = owners; }),
      api.onComposerDraftChanged?.(({ agentId, draft }) => host.applyDraft(agentId, draft)),
    ].filter((entry): entry is () => void => entry !== undefined);
  }

  /** Follows the panes this window starts with and is handed. The starting ones wait for the first listener. */
  function onSetup(listener: (setup: WindowSetup, mode: SetupMode) => void): () => void {
    setupListeners.add(listener);
    deliverInitialSetup();
    return () => { setupListeners.delete(listener); };
  }

  function deliverInitialSetup(): void {
    if (!initialSetupPending || !setupListeners.size) return;
    const setup = initialSetupPending;
    initialSetupPending = null;
    initialSetupSeen = true;
    for (const listener of setupListeners) listener(setup, 'replace');
  }

  function stop(): void {
    started = false;
    for (const release of unsubscribe) release();
    unsubscribe = [];
  }

  /** Tells main which agent this window shows, for the commands and notices that follow the window the user is in. */
  function reportSelection(api: AppApi | undefined, agentId: string | null): void {
    if (!started || !api?.setWindowSelection || reportedAgentId === agentId) return;
    reportedAgentId = agentId;
    void api.setWindowSelection(agentId).catch(() => undefined);
  }

  /** True while no other window holds the agent's native view. */
  function ownsNative(resource: NativeResource, agentId: string): boolean {
    const owner = nativeOwners.value.find((entry) => entry.resource === resource && entry.agentId === agentId);
    return !owner || owner.windowId === windowId.value;
  }

  return { windowId, nativeOwners, scope, teamId, agentId, branch, missionId, onSetup, start, stop, reportSelection, ownsNative };
}

export const windowState = createWindowState();
