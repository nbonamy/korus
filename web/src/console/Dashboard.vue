<template>
  <div class="console-shell">
    <ConsoleNavigation :product-name="productName" :page="page" />
    <main :class="`page-${page}`">
      <header class="masthead">
        <div>
          <h1 ref="heading" tabindex="-1">{{ pageTitle }}</h1>
        </div>
        <ElButton
          class="refresh-button"
          aria-label="Refresh metrics"
          @click="load"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"
            /></svg
          >Refresh
        </ElButton>
      </header>
      <div class="report-controls">
        <form
          class="range-controls"
          aria-label="Reporting range"
          @submit.prevent="load"
        >
          <ElSegmented
            class="presets"
            :model-value="selectedRange"
            :options="[
              { label: '7d', value: 7 },
              { label: '30d', value: 30 },
              { label: '90d', value: 90 },
            ]"
            aria-label="Recent ranges"
            @change="recent(Number($event))"
          />
          <div class="date-range-fields">
            <ElDatePicker
              v-model="from"
              class="range-date"
              type="date"
              format="YYYY-MM-DD"
              value-format="YYYY-MM-DD"
              :clearable="false"
              aria-label="From UTC day"
              :disabled-date="futureDay"
            />
            <span class="date-separator" aria-hidden="true">to</span>
            <ElDatePicker
              v-model="to"
              class="range-date"
              type="date"
              format="YYYY-MM-DD"
              value-format="YYYY-MM-DD"
              :clearable="false"
              aria-label="To UTC day"
              :disabled-date="futureDay"
            />
            <ElButton native-type="submit">Apply range</ElButton>
          </div>
        </form>
        <section
          v-show="page !== 'activity'"
          class="filters"
          aria-label="Usage filters"
        >
          <ElSelect
            v-model="provider"
            :empty-values="[null, undefined]"
            placeholder="All providers"
            aria-label="Provider"
            filterable
            popper-class="console-options"
            @change="load"
          >
            <ElOption label="All providers" value="" />
            <ElOption
              v-for="item in [
                { value: 'codex', label: 'Codex' },
                { value: 'claude', label: 'Claude' },
                { value: 'antigravity', label: 'Antigravity' },
              ]"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </ElSelect>
          <ElSelect
            v-model="model"
            :empty-values="[null, undefined]"
            placeholder="All models"
            aria-label="Model"
            filterable
            popper-class="console-options"
            @change="load"
          >
            <ElOption label="All models" value="" />
            <ElOption label="Unknown model" value="unknown" />
            <ElOption
              v-for="item in telemetryModels"
              :key="item"
              :label="item"
              :value="item"
            />
          </ElSelect>
          <AppMenuButton
            ariaLabel="Analytics options"
            :items="optionsItems"
            @select="toggleServiceTiers"
          >
            <template #trigger="{ attrs }">
              <ElTooltip content="Analytics options" placement="top">
                <span class="console-options-tooltip">
                  <button
                    v-bind="attrs"
                    type="button"
                    class="app-icon-button console-options-trigger"
                    aria-label="Analytics options"
                  >
                    <DotsVerticalIcon aria-hidden="true" />
                  </button>
                </span>
              </ElTooltip>
            </template>
          </AppMenuButton>
        </section>
      </div>
      <p class="freshness">
        <span class="status-dot" aria-hidden="true" />
        <template v-if="data"
          >Latest report
          {{ data.availability.lastDay ?? "not available" }}</template
        ><template v-else>Completed daily reports</template><span>· UTC</span>
      </p>
      <p v-if="loading" role="status" class="state panel">Loading metrics…</p>
      <p v-else-if="error" role="alert" class="state panel">{{ error }}</p>
      <template v-else-if="data">
        <section
          v-if="page === 'overview' || page === 'activity'"
          aria-label="Global activity"
          class="overview-section"
        >
          <div class="section-heading">
            <h2>Installations</h2>
            <span class="muted">As of {{ data.range.to }} UTC</span>
          </div>
          <dl class="cards">
            <div class="panel" aria-label="Participating installs">
              <dt>Participating installs</dt>
              <dd>{{ count(data.overview.participatingInstalls) }}</dd>
              <small>Opted-in installations</small>
            </div>
            <div class="panel" aria-label="Daily active installs">
              <dt>Daily active</dt>
              <dd>{{ count(data.overview.dau) }}</dd>
              <small>{{ data.range.to }} UTC</small>
            </div>
            <div class="panel" aria-label="Weekly active installs">
              <dt>Weekly active</dt>
              <dd>{{ count(data.overview.wau) }}</dd>
              <small>Last 7 days</small>
            </div>
            <div class="panel" aria-label="Monthly active installs">
              <dt>Monthly active</dt>
              <dd>{{ count(data.overview.mau) }}</dd>
              <small>Last 30 days</small>
            </div>
          </dl>
        </section>
        <p
          v-if="page !== 'activity' && data.totals.groups === '0'"
          class="state panel"
        >
          No usage for this selection.
        </p>
        <div
          v-if="!['activity', 'performance', 'models'].includes(page)"
          class="section-heading usage-heading"
        >
          <h2>Usage</h2>
          <span class="muted">Selected range · provider and model filters</span>
        </div>
        <dl
          v-if="!['activity', 'performance', 'models'].includes(page)"
          class="cards usage-totals"
        >
          <div class="panel" aria-label="Turns">
            <dt>Turns</dt>
            <dd>{{ count(data.totals.turns) }}</dd>
            <small>Selected range</small>
          </div>
          <div
            v-if="page !== 'spend'"
            class="panel"
            aria-label="Measured total tokens"
          >
            <dt>Total tokens</dt>
            <dd :title="count(data.totals.totalTokens)">
              {{ tokens(data.totals.totalTokens) }}
            </dd>
            <small
              >Input + output<template
                v-if="data.totals.excludedTokenGroups !== '0'"
              >
                · {{ count(data.totals.excludedTokenGroups) }} groups
                excluded</template
              ></small
            >
          </div>
          <div
            v-if="page !== 'tokens'"
            class="panel"
            aria-label="Known estimated spend"
          >
            <dt>Estimated spend</dt>
            <dd :title="exactMoney(data.totals.estimatedCostUsd)">
              {{ money(data.totals.estimatedCostUsd) }}
            </dd>
            <small
              >API-equivalent · {{ data.totals.costCoverage
              }}<template v-if="data.totals.unknownCostGroups !== '0'">
                · {{ count(data.totals.unknownCostGroups) }} unknown</template
              ></small
            >
          </div>
          <div
            v-if="page === 'overview' || page === 'tokens'"
            class="panel"
            aria-label="Measured cache-read share"
          >
            <dt>Cache-read share</dt>
            <dd>{{ percent(data.totals.cacheReadShare) }}</dd>
            <small
              >Share of measured input<template
                v-if="data.totals.excludedCacheGroups !== '0'"
              >
                · {{ count(data.totals.excludedCacheGroups) }} groups
                excluded</template
              ></small
            >
          </div>
        </dl>
        <MetricChart
          v-if="page === 'overview' || page === 'activity'"
          id="activity"
          title="Daily activity"
          description="Active and newly reporting installations · daily, UTC."
          :days="data.activity.map((row) => row.day)"
          :series="[
            {
              label: 'Active installs',
              values: data.activity.map((row) => row.activeInstalls),
            },
            {
              label: 'First reported installs',
              values: data.activity.map((row) => row.firstReportedInstalls),
            },
          ]"
          measure="count"
        />

        <div
          v-if="['overview', 'tokens', 'spend'].includes(page)"
          class="chart-grid"
        >
          <MetricChart
            v-if="page !== 'spend'"
            id="tokens"
            title="Weekly tokens"
            description="Input and output · weekly, UTC."
            :days="data.weekly.map((row) => row.week)"
            :series="[
              {
                label: 'Inclusive input',
                values: data.weekly.map((row) => row.pairedInputTokens ?? null),
              },
              {
                label: 'Output',
                values: data.weekly.map(
                  (row) => row.pairedOutputTokens ?? null,
                ),
              },
            ]"
            :notes="
              data.weekly.map(
                (row) =>
                  `${count(row.excludedTokenGroups)} incomplete token groups; ${count(row.unknownInputGroups)} unknown input; ${count(row.unknownOutputGroups)} unknown output`,
              )
            "
            measure="tokens"
            variant="stacked"
          />
          <MetricChart
            v-if="page !== 'tokens'"
            id="spend"
            title="Daily estimated spend"
            description="API-equivalent USD · gaps indicate unavailable estimates."
            :days="data.daily.map((row) => row.day)"
            :series="[
              {
                label: 'Estimated USD',
                values: data.daily.map((row) => row.estimatedCostUsd),
              },
            ]"
            :notes="
              data.daily.map(
                (row) =>
                  `${row.costCoverage}; ${count(row.unknownCostGroups)} unknown groups`,
              )
            "
            measure="usd"
            variant="bar"
          />
          <MetricChart
            v-if="page === 'tokens'"
            title="Cache-read share"
            description="Cached reads as a share of measured input · daily."
            :days="data.daily.map((row) => row.day)"
            :series="[
              {
                label: 'Cache-read share',
                values: data.daily.map((row) =>
                  row.cacheReadShare === null
                    ? null
                    : String(row.cacheReadShare),
                ),
              },
            ]"
            :notes="
              data.daily.map(
                (row) => `${count(row.excludedCacheGroups)} excluded groups`,
              )
            "
            measure="ratio"
          />
          <MetricChart
            v-if="page === 'tokens'"
            title="Measured input"
            description="Cached and non-cache-read input · weekly."
            :days="data.weekly.map((row) => row.week)"
            :series="[
              {
                label: 'Cache-read input',
                values: data.weekly.map((row) => row.cacheReadTokens),
              },
              {
                label: 'Non-cache-read input',
                values: data.weekly.map((row) => row.nonCacheReadTokens),
              },
            ]"
            :notes="
              data.weekly.map(
                (row) => `${count(row.excludedCacheGroups)} excluded groups`,
              )
            "
            measure="tokens"
            variant="stacked"
          />
        </div>
        <ModelsReport v-if="page === 'models'" :data="data" />
        <PerformanceReport v-if="page === 'performance'" :data="data" />
        <section
          v-if="page === 'models'"
          id="models"
          class="panel model-panel"
          aria-label="Provider and model"
        >
          <header class="panel-heading">
            <h2>Provider and model</h2>
            <span class="muted"
              >{{ data.models.length }}
              {{ data.range.groupServiceTiers ? "models" : "variants" }}</span
            >
          </header>
          <div
            class="table-scroll"
            tabindex="0"
            aria-label="Provider and model data"
          >
            <table>
              <caption class="sr-only">
                Usage by provider and canonical model
              </caption>
              <thead>
                <tr>
                  <th scope="col">Provider / model</th>
                  <th scope="col">Turns</th>
                  <th scope="col">Inclusive input</th>
                  <th scope="col">Cache reads</th>
                  <th scope="col">Output</th>
                  <th scope="col">Estimated USD</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in data.models"
                  :key="`${row.provider}/${row.model}/${row.serviceTier}`"
                >
                  <th scope="row">
                    <span class="provider">{{ row.provider }}</span
                    ><span>{{ modelLabel(row) }}</span>
                  </th>
                  <td>{{ count(row.turns) }}</td>
                  <td :title="count(row.inputTokens)">
                    {{ tokens(row.inputTokens)
                    }}<small v-if="row.unknownInputGroups !== '0'"
                      >{{ count(row.unknownInputGroups) }} unknown groups</small
                    >
                  </td>
                  <td :title="count(row.cachedInputTokens)">
                    {{ tokens(row.cachedInputTokens)
                    }}<small v-if="row.unknownCachedInputGroups !== '0'"
                      >{{ count(row.unknownCachedInputGroups) }} unknown
                      groups</small
                    >
                  </td>
                  <td :title="count(row.outputTokens)">
                    {{ tokens(row.outputTokens)
                    }}<small v-if="row.unknownOutputGroups !== '0'"
                      >{{ count(row.unknownOutputGroups) }} unknown
                      groups</small
                    >
                  </td>
                  <td :title="exactMoney(row.estimatedCostUsd)">
                    {{ money(row.estimatedCostUsd)
                    }}<small
                      >{{ row.costCoverage }} ·
                      {{ count(row.unknownCostGroups) }} unknown</small
                    >
                  </td>
                </tr>
                <tr v-if="!data.models.length">
                  <td colspan="6">No usage groups.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import { telemetryModels } from "@workspace/core/telemetry-models";
import {
  ElButton,
  ElDatePicker,
  ElSelect,
  ElOption,
  ElSegmented,
  ElTooltip,
} from "element-plus";
import AppMenuButton from "../../../vue/src/shared/menu/AppMenuButton.vue";
import {
  BoltIcon,
  DotsVerticalIcon,
} from "../../../vue/src/shared/icons/app-icons";
import ModelsReport from "./ModelsReport.vue";
import MetricChart from "./MetricChart.vue";
import PerformanceReport from "./PerformanceReport.vue";
import ConsoleNavigation from "./ConsoleNavigation.vue";
import {
  count,
  tokens,
  money,
  exactMoney,
  percent,
  completedDay,
} from "./format";
import { modelLabel } from "./model-label";
import { useMetrics } from "./use-metrics";
const productName =
  typeof __PRODUCT_NAME__ === "undefined" ? "Usage console" : __PRODUCT_NAME__;
const pageLabels = {
  overview: "Overview",
  activity: "Activity",
  tokens: "Tokens",
  spend: "Spend",
  models: "Models",
  performance: "Performance",
} as const;
type ConsolePage = keyof typeof pageLabels;
function readPage(): ConsolePage {
  const route = window.location.hash.slice(2);
  return Object.hasOwn(pageLabels, route) ? (route as ConsolePage) : "overview";
}
const page = ref<ConsolePage>(readPage());
const pageTitle = computed(() => pageLabels[page.value]);
const heading = ref<HTMLElement | null>(null);
watch(page, async () => {
  document.title = `${productName} · ${pageTitle.value}`;
  await nextTick();
  heading.value?.focus();
});
function navigate() {
  page.value = readPage();
}
onMounted(() => {
  document.title = `${productName} · ${pageTitle.value}`;
  window.addEventListener("hashchange", navigate);
});
onUnmounted(() => window.removeEventListener("hashchange", navigate));
const {
  from,
  to,
  provider,
  model,
  groupServiceTiers,
  data,
  loading,
  error,
  load,
  recent,
} = useMetrics();
const optionsItems = computed(() => [
  {
    id: "group-service-tiers",
    type: "checkbox" as const,
    label: "Group service tiers",
    icon: BoltIcon,
    checked: groupServiceTiers.value,
  },
]);
function toggleServiceTiers() {
  groupServiceTiers.value = !groupServiceTiers.value;
  void load();
}
const selectedRange = computed(() => {
  const days = (Date.parse(to.value) - Date.parse(from.value)) / 86400000 + 1;
  return to.value === completedDay() && [7, 30, 90].includes(days)
    ? days
    : undefined;
});
const futureDay = (date: Date) =>
  date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate() >
  Number(completedDay().replaceAll("-", ""));
</script>
