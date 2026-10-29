import type { Agent, OpenInApplication, OpenInApplicationCatalog, ReorderAgentsInput, ReorderRepositoriesInput, SourceBranch, Team } from '@workspace/core/contracts';
import type { Mission } from '@workspace/core/missions';

export interface AgentSidebarProps {
  agents: Agent[];
  allTeams?: boolean;
  missionAgents?: Agent[];
  missions?: Mission[];
  activeMissionId?: string | null;
  activeAgentId: string | null;
  unreadAgentIds?: string[];
  forkableAgentIds?: string[];
  summaryReplacementAgentIds?: string[];
  compact?: boolean;
  collapsedRepositoryKeys?: string[];
  teams?: Team[];
  teamId?: string | null;
  teamName: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  missionCreationError?: string;
  missionCreationPending?: boolean;
  /** Phones expose conversations and the cockpit only. */
  phoneScope?: boolean;
  quickSwitchShortcutsVisible?: boolean;
  repositoryIcons?: Record<string, string>;
  listRepositoryBranches?: (input: { agentId: string; repositoryRoot: string }) => Promise<SourceBranch[]>;
  openInCatalog?: OpenInApplicationCatalog;
}

export type AgentSidebarEvents = {
  'collapse-sidebar': [];
  'close-agent': [agentId: string];
  'compress-session': [agentId: string];
  'compact-session': [agentId: string];
  'cleanup-pull-request': [agentId: string];
  'update-collapsed-repositories': [repositoryKeys: string[]];
  'create-agent-from-repository': [payload: { agentId: string; repositoryName: string; repositoryRoot: string }];
  'create-agent-on-branch': [payload: { agentId: string; repositoryName: string; repositoryRoot: string; branch: SourceBranch }];
  'create-agent-worktree-in-repository': [payload: { agentId: string; repositoryName: string; repositoryRoot: string }];
  'duplicate-agent': [agentId: string];
  'fork-agent': [agentId: string];
  'share-agent': [agentId: string];
  'handoff-agent': [agentId: string];
  'edit-agent': [agentId: string];
  'move-agent-to-team': [payload: { agentId: string; teamId: string }];
  'open-in': [payload: { agentId: string; application: OpenInApplication }];
  'reorder-agents': [payload: ReorderAgentsInput];
  'reorder-repositories': [payload: ReorderRepositoriesInput];
  'resize-sidebar': [width: number];
  'resume-session': [agentId: string];
  'restart-agent': [agentId: string];
  'select-agent': [agentId: string];
  'start-work': [action: import('./start-work-actions').StartWorkAction];
  'create-quick-chat': [];
  'create-mission': [];
  'delete-mission': [id: string];
  'create-agent-in-mission-worktree': [payload: { missionId: string; worktreePath: string }];
  'delete-repository': [agentId: string];
  'select-mission': [id: string];
  'update-repository-icon': [payload: { repositoryKey: string; repositoryRoot: string; icon: string | undefined }];
};

export type AgentSidebarEmit = <K extends keyof AgentSidebarEvents>(event: K, ...args: AgentSidebarEvents[K]) => void;
