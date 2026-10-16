import { computed, ref, watch } from 'vue';
import type { Agent } from '@workspace/core/contracts';
import type { WorkspaceSidebarGroup } from '@workspace/core/workspace-sidebar';

type Activity = 'attention' | 'recent' | 'working' | 'idle';
export type SidebarGroup = WorkspaceSidebarGroup & { activity?: Activity };
const recentDuration = 5 * 60_000;

export function useAgentSidebarOrganization(options: {
  teamId: () => string | null | undefined;
  agents: () => Agent[];
  repositoryGroups: () => WorkspaceSidebarGroup[];
  label: (activity: Activity) => string;
}) {
  const mode = ref<'repository' | 'activity'>('repository');
  const now = ref(Date.now());
  const preferenceKey = () => options.teamId() ? `app:agentOrganization:${options.teamId()}` : null;
  watch(options.teamId, () => {
    try { mode.value = localStorage.getItem(preferenceKey() ?? '') === 'activity' ? 'activity' : 'repository'; }
    catch { mode.value = 'repository'; }
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
    const groups = (['attention', 'recent', 'working', 'idle'] as const).map(activity => ({
      id: `activity:${activity}`, kind: 'folder' as const, activity, label: options.label(activity), sessions: [] as WorkspaceSidebarGroup['sessions'],
    }));
    const agents = new Map(options.agents().map(agent => [agent.id, agent]));
    const observedNow = Math.max(now.value, Date.now());
    for (const group of options.repositoryGroups()) {
      for (const session of group.sessions) {
        const agent = agents.get(session.agentId)!;
        const lastActivity = agent.hasSubmittedPrompt ? Date.parse(agent.lastActivityAt ?? '') || 0 : 0;
        const age = observedNow - Math.max(Date.parse(agent.createdAt), lastActivity);
        const activity: Activity = agent.status.type === 'awaitingInput' ? 'attention'
          : agent.status.type === 'working' ? 'working'
            : age >= 0 && age < recentDuration ? 'recent' : 'idle';
        groups.find(group => group.activity === activity)!.sessions.push(session);
      }
    }
    const lastActive = (id: string) => Date.parse(agents.get(id)?.lastActivityAt ?? '') || 0;
    groups.find(group => group.activity === 'idle')!.sessions.sort((a, b) => lastActive(b.agentId) - lastActive(a.agentId));
    return groups.filter(group => group.sessions.length);
  });
  return { mode, groups, select };
}
