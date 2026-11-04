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
  /** The team of a team, feature or Mission window. */
  teamId?: string;
  /** The Git branch that makes a feature: its agents are the team's agents working on it. */
  branch?: string;
  missionId?: string;
  scope?: WindowScope;
  /** The panes each agent has open in this window. A new window starts from a copy of its source's, then drifts. */
  setup?: WindowSetup;
};

/** The right panel of one agent in a window: what is worth bringing to a new window or back after a relaunch. */
export type AgentPaneSetup = {
  open: boolean;
  width: number;
  activeTab: string | null;
  tabs: string[];
  /** The page of the agent's primary Browser tab. */
  browserUrl?: string;
  /** The pages of its other Browser tabs, by tab. */
  browserPanels?: Record<string, { browserId: string; url: string; title: string }>;
};

export type WindowSetup = Record<string, AgentPaneSetup>;

const maxSetupAgents = 64;
const maxSetupTabs = 32;
const maxSetupText = 4096;

function isSetupText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= maxSetupText;
}

export function isAgentPaneSetup(value: unknown): value is AgentPaneSetup {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { open, width, activeTab, tabs, browserUrl, browserPanels } = value as Record<string, unknown>;
  if (typeof open !== 'boolean' || typeof width !== 'number' || !Number.isFinite(width)) return false;
  if (activeTab !== null && !isSetupText(activeTab)) return false;
  if (!Array.isArray(tabs) || tabs.length > maxSetupTabs || !tabs.every(isSetupText)) return false;
  if (browserUrl !== undefined && !isSetupText(browserUrl)) return false;
  if (browserPanels === undefined) return true;
  if (typeof browserPanels !== 'object' || browserPanels === null || Array.isArray(browserPanels)) return false;
  const panels = Object.entries(browserPanels);
  return panels.length <= maxSetupTabs && panels.every(([tab, panel]) => isSetupText(tab) && typeof panel === 'object' && panel !== null
    && isSetupText((panel as Record<string, unknown>).browserId) && isSetupText((panel as Record<string, unknown>).url) && isSetupText((panel as Record<string, unknown>).title));
}

export function isWindowSetup(value: unknown): value is WindowSetup {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= maxSetupAgents && entries.every(([agentId, setup]) => isSetupText(agentId) && isAgentPaneSetup(setup));
}

/**
 * What a window shows. `workspace` is everything. `team` is one team with its sidebar but no rail.
 * `feature` is the same for one feature, listing only the agents on its branch. `agent` is a single agent
 * with no navigation around it. `mission` shows one Mission's workbench and conversations.
 */
export type WindowScope = 'workspace' | 'team' | 'agent' | 'feature' | 'mission';

export function isWindowViewState(value: unknown): value is WindowViewState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { agentId, teamId, branch, missionId, scope, setup } = value as { agentId?: unknown; teamId?: unknown; branch?: unknown; missionId?: unknown; scope?: unknown; setup?: unknown };
  if (agentId !== undefined && typeof agentId !== 'string') return false;
  if (teamId !== undefined && typeof teamId !== 'string') return false;
  if (branch !== undefined && typeof branch !== 'string') return false;
  if (missionId !== undefined && typeof missionId !== 'string') return false;
  if (setup !== undefined && !isWindowSetup(setup)) return false;
  if (scope !== undefined && scope !== 'workspace' && scope !== 'team' && scope !== 'agent' && scope !== 'feature' && scope !== 'mission') return false;
  if (scope === 'agent') return typeof agentId === 'string';
  if (scope === 'team') return typeof teamId === 'string';
  if (scope === 'feature') return typeof teamId === 'string' && typeof branch === 'string' && branch.length > 0;
  if (scope === 'mission') return typeof teamId === 'string' && typeof missionId === 'string' && missionId.length > 0;
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
