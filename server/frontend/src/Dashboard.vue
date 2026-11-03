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
        <div class="masthead-actions">
          <ElButton
            v-if="page !== 'overview'"
            class="filters-toggle"
            aria-label="Toggle filters"
            aria-controls="report-controls"
            :aria-expanded="filtersExpanded"
            @click="filtersExpanded = !filtersExpanded"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M7 12h10M10 17h4" />
            </svg>
            <span>Filters</span>
          </ElButton>
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
            ><span class="refresh-label">Refresh</span>
          </ElButton>
        </div>
      </header>
      <div
        v-if="page !== 'overview'"
        id="report-controls"
        class="report-controls"
        :class="{ 'report-controls--open': filtersExpanded }"
      >
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
              popper-class="console-date-options"
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
              popper-class="console-date-options"
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
          <ConsoleOptions v-model="groupServiceTiers" @change="load" />
        </section>
      </div>
      <p v-if="page !== 'overview'" class="freshness">
        <span class="status-dot" aria-hidden="true" />
        <template v-if="data?.availability.lastDay"
          >Latest report {{ data.availability.lastDay }} ·
        </template>
        <span>{{ timeZone }}</span>
      </p>
      <p v-if="loading" role="status" class="state panel">Loading metrics…</p>
      <p v-else-if="error" role="alert" class="state panel">{{ error }}</p>
      <template v-else-if="data">
        <OverviewReport
          v-if="page === 'overview'"
          :data="data"
          :previous="previousData"
        />
        <ActivityReport v-if="page === 'activity'" :data="data" />
        <TokensReport v-if="page === 'tokens'" :data="data" />
        <SpendReport v-if="page === 'spend'" :data="data" />
        <ModelsReport
          v-if="page === 'models'"
          v-model:measure="modelMeasure"
          v-model:grouping="modelGrouping"
          :data="data"
        />
        <PerformanceReport v-if="page === 'performance'" :data="data" />
        <section
          v-if="page === 'models'"
          id="models"
          class="panel model-panel"
          aria-label="Provider and model"
        >
          <header class="panel-heading">
            <h2>
              {{
                modelGrouping === "provider"
                  ? "Providers"
                  : "Provider and model"
              }}
            </h2>
            <span class="muted"
              >{{ rankedModels.length }}
              {{
                modelGrouping === "provider"
                  ? "providers"
                  : data.range.groupServiceTiers
                    ? "models"
                    : "variants"
              }}</span
            >
          </header>
          <div
            class="table-scroll"
            tabindex="0"
            aria-label="Provider and model data"
          >
            <table>
              <caption class="sr-only">
                {{
                  modelGrouping === "provider"
                    ? "Usage by provider"
                    : "Usage by provider and model"
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    {{
                      modelGrouping === "provider"
                        ? "Provider"
                        : "Provider / model"
                    }}
                  </th>
                  <th
                    scope="col"
                    :aria-sort="
                      modelMeasure === 'turns' ? 'descending' : undefined
                    "
                  >
                    Turns
                  </th>
                  <th
                    scope="col"
                    :aria-sort="
                      modelMeasure === 'totalTokens' ? 'descending' : undefined
                    "
                  >
                    Total tokens
                  </th>
                  <th
                    scope="col"
                    :aria-sort="
                      modelMeasure === 'inputTokens' ? 'descending' : undefined
                    "
                  >
                    Inclusive input
                  </th>
                  <th scope="col">Cache reads</th>
                  <th
                    scope="col"
                    :aria-sort="
                      modelMeasure === 'outputTokens' ? 'descending' : undefined
                    "
                  >
                    Output
                  </th>
                  <th
                    scope="col"
                    :aria-sort="
                      modelMeasure === 'inputRatio' ? 'descending' : undefined
                    "
                  >
                    Input ratio
                  </th>
                  <th
                    scope="col"
                    :aria-sort="
                      modelMeasure === 'estimatedCostUsd'
                        ? 'descending'
                        : undefined
                    "
                  >
                    Estimated USD
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rankedModels" :key="row.key">
                  <th scope="row">
                    <span v-if="row.modelLabel" class="provider">{{
                      row.provider
                    }}</span
                    ><span>{{ row.modelLabel ?? row.label }}</span>
                  </th>
                  <td>
                    {{ count(row.turns) }}
                  </td>
                  <td :title="count(row.totalTokens)">
                    {{ tokens(row.totalTokens) }}
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
                  <td>
                    {{ measurement(modelValue(row, "inputRatio"), "ratio") }}
                  </td>
                  <td :title="exactMoney(row.estimatedCostUsd)">
                    {{ money(row.estimatedCostUsd) }}
                  </td>
                </tr>
                <tr v-if="!data.models.length">
                  <td colspan="8">No usage groups.</td>
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
import { useRoute } from "vue-router";
import {
  ElButton,
  ElDatePicker,
  ElSelect,
  ElOption,
  ElSegmented,
} from "element-plus";
import ConsoleOptions from "./ConsoleOptions.vue";
import ModelsReport from "./ModelsReport.vue";
import OverviewReport from "./OverviewReport.vue";
import ActivityReport from "./ActivityReport.vue";
import TokensReport from "./TokensReport.vue";
import SpendReport from "./SpendReport.vue";
import PerformanceReport from "./PerformanceReport.vue";
import ConsoleNavigation from "./ConsoleNavigation.vue";
import {
  count,
  tokens,
  money,
  exactMoney,
  measurement,
  currentDay,
  utcDay,
} from "./format";
import { consolePages, type ConsolePage } from "./console-pages";
import { modelLabel } from "./model-label";
import { modelValue, type ModelMeasure } from "./use-model-comparison";
import { useMetrics } from "./use-metrics";
import {
  useReportGroups,
  rankReportGroups,
  type ReportGrouping,
} from "./use-report-groups";
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
const modelMeasure = ref<ModelMeasure>("turns");
const modelGrouping = ref<ReportGrouping>("model");
const route = useRoute();
const filtersExpanded = ref(false);
watch(
  () => props.page,
  () => {
    filtersExpanded.value = false;
  },
);
watch(
  () => props.page,
  async (page, previous) => {
    if (previous === "overview" && page !== "overview") applyLinkedRange();
    if (page === "overview" || previous === "overview") void load();
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
  previousData,
  loading,
  error,
  load,
  recent,
} = useMetrics(
  () => emit("sessionExpired"),
  () => props.page === "overview",
);
const { groups: modelGroups } = useReportGroups(
  () => data.value,
  () => modelGrouping.value,
);
const rankedModels = computed(() =>
  rankReportGroups(modelGroups.value, modelMeasure.value),
);
function applyLinkedRange() {
  if (
    props.page === "overview" ||
    typeof route.query.from !== "string" ||
    typeof route.query.to !== "string"
  )
    return;
  from.value = route.query.from;
  to.value = route.query.to;
  provider.value = "";
  model.value = "";
  groupServiceTiers.value = false;
}
applyLinkedRange();
watch(to, (day, previous) => {
  if (props.page !== "overview") return;
  const delta = Date.parse(day) - Date.parse(previous),
    start = Date.parse(from.value);
  if (Number.isFinite(delta) && Number.isFinite(start))
    from.value = utcDay(start + delta);
});
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
