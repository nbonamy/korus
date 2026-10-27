<template>
  <main>
    <header class="masthead">
      <div>
        <p class="eyebrow">{{ productName }} · Private console</p>
        <h1>Usage</h1>
      </div>
      <button aria-label="Refresh metrics" @click="load">Refresh</button>
    </header>
    <form
      class="range-controls"
      aria-label="Reporting range"
      @submit.prevent="load"
    >
      <label
        >From UTC day<input
          aria-label="From UTC day"
          type="date"
          v-model="from"
          required
          :max="completedDay()"
      /></label>
      <label
        >To UTC day<input
          aria-label="To UTC day"
          type="date"
          v-model="to"
          required
          :max="completedDay()"
      /></label>
      <button type="submit">Apply range</button>
      <div class="presets" aria-label="Recent ranges">
        <button type="button" @click="recent(7)">7 days</button
        ><button type="button" @click="recent(30)">30 days</button
        ><button type="button" @click="recent(90)">90 days</button>
      </div>
    </form>
    <p class="freshness">
      UTC complete through {{ completedDay() }}.<template v-if="data">
        Latest report: {{ data.availability.lastDay ?? "none" }}. Last received:
        {{ received }}.</template
      >
      Completed-day reports can arrive late.
    </p>
    <section class="usage-heading" aria-label="Usage filters">
      <div>
        <h2>Usage</h2>
        <p class="muted">
          Filters apply to usage charts and the provider/model table.
        </p>
      </div>
      <div class="filters">
        <label
          >Provider<select
            aria-label="Provider"
            v-model="provider"
            @change="load"
          >
            <option value="">All providers</option>
            <option
              v-for="item in ['codex', 'claude', 'antigravity']"
              :key="item"
              :value="item"
            >
              {{ item }}
            </option>
          </select></label
        ><label
          >Model<select aria-label="Model" v-model="model" @change="load">
            <option value="">All models</option>
            <option value="unknown">unknown</option>
            <option v-for="item in telemetryModels" :key="item" :value="item">
              {{ item }}
            </option>
          </select></label
        >
      </div>
    </section>
    <p v-if="loading" role="status" class="state panel">Loading metrics…</p>
    <p v-else-if="error" role="alert" class="state panel">{{ error }}</p>
    <template v-else-if="data">
      <section aria-label="Global activity">
        <div class="section-heading">
          <h2>Participating installs</h2>
          <span class="muted">Global · as of {{ data.range.to }} UTC</span>
        </div>
        <dl class="cards">
          <div class="panel" aria-label="Participating installs">
            <dt>Participating installs</dt>
            <dd>{{ count(data.overview.participatingInstalls) }}</dd>
            <small>Cumulative random identities</small>
          </div>
          <div class="panel" aria-label="Daily active installs">
            <dt>Daily active</dt>
            <dd>{{ count(data.overview.dau) }}</dd>
            <small>{{ data.range.to }} UTC</small>
          </div>
          <div class="panel" aria-label="Weekly active installs">
            <dt>Weekly active</dt>
            <dd>{{ count(data.overview.wau) }}</dd>
            <small>Trailing 7 reporting days</small>
          </div>
          <div class="panel" aria-label="Monthly active installs">
            <dt>Monthly active</dt>
            <dd>{{ count(data.overview.mau) }}</dd>
            <small>Trailing 30 reporting days</small>
          </div>
        </dl>
        <p class="muted scope">
          Activity stays global when usage filters change. Calendar month to
          {{ data.range.to }}:
          {{ count(data.overview.calendarMonthActives) }} active. Counts
          describe consenting installation identities, not people or downloads.
        </p>
      </section>
      <MetricChart
        title="Daily activity"
        description="Distinct active installation identities, including days with no turns. Dates are UTC."
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

      <p v-if="data.totals.groups === '0'" class="state panel">
        No usage for this selection.
      </p>
      <dl class="cards usage-totals">
        <div class="panel" aria-label="Turns">
          <dt>Turns</dt>
          <dd>{{ count(data.totals.turns) }}</dd>
          <small>Selected usage</small>
        </div>
        <div class="panel" aria-label="Measured total tokens">
          <dt>Measured tokens</dt>
          <dd>{{ count(data.totals.totalTokens) }}</dd>
          <small
            >Inclusive input + output ·
            {{ count(data.totals.excludedTokenGroups) }} groups excluded</small
          >
        </div>
        <div class="panel" aria-label="Known estimated spend">
          <dt>Estimated API-equivalent spend</dt>
          <dd>{{ money(data.totals.estimatedCostUsd) }}</dd>
          <small
            >{{ data.totals.costCoverage }} ·
            {{ count(data.totals.unknownCostGroups) }} unknown groups</small
          >
        </div>
        <div class="panel" aria-label="Measured cache-read share">
          <dt>Cache-read share</dt>
          <dd>{{ percent(data.totals.cacheReadShare) }}</dd>
          <small
            >{{ count(data.totals.excludedCacheGroups) }} groups excluded</small
          >
        </div>
      </dl>
      <div class="chart-grid">
        <MetricChart
          title="Weekly tokens"
          description="Monday-based UTC weeks; edge weeks include selected dates only. Inclusive input already contains cache reads. Total uses complete input/output pairs."
          :days="data.weekly.map((row) => row.week)"
          :series="[
            {
              label: 'Total tokens',
              values: data.weekly.map((row) => row.totalTokens),
            },
            {
              label: 'Inclusive input',
              values: data.weekly.map((row) => row.inputTokens),
            },
            {
              label: 'Output',
              values: data.weekly.map((row) => row.outputTokens),
            },
          ]"
          :notes="
            data.weekly.map(
              (row) =>
                `${count(row.excludedTokenGroups)} incomplete token groups; ${count(row.unknownInputGroups)} unknown input; ${count(row.unknownOutputGroups)} unknown output`,
            )
          "
          measure="count"
        />
        <MetricChart
          title="Daily estimated spend"
          description="Known complete group estimates in USD, not billing. Missing measurements are gaps; partial totals omit unknown groups."
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
        />
        <MetricChart
          title="Cache-read share"
          description="Cache reads ÷ inclusive input for complete pairs. Zero input and missing measurements are unavailable."
          :days="data.daily.map((row) => row.day)"
          :series="[
            {
              label: 'Cache-read share',
              values: data.daily.map((row) =>
                row.cacheReadShare === null ? null : String(row.cacheReadShare),
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
          title="Measured input"
          description="Complete input/cache pairs only. Non-cache-read input can include cache creation and is not a fresh-input pricing category."
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
          measure="count"
        />
      </div>
      <section class="panel" aria-label="Provider and model">
        <header class="panel-heading">
          <h2>Provider and model</h2>
          <span class="muted">Selected range · known subtotals</span>
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
                :key="`${row.provider}/${row.model}`"
              >
                <th scope="row">
                  <span class="provider">{{ row.provider }}</span
                  ><span>{{ row.model }}</span>
                </th>
                <td>{{ count(row.turns) }}</td>
                <td>
                  {{ count(row.inputTokens)
                  }}<small v-if="row.unknownInputGroups !== '0'"
                    >{{ count(row.unknownInputGroups) }} unknown groups</small
                  >
                </td>
                <td>
                  {{ count(row.cachedInputTokens)
                  }}<small v-if="row.unknownCachedInputGroups !== '0'"
                    >{{ count(row.unknownCachedInputGroups) }} unknown
                    groups</small
                  >
                </td>
                <td>
                  {{ count(row.outputTokens)
                  }}<small v-if="row.unknownOutputGroups !== '0'"
                    >{{ count(row.unknownOutputGroups) }} unknown groups</small
                  >
                </td>
                <td>
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
      <footer class="muted">
        Anonymous daily rollups · UTC reporting dates ·
        {{
          data.availability.firstDay
            ? `History available from ${data.availability.firstDay}.`
            : "No reports received."
        }}
        Resetting or reinstalling without local state creates another identity.
      </footer>
    </template>
  </main>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { telemetryModels } from "@workspace/core/telemetry-models";
import MetricChart from "./MetricChart.vue";
import { count, money, percent, completedDay } from "./format";
import { useMetrics } from "./use-metrics";
const productName =
  typeof __PRODUCT_NAME__ === "undefined" ? "Usage console" : __PRODUCT_NAME__;
const { from, to, provider, model, data, loading, error, load, recent } =
  useMetrics();
const received = computed(() =>
  data.value?.availability.lastReceivedAt
    ? new Date(data.value.availability.lastReceivedAt)
        .toISOString()
        .replace("T", " ")
        .replace(".000Z", " UTC")
    : "none",
);
</script>
