import { hasUnreadActivity } from '@workspace/core/agent-read-state';
import type { Agent } from '@workspace/core/contracts';
import { projectActivitySidebar, projectWorkspaceSidebar, type SidebarActivity, type WorkspaceSidebarGroup, type WorkspaceSidebarSession } from '@workspace/core/workspace-sidebar';

export type MobileSidebarGroup = WorkspaceSidebarGroup & { icon: string | undefined; activity?: SidebarActivity };
export type MobileActivityGroup = Omit<MobileSidebarGroup, 'sessions'> & { sessions: (WorkspaceSidebarSession & { subtitle: string; quickChat: boolean })[] };

export function projectMobileActivityGroups(agents: readonly Agent[], repositoryGroups: MobileSidebarGroup[], now: number, idleSort: 'activity' | 'repository' = 'activity'): MobileActivityGroup[] {
  const labels = { attention: 'Needs input', recent: 'Done', working: 'Working', idle: 'Idle' };
  const origins = new Map(repositoryGroups.flatMap(group => group.sessions.map(session => [session.agentId, group] as const)));
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  return projectActivitySidebar({ agents, repositoryGroups, now, idleSort, label: activity => labels[activity] }).map(group => ({ ...group, icon: undefined,
    sessions: group.sessions.map(session => {
      const context = origins.get(session.agentId)!.label;
      const quickChat = byId.get(session.agentId)?.sessionKind === 'quickChat';
      return { ...session, quickChat, displayTitle: session.customName ?? (quickChat ? session.displayTitle : context),
        subtitle: quickChat ? context : [session.customName ? context : null, session.branch].filter(Boolean).join(' · ') };
    }),
  }));
}

/** The desktop sidebar's grouping and titles, with each repository's icon resolved. */
export function projectMobileGroups(agents: readonly Agent[], activeAgentId: string | null, chatsLabel: string, repositoryIcons: Readonly<Record<string, string>> = {}): MobileSidebarGroup[] {
  return projectWorkspaceSidebar({ agents, activeAgentId, quickChatsLabel: chatsLabel, unreadAgentIds: agents.filter(hasUnreadActivity).map(agent => agent.id) })
    .map((group) => ({ ...group, icon: group.repositoryKey ? repositoryIcons[group.repositoryKey] : undefined }))
    .sort((left, right) => Number(right.kind === 'quickChats') - Number(left.kind === 'quickChats'));
}

export function activeSession(groups: readonly MobileSidebarGroup[]): { group: MobileSidebarGroup; session: WorkspaceSidebarSession } | null {
  for (const group of groups) {
    const session = group.sessions.find((candidate) => candidate.isActive);
    if (session) return { group, session };
  }
  return null;
}
