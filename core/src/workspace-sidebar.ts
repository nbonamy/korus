import type { Agent, AgentPullRequestTracking, AgentStatus } from './contracts';
import { agentDisplayName } from './agent-display';
import { repositoryIconKeyForRemote } from './git-remote';

export type WorkspaceSidebarSession = {
  shared?: boolean;
  agentId: string;
  customName: string | null;
  conversationTitle: string | null;
  displayTitle: string;
  branch: string | null;
  folder: string | null;
  isLinkedWorktree: boolean;
  kind: 'main' | 'branch' | 'worktree' | 'detached' | 'folder';
  isActive: boolean;
  isUnread: boolean;
  status: AgentStatus;
  pullRequest?: AgentPullRequestTracking;
  /** Host running the agent; absent for local agents. */
  remoteConnectionId?: string;
  quickSwitchIndex: number;
};

export type WorkspaceSidebarGroup = {
  id: string;
  kind: 'repository' | 'folder' | 'quickChats';
  label: string;
  /** Primary checkout of the section on `remoteConnectionId` (local when absent): the local one when the section has it. */
  repositoryRoot?: string;
  repositoryKey?: string;
  /** An agent on the primary checkout, which section actions resolve their location through. */
  repositoryAgentId?: string;
  remoteConnectionId?: string;
  originUrl?: string;
  /** Agents of this section run on more than one host. */
  spansHosts?: true;
  sessions: WorkspaceSidebarSession[];
};

export type AgentMentionProjection = {
  agentId: string;
  label: string;
};

/** Sections are one repository wherever it runs: the origin identity, else the path on its own host. */
export function workspaceSidebarRepositoryKeyForAgent(agent: Agent): string | null {
  const workspace = agent.workspace;
  if (agent.sessionKind === 'quickChat' || workspace?.kind !== 'git') return null;
  const origin = workspace.originUrl ? repositoryIconKeyForRemote(workspace.originUrl) : undefined;
  if (origin) return origin;
  return agent.remoteConnectionId ? `${agent.remoteConnectionId}:${workspace.primaryWorktreeRoot}` : workspace.primaryWorktreeRoot;
}

export function workspaceSidebarGroupIdForAgent(agent: Agent): string {
  if (agent.sessionKind === 'quickChat') return 'quick-chats';
  const repositoryKey = workspaceSidebarRepositoryKeyForAgent(agent);
  if (repositoryKey) return `git:${repositoryKey}`;
  const host = agent.remoteConnectionId ? `${agent.remoteConnectionId}:` : '';
  return agent.folder ? `folder:${host}${agent.folder}` : `agent:${agent.id}`;
}

export function repositoryIconForAgent(
  agent: Agent | null | undefined,
  repositoryIcons: Readonly<Record<string, string>>,
): string | undefined {
  const workspace = agent?.workspace;
  if (workspace?.kind !== 'git') return undefined;

  const keys = [
    workspace.originUrl ? repositoryIconKeyForRemote(workspace.originUrl) : undefined,
    workspace.primaryWorktreeRoot,
    workspace.repositoryRoot,
  ]
    .filter((key): key is string => Boolean(key));
  for (const key of keys) {
    const icon = repositoryIcons[key];
    if (icon) return icon;
  }
  return undefined;
}

export function projectWorkspaceSidebar(input: {
  agents: readonly Agent[];
  activeAgentId: string | null;
  quickChatsLabel: string;
  unreadAgentIds?: readonly string[];
}): WorkspaceSidebarGroup[] {
  const unreadIds = new Set(input.unreadAgentIds ?? []);
  const groups = new Map<string, WorkspaceSidebarGroup>();

  input.agents.forEach((agent, quickSwitchIndex) => {
    const workspace = agent.workspace;
    const isQuickChat = agent.sessionKind === 'quickChat';
    const isGit = !isQuickChat && workspace?.kind === 'git';
    const id = workspaceSidebarGroupIdForAgent(agent);
    let group = groups.get(id);
    if (!group) {
      group = isGit
        ? {
            id,
            kind: 'repository',
            label: workspace.repositoryName,
            repositoryRoot: workspace.primaryWorktreeRoot,
            repositoryKey: workspaceSidebarRepositoryKeyForAgent(agent)!,
            repositoryAgentId: agent.id,
            ...(agent.remoteConnectionId ? { remoteConnectionId: agent.remoteConnectionId } : {}),
            sessions: [],
          }
        : isQuickChat ? {
            id,
            kind: 'quickChats',
            label: input.quickChatsLabel,
            sessions: [],
          } : {
            id,
            kind: 'folder',
            label: workspace?.kind === 'folder'
              ? workspace.label
              : agent.folder?.replace(/\\/gu, '/').split('/').filter(Boolean).at(-1) ?? agentDisplayName(agent),
            sessions: [],
          };
      groups.set(id, group);
    }

    if (isGit) {
      if (!group.originUrl && workspace.originUrl) group.originUrl = workspace.originUrl;
      if (group.remoteConnectionId !== agent.remoteConnectionId) {
        group.spansHosts = true;
        if (group.remoteConnectionId && !agent.remoteConnectionId) {
          // The local checkout is the section's own; remote ones are reached through the remote action.
          group.repositoryRoot = workspace.primaryWorktreeRoot;
          group.repositoryAgentId = agent.id;
          delete group.remoteConnectionId;
        }
      }
    }

    const customName = agent.name?.trim() || null;
    const conversationTitle = agent.conversationTitle?.trim() || null;
    const sessionLabel = isQuickChat
      ? customName ?? conversationTitle ?? agentDisplayName(agent)
      : customName ?? agentDisplayName(agent);
    group.sessions.push({
      agentId: agent.id,
      customName,
      conversationTitle,
      displayTitle: sessionLabel,
      ...(agent.sharedConversation ? { shared: true } : {}),
      branch: isGit ? workspace.branch : null,
      folder: agent.folder,
      isLinkedWorktree: isGit && workspace.isLinkedWorktree,
      kind: workspaceSessionKind(agent),
      isActive: agent.id === input.activeAgentId,
      isUnread: unreadIds.has(agent.id),
      status: { ...agent.status },
      ...(agent.pullRequest ? { pullRequest: { ...agent.pullRequest } } : {}),
      ...(agent.remoteConnectionId ? { remoteConnectionId: agent.remoteConnectionId } : {}),
      quickSwitchIndex,
    });
  });

  const projectedGroups = [...groups.values()];
  disambiguateDuplicateSessionLabels(projectedGroups);
  return projectedGroups;
}

export function projectAgentMentionLabels(agents: readonly Agent[], quickChatsLabel: string): AgentMentionProjection[] {
  const labels = projectWorkspaceSidebar({ agents, activeAgentId: null, quickChatsLabel })
    .flatMap((group) => group.sessions.map((session) => {
      const branchContext = session.branch ? `${group.label}/${session.branch}` : group.label;
      return {
        agentId: session.agentId,
        label: `${session.displayTitle} · ${branchContext}`,
      };
    }));
  return disambiguateLabels(labels);
}

function disambiguateDuplicateSessionLabels(groups: WorkspaceSidebarGroup[]): void {
  for (const group of groups) {
    if (group.kind !== 'repository') continue;
    const namedSessions = group.sessions.filter(session => session.customName !== null);
    const counts = labelCounts(group.sessions.map(session => session.displayTitle));
    const candidates = namedSessions.map(session => {
      if ((counts.get(normalizedLabel(session.displayTitle)) ?? 0) < 2) return session.displayTitle;
      const context = session.branch && normalizedLabel(session.branch) !== normalizedLabel(session.displayTitle)
        ? session.branch
        : group.label;
      return `${session.displayTitle} · ${context}`;
    });
    const disambiguated = disambiguateLabels(candidates.map((label, index) => ({
      agentId: namedSessions[index]!.agentId,
      label,
    })));
    disambiguated.forEach(({ label }, index) => {
      namedSessions[index]!.displayTitle = label;
    });
  }
}

function disambiguateLabels<T extends { agentId: string; label: string }>(values: T[]): T[] {
  const counts = labelCounts(values.map(({ label }) => label));
  const indexes = new Map<string, number>();
  return values.map((value) => {
    const key = normalizedLabel(value.label);
    if ((counts.get(key) ?? 0) < 2) return value;
    const index = (indexes.get(key) ?? 0) + 1;
    indexes.set(key, index);
    return { ...value, label: `${value.label} · ${index}` };
  });
}

function labelCounts(labels: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) {
    const key = normalizedLabel(label);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function normalizedLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

function workspaceSessionKind(agent: Agent): WorkspaceSidebarSession['kind'] {
  if (agent.sessionKind === 'quickChat') return 'folder';
  const workspace = agent.workspace;
  if (workspace?.kind !== 'git') return 'folder';
  if (!workspace.branch) return 'detached';
  if (workspace.isLinkedWorktree) return 'worktree';
  const defaultBranch = workspace.defaultBranch === undefined
    ? (workspace.branch === 'main' || workspace.branch === 'master' ? workspace.branch : null)
    : workspace.defaultBranch;
  return workspace.branch === defaultBranch ? 'main' : 'branch';
}

export type SidebarActivity = 'attention' | 'recent' | 'working' | 'idle';
export type ActivitySidebarGroup = WorkspaceSidebarGroup & { activity: SidebarActivity };

/** Shared priority and recency policy; clients own preferences, clocks and animation. */
export function projectActivitySidebar(options: {
  agents: readonly Agent[];
  repositoryGroups: readonly WorkspaceSidebarGroup[];
  now: number;
  label: (activity: SidebarActivity) => string;
  idleSort?: 'activity' | 'repository';
}): ActivitySidebarGroup[] {
  const recentDuration = 5 * 60_000;
  const groups = (['attention', 'recent', 'working', 'idle'] as const).map(activity => ({
    id: `activity:${activity}`, kind: 'folder' as const, activity, label: options.label(activity), sessions: [] as WorkspaceSidebarGroup['sessions'],
  }));
  const agents = new Map(options.agents.map(agent => [agent.id, agent]));
  const observedNow = options.now;
  for (const group of options.repositoryGroups) {
    for (const session of group.sessions) {
      const agent = agents.get(session.agentId)!;
      const lastActivity = agent.hasSubmittedPrompt ? Date.parse(agent.lastActivityAt ?? '') || 0 : 0;
      const age = observedNow - Math.max(Date.parse(agent.createdAt), lastActivity);
      const activity: SidebarActivity = agent.status.type === 'awaitingInput' ? 'attention'
        : agent.status.type === 'working' ? 'working'
          : session.isUnread || (age >= 0 && age < recentDuration) ? 'recent' : 'idle';
      groups.find(group => group.activity === activity)!.sessions.push(session);
    }
  }
  const activityTime = (id: string) => {
    const agent = agents.get(id)!;
    return Date.parse(agent.hasSubmittedPrompt && agent.lastActivityAt ? agent.lastActivityAt : agent.createdAt) || 0;
  };
  for (const group of groups) {
    if (group.activity !== 'idle') group.sessions.sort((a, b) => activityTime(a.agentId) - activityTime(b.agentId));
  }
  const lastActive = (id: string) => Date.parse(agents.get(id)?.lastActivityAt ?? '') || 0;
  if (options.idleSort !== 'repository') groups.find(group => group.activity === 'idle')!.sessions.sort((a, b) => lastActive(b.agentId) - lastActive(a.agentId));
  return groups.filter(group => group.sessions.length);
}
