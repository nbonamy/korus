import type { WorkItem } from '@workspace/core/contracts';
import type { WorkItemAssignmentAction } from '@workspace/core/work-item-prompts';
import type { SidePanelGitDiffState, SidePanelImageState, SidePanelMarkdownState, SidePanelSourceState } from './side-panel';

export type RightWorkspaceFileTab = `file:${string}`;
export type RightWorkspaceDiffTab = `diff:${string}`;
export type RightWorkspaceImageTab = `image:${string}`;
export type RightWorkspaceSubagentTab = `subagent:${string}`;
export type RightWorkspaceBrowserTab = `browser:${string}`;
export type RightWorkspaceBrowserPanel = { browserId: string; url: string; title: string };
export type RightWorkspaceTab = 'gitLog' | 'simulator' | 'codeReview' | 'visualize' | 'review' | 'backlog' | 'browser' | 'files' | 'plan' | RightWorkspaceFileTab | RightWorkspaceDiffTab | RightWorkspaceImageTab | RightWorkspaceSubagentTab | RightWorkspaceBrowserTab;
export type RightWorkspaceFilePanel = SidePanelMarkdownState | SidePanelSourceState;
export type RightWorkspaceDiffPanel = SidePanelGitDiffState;
export type RightWorkspaceImagePanel = SidePanelImageState;

export function isRightWorkspaceBrowserTab(tab: RightWorkspaceTab): tab is RightWorkspaceBrowserTab {
  return tab.startsWith('browser:');
}

export type RepositoryWorkStartInput = {
  isCurrent?: () => boolean;
  backend?: import('@workspace/core/contracts').AgentBackend;
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string;
  action: WorkItemAssignmentAction | 'custom';
  item: WorkItem;
  target: 'current' | 'duplicate';
} & ({
  workspace: { kind: 'current' };
} | {
  workspace: { branchName: string; kind: 'worktree' };
});

export function rightWorkspaceFileTab(filePath: string): RightWorkspaceFileTab {
  return `file:${encodeURIComponent(filePath)}`;
}

export function rightWorkspaceMarkdownTab(identifier: string): RightWorkspaceFileTab {
  return `file:markdown:${encodeURIComponent(identifier)}`;
}

export function isRightWorkspaceFileTab(tab: RightWorkspaceTab): tab is RightWorkspaceFileTab {
  return tab.startsWith('file:');
}

export function rightWorkspaceDiffTab(turnId: string, filePath: string): RightWorkspaceDiffTab {
  return `diff:${encodeURIComponent(`${turnId}\u0000${filePath}`)}`;
}

export function isRightWorkspaceDiffTab(tab: RightWorkspaceTab): tab is RightWorkspaceDiffTab {
  return tab.startsWith('diff:');
}

export function rightWorkspaceImageTab(identifier: string): RightWorkspaceImageTab {
  let hash = 2_166_136_261;
  for (let index = 0; index < identifier.length; index += 1) {
    hash ^= identifier.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `image:${identifier.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export function isRightWorkspaceImageTab(tab: RightWorkspaceTab): tab is RightWorkspaceImageTab {
  return tab.startsWith('image:');
}

export function rightWorkspaceSubagentTab(conversationId: string): RightWorkspaceSubagentTab {
  return `subagent:${encodeURIComponent(conversationId)}`;
}

export function isRightWorkspaceSubagentTab(tab: RightWorkspaceTab): tab is RightWorkspaceSubagentTab {
  return tab.startsWith('subagent:');
}

export function rightWorkspaceSubagentConversationId(tab: RightWorkspaceSubagentTab): string {
  return decodeURIComponent(tab.slice('subagent:'.length));
}
