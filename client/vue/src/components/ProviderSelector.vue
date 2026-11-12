<template>
  <el-select
    v-if="choices.length > 1 || (showSingleChoice && choices.length > 0) || (preserveSelection && provider && !choices.includes(provider) && choices.length > 0)"
    v-model="provider"
    class="provider-selector"
    :size="size"
    :disabled="disabled"
    :aria-label="t('surface.agentDialog.codingAgent')"
    @update:model-value="rememberBackend"
  >
    <template #prefix>
      <ProviderIcon v-if="provider" :provider="provider" />
    </template>
    <el-option
      v-for="choice in displayChoices"
      :key="choice"
      :value="choice"
      :label="providerDisplayName(choice)"
    >
      <span class="provider-selector__option">
        <ProviderIcon :provider="choice" />
        {{ providerDisplayName(choice) }}
      </span>
    </el-option>
  </el-select>
  <button v-else-if="choices.length === 0" class="app-button app-button--tertiary" type="button" @click="connectEngine">{{ t('engineConnection.required') }}</button>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { HarnessProvider } from '@workspace/core/contracts';
import { harnessProviders } from '@workspace/core/contracts/shared';
import { useProviderChoices, useConnectEngine, useRememberProvider } from './provider-selection';
import { providerDisplayName } from '@workspace/core/provider-driver';
import ProviderIcon from './ProviderIcon.vue';

const props = withDefaults(defineProps<{
  remoteConnectionId?: string | null;
  size?: 'small' | 'default' | 'large';
  disabled?: boolean;
  preserveSelection?: boolean;
  showSingleChoice?: boolean;
}>(), { size: 'default', disabled: false });
const provider = defineModel<HarnessProvider>();
const choices = useProviderChoices(() => props.remoteConnectionId);
const displayChoices = computed(() => harnessProviders.filter(provider => choices.value.includes(provider)));
const rememberBackend = useRememberProvider(() => props.remoteConnectionId);
const connectEngine = useConnectEngine();
const { t } = useI18n();
watch(choices, (enabled) => {
  if (props.disabled || (props.preserveSelection && provider.value)) return;
  if (!provider.value || !enabled.includes(provider.value)) provider.value = enabled[0];
}, { immediate: true });
watch(() => props.remoteConnectionId, () => {
  if (!props.disabled && !props.preserveSelection) provider.value = choices.value[0];
});
</script>

<style scoped>
.provider-selector { width: 160px; }
.provider-selector.el-select--small { width: 136px; }
.provider-selector.el-select--large { width: 184px; }
.provider-selector__option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>
