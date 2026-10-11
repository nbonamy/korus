<template>
  <SettingsPanelFrame :title="$t('telemetry.usage')" title-id="usage-title">
    <p>{{ $t("telemetry.local") }}</p>
    <div class="usage-filters">
      <FormField
        v-for="key in ['from', 'to'] as const"
        :key="key"
        :label="$t('telemetry.' + key)"
        :label-for="'usage-' + key"
        density="compact"
        ><input
          :id="'usage-' + key"
          v-model="filter[key]"
          type="date"
          @change="load"
      /></FormField>
      <FormField
        :label="$t('telemetry.group')"
        label-for="usage-group"
        density="compact"
        ><select id="usage-group" v-model="filter.group" @change="load">
          <option v-for="g in groups" :key="g" :value="g">
            {{ $t("telemetry." + g) }}
          </option>
        </select></FormField
      >
      <FormField
        :label="$t('telemetry.provider')"
        label-for="usage-provider"
        density="compact"
        ><select id="usage-provider" v-model="filter.provider" @change="load">
          <option value="">{{ $t("telemetry.all") }}</option>
          <option
            v-for="b in ['codex', 'claude', 'antigravity'] as const"
            :key="b"
            :value="b"
          >
            {{ backendDisplayName(b) }}
          </option>
        </select></FormField
      >
      <FormField
        v-for="key in ['model', 'teamId', 'repository', 'agentId'] as const"
        :key="key"
        :label="$t('telemetry.' + key)"
        :label-for="'usage-' + key"
        density="compact"
        ><input :id="'usage-' + key" v-model="filter[key]" @change="load"
      /></FormField>
    </div>
    <button class="app-button" type="button" @click="load">
      {{ $t("telemetry.refresh") }}
    </button>
    <p v-if="error" role="alert">{{ $t("telemetry.error") }}</p>
    <p v-if="data">
      {{
        $t("telemetry.coverage", {
          since: new Date(data.retainedSince).toLocaleDateString(),
        })
      }}
    </p>
    <p>{{ $t("telemetry.semantics") }}</p>
    <p v-if="data && !data.rows.length">{{ $t("telemetry.empty") }}</p>
    <div class="usage-table">
      <AppDataList
        v-if="data?.rows.length"
        :title="$t('telemetry.usage')"
        :columns="columns"
        :rows="rows"
      />
    </div>
    <p>{{ $t("telemetry.separate") }}</p>
    <h3>{{ $t("telemetry.account") }}</h3>
    <p>{{ $t("telemetry.accountScope") }}</p>
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
  </SettingsPanelFrame>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type {
  UsageFilter,
  UsageSummary,
  AccountUsage,
} from "@workspace/core/usage";
import type { AgentBackend } from "@workspace/core/contracts";
import { appApi } from "../platform-api";
import { backendDisplayName } from "@workspace/core/backend-driver";
import { translate } from "../i18n";
import AppDataList from "./AppDataList.vue";
import FormField from "../shared/form/FormField.vue";
import SettingsPanelFrame from "./SettingsPanelFrame.vue";
const columns = computed(() =>
  ["group", "turns", "outcomes", "tokens", "measured"].map((id) => ({
    id,
    label: translate("telemetry." + id),
    width: id === "group" ? "minmax(120px, 1fr)" : "minmax(160px, 1fr)",
  })),
);
const rows = computed(
  () =>
    data.value?.rows.map((r) => ({
      id: r.label,
      group: r.label,
      turns: r.started,
      outcomes: `${r.completed} / ${r.failed} / ${r.interrupted} / ${r.inProgress}`,
      tokens: r.tokens
        ? `${r.tokens.total ?? translate("telemetry.unknown")} / ${r.tokens.input} / ${r.tokens.output} / ${r.tokens.cacheRead} / ${r.tokens.cacheWrite ?? translate("telemetry.unknown")} / ${r.tokens.reasoning ?? translate("telemetry.unknown")}`
        : translate("telemetry.unknown"),
      measured: `${r.measuredTurns} / ${r.started}`,
    })) ?? [],
);
const groups = [
  "provider",
  "model",
  "teamId",
  "repository",
  "agentId",
] as const;
const filter = ref<Record<string, string>>({ group: "provider" });
const data = ref<UsageSummary | null>(null);
const error = ref(false);
const account = ref<AccountUsage | null>(null);
const accountRequested = ref(false);
const accountBusy = ref(false);
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
let generation = 0;
async function load(): Promise<void> {
  const current = ++generation;
  error.value = false;
  try {
    const result = await appApi!.getUsage(
      Object.fromEntries(
        Object.entries(filter.value).filter(([, v]) => v),
      ) as UsageFilter,
    );
    if (current === generation) data.value = result;
  } catch {
    if (current === generation) error.value = true;
  }
}
onMounted(load);
</script>
<style scoped>
.usage-filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-8);
}
input,
select {
  color: var(--color-text);
  background: var(--color-surface-lowest);
  border: 1px solid var(--color-border);
  padding: var(--space-8);
}
.usage-table {
  overflow: auto;
}
</style>
