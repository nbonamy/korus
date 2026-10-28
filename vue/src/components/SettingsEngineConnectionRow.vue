<template>
  <div v-if="compact" class="settings-engine-connection--compact">
    <FormRow :title="title ?? $t('engineConnection.title')" :error="error">
      <template #control>
        <ProviderInstallActions v-if="installed === false && backend" :backend="backend" :busy="busy" :automated="installable" @refresh="emit('refresh')" @install="emit('install')" />
        <button v-else-if="pending" class="app-button app-button--tertiary" type="button" aria-busy="true" :disabled="busy" @click="emit('cancel')">{{ $t('auth.cancel') }}</button>
        <el-button v-else-if="connected" size="small" :disabled="busy || saving" @click="emit('disconnect')">{{ $t('engineConnection.disconnect') }}</el-button>
        <el-button v-else size="small" :disabled="busy || saving" @click="emit('connect')">
          {{ $t('engineConnection.connect') }}
        </el-button>
        <el-switch :model-value="connected && enabled !== false" :loading="saving" :disabled="!connected || busy || saving || pending" :aria-label="`${$t('engineConnection.enabled')} · ${title ?? $t('engineConnection.title')}`" @update:model-value="toggle" />
      </template>
      <template #copy>
        <span v-if="accountLabel" :title="accountLabel">{{ accountLabel }}</span>
        <span v-if="busy && !pending" role="status">{{ $t('auth.checking') }}</span>
        <span v-else-if="!pending && !accountLabel">{{ statusLabel }}</span>
      </template>
    </FormRow>
    <slot />
  </div>
  <div v-else class="engine-hero" :data-state="state">
    <div class="engine-hero__summary">
      <BackendIcon v-if="backend" class="engine-hero__logo" :backend="backend" :monochrome="backend === 'codex'" />
      <div class="engine-hero__copy">
        <strong>{{ title ?? $t('engineConnection.title') }}</strong>
        <StatusPill class="engine-hero__status" role="status" :tone="tone">{{ statusLabel }}</StatusPill>
        <span v-if="accountLabel" class="engine-hero__account" :title="accountLabel">{{ accountLabel }}</span>
        <span v-if="error" class="engine-hero__error" role="alert">{{ error }}</span>
      </div>
      <div class="engine-hero__action">
        <ProviderInstallActions v-if="installed === false && backend" :backend="backend" :busy="busy" @refresh="emit('refresh')" @install="emit('install')" />
        <button v-else-if="pending" class="app-button app-button--tertiary" type="button" aria-busy="true" :disabled="busy" @click="emit('cancel')">{{ $t('auth.cancel') }}</button>
        <el-button v-else-if="connected" :disabled="busy || saving" @click="emit('disconnect')">{{ $t('engineConnection.disconnect') }}</el-button>
        <el-button v-else type="primary" :disabled="busy || saving" @click="emit('connect')">{{ $t('engineConnection.connect') }}</el-button>
      </div>
    </div>
    <div class="engine-hero__details">
      <slot />
      <FormRow :title="$t('engineConnection.enabled')">
        <template #control>
          <el-switch :model-value="connected && enabled !== false" :loading="saving" :disabled="!connected || busy || saving || pending" :aria-label="$t('engineConnection.enabled')" @update:model-value="toggle" />
        </template>
      </FormRow>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AgentBackend } from '@workspace/core/contracts';
import type { ProviderAuthentication } from '@workspace/core/contracts/provider-setup';
import { ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import FormRow from '../shared/form/FormRow.vue';
import BackendIcon from './BackendIcon.vue';
import ProviderInstallActions from './ProviderInstallActions.vue';
import StatusPill from '../shared/form/StatusPill.vue';
const props = withDefaults(defineProps<{ backend?: AgentBackend; installed?: boolean; compact?: boolean; installable?: boolean; title?: string; connected?: boolean; enabled?: boolean; busy?: boolean; pending?: boolean; error?: string | null; authentication?: ProviderAuthentication; setEnabled?: (enabled: boolean) => unknown }>(), { enabled: true, installed: true });
const emit = defineEmits<{ connect: []; disconnect: []; cancel: []; refresh: []; install: [] }>();
const { t } = useI18n();
const saving = ref(false);
const accountLabel = computed(() => {
  const auth = props.authentication;
  if (!auth || auth.kind === 'antigravity') return '';
  const account = auth.state.account;
  if (!account) return '';
  if (account.type === 'apiKey') return t('engineConnection.apiKey');
  if (account.type === 'chatgpt') return [account.email, account.planType].filter(Boolean).join(' · ');
  if (account.type === 'subscription') return [account.email, account.subscription ?? t('engineConnection.subscription')].filter(Boolean).join(' · ');
  return t('engineConnection.amazonBedrock');
});
const state = computed(() => {
  if (props.pending) return 'pending';
  if (props.connected) return props.enabled !== false ? 'active' : 'idle';
  return 'idle';
});
const tone = computed(() => state.value === 'active' ? 'success' : state.value === 'pending' ? 'warning' : 'neutral');
const statusLabel = computed(() => {
  if (props.pending) return t('engineConnection.waiting');
  if (props.busy) return t('auth.checking');
  if (!props.installed) return t('auth.notDetected');
  if (!props.connected) return t('engineConnection.disconnected');
  return props.enabled !== false ? t('engineConnection.connected') : t('engineConnection.connectedDisabled');
});
async function toggle(value: string | number | boolean) {
  saving.value = true;
  try { await props.setEnabled?.(value === true); }
  catch (cause) {
    const lastEngine = String(cause).endsWith('Cannot disable the last engine. Enable another one first.');
    await ElMessageBox.alert(
      t(lastEngine ? 'engineConnection.lastEngine' : 'engineConnection.updateFailed'),
      t(lastEngine ? 'engineConnection.lastEngineTitle' : 'engineConnection.updateFailedTitle'),
      { confirmButtonText: t('common.ok'), type: lastEngine ? 'warning' : 'error' },
    ).catch(() => {});
  }
  finally { saving.value = false; }
}
</script>

<style scoped>
.engine-hero {
  min-width: 0;
  margin-bottom: var(--space-24);
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
}

.engine-hero__summary {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-10) var(--space-8);
}

.engine-hero__summary .engine-hero__logo {
  width: var(--space-24);
  height: var(--space-24);
  flex: 0 0 auto;
  color: var(--color-text);
}

.engine-hero__copy {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
}

.engine-hero__copy strong {
  color: var(--color-text);
  font-size: var(--font-size-18);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-24);
}

.engine-hero__status {
  align-self: flex-start;
  margin: var(--space-2) 0;
}

.engine-hero__account {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.engine-hero__error {
  color: var(--color-error);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.engine-hero__action {
  flex: 0 0 auto;
}

.engine-hero__details {
  border-top: 1px solid var(--color-border);
  background: var(--color-card-background);
}

.engine-hero__details :deep(.form-row + .form-row) {
  border-top: 1px solid var(--color-border);
}

.settings-engine-connection--compact {
  min-width: 0;
}

.settings-engine-connection--compact :deep(.form-row) {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-2) 0;
}

.settings-engine-connection--compact :deep(.form-row__copy) {
  flex-direction: row;
  align-items: center;
  gap: var(--space-6);
}

.settings-engine-connection--compact :deep(.form-row__copy strong) {
  flex: 0 0 100px;
}

.settings-engine-connection--compact :deep(.form-row__copy span) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.settings-engine-connection--compact :deep(.form-row__control) {
  justify-self: end;
  gap: var(--space-6);
}
</style>
