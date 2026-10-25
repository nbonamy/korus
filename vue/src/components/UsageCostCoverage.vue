<template>
  <div class="cost-coverage">
    <span v-if="label" class="cost-period"
      >{{ label
      }}<template v-if="showValue">
        · {{ usdFormat(cost?.usd) }}</template
      ></span
    >
    <strong>{{
      $t(
        "analytics.cost" +
          (cost?.coverage === "complete"
            ? "Complete"
            : cost?.coverage === "partial"
              ? "Partial"
              : "Unavailable"),
      )
    }}</strong>
    <span v-if="cost">{{
      $t("analytics.costCoverage", {
        priced: cost.pricedRequests,
        requests: cost.requests,
      })
    }}</span>
    <span v-else>{{ $t("analytics.costNoEvidence") }}</span>
    <span v-if="cost?.unknownRequestExecutions">{{
      $t("analytics.costUnknownRequests", {
        count: cost.unknownRequestExecutions,
      })
    }}</span>
    <span v-for="reason in cost?.reasons" :key="reason.reason"
      >{{ $t("analytics.costReasons." + reason.reason) }} ({{
        reason.count
      }})</span
    >
  </div>
</template>
<script setup lang="ts">
import type { UsageCost } from "@workspace/core/usage";
import { usdFormat } from "./usage-chart";
defineProps<{ cost?: UsageCost; label?: string; showValue?: boolean }>();
</script>
<style scoped>
.cost-coverage {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.cost-coverage strong {
  font-weight: var(--font-weight-semibold);
}
.cost-period {
  color: var(--color-text);
}
</style>
