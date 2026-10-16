import { computed, onMounted, onUnmounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import type { UsageFilter, UsageSummary } from "@workspace/core/usage";
import type { AgentBackend } from "@workspace/core/contracts";
import { appApi } from "../platform-api";
import { translate } from "../i18n";
import {
  activityWindow,
  chartSeries,
  type UsageGrouping,
  type UsageMeasure,
} from "./usage-chart";

export type UsageView = "usage" | "performance";
export type UsageProjections = {
  provider: UsageSummary;
  model: UsageSummary;
  /** The period before the selection, for the change badge. */
  previous: UsageSummary | null;
  /** The activity grid's own window, independent of every filter. */
  activity: UsageSummary | null;
};

const day = (at: number) => new Date(at).toISOString().slice(0, 10);
const POLL_MS = 5000;

/**
 * Owns the Analytics screen's filters, the projections read from the local
 * ledger, their refresh lifecycle and the clear action. Presentational
 * components receive what they show as props.
 */
export function useUsageAnalytics() {
  const view = ref<UsageView>("usage");
  const measure = ref<UsageMeasure>("total");
  const grouping = ref<UsageGrouping>("model");
  const filter = ref({
    from: day(Date.now() - 6 * 86400000),
    to: day(Date.now()),
    provider: "",
  });
  const projections = ref<UsageProjections | null>(null);
  const busy = ref(false);
  const error = ref(false);
  const clearing = ref(false);
  const clearError = ref(false);

  const selectedPeriod = computed(
    () =>
      [7, 30, 90].find(
        (days) =>
          filter.value.to === day(Date.now()) &&
          filter.value.from === day(Date.now() - (days - 1) * 86400000),
      ) ?? null,
  );
  const periodDays = computed(
    () =>
      Math.round(
        (Date.parse(filter.value.to) - Date.parse(filter.value.from)) /
          86400000,
      ) + 1,
  );
  const dateLabel = computed(
    () =>
      new Date(filter.value.from + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }) +
      " – " +
      new Date(filter.value.to + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
  );
  const grouped = computed(() => projections.value?.[grouping.value]);
  const series = computed(() =>
    chartSeries(grouped.value, measure.value, grouping.value),
  );
  const daily = computed(() => grouped.value?.daily ?? []);
  const activityDays = computed(
    () =>
      projections.value?.activity?.daily?.map((row) => ({
        day: row.day,
        tokens: row.tokens?.total ?? null,
      })) ?? null,
  );

  // A newer request, a clear or unmount makes older responses stale.
  let generation = 0;
  let disposed = false;
  const providerQuery = () =>
    filter.value.provider
      ? { provider: filter.value.provider as AgentBackend }
      : {};

  async function load(background = false): Promise<void> {
    const current = ++generation;
    busy.value = true;
    error.value = false;
    if (!background) projections.value = null;
    try {
      const query: UsageFilter = {
        from: filter.value.from,
        to: filter.value.to,
        ...providerQuery(),
      };
      const days = periodDays.value;
      const [provider, model, activity, previous] = await Promise.all([
        appApi!.getUsage({ ...query, group: "provider" }),
        appApi!.getUsage({ ...query, group: "model" }),
        // Context only: failing to read these never blocks the view. The
        // activity grid is a lifetime overview, so no filter applies to it.
        appApi!
          .getUsage({ ...activityWindow(), group: "provider" })
          .catch(() => null),
        appApi!
          .getUsage({
            ...query,
            from: day(Date.parse(filter.value.from) - days * 86400000),
            to: day(Date.parse(filter.value.from) - 86400000),
            group: "provider",
          })
          .catch(() => null),
      ]);
      if (disposed || current !== generation) return;
      if (provider.available === false || model.available === false)
        throw Error("Unavailable");
      projections.value = {
        provider,
        model,
        activity: activity?.available === false ? null : activity,
        previous: previous?.available === false ? null : previous,
      };
    } catch {
      if (!disposed && current === generation) {
        error.value = true;
        projections.value = null;
      }
    } finally {
      if (!disposed && current === generation) busy.value = false;
    }
  }
  function setRange(days: number): void {
    filter.value.from = day(Date.now() - (days - 1) * 86400000);
    filter.value.to = day(Date.now());
    void load();
  }
  function setDate(key: "from" | "to", value: string): void {
    filter.value[key] = value;
    void load();
  }
  function setProvider(provider: string): void {
    filter.value.provider = provider;
    void load();
  }
  async function clearStatistics(): Promise<void> {
    try {
      await ElMessageBox.confirm(
        translate("analytics.clearConfirmation"),
        translate("analytics.clearTitle"),
        {
          confirmButtonText: translate("analytics.clearConfirm"),
          cancelButtonText: translate("common.cancel"),
          type: "warning",
        },
      );
    } catch {
      return;
    }
    clearing.value = true;
    clearError.value = false;
    generation++;
    try {
      await appApi!.clearUsage();
      await load();
    } catch {
      clearError.value = true;
    } finally {
      clearing.value = false;
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    void load();
    timer = setInterval(() => {
      if (!busy.value && !clearing.value && !document.hidden) void load(true);
    }, POLL_MS);
  });
  onUnmounted(() => {
    disposed = true;
    generation++;
    clearInterval(timer);
  });

  return {
    view,
    measure,
    grouping,
    filter,
    projections,
    busy,
    error,
    clearing,
    clearError,
    selectedPeriod,
    periodDays,
    dateLabel,
    daily,
    series,
    activityDays,
    load,
    setRange,
    setDate,
    setProvider,
    clearStatistics,
  };
}
