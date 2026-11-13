import { onMounted, onUnmounted, ref, watch } from 'vue';
import {
  projectOverviewSourceFailed,
  projectOverviewSourcesReading,
  type ProjectOverview,
  type ProjectOverviewOuterSource,
} from '@workspace/core/project-overview';
import type { AppApi } from '@workspace/core/contracts';
import { appApi } from '../platform-api';

const refreshInterval = 60_000;
const activityDebounce = 2_000;

const outerSources: readonly ProjectOverviewOuterSource[] = ['backlog', 'pullRequests', 'pipelines'];

/**
 * Loads one repository's overview and keeps its flow live while the page can be seen: on activity,
 * debounced, and once a minute. The first read shows the repository at once and each tool as it answers;
 * later reads replace the whole picture when they land, so nothing goes back to loading.
 * The narrative is rewritten on request only when it is missing or stale, after every tool has answered;
 * the daemon decides whether that spends anything.
 */
/** The two reads the page makes; a debug preview supplies scripted ones. */
export type ProjectOverviewReads = Pick<AppApi, 'getProjectOverview' | 'refreshProjectNarrative'>;

export function useProjectOverview(agentId: () => string, activityKey: () => string, reads?: ProjectOverviewReads) {
  const api = () => reads ?? appApi!;
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

  /** Reads the repository, then asks for each tool separately; every answer is the daemon's latest picture. */
  async function stagedRead(id: string, current: number): Promise<ProjectOverview | null> {
    const stale = () => disposed || current !== generation;
    let latest = await api().getProjectOverview(id, []);
    if (stale()) return null;
    const lost = new Set<ProjectOverviewOuterSource>();
    const show = () => {
      overview.value = [...lost].reduce(projectOverviewSourceFailed, latest);
      now.value = Date.now();
    };
    show();
    failed.value = false;
    const waiting = outerSources.filter(source => latest.sources[source] === 'loading');
    await Promise.all(waiting.map(source => api().getProjectOverview(id, [source]).then(
      answer => {
        // The daemon's answers only ever add sources; one that knows less arrived out of order.
        if (stale() || projectOverviewSourcesReading(answer.sources) > projectOverviewSourcesReading(latest.sources)) return;
        latest = answer;
        show();
      },
      () => {
        if (stale()) return;
        lost.add(source);
        show();
      },
    )));
    return stale() ? null : overview.value;
  }

  async function load(): Promise<void> {
    const current = ++generation;
    const id = agentId();
    try {
      let result: ProjectOverview | null;
      if (overview.value === null) {
        result = await stagedRead(id, current);
        if (!result) return;
      } else {
        result = await api().getProjectOverview(id);
        if (disposed || current !== generation) return;
        overview.value = result;
        failed.value = false;
        now.value = Date.now();
      }
      if ((result.narrative.status === 'stale' || result.narrative.status === 'missing') && !writing.value) {
        writing.value = true;
        try {
          const written = await api().refreshProjectNarrative(id);
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
