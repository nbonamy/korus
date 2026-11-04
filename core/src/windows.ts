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
};

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
