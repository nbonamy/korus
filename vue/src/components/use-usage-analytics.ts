import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import type { UsageFilter, UsageSummary } from "@workspace/core/usage";
import type { AgentBackend } from "@workspace/core/contracts";
import { appApi } from "../platform-api";
import { translate } from "../i18n";
import {
  activityWindow,
  browserTimeZone,
  localDay,
  shiftDay,
  chartSeries,
  type UsageGrouping,
  type UsageMeasure,
} from "./usage-chart";

export type UsageView = "usage" | "performance";
export type UsageProjections = {
  provider: UsageSummary;
  model: UsageSummary;
  /** Read only once someone groups by repository, so the other views do not pay for it. */
  repository?: UsageSummary;
  /** The period before the selection, for the change badge. */
  previous: UsageSummary | null;
  /** The activity grid's own window, independent of every filter. */
  activity: UsageSummary | null;
};

const today = () => localDay();

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
    from: shiftDay(today(), -6),
    to: today(),
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
          filter.value.to === today() &&
          filter.value.from === shiftDay(today(), -(days - 1)),
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
  // Ratios are not additive shares; keep the donut's denominator in tokens.
  const shareMeasure = computed(() => measure.value === "ratio" ? "total" : measure.value);
  const shareSeries = computed(() => measure.value === "ratio"
    ? chartSeries(grouped.value, "total", grouping.value) : series.value);
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
        timeZone: browserTimeZone(),
      };
      const days = periodDays.value;
      const [provider, model, activity, previous, repository] = await Promise.all([
        appApi!.getUsage({ ...query, group: "provider" }),
        appApi!.getUsage({ ...query, group: "model" }),
        // Context only: failing to read these never blocks the view. The
        // activity grid is a lifetime overview, so no filter applies to it.
        appApi!
          .getUsage({ ...activityWindow(), timeZone: browserTimeZone(), group: "provider" })
          .catch(() => null),
        appApi!
          .getUsage({
            ...query,
            from: shiftDay(filter.value.from, -days),
            to: shiftDay(filter.value.from, -1),
            group: "provider",
          })
          .catch(() => null),
        grouping.value === "repository"
          ? appApi!.getUsage({ ...query, group: "repository" })
          : Promise.resolve(undefined),
      ]);
      if (disposed || current !== generation) return;
      if (provider.available === false || model.available === false)
        throw Error("Unavailable");
      projections.value = {
        provider,
        model,
        ...(repository ? { repository } : {}),
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
    filter.value.from = shiftDay(today(), -(days - 1));
    filter.value.to = today();
    void load();
  }
  function setDate(key: "from" | "to", value: string): void {
    filter.value[key] = value;
    void load();
  }
  watch(grouping, (next) => {
    if (next === "repository" && !projections.value?.repository) void load(true);
  });
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

  // No timer: the Refresh button reads again on demand, and the page catches up when it becomes visible.
  const refresh = () => {
    if (!busy.value && !clearing.value && !document.hidden) void load(true);
  };
  onMounted(() => {
    void load();
    document.addEventListener("visibilitychange", refresh);
  });
  onUnmounted(() => {
    disposed = true;
    generation++;
    document.removeEventListener("visibilitychange", refresh);
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
    shareSeries,
    shareMeasure,
    activityDays,
    load,
    setRange,
    setDate,
    setProvider,
    clearStatistics,
  };
}
