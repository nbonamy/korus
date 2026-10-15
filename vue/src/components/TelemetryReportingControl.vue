<template>
  <FormRow
    class="telemetry-reporting"
    :title="$t('telemetry.reporting')"
    :description="description"
  >
    <template #control>
      <el-popover
        v-model:visible="detailsVisible"
        placement="top"
        trigger="click"
        :width="320"
        popper-class="app-popover"
      >
        <template #reference>
          <button
            type="button"
            class="telemetry-reporting__info"
            :aria-label="$t('telemetry.about')"
            :aria-expanded="detailsVisible"
          >
            <InfoCircleIcon aria-hidden="true" />
          </button>
        </template>
        <div class="telemetry-reporting__help">
          <strong>{{ $t("telemetry.anonymous") }}</strong>
          <p>{{ $t("telemetry.disclosure") }}</p>
          <p>{{ $t("telemetry.delivery") }}</p>
          <p>{{ $t("telemetry.optOut") }}</p>
        </div>
      </el-popover>
      <el-switch
        :model-value="modelValue"
        :disabled="disabled"
        :aria-label="$t('telemetry.reporting')"
        @update:model-value="emit('update:modelValue', $event === true)"
      />
    </template>
  </FormRow>
</template>
<script setup lang="ts">
import { ref } from "vue";
import FormRow from "../shared/form/FormRow.vue";
import { InfoCircleIcon } from "../shared/icons/app-icons";
withDefaults(
  defineProps<{
    modelValue: boolean;
    disabled?: boolean;
    description?: string;
  }>(),
  { disabled: false, description: "" },
);
const emit = defineEmits<{ "update:modelValue": [enabled: boolean] }>();
const detailsVisible = ref(false);
</script>
<style scoped>
.telemetry-reporting {
  width: 100%;
  -webkit-app-region: no-drag;
}

.telemetry-reporting__info {
  display: inline-flex;
  padding: var(--space-3);
  color: var(--color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.telemetry-reporting__info svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.telemetry-reporting__help p {
  margin: var(--space-8) 0;
}
</style>
