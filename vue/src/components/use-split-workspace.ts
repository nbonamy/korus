import { computed, onScopeDispose, ref, watch } from 'vue';

export type SplitLayout =
  | 'single'
  | '2-vertical'
  | '2-horizontal'
  | '4-quadrant';
export type SplitPane = { id: number; agentId: string | null };
export type SplitRatios = { columns: number; rows: number };
type TeamWorkspace = {
  layout: SplitLayout;
  panes: SplitPane[];
  focusedPaneId: number;
  ratios: SplitRatios;
};

const storageKey = (teamId: string) => `app:splitWorkspace:v1:${teamId}`;
const paneCount = (layout: SplitLayout) => layout === 'single' ? 1 : layout === '4-quadrant' ? 4 : 2;

function readWorkspace(teamId: string | undefined): TeamWorkspace | undefined {
  if (!teamId) return;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(teamId)) ?? 'null') as TeamWorkspace | null;
    if (!saved || !['single', '2-vertical', '2-horizontal', '4-quadrant'].includes(saved.layout)
      || !Array.isArray(saved.panes) || saved.panes.length !== paneCount(saved.layout)
      || !saved.panes.every(pane => pane && Number.isSafeInteger(pane.id) && pane.id >= 0
        && (pane.agentId === null || typeof pane.agentId === 'string'))
      || new Set(saved.panes.map(pane => pane.id)).size !== saved.panes.length
      || new Set(saved.panes.filter(pane => pane.agentId !== null).map(pane => pane.agentId)).size !== saved.panes.filter(pane => pane.agentId !== null).length
      || !saved.panes.some(pane => pane.id === saved.focusedPaneId)
      || !saved.ratios || ![saved.ratios.columns, saved.ratios.rows].every(ratio =>
        Number.isFinite(ratio) && ratio >= 0.15 && ratio <= 0.85)) return;
    return saved;
  } catch { /* Ignore unavailable storage and invalid client preferences. */ }
}

/** Layout is client-local. Agents never own other agents or their workspace tabs. */
export function useSplitWorkspace(options: {
  agentIds: () => string[];
  currentAgentId: () => string | undefined;
  teamId: () => string | undefined;
  selectAgent: (agentId: string) => void;
}) {
  const layout = ref<SplitLayout>('single');
  const panes = ref<SplitPane[]>([
    { id: 0, agentId: options.currentAgentId() ?? null },
  ]);
  const focusedPaneId = ref(0);
  const ratios = ref<SplitRatios>({ columns: 0.5, rows: 0.5 });
  let nextPaneId = 1;
  let activeTeamId = options.teamId();
  let initialized = false;
  const teamWorkspaces = new Map<string | undefined, TeamWorkspace>();
  const focusedPane = computed(
    () =>
      panes.value.find((pane) => pane.id === focusedPaneId.value) ??
      panes.value[0]!,
  );

  function saveWorkspace(): void {
    const saved: TeamWorkspace = {
      layout: layout.value,
      panes: panes.value.map(pane => ({ ...pane })),
      focusedPaneId: focusedPaneId.value,
      ratios: { ...ratios.value },
    };
    teamWorkspaces.set(activeTeamId, saved);
    try {
      if (activeTeamId) localStorage.setItem(storageKey(activeTeamId), JSON.stringify(saved));
    } catch { /* Keep session layouts when storage is unavailable or full. */ }
  }

  function select(agentId: string): void {
    if (!options.agentIds().includes(agentId)) return;
    const existing = panes.value.find((pane) => pane.agentId === agentId);
    if (existing) focusedPaneId.value = existing.id;
    else focusedPane.value.agentId = agentId;
  }

  function focus(paneId: number): void {
    const pane = panes.value.find((candidate) => candidate.id === paneId);
    if (!pane) return;
    focusedPaneId.value = pane.id;
    if (pane.agentId && pane.agentId !== options.currentAgentId())
      options.selectAgent(pane.agentId);
  }

  function setLayout(value: SplitLayout): void {
    const count = paneCount(value);
    const current = focusedPane.value;
    if (panes.value.indexOf(current) >= count) {
      panes.value = [
        current,
        ...panes.value.filter((pane) => pane !== current),
      ];
    }
    panes.value = panes.value.slice(0, count);
    const available = options
      .agentIds()
      .filter((id) => !panes.value.some((pane) => pane.agentId === id));
    while (panes.value.length < count)
      panes.value.push({
        id: nextPaneId++,
        agentId: available.shift() ?? null,
      });
    layout.value = value;
  }

  watch(
    [options.teamId, options.currentAgentId, options.agentIds],
    ([teamId, agentId, ids], [, previousAgentId]) => {
      const restoring = !initialized || teamId !== activeTeamId;
      let saved: TeamWorkspace | undefined;
      if (restoring) {
        if (initialized) saveWorkspace();
        initialized = true;
        activeTeamId = teamId;
        saved = teamWorkspaces.get(teamId) ?? readWorkspace(teamId);
        layout.value = saved?.layout ?? 'single';
        panes.value = saved?.panes.map(pane => ({ ...pane })) ?? [
          { id: nextPaneId++, agentId: agentId ?? null },
        ];
        focusedPaneId.value = saved?.focusedPaneId ?? panes.value[0]!.id;
        ratios.value = { ...(saved?.ratios ?? { columns: 0.5, rows: 0.5 }) };
        nextPaneId = Math.max(nextPaneId, ...panes.value.map(pane => pane.id + 1));
      }
      for (const pane of panes.value)
        if (pane.agentId && !ids.includes(pane.agentId)) pane.agentId = null;
      if (restoring && saved) {
        const focusedAgentId = focusedPane.value.agentId;
        const departedFocus = saved.panes.find(pane => pane.id === saved.focusedPaneId)?.agentId && !focusedAgentId;
        if (departedFocus && agentId) select(agentId);
        if (focusedAgentId && focusedAgentId !== agentId) options.selectAgent(focusedAgentId);
        return;
      }
      const followCurrent = restoring || agentId !== previousAgentId || !panes.value.some(pane => pane.agentId);
      if (agentId && followCurrent) select(agentId);
    },
    { immediate: true },
  );

  watch([layout, panes, focusedPaneId, ratios], saveWorkspace, { deep: true, flush: 'post' });
  onScopeDispose(saveWorkspace);

  return {
    layout,
    panes,
    focusedPaneId,
    focusedPane,
    focus,
    select,
    setLayout,
    ratios,
    resize: (value: SplitRatios) => { ratios.value = value; },
  };
}
