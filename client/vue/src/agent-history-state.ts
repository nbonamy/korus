import type {
  AgentHistoryLoadResult,
  AppSnapshot,
  MainToRendererEvent,
} from '@workspace/core/contracts';
import { computed, ref } from 'vue';
import { appApi, traceConversationLoad } from './platform-api';
import { defaultProviderCapabilities } from '@workspace/core/provider-capabilities';

export function createAgentHistoryState(options: {
  adoptSnapshot: (snapshot: AppSnapshot) => void;
  getSnapshot: () => AppSnapshot;
  synchronizeComposerSelection: (agentId: string) => void;
  hasHistory: (agentId: string) => boolean;
}) {
  const hydratingAgentIds = ref(new Set<string>());
  const failedAgentIds = ref(new Set<string>());
  const loadingOlderAgentIds = ref(new Set<string>());
  const hasOlderByAgentId = ref<Record<string, boolean>>({});

  const isHydratingActiveAgentHistory = computed(() => {
    const agentId = options.getSnapshot().activeAgentId;
    return Boolean(agentId && statusFor(agentId).hydrating);
  });
  const isActiveAgentHistoryFailed = computed(() => {
    const agentId = options.getSnapshot().activeAgentId;
    return Boolean(agentId && failedAgentIds.value.has(agentId));
  });
  const activeHistoryHasOlder = computed(() => {
    const snapshot = options.getSnapshot();
    const agent = snapshot.agents.find((candidate) => candidate.id === snapshot.activeAgentId);
    if (!agent || !defaultProviderCapabilities(agent.provider).olderHistoryPaging) return false;
    return hasOlderByAgentId.value[agent.id] ?? true;
  });
  const isLoadingOlderHistory = computed(() => {
    const agentId = options.getSnapshot().activeAgentId;
    return Boolean(agentId && loadingOlderAgentIds.value.has(agentId));
  });

  async function hydrateActive(): Promise<void> {
    const snapshot = options.getSnapshot();
    if (!snapshot.activeAgentId) return;
    await hydrate(snapshot.activeAgentId);
  }

  async function hydrate(agentId: string): Promise<void> {
    const agent = options.getSnapshot().agents.find((candidate) => candidate.id === agentId);
    if (!agent?.providerSession || !appApi?.loadConversationHistory || hydratingAgentIds.value.has(agent.id)) {
      return;
    }
    markHydrating(agent.id, true);
    const timingStarted = performance.now();
    const timing = (stage: string) => traceConversationLoad && console.warn('[conversation-load] ' + JSON.stringify({ layer: 'renderer', stage, agentId,
      rendererId: performance.timeOrigin, at: performance.timeOrigin + performance.now(), elapsedMs: performance.now() - timingStarted }));
    timing('history.request');
    try {
      options.adoptSnapshot(await appApi.loadConversationHistory(agent.id));
      timing('history.response-adopted');
      options.synchronizeComposerSelection(agent.id);
    } catch {
      failedAgentIds.value = new Set(failedAgentIds.value).add(agent.id);
      // The conversation pane owns hydration errors, including writer locks.
      // Rejecting here also sends the same failure to generic action toasts.
    } finally {
      markHydrating(agent.id, false);
      timing(failedAgentIds.value.has(agent.id) ? 'history.failed' : 'history.settled');
    }
  }

  function statusFor(agentId: string): { failed: boolean; hasOlder: boolean; hydrating: boolean; loadingOlder: boolean } {
    const failed = failedAgentIds.value.has(agentId);
    const pending = Boolean(options.getSnapshot().agents.find(agent => agent.id === agentId)?.providerSession) && !options.hasHistory(agentId);
    return {
      failed,
      hasOlder: hasOlderByAgentId.value[agentId] ?? true,
      hydrating: hydratingAgentIds.value.has(agentId) || (!failed && pending),
      loadingOlder: loadingOlderAgentIds.value.has(agentId),
    };
  }

  async function loadOlder(agentId: string): Promise<void> {
    if (!appApi?.loadOlderAgentHistory || loadingOlderAgentIds.value.has(agentId)) return;
    const next = new Set(loadingOlderAgentIds.value);
    next.add(agentId);
    loadingOlderAgentIds.value = next;
    try {
      const result = await appApi.loadOlderAgentHistory(agentId) as AgentHistoryLoadResult;
      hasOlderByAgentId.value = { ...hasOlderByAgentId.value, [agentId]: result.hasOlder };
    } finally {
      const remaining = new Set(loadingOlderAgentIds.value);
      remaining.delete(agentId);
      loadingOlderAgentIds.value = remaining;
    }
  }

  function markHydrating(agentId: string, hydrating: boolean): void {
    const next = new Set(hydratingAgentIds.value);
    if (hydrating) {
      next.add(agentId);
      const failed = new Set(failedAgentIds.value);
      failed.delete(agentId);
      failedAgentIds.value = failed;
    }
    else next.delete(agentId);
    hydratingAgentIds.value = next;
  }

  function reset(agentId: string): void {
    const hydrating = new Set(hydratingAgentIds.value);
    hydrating.delete(agentId);
    hydratingAgentIds.value = hydrating;

    const failed = new Set(failedAgentIds.value);
    failed.delete(agentId);
    failedAgentIds.value = failed;

    const loadingOlder = new Set(loadingOlderAgentIds.value);
    loadingOlder.delete(agentId);
    loadingOlderAgentIds.value = loadingOlder;

    const hasOlder = { ...hasOlderByAgentId.value };
    delete hasOlder[agentId];
    hasOlderByAgentId.value = hasOlder;
  }

  function handleMainEvent(event: Extract<MainToRendererEvent, { type: 'conversation.historyLoadFailed' }>): void {
    const failed = new Set(failedAgentIds.value);
    failed.add(event.agentId);
    failedAgentIds.value = failed;
    markHydrating(event.agentId, false);
  }

  return {
    activeHistoryHasOlder,
    handleMainEvent,
    hydrateActive,
    hydrate,
    retryActive: hydrateActive,
    isActiveAgentHistoryFailed,
    isHydratingActiveAgentHistory,
    isLoadingOlderHistory,
    loadOlder,
    loadTurn: (agentId: string, turnId: string) => appApi!.loadAgentTurnHistory(agentId, turnId),
    markHydrating,
    reset,
    statusFor,
  };
}
