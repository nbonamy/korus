<template>
  <SettingsPanelFrame
    class="analytics"
    :title="$t('telemetry.usage')"
    title-id="usage-title"
  >
    <template #actions>
      <button
        class="app-button analytics-refresh"
        type="button"
        :aria-label="$t('telemetry.refresh')"
        :disabled="busy"
        @click="load()"
      >
        <RefreshIcon :size="14" />{{ $t("telemetry.refresh") }}
      </button>
    </template>
    <div class="analytics-toolbar">
      <div class="analytics-tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :id="'usage-tab-' + tab.name"
          :key="tab.name"
          class="analytics-tab"
          :class="{ 'analytics-tab--active': view === tab.name }"
          type="button"
          role="tab"
          :aria-selected="view === tab.name"
          @click="view = tab.name"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="analytics-filters">
        <UsageToggle
          :model-value="selectedPeriod"
          :options="
            [7, 30, 90].map((value) => ({
              value,
              label: $t('analytics.days', { count: value }),
            }))
          "
          :label="$t('analytics.dateRange')"
          @update:model-value="setRange($event)"
        />
        <el-popover trigger="click" :width="300"
          ><template #reference
            ><button
              class="app-button analytics-date"
              type="button"
              :aria-label="$t('analytics.dateRange')"
            >
              {{ dateLabel }} ⌄
            </button></template
          >
          <div class="analytics-date-fields">
            <label
              v-for="key in ['from', 'to'] as const"
              :key="key"
              :for="'usage-' + key"
              >{{ $t("telemetry." + key)
              }}<input
                :id="'usage-' + key"
                v-model="filter[key]"
                type="date"
                @change="load()"
            /></label>
          </div>
        </el-popover>
        <div id="usage-provider" class="analytics-provider">
          <UsageToggle
            :model-value="filter.provider"
            :options="providerOptions"
            :label="$t('telemetry.provider')"
            @update:model-value="
              filter.provider = $event;
              load();
            "
          />
        </div>
      </div>
    </div>
    <p v-if="error" class="analytics-note" role="alert">
      {{ $t("analytics.loadError") }}
    </p>
    <p v-else-if="busy && !data" class="analytics-note" role="status">
      {{ $t("analytics.loading") }}
    </p>
    <div
      v-if="data"
      class="analytics-content"
      :class="{ 'analytics-content--refreshing': busy }"
    >
      <p v-if="!data.rows.length" class="analytics-note">
        {{ $t("telemetry.empty") }}
      </p>
      <template v-if="view === 'usage'">
        <div class="analytics-bento">
          <UsageTrend
            class="analytics-card analytics-hero"
            :daily="trendData?.daily ?? []"
            :series="trendSeries"
            :measure="measure"
            :from="filter.from"
            :to="filter.to"
          >
            <template #header>
              <header class="hero-header">
                <div class="hero-figure">
                  <span class="hero-label">{{ measureLabel }}</span>
                  <div class="hero-number">
                    <strong>{{
                      chartFormat(heroTotal, measure !== "turns")
                    }}</strong>
                    <span
                      v-if="delta"
                      class="hero-delta"
                      :class="'hero-delta--' + delta.direction"
                      ><span aria-hidden="true">{{
                        { up: "▲", down: "▼", flat: "•" }[delta.direction]
                      }}</span>
                      {{ delta.text
                      }}<small>{{
                        $t("analytics.vsPrevious", { count: periodDays })
                      }}</small></span
                    >
                  </div>
                </div>
                <div class="hero-controls">
                  <div id="usage-measure" class="analytics-measure">
                    <UsageToggle
                      v-model="measure"
                      :options="measureOptions"
                      :label="$t('analytics.measure')"
                    />
                  </div>
                  <div id="usage-trend-group" class="analytics-group">
                    <UsageToggle
                      v-model="trendGroup"
                      :options="groupOptions"
                      :label="$t('analytics.dailyBreakdown')"
                    />
                  </div>
                </div>
              </header>
            </template>
          </UsageTrend>
          <UsageShare
            class="analytics-card analytics-share"
            :series="shareSeries"
            :measure="measure"
            :subtitle="measureLabel"
            ><template #controls
              ><div id="usage-share-group" class="analytics-group">
                <UsageToggle
                  v-model="shareGroup"
                  :options="groupOptions"
                  :label="$t('analytics.shareBreakdown')"
                /></div></template
          ></UsageShare>
        </div>
        <section class="analytics-tiles" :aria-label="$t('analytics.totals')">
          <article
            v-for="(card, index) in cards"
            :key="card.label"
            class="analytics-card analytics-stat"
          >
            <span class="analytics-stat__label">{{ card.label }}</span>
            <strong class="analytics-stat__value">{{ card.value }}</strong>
            <UsageSparkline
              v-if="card.spark"
              class="analytics-stat__spark"
              :style="{ color: `var(--chart-${index === 0 ? 1 : 7})` }"
              :values="card.spark"
            />
          </article>
          <article class="analytics-card analytics-stat analytics-mix">
            <span class="analytics-stat__label">{{
              $t("analytics.tokenMix")
            }}</span>
            <template v-if="tokenMix.length">
              <div
                class="mix-bar"
                role="img"
                :aria-label="$t('analytics.tokenMix')"
              >
                <span
                  v-for="part in tokenMix"
                  :key="part.id"
                  :style="{
                    flexGrow: part.value,
                    background: `linear-gradient(180deg, ${part.color}, color-mix(in srgb, ${part.color} 70%, transparent))`,
                  }"
                />
              </div>
              <ul class="mix-legend">
                <li v-for="part in tokenMix" :key="part.id">
                  <i :style="{ background: part.color }" />
                  <span>{{ part.label }}</span>
                  <b>{{ chartFormat(part.percent) }}%</b>
                </li>
              </ul>
            </template>
            <strong v-else class="analytics-stat__value">{{
              $t("telemetry.unknown")
            }}</strong>
            <div class="mix-coverage">
              <div
                class="analytics-meter"
                role="meter"
                :aria-valuenow="Math.round(coverage)"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="$t('analytics.tokenCoverage')"
              >
                <span :style="{ width: coverage + '%' }" />
              </div>
              <small>{{
                $t("analytics.measuredOf", {
                  measured: format(measured),
                  turns: format(turns),
                })
              }}</small>
            </div>
          </article>
        </section>
        <section
          class="analytics-card analytics-breakdown"
          :aria-label="$t('analytics.breakdown')"
        >
          <header>
            <h3>
              {{
                $t(
                  shareGroup === "provider"
                    ? "analytics.providerUsage"
                    : "analytics.modelUsage",
                )
              }}
            </h3>
            <el-tooltip :content="$t('analytics.shareNote')"
              ><span
                class="analytics-info"
                tabindex="0"
                :aria-label="$t('analytics.shareNote')"
                >ⓘ</span
              ></el-tooltip
            >
          </header>
          <table>
            <thead>
              <tr>
                <th>{{ $t("telemetry." + shareGroup) }}</th>
                <th class="num">{{ $t("analytics.turns") }}</th>
                <th>{{ $t("analytics.share") }}</th>
                <th class="num">{{ $t("analytics.measuredTokens") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in shareSeries" :key="row.key">
                <td>
                  <i
                    class="analytics-dot"
                    :style="{ background: row.color }"
                  />{{ row.label }}
                </td>
                <td class="num">{{ chartFormat(row.turns) }}</td>
                <td>
                  <span class="analytics-table-share"
                    ><span class="analytics-track"
                      ><span
                        :style="{
                          width:
                            (shareTotal && row.value !== null
                              ? (100 * row.value) / shareTotal
                              : 0) + '%',
                          background: `linear-gradient(90deg, color-mix(in srgb, ${row.color} 50%, transparent), ${row.color})`,
                        }" /></span
                    ><b>{{
                      row.value === null || !shareTotal
                        ? $t("telemetry.unknown")
                        : chartFormat((100 * row.value) / shareTotal) + "%"
                    }}</b></span
                  >
                </td>
                <td class="num">{{ chartFormat(row.tokens, true) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
      <template v-else>
        <section class="analytics-tiles" :aria-label="$t('analytics.totals')">
          <article
            v-for="card in cards"
            :key="card.label"
            class="analytics-card analytics-stat"
          >
            <span class="analytics-stat__label">{{ card.label }}</span>
            <strong class="analytics-stat__value">{{ card.value }}</strong>
          </article>
        </section>
        <section
          class="analytics-card analytics-performance"
          :aria-label="$t('analytics.textDelivery')"
        >
          <header>
            <div class="analytics-heading">
              <h3>{{ $t("analytics.textDelivery") }}</h3>
              <p>{{ $t("analytics.tokensPerSecond") }}</p>
            </div>
          </header>
          <article
            v-for="row in breakdown"
            :key="row.label"
            class="analytics-rank"
          >
            <div class="analytics-rank__head">
              <span class="analytics-rank__name"
                ><i
                  class="analytics-dot"
                  :style="{ background: row.color }"
                />{{ row.label
                }}<small>{{
                  $t("analytics.samples", { count: row.turns })
                }}</small></span
              ><strong
                >{{ chartFormat(row.value) }}
                <small v-if="row.value !== null">{{
                  $t("analytics.tokensPerSecond")
                }}</small
                ><small v-if="row.ttft !== null">
                  · {{ seconds(row.ttft) }}
                  {{ $t("analytics.toFirstToken") }}</small
                ></strong
              >
            </div>
            <div class="analytics-track analytics-track--thick">
              <span
                v-if="row.value !== null"
                :style="{
                  width: row.width + '%',
                  background: `linear-gradient(90deg, color-mix(in srgb, ${row.color} 50%, transparent), ${row.color})`,
                }"
              />
            </div>
          </article>
          <p class="analytics-footnote">{{ $t("analytics.rateNote") }}</p>
        </section>
      </template>
    </div>
    <div class="analytics-data-actions">
      <button
        class="app-button app-button--tertiary"
        type="button"
        :disabled="busy || clearing"
        @click="clearStatistics"
      >
        {{ $t(clearing ? "analytics.clearing" : "analytics.clear") }}
      </button>
      <p v-if="clearError" role="alert">{{ $t("analytics.clearError") }}</p>
    </div>
  </SettingsPanelFrame>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import type { UsageFilter, UsageSummary } from "@workspace/core/usage";
import type { AgentBackend } from "@workspace/core/contracts";
import { backendDisplayName } from "@workspace/core/backend-driver";
import { appApi } from "../platform-api";
import { translate } from "../i18n";
import UsageShare from "./UsageShare.vue";
import {
  chartSeries,
  chartFormat,
  averageTtftSeconds,
  sumSpeed,
  tokensPerSecond,
  type UsageGrouping,
} from "./usage-chart";
import { RefreshIcon } from "../shared/icons/app-icons";
import SettingsPanelFrame from "./SettingsPanelFrame.vue";
import UsageTrend from "./UsageTrend.vue";
import UsageSparkline from "./UsageSparkline.vue";
import UsageToggle from "./UsageToggle.vue";
type Measure = "turns" | "total" | "input" | "output";
type View = "usage" | "performance";
type DailyRow = NonNullable<UsageSummary["daily"]>[number];
const providers = ["codex", "claude", "antigravity"] as const;
const trendGroup = ref<UsageGrouping>("provider"),
  shareGroup = ref<UsageGrouping>("provider");
const view = ref<View>("usage"),
  measure = ref<Measure>("turns");
const day = (at: number) => new Date(at).toISOString().slice(0, 10);
const filter = ref({
  from: day(Date.now() - 6 * 86400000),
  to: day(Date.now()),
  provider: "",
});
const projections = ref<{
  provider: UsageSummary;
  model: UsageSummary;
  previous: UsageSummary | null;
} | null>(null);
const data = computed(
  () =>
    projections.value?.[
      view.value === "performance" ? "model" : shareGroup.value
    ] ?? null,
);
const trendData = computed(() => projections.value?.[trendGroup.value]);
const trendSeries = computed(() =>
  chartSeries(trendData.value, measure.value, trendGroup.value),
);
const shareSeries = computed(() =>
  chartSeries(data.value ?? undefined, measure.value, shareGroup.value),
);
const selectedPeriod = computed(
  () =>
    [7, 30, 90].find(
      (days) =>
        filter.value.to === day(Date.now()) &&
        filter.value.from === day(Date.now() - (days - 1) * 86400000),
    ) ?? null,
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
const busy = ref(false),
  error = ref(false);
const format = (value: number | null | undefined) =>
  value === null || value === undefined
    ? translate("telemetry.unknown")
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
        value,
      );
const total = (values: (number | null | undefined)[]) =>
  values.some((value) => value !== null && value !== undefined)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
const measured = computed(
  () => data.value?.rows.reduce((n, row) => n + row.measuredTurns, 0) ?? 0,
);
const turns = computed(
  () => data.value?.rows.reduce((n, row) => n + row.started, 0) ?? 0,
);
const measureLabel = computed(() =>
  translate(
    "analytics." +
      {
        turns: "turns",
        total: "totalTokens",
        input: "inputTokens",
        output: "outputTokens",
      }[measure.value],
  ),
);
const dailySeries = (pick: (row: DailyRow) => number | null | undefined) => {
  const days = new Map(
    (projections.value?.provider.daily ?? []).map((row) => [row.day, row]),
  );
  const values: number[] = [];
  for (
    let at = Date.parse(filter.value.from);
    at <= Date.parse(filter.value.to) && values.length < 90;
    at += 86400000
  ) {
    const row = days.get(new Date(at).toISOString().slice(0, 10));
    values.push(row ? (pick(row) ?? 0) : 0);
  }
  return values;
};
const providerOptions = computed(() => [
  { value: "", label: translate("analytics.allProviders") },
  ...providers.map((value) => ({
    value: value as string,
    label: backendDisplayName(value),
    color: `var(--chart-${{ codex: 1, claude: 2, antigravity: 3 }[value]})`,
  })),
]);
const measureOptions = computed(() => [
  { value: "turns" as const, label: translate("analytics.turns") },
  { value: "total" as const, label: translate("analytics.measureTotal") },
  { value: "input" as const, label: translate("analytics.measureInput") },
  { value: "output" as const, label: translate("analytics.measureOutput") },
]);
const groupOptions = computed(() => [
  { value: "provider" as const, label: translate("telemetry.provider") },
  { value: "model" as const, label: translate("telemetry.model") },
]);
const tabs = computed(() => [
  { name: "usage" as const, label: translate("analytics.usageOverview") },
  { name: "performance" as const, label: translate("analytics.performance") },
]);
const heroTotal = computed(() =>
  total(
    chartSeries(projections.value?.provider, measure.value, "provider").map(
      (item) => item.value,
    ),
  ),
);
const periodDays = computed(
  () =>
    Math.round(
      (Date.parse(filter.value.to) - Date.parse(filter.value.from)) / 86400000,
    ) + 1,
);
const delta = computed(() => {
  const previous = total(
    chartSeries(
      projections.value?.previous ?? undefined,
      measure.value,
      "provider",
    ).map((item) => item.value),
  );
  if (heroTotal.value === null || !previous) return null;
  const change = ((heroTotal.value - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(change) * 10) / 10;
  return {
    direction:
      rounded === 0
        ? ("flat" as const)
        : change > 0
          ? ("up" as const)
          : ("down" as const),
    text: chartFormat(rounded) + "%",
  };
});
const tokenMix = computed(() => {
  const rows = projections.value?.provider.rows ?? [];
  const parts = (
    [
      ["input", "inputTokens", "var(--chart-7)"],
      ["output", "outputTokens", "var(--chart-5)"],
      [
        "cacheRead",
        "cacheRead",
        "color-mix(in oklab, var(--chart-7) 50%, white)",
      ],
      [
        "cacheWrite",
        "cacheWrite",
        "color-mix(in oklab, var(--chart-5) 50%, white)",
      ],
      ["reasoning", "reasoning", "var(--chart-4)"],
    ] as const
  ).flatMap(([id, label, color]) => {
    const value = total(rows.map((row) => row.tokens?.[id]));
    return value
      ? [{ id, label: translate("analytics." + label), color, value }]
      : [];
  });
  const all = parts.reduce((n, part) => n + part.value, 0);
  return parts.map((part) => ({ ...part, percent: (100 * part.value) / all }));
});
const seconds = (value: number) =>
  translate("analytics.seconds", { value: chartFormat(value) });
const coverage = computed(() =>
  turns.value ? (100 * measured.value) / turns.value : 0,
);
const cards = computed<{ label: string; value: string; spark?: number[] }[]>(
  () => {
    if (view.value === "performance") {
      const speed = sumSpeed(data.value?.rows.map((row) => row.speed) ?? []);
      const ttft = averageTtftSeconds(speed);
      return [
        {
          label: translate("analytics.tokensPerSecond"),
          value: format(tokensPerSecond(speed)),
        },
        {
          label: translate("analytics.timeToFirstToken"),
          value: ttft === null ? format(null) : seconds(ttft),
        },
        {
          label: translate("analytics.timedTurns"),
          value: format(speed?.turns ?? null),
        },
      ];
    }
    return [
      {
        label: translate("analytics.turnsPerDay"),
        value: format(Math.round((turns.value / periodDays.value) * 10) / 10),
        spark: dailySeries((row) => row.started),
      },
      {
        label: translate("analytics.totalTokens"),
        value: chartFormat(
          total(data.value?.rows.map((row) => row.tokens?.total) ?? []),
          true,
        ),
        spark: dailySeries((row) => row.tokens?.total),
      },
    ];
  },
);
const breakdown = computed(() => {
  const rows = projections.value?.model.rows ?? [];
  const colors = new Map(
    chartSeries(projections.value?.model, "turns", "model").map((item) => [
      item.key,
      item.color,
    ]),
  );
  const max = Math.max(
    1,
    ...rows.map((row) => tokensPerSecond(row.speed) ?? 0),
  );
  return rows
    .map((row) => ({
      label:
        row.label === "Unknown"
          ? translate("analytics.unknownModel")
          : row.label,
      color: colors.get(row.label) ?? "var(--chart-1)",
      value: tokensPerSecond(row.speed),
      ttft: averageTtftSeconds(row.speed),
      turns: row.speed?.turns ?? 0,
    }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    .map((row) => ({ ...row, width: ((row.value ?? 0) * 100) / max }));
});
const shareTotal = computed(() =>
  shareSeries.value.reduce((n, row) => n + (row.value ?? 0), 0),
);
const clearing = ref(false),
  clearError = ref(false);
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
let generation = 0,
  disposed = false;
async function load(background = false): Promise<void> {
  const current = ++generation;
  busy.value = true;
  error.value = false;
  if (!background) projections.value = null;
  try {
    const query: UsageFilter = {
      from: filter.value.from,
      to: filter.value.to,
      ...(filter.value.provider
        ? { provider: filter.value.provider as AgentBackend }
        : {}),
    };
    const days = periodDays.value;
    const [provider, model, previous] = await Promise.all([
      appApi!.getUsage({ ...query, group: "provider" }),
      appApi!.getUsage({ ...query, group: "model" }),
      // The comparison period is context only; failing to read it never blocks the view.
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
function setRange(days: number) {
  filter.value.from = day(Date.now() - (days - 1) * 86400000);
  filter.value.to = day(Date.now());
  void load();
}
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void load();
  timer = setInterval(() => {
    if (!busy.value && !clearing.value && !document.hidden) void load(true);
  }, 5000);
});
onUnmounted(() => {
  disposed = true;
  generation++;
  clearInterval(timer);
});
</script>
<style scoped>
.analytics {
  font-variant-numeric: tabular-nums;
}
.analytics-refresh {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}
.analytics-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
}
.analytics-tabs {
  display: inline-flex;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
}
.analytics-tab {
  padding: var(--space-2) var(--space-8);
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition:
    background 140ms ease,
    color 140ms ease,
    box-shadow 140ms ease;
}
.analytics-tab:hover {
  color: var(--color-text);
}
.analytics-tab--active {
  background: var(--color-surface-lowest);
  color: var(--color-text);
  box-shadow: var(--shadow-sm);
}
.analytics-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}
.analytics-date {
  white-space: nowrap;
}
.analytics-provider {
  display: flex;
}
.analytics-content {
  display: grid;
  gap: var(--space-8);
  margin-top: var(--space-8);
  transition: opacity 160ms ease;
}
.analytics-content--refreshing {
  opacity: 0.6;
}
.analytics-card {
  min-width: 0;
  padding: var(--space-10);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-sm);
}
.analytics-bento {
  display: grid;
  grid-template-columns: minmax(0, 2.1fr) minmax(280px, 1fr);
  gap: var(--space-8);
}
.analytics-hero {
  padding: var(--space-12) var(--space-12) var(--space-8);
  background:
    radial-gradient(
      55% 60% at 0% 0%,
      color-mix(in srgb, var(--chart-1) 9%, transparent),
      transparent 70%
    ),
    radial-gradient(
      45% 55% at 100% 0%,
      color-mix(in srgb, var(--chart-2) 8%, transparent),
      transparent 70%
    ),
    var(--color-surface-lowest);
}
.hero-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-8);
  margin-bottom: var(--space-6);
}
.hero-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.hero-number {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-4) var(--space-6);
}
.hero-number strong {
  font-size: 56px;
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.035em;
  line-height: 1.05;
}
.hero-delta {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-4);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-text) 7%, transparent);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-bold);
}
.hero-delta small {
  margin-left: var(--space-2);
  font-weight: var(--font-weight-regular);
}
.hero-delta--up {
  background: color-mix(in srgb, var(--chart-3) 16%, transparent);
}
.hero-delta--down {
  background: color-mix(in srgb, var(--chart-2) 16%, transparent);
}
.hero-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-4);
}
.analytics-group {
  flex-shrink: 0;
}
.analytics-tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-8);
}
.analytics-stat {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow: hidden;
}
.analytics-stat__label {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
}
.analytics-stat__value {
  font-size: var(--font-size-28);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.02em;
  line-height: var(--line-height-32);
  white-space: nowrap;
}
.analytics-stat__spark {
  margin-top: var(--space-6);
}
.mix-bar {
  display: flex;
  gap: 2px;
  height: 14px;
  margin: var(--space-4) 0 var(--space-3);
}
.mix-bar > span {
  min-width: 4px;
  border-radius: var(--radius-sm);
}
.mix-legend {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--font-size-12);
}
.mix-legend li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.mix-legend span {
  flex: 1;
  color: var(--color-text-muted);
}
.mix-legend i {
  width: 8px;
  height: 8px;
  border-radius: 3px;
}
.mix-coverage {
  margin-top: auto;
  padding-top: var(--space-4);
}
.analytics-meter {
  height: 6px;
  margin-bottom: var(--space-2);
  overflow: hidden;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--chart-3) 14%, transparent);
}
.analytics-meter > span {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--chart-3) 55%, transparent),
    var(--chart-3)
  );
}
.analytics-info {
  color: var(--color-text-muted);
  cursor: help;
  font-size: var(--font-size-12);
}
.analytics-card > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-6);
}
.analytics-heading p {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
h3 {
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-bold);
  margin: 0;
}
.analytics-breakdown {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-13);
}
th,
td {
  text-align: left;
  padding: var(--space-4) var(--space-4);
  border-bottom: 1px solid
    color-mix(in srgb, var(--color-border) 60%, transparent);
}
th {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-regular);
}
tbody tr {
  transition: background 120ms ease;
}
tbody tr:hover {
  background: color-mix(in srgb, var(--color-text) 3%, transparent);
}
tbody tr:last-child td {
  border-bottom: 0;
}
th:first-child,
td:first-child {
  padding-left: 0;
}
th:last-child,
td:last-child {
  padding-right: 0;
}
.num {
  text-align: right;
}
td {
  white-space: nowrap;
}
.analytics-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  margin-right: var(--space-4);
}
.analytics-table-share {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}
.analytics-table-share b {
  min-width: 44px;
  font-weight: var(--font-weight-semibold);
}
.analytics-track {
  display: block;
  height: 6px;
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
  border-radius: var(--radius-full);
  overflow: hidden;
}
.analytics-track--thick {
  height: 10px;
}
.analytics-table-share .analytics-track {
  flex: 1;
  min-width: 70px;
  max-width: 280px;
}
.analytics-track > span {
  display: block;
  height: 100%;
  background: var(--color-primary);
  border-radius: var(--radius-full);
  transition: width 240ms ease;
}
.analytics-note,
small {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.analytics-footnote {
  margin: var(--space-8) 0 0;
}
.analytics-note {
  margin: var(--space-8) 0 0;
  padding: var(--space-12);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-2xl);
  text-align: center;
}
.analytics-rank {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-8);
}
.analytics-rank:first-of-type {
  margin-top: 0;
}
.analytics-rank__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-8);
  font-size: var(--font-size-13);
}
.analytics-rank__name small {
  margin-left: var(--space-4);
}
.analytics-rank strong {
  font-weight: var(--font-weight-bold);
}
.analytics-date-fields {
  display: flex;
  gap: var(--space-6);
}
.analytics-date-fields label {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  font-size: var(--font-size-12);
}
.analytics-date-fields input {
  width: 100%;
  box-sizing: border-box;
  color: var(--color-text);
  background: var(--color-surface-lowest);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: var(--space-3);
}
@media (max-width: 1100px) {
  .analytics-bento {
    grid-template-columns: minmax(0, 1fr);
  }
  .analytics-tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 720px) {
  .analytics-tiles {
    grid-template-columns: minmax(0, 1fr);
  }
  .hero-header {
    flex-direction: column;
  }
  .hero-number strong {
    font-size: 44px;
  }
}
.analytics-data-actions {
  margin-top: var(--space-6);
  padding-top: var(--space-6);
  border-top: 1px solid var(--color-border);
}
.analytics-data-actions p {
  color: var(--color-error);
  font-size: var(--font-size-12);
}
</style>
