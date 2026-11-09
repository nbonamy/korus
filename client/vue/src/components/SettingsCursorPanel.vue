<template>
  <SettingsPanelFrame :title="$t('cursor.name')" title-id="settings-cursor-title">
    <SettingsEngineConnectionRow backend="cursor" :capabilities="setupCapabilities" :installed="installed" :title="$t('cursor.name')" :authentication="authentication" :connected="connected" :enabled="enabled" :set-enabled="setEnabled" :busy="busy" :pending="pending" :error="error || nativeState?.error" @install="emit('install')" @refresh="emit('refresh')" @connect="emit('connect')" @disconnect="emit('disconnect')" @cancel="emit('cancel')">
      <FormRow :title="$t('engineSetup.title')" :description="nativeState?.homePath || $t('cursor.existingHome')" />
      <FormRow v-if="nativeState?.team" :title="$t('cursor.team')" :description="nativeState.team" />
      <ProviderUpdateRow backend="cursor" :enabled="installed" :remote-connection-id="remoteConnectionId" />
    </SettingsEngineConnectionRow>
    <FormSection v-if="connected && enabled !== false && !remoteConnectionId" :title="$t('cursor.billing')" title-id="settings-cursor-billing-title">
      <template #actions>
        <el-button size="small" :loading="billingLoading" :aria-label="$t('cursor.refreshBilling')" @click="refreshBilling">{{ $t('cursor.refreshBilling') }}</el-button>
      </template>
      <FormRow :title="$t('surface.settingsMenu.credits')" :description="billing ? money(billing.includedBalanceUsd) : $t('surface.settingsMenu.unknown')" :error="billingFailed ? $t('surface.settingsMenu.loadFailed') : undefined" />
      <FormRow :title="$t('surface.settingsMenu.onDemand')" :description="onDemandValue" />
    </FormSection>
    <FormSection :title="$t('cursor.conversation')" title-id="settings-cursor-conversation-title">
      <FormRow as="label" :title="$t('cursor.steeringFallback')" :description="$t('cursor.steeringFallbackDescription')">
        <template #control>
          <el-switch :model-value="steeringFallbackEnabled === true" :aria-label="$t('cursor.steeringFallback')" @update:model-value="setSteeringFallbackEnabled?.($event === true)" />
        </template>
      </FormRow>
    </FormSection>
  </SettingsPanelFrame>
</template>
<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AccountBilling } from '@workspace/core/contracts/backend';
import { isAccountBilling } from '@workspace/core/snapshot-guard-collections';
import { appApi } from '../platform-api';
import type { ProviderSetupCapabilities, ProviderAuthentication } from '@workspace/core/contracts/provider-setup';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsEngineConnectionRow from './SettingsEngineConnectionRow.vue';
import ProviderUpdateRow from './ProviderUpdateRow.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';
const props = withDefaults(defineProps<{ setupCapabilities?: ProviderSetupCapabilities; steeringFallbackEnabled?: boolean; setSteeringFallbackEnabled?: (enabled: boolean) => unknown; installed?: boolean; connected?: boolean; enabled?: boolean; authentication?: ProviderAuthentication; setEnabled?: (enabled: boolean) => unknown; busy?: boolean; pending?: boolean; error?: string | null; remoteConnectionId?: string }>(), { installed: false });
const nativeState = computed(() => props.authentication?.kind === 'cursor' ? props.authentication.state : undefined);
const { t } = useI18n();
const billing = ref<AccountBilling | null>(null);
const billingLoading = ref(false);
const billingFailed = ref(false);
let billingRevision = 0;
const onDemandValue = computed(() => {
  const demand = billing.value?.onDemand;
  if (demand?.enabled === false) return t('surface.settingsMenu.billingOff');
  if (demand?.enabled !== true) return t('surface.settingsMenu.unknown');
  return demand.unlimited ? t('surface.settingsMenu.noLimit') : money(demand.remainingUsd);
});
function money(value: string | number | null): string {
  return value === null ? t('surface.settingsMenu.unknown') : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
}
async function refreshBilling(): Promise<void> {
  const revision = ++billingRevision;
  billingLoading.value = true; billingFailed.value = false;
  try {
    const result = await appApi?.getProviderUsage('cursor');
    if (revision === billingRevision) billing.value = isAccountBilling(result?.billing) ? result.billing : null;
  } catch { if (revision === billingRevision) billingFailed.value = true; }
  finally { if (revision === billingRevision) billingLoading.value = false; }
}
watch(() => [props.connected, props.enabled, props.remoteConnectionId, JSON.stringify(props.authentication)], () => {
  ++billingRevision; billing.value = null; billingFailed.value = false; billingLoading.value = false;
  if (props.connected && props.enabled !== false && !props.remoteConnectionId) void refreshBilling();
}, { immediate: true });
onScopeDispose(() => { ++billingRevision; });
const emit = defineEmits<{ connect: []; disconnect: []; cancel: []; refresh: []; install: [] }>();
</script>
