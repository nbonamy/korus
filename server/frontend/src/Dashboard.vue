<template>
  <div class="console-shell">
    <ConsoleNavigation
      :product-name="productName"
      :signing-out="signingOut"
      :auth-error="authError"
      @sign-out="emit('signOut')"
    />
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
              aria-label="From day"
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
              aria-label="To day"
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
            <ElOption
              v-for="item in availableModels"
              :key="item"
              :label="item === 'unknown' ? 'Unknown model' : item"
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
        <template v-if="data?.availability.lastDay"
          >Latest report {{ data.availability.lastDay }} ·
        </template>
        <span>{{ timeZone }}</span>
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
            <span class="muted">As of {{ data.range.to }} {{ timeZone }}</span>
          </div>
          <dl class="cards">
            <div class="panel" aria-label="Participating installs">
              <dt>Participating installs</dt>
              <dd>{{ count(data.overview.participatingInstalls) }}</dd>
            </div>
            <div class="panel" aria-label="Daily active installs">
              <dt>Daily active</dt>
              <dd>{{ count(data.overview.dau) }}</dd>
            </div>
            <div class="panel" aria-label="Weekly active installs">
              <dt>Weekly active</dt>
              <dd>{{ count(data.overview.wau) }}</dd>
            </div>
            <div class="panel" aria-label="Monthly active installs">
              <dt>Monthly active</dt>
              <dd>{{ count(data.overview.mau) }}</dd>
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
        </div>
        <dl
          v-if="!['activity', 'performance', 'models'].includes(page)"
          class="cards usage-totals"
        >
          <div class="panel" aria-label="Turns">
            <dt>Turns</dt>
            <dd>{{ count(data.totals.turns) }}</dd>
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
          </div>
          <div
            v-if="page === 'overview' || page === 'tokens'"
            class="panel"
            aria-label="Measured cache-read share"
          >
            <dt>Cache-read share</dt>
            <dd>{{ percent(data.totals.cacheReadShare) }}</dd>
          </div>
        </dl>
        <MetricChart
          v-if="page === 'overview' || page === 'activity'"
          id="activity"
          title="Daily activity"
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
            :days="data.weekly.map((row) => row.week)"
            :series="[
              {
                label: 'Inclusive input',
                values: data.weekly.map((row) => row.inputTokens),
              },
              {
                label: 'Output',
                values: data.weekly.map((row) => row.outputTokens),
              },
            ]"
            measure="tokens"
            variant="stacked"
          />
          <MetricChart
            v-if="page !== 'tokens'"
            id="spend"
            title="Daily estimated spend"
            :days="data.daily.map((row) => row.day)"
            :series="[
              {
                label: 'Estimated USD',
                values: data.daily.map((row) => row.estimatedCostUsd),
              },
            ]"
            measure="usd"
            variant="bar"
          />
          <MetricChart
            v-if="page === 'tokens'"
            title="Cache-read share"
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
            measure="ratio"
          />
          <MetricChart
            v-if="page === 'tokens'"
            title="Measured input"
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
                  <td>
                    {{ count(row.turns) }}
                  </td>
                  <td :title="count(row.inputTokens)">
                    {{ tokens(row.inputTokens) }}
                  </td>
                  <td :title="count(row.cachedInputTokens)">
                    {{ tokens(row.cachedInputTokens) }}
                  </td>
                  <td :title="count(row.outputTokens)">
                    {{ tokens(row.outputTokens) }}
                  </td>
                  <td :title="exactMoney(row.estimatedCostUsd)">
                    {{ money(row.estimatedCostUsd) }}
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
import { computed, ref, onMounted, watch, nextTick } from "vue";
import {
  ElButton,
  ElDatePicker,
  ElSelect,
  ElOption,
  ElSegmented,
  ElTooltip,
} from "element-plus";
import AppMenuButton from "@workspace/vue/shared/menu/AppMenuButton.vue";
import {
  BoltIcon,
  DotsVerticalIcon,
} from "@workspace/vue/shared/icons/app-icons";
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
  currentDay,
} from "./format";
import { consolePages, type ConsolePage } from "./console-pages";
import { modelLabel } from "./model-label";
import { useMetrics } from "./use-metrics";
const props = withDefaults(
  defineProps<{
    page?: ConsolePage;
    signingOut?: boolean;
    authError?: string;
  }>(),
  { page: "overview" },
);
const emit = defineEmits<{ sessionExpired: []; signOut: [] }>();
const productName =
  typeof __PRODUCT_NAME__ === "undefined" ? "Usage console" : __PRODUCT_NAME__;
const pageTitle = computed(
  () => consolePages.find((page) => page.id === props.page)!.label,
);
const heading = ref<HTMLElement | null>(null);
watch(
  () => props.page,
  async () => {
    document.title = `${productName} Console · ${pageTitle.value}`;
    await nextTick();
    heading.value?.focus();
  },
);
onMounted(() => {
  document.title = `${productName} Console · ${pageTitle.value}`;
});
const {
  timeZone,
  from,
  to,
  provider,
  model,
  availableModels,
  groupServiceTiers,
  data,
  loading,
  error,
  load,
  recent,
} = useMetrics(() => emit("sessionExpired"));
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
  return to.value === currentDay() && [7, 30, 90].includes(days)
    ? days
    : undefined;
});
const futureDay = (date: Date) =>
  date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate() >
  Number(currentDay().replaceAll("-", ""));
</script>
