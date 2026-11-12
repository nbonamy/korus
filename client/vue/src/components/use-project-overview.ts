import { onMounted, onUnmounted, ref, watch } from 'vue';
import type { ProjectOverview } from '@workspace/core/project-overview';
import { appApi } from '../platform-api';

const refreshInterval = 60_000;
const activityDebounce = 2_000;

/**
 * Loads one repository's overview and keeps its flow live while the page can be seen: on activity,
 * debounced, and once a minute. The narrative is rewritten on request only when it is missing or stale;
 * the daemon decides whether that spends anything.
 */
export function useProjectOverview(agentId: () => string, activityKey: () => string) {
  const overview = ref<ProjectOverview | null>(null);
  const failed = ref(false);
  const writing = ref(false);
  const now = ref(Date.now());
  // A newer load, another repository or unmount makes older responses stale.
  let generation = 0;
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const hidden = () => typeof document !== 'undefined' && document.hidden;

  async function load(): Promise<void> {
    const current = ++generation;
    const id = agentId();
    try {
      const result = await appApi!.getProjectOverview(id);
      if (disposed || current !== generation) return;
      overview.value = result;
      failed.value = false;
      now.value = Date.now();
      if ((result.narrative.status === 'stale' || result.narrative.status === 'missing') && !writing.value) {
        writing.value = true;
        try {
          const written = await appApi!.refreshProjectNarrative(id);
          if (!disposed && current === generation) overview.value = written;
        } catch {
          // The flow stays; the narrative is asked for again on a later load.
        } finally {
          if (!disposed) writing.value = false;
        }
      }
    } catch {
      if (!disposed && current === generation) failed.value = overview.value === null;
    }
  }

  onMounted(() => {
    void load();
    timer = setInterval(() => { if (!hidden()) void load(); }, refreshInterval);
  });
  watch(activityKey, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { if (!hidden()) void load(); }, activityDebounce);
  });
  watch(agentId, () => {
    overview.value = null;
    failed.value = false;
    void load();
  });
  onUnmounted(() => {
    disposed = true;
    clearInterval(timer);
    clearTimeout(debounce);
  });

  return { overview, failed, writing, now };
}
