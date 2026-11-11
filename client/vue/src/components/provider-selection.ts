import { computed, inject, provide, ref, watch, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import { enabledAgentProviders, providerConnectionsForHost } from '@workspace/core/agent-providers';
import type { HarnessProvider, ExecutionSelection, AppSnapshot } from '@workspace/core/contracts';
import { useGeneralPreferences } from '../general-preferences';
import { ElMessage } from 'element-plus';
import type { ProviderConnection } from '@workspace/core/contracts/provider-setup';

export const providerChoicesKey: InjectionKey<ComputedRef<HarnessProvider[]>> = Symbol('providerChoices');
type ProviderSwitch = ReturnType<typeof provideProviderSwitch>;
const providerSwitchKey: InjectionKey<ProviderSwitch> = Symbol('backendSwitch');
export const backendSnapshotKey: InjectionKey<() => AppSnapshot> = Symbol('backendSnapshot');
const connectEngineKey: InjectionKey<() => void> = Symbol('connectEngine');
const backendHostKey: InjectionKey<() => { host: string; connections: ProviderConnection[] } | null> = Symbol('backendHost');

export function provideProviderSwitch(update: (id: string, provider: HarnessProvider) => Promise<void>) {
  const busy = ref(false);
  let pending: Promise<void> | undefined;
  const context = {
    busy,
    select(id: string, provider: HarnessProvider): Promise<void> {
      if (pending) return pending;
      busy.value = true;
      pending = update(id, provider).finally(() => { busy.value = false; pending = undefined; });
      return pending;
    },
    settled: () => pending ?? Promise.resolve(),
  };
  provide(providerSwitchKey, context);
  return context;
}

export function useProviderSwitch() {
  return inject(providerSwitchKey, undefined);
}

export function provideProviderChoices(snapshot: () => AppSnapshot, connect: () => void = () => undefined): void {
  provide(backendSnapshotKey, snapshot);
  provide(connectEngineKey, connect);
  provide(providerChoicesKey, computed(() => enabledAgentProviders({ providerConnections: providerConnectionsForHost(snapshot()) })));
}

export function useConnectEngine(): () => void {
  return inject(connectEngineKey, () => undefined);
}

export function useNewAgentProvider(provider: Ref<HarnessProvider | undefined>, choices: ComputedRef<HarnessProvider[]>, active: () => boolean = () => true) {
  watch([choices, active], ([enabled, visible]) => {
    if (!visible) return;
    if (!provider.value || !enabled.includes(provider.value)) provider.value = enabled[0];
  }, { immediate: true });
}

/** Engines usable on one host; local when no connection is given. */
export function useProviderChoices(host?: () => string | null | undefined): ComputedRef<HarnessProvider[]> {
  const snapshot = inject(backendSnapshotKey, undefined);
  const preferences = useGeneralPreferences();
  const hostOverride = inject(backendHostKey, undefined);
  const fallback = inject(providerChoicesKey, computed<HarnessProvider[]>(() => []));
  return computed(() => {
    const override = hostOverride?.();
    const remembered = preferences?.general().preferredProviders ?? snapshot?.().general.preferredProviders;
    if (override) return preferredChoices(enabledAgentProviders({ providerConnections: override.connections }), override.host, remembered);
    const state = snapshot?.();
    return state ? preferredChoices(enabledAgentProviders({ providerConnections: providerConnectionsForHost(state, host?.()) }), host?.() || 'local', remembered) : fallback.value;
  });
}

/**
 * An agent on a host to read the model catalog through.
 * An explicit id always wins so callers that already know the right agent stay in control.
 */
export function useCatalogAgentId(host?: () => string | null | undefined, explicit?: () => string | undefined): ComputedRef<string> {
  const snapshot = inject(backendSnapshotKey, undefined);
  return computed(() => {
    const given = explicit?.();
    if (given) return given;
    const state = snapshot?.();
    if (!state) return '';
    const connectionId = host?.() ?? undefined;
    return state.agents.find(agent => agent.remoteConnectionId === connectionId)?.id ?? '';
  });
}

/** The model and effort the user last chose for a provider; new agents start from it. */
export function useSavedModelSelection(provider: () => HarnessProvider | undefined): ComputedRef<ExecutionSelection | undefined> {
  const snapshot = inject(backendSnapshotKey, undefined);
  return computed(() => {
    const current = provider();
    return current ? snapshot?.().general.providerModelDefaults?.[current] : undefined;
  });
}

/** The host an agent runs on; catalogs differ per host, so caches are keyed by it. */
export function useAgentHost(agentId: () => string): ComputedRef<string> {
  const snapshot = inject(backendSnapshotKey, undefined);
  return computed(() => {
    const state = snapshot?.();
    return state?.agents.find(agent => agent.id === agentId())?.remoteConnectionId ?? 'local';
  });
}

export function preferredProviderChoices(state: AppSnapshot, remoteConnectionId?: string | null): HarnessProvider[] {
  const choices = enabledAgentProviders({ providerConnections: providerConnectionsForHost(state, remoteConnectionId) });
  return preferredChoices(choices, remoteConnectionId || 'local', state.general.preferredProviders);
}

function preferredChoices(choices: HarnessProvider[], host: string, remembered?: Record<string, HarnessProvider>): HarnessProvider[] {
  const preferred = remembered?.[host];
  return preferred && choices.includes(preferred) ? [preferred, ...choices.filter(choice => choice !== preferred)] : choices;
}

export function useRememberProvider(remoteConnectionId?: () => string | null | undefined) {
  const hostOverride = inject(backendHostKey, undefined);
  const preferences = useGeneralPreferences();
  return (provider: HarnessProvider) => {
    const host = hostOverride?.()?.host ?? remoteConnectionId?.() ?? 'local';
    void preferences?.update(general => ({ preferredProviders: { ...general.preferredProviders, [host]: provider } }))
      .catch(cause => ElMessage.error(cause instanceof Error ? cause.message : String(cause)));
  };
}

export function provideBackendHost(host: () => { host: string; connections: ProviderConnection[] } | null) {
  provide(backendHostKey, host);
}
