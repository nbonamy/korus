import { ref } from 'vue';
import type { UsageSummary } from '@workspace/core/usage';
import { appApi } from '../platform-api';

/** The ledger's lifetime totals per agent, read on demand so no screen polls for a figure few people look at. */
export function useUsageByAgent() {
  const summary = ref<UsageSummary | null>(null);
  const loaded = ref(false);
  let generation = 0;

  async function refresh(): Promise<void> {
    const current = ++generation;
    try {
      const next = await appApi?.getUsage({ group: 'agentId' }) ?? null;
      if (current === generation) summary.value = next;
    } catch {
      if (current === generation) summary.value = null;
    } finally {
      if (current === generation) loaded.value = true;
    }
  }

  return { summary, loaded, refresh };
}
