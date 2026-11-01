import type { AutomationLocation, WorkIntegrationConnection, WorkProviderKind } from '@workspace/core/contracts';
import { computed, inject, provide, ref, watch, type InjectionKey } from 'vue';
import { appApi } from '../platform-api';

type Connections = () => WorkIntegrationConnection[];
export const backlogConnectionsKey: InjectionKey<Connections> = Symbol('backlogConnections');

export function provideBacklogConnections(connections: Connections): void {
  provide(backlogConnectionsKey, connections);
}

/** Resolve connections on the host that owns the backlog, never the execution repository. */
export function useBacklogConnections(location: () => AutomationLocation | undefined): Connections {
  const local = inject(backlogConnectionsKey, () => []);
  const remote = ref<WorkIntegrationConnection[]>([]);
  watch(() => location()?.kind === 'remote' ? JSON.stringify(location()) : '', async (key, _, onCleanup) => {
    let current = true;
    onCleanup(() => { current = false; });
    remote.value = [];
    if (!key) return;
    try {
      const snapshot = await appApi?.getAutomationSnapshot(location());
      if (current) remote.value = snapshot?.workBacklog.connections ?? [];
    } catch { /* An unavailable host has no selectable providers. */ }
  }, { immediate: true });
  return () => location()?.kind === 'remote' ? remote.value : local();
}

/** Share connection filtering and fallback selection across backlog surfaces. */
export function useBacklogProviders(connections: Connections, initial: WorkProviderKind = 'github', accepts: (provider: WorkProviderKind) => boolean = () => true) {
  const preferred = ref(initial);
  const providers = computed(() => connections().filter(connection => connection.status === 'connected' && accepts(connection.provider)).map(connection => connection.provider));
  const provider = computed({
    get: () => providers.value.includes(preferred.value) ? preferred.value : providers.value[0] ?? initial,
    set: (value: WorkProviderKind) => { if (providers.value.includes(value)) preferred.value = value; },
  });
  return { providers, provider };
}
