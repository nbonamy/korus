<template>
  <slot v-if="$slots.default" :summary="enabled === false || backend === 'antigravity' || (!state && loading) ? '' : versionSummary" :upgrade-available="state?.status === 'available' && state.canUpgrade" :busy="loading || pending" :upgrade="upgrade" :menu-items="updateMenuItems" :select-menu-item="selectUpdateMenuItem" />
  <FormRow v-else :title="$t('providerUpdate.version')">
    <template #copy>
      <span class="provider-update__version" :class="{ 'provider-update__current': state?.status === 'current', 'provider-update__available': state?.status === 'available' || pending }" :role="errorText ? 'alert' : pending ? 'status' : undefined">
        <span class="provider-update__summary" :title="versionSummary">{{ versionSummary }}</span>
      </span>
    </template>
    <template #control>
      <el-button v-if="state?.status === 'waiting'" size="small" :disabled="loading" @click="cancel">{{ $t('common.cancel') }}</el-button>
      <el-button v-else-if="state?.status === 'current'" size="small" disabled>{{ $t('providerUpdate.current') }}</el-button>
      <el-button v-else-if="state?.status === 'available' && state.canUpgrade" size="small" :disabled="loading" @click="upgrade">{{ $t(state.busy ? 'providerUpdate.upgradeWhenIdle' : 'providerUpdate.upgrade') }}</el-button>
      <a v-else-if="state?.status === 'manual' || (state?.status === 'available' && !state.canUpgrade)" :href="instructionsUrl" target="_blank" rel="noopener noreferrer" @click.prevent="appPlatformActions.openExternal?.(instructionsUrl)">{{ $t('providerUpdate.instructions') }}</a>
      <button class="provider-update__refresh" type="button" :disabled="loading || pending" :aria-label="$t('providerUpdate.check')" :title="$t('providerUpdate.check')" @click="refresh(true)">
        <ElIcon :size="12" :class="{ 'is-loading': loading || state?.status === 'upgrading' }"><RefreshIcon /></ElIcon>
      </button>
    </template>
  </FormRow>
</template>

<script setup lang="ts">
import { computed, inject, onScopeDispose, ref, watch } from 'vue';
import { ElIcon, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import type { AgentBackend } from '@workspace/core/contracts';
import type { ProviderUpdateStatus } from '@workspace/core/contracts/provider-updates';
import { appApi, appPlatformActions } from '../platform-api';
import FormRow from '../shared/form/FormRow.vue';
import { RefreshIcon, SearchIcon } from '../shared/icons/app-icons';
import { providerUpdatePreviewKey } from './provider-update-preview';
import type { AppMenuItem } from '../shared/menu/app-menu';

const props = withDefaults(defineProps<{ backend: AgentBackend; remoteConnectionId?: string; enabled?: boolean }>(), { enabled: true });
const emit = defineEmits<{ activity: [active: boolean] }>();
const preview = inject(providerUpdatePreviewKey, ref(false));
const { t } = useI18n();
const state = ref<ProviderUpdateStatus>();
const loading = ref(false);
const failed = ref(false);
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
const pending = computed(() => state.value?.status === 'waiting' || state.value?.status === 'upgrading');
watch(() => loading.value || pending.value, active => emit('activity', active), { immediate: true });
const errorText = computed(() => failed.value ? t('providerUpdate.errors.checkFailed') : state.value?.error ? t(`providerUpdate.errors.${state.value.error}`) : undefined);
const versionSummary = computed(() => {
  const status = state.value?.status;
  const detail = errorText.value
    ?? (status === 'waiting' ? t('providerUpdate.waiting')
      : status === 'upgrading' ? t('providerUpdate.upgrading')
      : status === 'available' ? t('providerUpdate.available', { version: state.value?.latestVersion })
      : !state.value && loading.value ? t('auth.checking') : '');
  return [state.value?.installedVersion, detail].filter(Boolean).join(' · ') || '—';
});
const instructionsUrl = computed(() => props.backend === 'codex' ? 'https://learn.chatgpt.com/docs/codex/cli#getting-started' : 'https://code.claude.com/docs/en/setup#update-claude-code');
const updateMenuItems = computed<AppMenuItem[]>(() => {
  if (props.enabled === false || props.backend === 'antigravity') return [];
  const items: AppMenuItem[] = [{ id: 'check-updates', type: 'action', label: t('providerUpdate.check'), icon: SearchIcon, disabled: loading.value || pending.value }];
  if (state.value?.status === 'available' && state.value.canUpgrade) items.unshift({ id: 'upgrade', type: 'action', label: t('engineConnection.update'), disabled: loading.value });
  if (state.value?.status === 'waiting') items.unshift({ id: 'cancel-update', type: 'action', label: t('common.cancel'), disabled: loading.value });
  if (state.value?.status === 'manual' || (state.value?.status === 'available' && !state.value.canUpgrade)) items.push({ id: 'update-instructions', type: 'action', label: t('providerUpdate.instructions') });
  return items;
});

function selectUpdateMenuItem(id: string): void {
  if (id === 'check-updates') void refresh(true);
  else if (id === 'upgrade') void upgrade();
  else if (id === 'cancel-update') void cancel();
  else if (id === 'update-instructions') void appPlatformActions.openExternal?.(instructionsUrl.value);
}

function poll() {
  clearTimeout(timer);
  if (pending.value && !preview.value) timer = setTimeout(() => void refresh(), 2_000);
}
function resetPreview() {
  clearTimeout(previewTimer);
  state.value = { backend: props.backend, status: 'available', installedVersion: '1.0.0', latestVersion: '1.1.0', method: 'native', canUpgrade: true, busy: false };
  loading.value = false;
  failed.value = false;
}
function changePreview(action: 'upgrade' | 'cancel') {
  resetPreview();
  if (action === 'cancel') return;
  const expected = revision;
  state.value!.status = 'waiting';
  previewTimer = setTimeout(() => {
    if (expected !== revision || !preview.value) return;
    state.value!.status = 'upgrading';
    previewTimer = setTimeout(() => {
      if (expected !== revision || !preview.value) return;
      state.value = { ...state.value!, status: 'current', installedVersion: '1.1.0', canUpgrade: false };
    }, 4_000);
  }, 2_000);
}
async function refresh(force = false) {
  if (props.enabled === false || props.backend === 'antigravity') return;
  if (preview.value) { resetPreview(); return; }
  const expected = revision;
  loading.value = true;
  failed.value = false;
  try {
    if (!appApi) throw new Error('Backend unavailable');
    const result = await appApi.getProviderUpdate(props.backend, props.remoteConnectionId, force);
    if (revision === expected) state.value = result;
  } catch { if (revision === expected) failed.value = true; }
  finally { if (revision === expected) { loading.value = false; poll(); } }
}
async function upgrade() {
  const expected = revision;
  const token = state.value?.token;
  try {
    await ElMessageBox.confirm(t('providerUpdate.confirmation'), t('providerUpdate.upgrade'), { confirmButtonText: t('providerUpdate.upgrade'), cancelButtonText: t('common.cancel') });
  } catch { return; }
  if (expected !== revision) return;
  await change({ action: 'upgrade', confirmed: true, token });
}
async function cancel() { await change({ action: 'cancel' }); }
async function change(input: import('@workspace/core/contracts/provider-updates').ProviderUpdateInput) {
  if (preview.value) { changePreview(input.action); return; }
  const expected = revision;
  loading.value = true;
  failed.value = false;
  try {
    if (!appApi) throw new Error('Backend unavailable');
    const result = await appApi.setProviderUpdate(props.backend, input, props.remoteConnectionId);
    if (revision === expected) state.value = result;
  } catch { if (revision === expected) failed.value = true; }
  finally { if (revision === expected) { loading.value = false; poll(); } }
}
watch(() => [props.backend, props.remoteConnectionId, props.enabled, preview.value], () => {
  ++revision; clearTimeout(timer); clearTimeout(previewTimer); state.value = undefined; void refresh();
}, { immediate: true, flush: 'sync' });
onScopeDispose(() => { ++revision; clearTimeout(timer); clearTimeout(previewTimer); emit('activity', false); });
</script>

<style scoped>
.provider-update__version {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}
.provider-update__summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.provider-update__current::before,
.provider-update__available::before {
  content: '';
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-success);
}
.provider-update__available::before {
  background: var(--color-warning);
}
.provider-update__refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  border: 0;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}
.provider-update__refresh:disabled { cursor: default; opacity: 0.5; }
@media (prefers-reduced-motion: reduce) {
  .provider-update__refresh .is-loading { animation: none; }
}
</style>
