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
      <el-segmented
        :model-value="selectedPeriod"
        :options="
          [7, 30, 90].map((value) => ({
            value,
            label: $t('analytics.days', { count: value }),
          }))
        "
        size="small"
        :aria-label="$t('analytics.dateRange')"
        @change="setRange(Number($event))"
      />
      <div id="usage-provider" class="analytics-provider">
        <el-select
          v-model="filter.provider"
          :placeholder="$t('analytics.allProviders')"
          size="small"
          :aria-label="$t('telemetry.provider')"
          @change="load()"
          ><el-option
            value=""
            :label="$t('analytics.allProviders')" /><el-option
            v-for="provider in providers"
            :key="provider"
            :value="provider"
            :label="backendDisplayName(provider)"
        /></el-select>
      </div>
    </div>
    <div class="analytics-navigation">
      <el-tabs v-model="view"
        ><el-tab-pane
          name="usage"
          :label="$t('analytics.usageOverview')" /><el-tab-pane
          name="performance"
          :label="$t('analytics.performance')"
      /></el-tabs>
      <div v-if="view === 'usage'" id="usage-measure">
        <el-select
          v-model="measure"
          size="small"
          :aria-label="$t('analytics.measure')"
          ><el-option
            v-for="(label, value) in {
              turns: 'turns',
              total: 'totalTokens',
              input: 'inputTokens',
              output: 'outputTokens',
            }"
            :key="value"
            :value="value"
            :label="$t('analytics.' + label)"
        /></el-select>
      </div>
    </div>
    <p v-if="error" role="alert">{{ $t("analytics.loadError") }}</p>
    <p v-else-if="busy && !data" role="status">{{ $t("analytics.loading") }}</p>
    <template v-if="data">
      <section class="analytics-summary" :aria-label="$t('analytics.totals')">
        <article v-for="card in cards" :key="card.label">
          <strong>{{ card.value }}</strong
          ><span>{{ card.label }}</span>
        </article>
      </section>
      <p v-if="!data.rows.length" class="analytics-note">
        {{ $t("telemetry.empty") }}
      </p>
      <template v-if="view === 'usage'">
        <div class="analytics-charts">
          <UsageTrend
            class="analytics-panel"
            :daily="trendData?.daily ?? []"
            :series="trendSeries"
            :measure="measure"
            :from="filter.from"
            :to="filter.to"
            ><template #controls
              ><div id="usage-trend-group" class="analytics-group">
                <el-select
                  v-model="trendGroup"
                  size="small"
                  :aria-label="$t('analytics.dailyBreakdown')"
                  ><el-option
                    value="provider"
                    :label="$t('telemetry.provider')" /><el-option
                    value="model"
                    :label="$t('telemetry.model')"
                /></el-select></div></template
          ></UsageTrend>
          <UsageShare
            class="analytics-panel"
            :series="shareSeries"
            :measure="measure"
            ><template #controls
              ><div id="usage-share-group" class="analytics-group">
                <el-select
                  v-model="shareGroup"
                  size="small"
                  :aria-label="$t('analytics.shareBreakdown')"
                  ><el-option
                    value="provider"
                    :label="$t('telemetry.provider')" /><el-option
                    value="model"
                    :label="$t('telemetry.model')"
                /></el-select></div></template
          ></UsageShare>
        </div>
        <section
          class="analytics-panel analytics-breakdown"
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
                <th>{{ $t("analytics.turns") }}</th>
                <th>{{ $t("analytics.share") }}</th>
                <th>{{ $t("analytics.measuredTokens") }}</th>
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
                <td>{{ chartFormat(row.turns) }}</td>
                <td>
                  <span class="analytics-table-share"
                    ><span class="analytics-track"
                      ><span
                        :style="{
                          width:
                            (shareTotal && row.value !== null
                              ? (100 * row.value) / shareTotal
                              : 0) + '%',
                          background: row.color,
                        }" /></span
                    >{{
                      row.value === null || !shareTotal
                        ? $t("telemetry.unknown")
                        : chartFormat((100 * row.value) / shareTotal) + "%"
                    }}</span
                  >
                </td>
                <td>{{ chartFormat(row.tokens, true) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
      <section
        v-else
        class="analytics-panel analytics-performance"
        :aria-label="$t('analytics.textDelivery')"
      >
        <header>
          <h3>
            {{ $t("analytics.textDelivery") }}
            <small>{{ $t("analytics.charactersPerSecond") }}</small>
          </h3>
          <el-tooltip :content="$t('analytics.rateNote')"
            ><span
              tabindex="0"
              class="analytics-info"
              :aria-label="$t('analytics.rateNote')"
              >ⓘ</span
            ></el-tooltip
          >
        </header>
        <article
          v-for="row in breakdown"
          :key="row.label"
          class="analytics-rank"
        >
          <div>
            <span>{{ row.label }}</span
            ><strong
              >{{ chartFormat(row.value) }}
              {{
                row.value === null ? "" : $t("analytics.charactersPerSecond")
              }}</strong
            >
          </div>
          <div v-if="row.value !== null" class="analytics-track">
            <span :style="{ width: row.width + '%' }" />
          </div>
          <small>{{ $t("analytics.samples", { count: row.messages }) }}</small>
        </article>
      </section>
    </template>
    <details class="analytics-details">
      <summary>{{ $t("analytics.details") }}</summary>
      <div class="usage-table">
        <AppDataList
          v-if="data?.rows.length"
          :title="$t('telemetry.usage')"
          :columns="columns"
          :rows="rows"
        />
      </div>
    </details>
    <details class="analytics-details">
      <summary>{{ $t("telemetry.account") }}</summary>

      <button
        class="app-button"
        type="button"
        :disabled="accountBusy"
        @click="loadAccount"
      >
        {{ $t("telemetry.loadAccount") }}
      </button>
      <p v-if="accountRequested && !accountBusy && !account">
        {{ $t("telemetry.accountUnknown") }}
      </p>
      <AppDataList
        v-if="account"
        :title="$t('telemetry.account')"
        :columns="accountColumns"
        :rows="accountRows"
      />
      <AppDataList
        v-if="account?.dailyUsageBuckets"
        :title="$t('telemetry.accountDays')"
        :columns="dailyColumns"
        :rows="
          account.dailyUsageBuckets.slice(-90).map((b) => ({
            id: b.startDate,
            date: b.startDate,
            tokens: b.tokens,
          }))
        "
      />
    </details>
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
import type {
  UsageFilter,
  UsageSummary,
  AccountUsage,
} from "@workspace/core/usage";
import type { AgentBackend } from "@workspace/core/contracts";
import { backendDisplayName } from "@workspace/core/backend-driver";
import { appApi } from "../platform-api";
import { translate } from "../i18n";
import AppDataList from "./AppDataList.vue";
import UsageShare from "./UsageShare.vue";
import { chartSeries, chartFormat, type UsageGrouping } from "./usage-chart";
import { RefreshIcon } from "../shared/icons/app-icons";
import SettingsPanelFrame from "./SettingsPanelFrame.vue";
import UsageTrend from "./UsageTrend.vue";
type Measure = "turns" | "total" | "input" | "output";
type View = "usage" | "performance";
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
const projections = ref<{ provider: UsageSummary; model: UsageSummary } | null>(
  null,
);
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
const account = ref<AccountUsage | null>(null),
  accountBusy = ref(false),
  accountRequested = ref(false);
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
const cards = computed(() => {
  if (view.value === "performance") {
    const streams =
      data.value?.rows.flatMap((row) =>
        row.textStream ? [row.textStream] : [],
      ) ?? [];
    const characters = total(streams.map((row) => row.characters)),
      ms = total(streams.map((row) => row.durationMs));
    return [
      {
        label: translate("analytics.textDelivery"),
        value: format(ms ? (characters! * 1000) / ms : null),
      },
      {
        label: translate("analytics.measuredMessages"),
        value: format(
          streams.length
            ? streams.reduce((n, row) => n + row.messages, 0)
            : null,
        ),
      },
      {
        label: translate("analytics.characters"),
        value: format(characters),
      },
    ];
  }
  return [
    {
      label: translate("analytics.turns"),
      value: format(turns.value),
    },
    {
      label: translate("analytics.totalTokens"),
      value: chartFormat(
        total(data.value?.rows.map((row) => row.tokens?.total) ?? []),
        true,
      ),
    },
    {
      label: translate("analytics.tokenCoverage"),
      value: format(measured.value) + " / " + format(turns.value),
    },
  ];
});
const breakdown = computed(() => {
  const rows = projections.value?.model.rows ?? [];
  const max = Math.max(
    1,
    ...rows.map((row) =>
      row.textStream
        ? (row.textStream.characters * 1000) / row.textStream.durationMs
        : 0,
    ),
  );
  return rows
    .map((row) => ({
      label:
        row.label === "Unknown"
          ? translate("analytics.unknownModel")
          : row.label,
      value: row.textStream
        ? (row.textStream.characters * 1000) / row.textStream.durationMs
        : null,
      messages: row.textStream?.messages ?? 0,
    }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    .map((row) => ({ ...row, width: ((row.value ?? 0) * 100) / max }));
});
const shareTotal = computed(() =>
  shareSeries.value.reduce((n, row) => n + (row.value ?? 0), 0),
);
const columns = computed(() => [
  {
    id: "group",
    label: translate("telemetry.group"),
    width: "minmax(140px,1fr)",
  },
  { id: "turns", label: translate("analytics.turns") },
  ...(
    [
      "total",
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "reasoning",
    ] as const
  ).map((id) => ({
    id,
    label: translate(
      "analytics." +
        {
          total: "totalTokens",
          input: "inputTokens",
          output: "outputTokens",
          cacheRead: "cacheRead",
          cacheWrite: "cacheWrite",
          reasoning: "reasoning",
        }[id],
    ),
  })),
  { id: "measured", label: translate("analytics.tokenCoverage") },
]);
const rows = computed(
  () =>
    data.value?.rows.map((row) => ({
      id: row.label,
      group: row.label,
      turns: row.started,
      ...Object.fromEntries(
        [
          "total",
          "input",
          "output",
          "cacheRead",
          "cacheWrite",
          "reasoning",
        ].map((key) => [
          key,
          format(row.tokens?.[key as keyof NonNullable<typeof row.tokens>]),
        ]),
      ),
      measured: `${row.measuredTurns} / ${row.started}`,
    })) ?? [],
);
const accountColumns = computed(() => [
  { id: "metric", label: translate("telemetry.group") },
  { id: "value", label: translate("telemetry.value") },
]);
const dailyColumns = computed(() => [
  { id: "date", label: translate("telemetry.date") },
  { id: "tokens", label: translate("telemetry.tokens") },
]);
const accountRows = computed(() =>
  account.value
    ? Object.entries(account.value.summary).map(([key, value]) => ({
        id: key,
        metric: translate("telemetry." + key),
        value: value ?? translate("telemetry.unknown"),
      }))
    : [],
);
async function loadAccount(): Promise<void> {
  accountBusy.value = true;
  accountRequested.value = true;
  account.value = null;
  try {
    account.value = await appApi!.getAccountUsage(
      (filter.value.provider || "codex") as AgentBackend,
    );
  } catch {
    /* Unsupported/account errors stay unknown. */
  } finally {
    accountBusy.value = false;
  }
}

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
    const [provider, model] = await Promise.all([
      appApi!.getUsage({ ...query, group: "provider" }),
      appApi!.getUsage({ ...query, group: "model" }),
    ]);
    if (disposed || current !== generation) return;
    if (provider.available === false || model.available === false)
      throw Error("Unavailable");
    projections.value = { provider, model };
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
  gap: var(--space-6);
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface-lowest);
}
.analytics-date {
  white-space: nowrap;
}
.analytics-provider {
  width: 160px;
  margin-left: auto;
}
.analytics-navigation {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-top: var(--space-4);
}
.analytics-navigation :deep(.el-tabs) {
  flex: 1;
  min-width: 0;
}
.analytics-navigation :deep(.el-tabs__header) {
  margin-bottom: var(--space-4);
}
#usage-measure {
  width: 140px;
}
.analytics-summary {
  display: flex;
  flex-wrap: wrap;
  margin: var(--space-6) 0 var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface-lowest);
}
.analytics-summary article {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-8);
  flex: 1;
}
.analytics-summary strong {
  font-size: var(--font-size-20);
  font-weight: 600;
  white-space: nowrap;
}
.analytics-summary span {
  font-size: var(--font-size-12);
  color: var(--color-text-muted);
}
.analytics-summary article:last-child {
  flex: 0.9;
}
.analytics-summary article:last-child strong {
  font-size: var(--font-size-14);
}
.analytics-info {
  color: var(--color-text-muted);
  cursor: help;
  font-size: var(--font-size-12);
}
.analytics-charts {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: var(--space-8);
}
.analytics-panel {
  padding: var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  min-width: 0;
  background: var(--color-surface-lowest);
}
.analytics-group {
  width: 100px;
  flex-shrink: 0;
}
.analytics-breakdown,
.analytics-performance {
  margin-top: var(--space-8);
}
.analytics-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-6);
}
h3 {
  font-size: var(--font-size-14);
  font-weight: 600;
  margin: 0;
}
.analytics-breakdown {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-12);
}
th,
td {
  text-align: left;
  padding: var(--space-6) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
th {
  color: var(--color-text-muted);
  font-weight: 400;
}
th:first-child,
td:first-child {
  padding-left: 0;
}
td {
  white-space: nowrap;
}
.analytics-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: var(--space-4);
}
.analytics-table-share {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}
.analytics-track {
  display: block;
  height: 6px;
  background: var(--color-surface-high);
  border-radius: 4px;
  overflow: hidden;
}
.analytics-table-share .analytics-track {
  width: clamp(70px, 12vw, 180px);
}
.analytics-track > span {
  display: block;
  height: 100%;
  background: var(--color-primary);
  border-radius: 4px;
}
.analytics-details {
  margin-top: var(--space-6);
  font-size: var(--font-size-12);
}
.analytics-details summary {
  cursor: pointer;
  color: var(--color-text-muted);
}
.analytics-details p,
.analytics-note,
small {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.usage-table {
  overflow: auto;
}
.analytics-rank {
  margin: var(--space-8) 0;
}
.analytics-rank > div:first-child {
  display: flex;
  justify-content: space-between;
  gap: var(--space-8);
  font-size: var(--font-size-14);
}
.analytics-rank .analytics-track {
  margin: var(--space-4) 0;
}
.analytics-rank strong {
  font-weight: 500;
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
  .analytics-charts {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .analytics-summary {
    flex-direction: column;
  }
  .analytics-toolbar {
    gap: var(--space-4);
  }
  .analytics-provider {
    margin-left: 0;
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
