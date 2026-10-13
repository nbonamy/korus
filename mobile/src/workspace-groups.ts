import type { Agent } from '@workspace/core/contracts';
import { projectWorkspaceSidebar, type WorkspaceSidebarGroup, type WorkspaceSidebarSession } from '@workspace/core/workspace-sidebar';

export type MobileSidebarGroup = WorkspaceSidebarGroup & { icon: string | undefined };

/** The desktop sidebar's grouping and titles, with each repository's icon resolved. */
export function projectMobileGroups(agents: readonly Agent[], activeAgentId: string | null, chatsLabel: string, repositoryIcons: Readonly<Record<string, string>> = {}): MobileSidebarGroup[] {
  return projectWorkspaceSidebar({ agents, activeAgentId, quickChatsLabel: chatsLabel })
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
