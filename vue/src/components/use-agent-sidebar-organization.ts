import { computed, ref, watch } from 'vue';
import type { Agent } from '@workspace/core/contracts';
import { projectActivitySidebar, type WorkspaceSidebarGroup, type SidebarActivity } from '@workspace/core/workspace-sidebar';

export type SidebarGroup = WorkspaceSidebarGroup & { activity?: SidebarActivity };

export function useAgentSidebarOrganization(options: {
  teamId: () => string | null | undefined;
  agents: () => Agent[];
  repositoryGroups: () => WorkspaceSidebarGroup[];
  label: (activity: SidebarActivity) => string;
}) {
  const mode = ref<'repository' | 'activity'>('repository');
  const idleSort = ref<'activity' | 'repository'>('activity');
  const now = ref(Date.now());
  const preferenceKey = () => options.teamId() ? `app:agentOrganization:${options.teamId()}` : null;
  const idleSortKey = () => options.teamId() ? `app:idleAgentSort:${options.teamId()}` : null;
  watch(options.teamId, () => {
    try {
      mode.value = localStorage.getItem(preferenceKey() ?? '') === 'activity' ? 'activity' : 'repository';
      idleSort.value = localStorage.getItem(idleSortKey() ?? '') === 'repository' ? 'repository' : 'activity';
    } catch { mode.value = 'repository'; idleSort.value = 'activity'; }
  }, { immediate: true });
  watch(mode, (value, _, cleanup) => {
    now.value = Date.now();
    if (value !== 'activity') return;
    const timer = setInterval(() => { now.value = Date.now(); }, 1_000);
    cleanup(() => clearInterval(timer));
  }, { immediate: true });

  function select(value: string): void {
    if (value !== 'repository' && value !== 'activity') return;
    mode.value = value;
    const key = preferenceKey();
    try { if (key) localStorage.setItem(key, value); } catch { /* Keep the session choice if storage is unavailable. */ }
  }

  const groups = computed<SidebarGroup[]>(() => {
    if (mode.value === 'repository') return options.repositoryGroups();
    return projectActivitySidebar({ agents: options.agents(), repositoryGroups: options.repositoryGroups(),
      now: Math.max(now.value, Date.now()), label: options.label, idleSort: idleSort.value });
  });
  function selectIdleSort(value: string): void {
    if (value !== 'repository' && value !== 'activity') return;
    idleSort.value = value;
    const key = idleSortKey();
    try { if (key) localStorage.setItem(key, value); } catch { /* Keep the session choice if storage is unavailable. */ }
  }
  return { mode, groups, select, now, idleSort, selectIdleSort };
}
