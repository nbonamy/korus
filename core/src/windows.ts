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
  teamId?: string;
  /** The agents of a feature, shown together. */
  agentIds?: string[];
  scope?: WindowScope;
};

/**
 * What a window shows. `workspace` is everything. `team` is one team with its sidebar but no rail.
 * `agent` is a single agent and `feature` the agents of one feature, both with no navigation around them.
 */
export type WindowScope = 'workspace' | 'team' | 'agent' | 'feature';

const maxFeatureWindowAgents = 16;

export function isWindowViewState(value: unknown): value is WindowViewState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { agentId, teamId, agentIds, scope } = value as { agentId?: unknown; teamId?: unknown; agentIds?: unknown; scope?: unknown };
  if (agentId !== undefined && typeof agentId !== 'string') return false;
  if (teamId !== undefined && typeof teamId !== 'string') return false;
  if (agentIds !== undefined && (!Array.isArray(agentIds) || agentIds.length > maxFeatureWindowAgents || agentIds.some(id => typeof id !== 'string'))) return false;
  if (scope !== undefined && scope !== 'workspace' && scope !== 'team' && scope !== 'agent' && scope !== 'feature') return false;
  if (scope === 'agent') return typeof agentId === 'string';
  if (scope === 'team') return typeof teamId === 'string';
  if (scope === 'feature') return Array.isArray(agentIds) && agentIds.length > 0;
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
