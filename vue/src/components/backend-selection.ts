import { computed, inject, provide, ref, watch, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import { enabledAgentBackends, providerConnectionsForTeam } from '@workspace/core/agent-backends';
import type { AgentBackend, AgentModelSelection, AppSnapshot } from '@workspace/core/contracts';
import { isAgentBackend } from '@workspace/core/contracts/shared';
import type { ProviderConnection } from '@workspace/core/contracts/provider-setup';

export const backendChoicesKey: InjectionKey<ComputedRef<AgentBackend[]>> = Symbol('backendChoices');
type BackendSwitch = ReturnType<typeof provideBackendSwitch>;
const backendSwitchKey: InjectionKey<BackendSwitch> = Symbol('backendSwitch');
export const backendSnapshotKey: InjectionKey<() => AppSnapshot> = Symbol('backendSnapshot');
const connectEngineKey: InjectionKey<() => void> = Symbol('connectEngine');
const backendHostKey: InjectionKey<() => { host: string; connections: ProviderConnection[] } | null> = Symbol('backendHost');
const remembered = ref<Record<string, AgentBackend>>({});
const preferenceKey = 'app:preferredEngines';

export function provideBackendSwitch(update: (id: string, backend: AgentBackend) => Promise<void>) {
  const busy = ref(false);
  let pending: Promise<void> | undefined;
  const context = {
    busy,
    select(id: string, backend: AgentBackend): Promise<void> {
      if (pending) return pending;
      busy.value = true;
      pending = update(id, backend).finally(() => { busy.value = false; pending = undefined; });
      return pending;
    },
    settled: () => pending ?? Promise.resolve(),
  };
  provide(backendSwitchKey, context);
  return context;
}

export function useBackendSwitch() {
  return inject(backendSwitchKey, undefined);
}

export function provideBackendChoices(snapshot: () => AppSnapshot, connect: () => void = () => undefined): void {
  provide(backendSnapshotKey, snapshot);
  provide(connectEngineKey, connect);
  try {
    const value: unknown = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}');
    remembered.value = value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, backend]) => isAgentBackend(backend)))
      : {};
  } catch { remembered.value = {}; }
  provide(backendChoicesKey, computed(() => enabledAgentBackends({ providerConnections: providerConnectionsForTeam(snapshot()) })));
}

export function useConnectEngine(): () => void {
  return inject(connectEngineKey, () => undefined);
}

export function useNewAgentBackend(backend: Ref<AgentBackend | undefined>, choices: ComputedRef<AgentBackend[]>) {
  watch(choices, enabled => {
    if (!backend.value || !enabled.includes(backend.value)) backend.value = enabled[0];
  }, { immediate: true });
}

export function useBackendChoices(teamId?: () => string | null | undefined): ComputedRef<AgentBackend[]> {
  const snapshot = inject(backendSnapshotKey, undefined);
  const hostOverride = inject(backendHostKey, undefined);
  const fallback = inject(backendChoicesKey, computed<AgentBackend[]>(() => []));
  return computed(() => {
    const override = hostOverride?.();
    if (override) return preferredChoices(enabledAgentBackends({ providerConnections: override.connections }), override.host);
    const state = snapshot?.();
    return state ? preferredBackendChoices(state, teamId?.() ?? state.activeTeamId) : fallback.value;
  });
}

/**
 * An agent on the team, or failing that on its host, to read the model catalog through.
 * An explicit id always wins so callers that already know the right agent stay in control.
 */
export function useCatalogAgentId(teamId?: () => string | null | undefined, explicit?: () => string | undefined): ComputedRef<string> {
  const snapshot = inject(backendSnapshotKey, undefined);
  return computed(() => {
    const given = explicit?.();
    if (given) return given;
    const state = snapshot?.();
    if (!state) return '';
    const id = teamId?.() ?? state.activeTeamId;
    const host = state.teams.find(team => team.id === id)?.remoteConnectionId;
    return state.agents.find(agent => agent.teamId === id)?.id
      ?? state.agents.find(agent => state.teams.find(team => team.id === agent.teamId)?.remoteConnectionId === host)?.id
      ?? '';
  });
}

/** The model and effort the user last chose for a provider; new agents start from it. */
export function useSavedModelSelection(backend: () => AgentBackend | undefined): ComputedRef<AgentModelSelection | undefined> {
  const snapshot = inject(backendSnapshotKey, undefined);
  return computed(() => {
    const current = backend();
    return current ? snapshot?.().general.providerModelDefaults?.[current] : undefined;
  });
}

/** The host an agent runs on; catalogs differ per host, so caches are keyed by it. */
export function useAgentHost(agentId: () => string): ComputedRef<string> {
  const snapshot = inject(backendSnapshotKey, undefined);
  return computed(() => {
    const state = snapshot?.();
    const teamId = state?.agents.find(agent => agent.id === agentId())?.teamId;
    return state?.teams.find(team => team.id === teamId)?.remoteConnectionId ?? 'local';
  });
}

export function preferredBackendChoices(state: AppSnapshot, teamId = state.activeTeamId): AgentBackend[] {
  const choices = enabledAgentBackends({ providerConnections: providerConnectionsForTeam(state, teamId) });
  const host = state.teams.find(team => team.id === teamId)?.remoteConnectionId ?? 'local';
  return preferredChoices(choices, host);
}

function preferredChoices(choices: AgentBackend[], host: string): AgentBackend[] {
  const preferred = remembered.value[host];
  return preferred && choices.includes(preferred) ? [preferred, ...choices.filter(choice => choice !== preferred)] : choices;
}

export function useRememberBackend(teamId?: () => string | null | undefined) {
  const snapshot = inject(backendSnapshotKey, undefined);
  const hostOverride = inject(backendHostKey, undefined);
  return (backend: AgentBackend) => {
    const state = snapshot?.();
    const host = hostOverride?.()?.host ?? state?.teams.find(team => team.id === (teamId?.() ?? state.activeTeamId))?.remoteConnectionId ?? 'local';
    remembered.value = { ...remembered.value, [host]: backend };
    try { localStorage.setItem(preferenceKey, JSON.stringify(remembered.value)); } catch { /* Session preference remains usable. */ }
  };
}

export function provideBackendHost(host: () => { host: string; connections: ProviderConnection[] } | null) {
  provide(backendHostKey, host);
}
