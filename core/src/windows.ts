import type { CodexNativeAttachment } from '@codex-app-sdk/core/native';
import type { CodexPromptPart } from '@codex-app-sdk/core/surface';

/**
 * View state a window starts with. Opening a window always takes one, so every
 * entry point (New Window now, detaching an agent, feature or team later) is the
 * same call with a different value. Absent fields fall back to the daemon's
 * last selection.
 */
export type WindowViewState = {
  agentId?: string;
  /** The team of a team window, and of a feature window. */
  teamId?: string;
  /** The Git branch that makes a feature: its agents are the team's agents working on it. */
  branch?: string;
  scope?: WindowScope;
};

/**
 * What a window shows. `workspace` is everything. `team` is one team with its sidebar but no rail.
 * `feature` is the same for one feature, listing only the agents on its branch. `agent` is a single agent
 * with no navigation around it.
 */
export type WindowScope = 'workspace' | 'team' | 'agent' | 'feature';

export function isWindowViewState(value: unknown): value is WindowViewState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { agentId, teamId, branch, scope } = value as { agentId?: unknown; teamId?: unknown; branch?: unknown; scope?: unknown };
  if (agentId !== undefined && typeof agentId !== 'string') return false;
  if (teamId !== undefined && typeof teamId !== 'string') return false;
  if (branch !== undefined && typeof branch !== 'string') return false;
  if (scope !== undefined && scope !== 'workspace' && scope !== 'team' && scope !== 'agent' && scope !== 'feature') return false;
  if (scope === 'agent') return typeof agentId === 'string';
  if (scope === 'team') return typeof teamId === 'string';
  if (scope === 'feature') return typeof teamId === 'string' && typeof branch === 'string' && branch.length > 0;
  return true;
}

/** Native views that exist once per agent: only the owning window mounts them. */
export type NativeResource = 'browser' | 'simulator';

export type NativeOwnerEntry = {
  resource: NativeResource;
  agentId: string;
  windowId: number;
};

/** The composer of one agent. Drafts are shared by every window showing that agent. */
export type ComposerDraft = {
  state: {
    text: string;
    content?: readonly CodexPromptPart[];
    selectionStart: number;
    selectionEnd: number;
    activeCommandId?: string | null;
  };
  attachments: readonly CodexNativeAttachment[];
};

export type ComposerDraftChange = { agentId: string; draft: ComposerDraft | null };

export type WindowContext = {
  windowId: number;
  viewState: WindowViewState | null;
  nativeOwners: NativeOwnerEntry[];
  composerDrafts: Record<string, ComposerDraft>;
};

export function isEmptyComposerDraft(draft: ComposerDraft): boolean {
  return draft.state.text === '' && !(draft.state.content?.length) && draft.attachments.length === 0;
}
