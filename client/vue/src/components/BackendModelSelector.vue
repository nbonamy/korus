<template>
  <el-popover v-model:visible="open" trigger="click" placement="bottom-start" :width="320" :teleported="true" :disabled="disabled" popper-class="app-popover backend-model-selector__popover">
    <template #reference>
      <button class="backend-model-selector" type="button" :disabled="disabled" :aria-label="t('modelPicker.label')">
        <BackendIcon v-if="backend" :backend="backend" />
        <span class="backend-model-selector__label">{{ selectedModel?.displayName ?? (backend ? backendDisplayName(backend) : '') }}</span>
        <span v-if="reasoningEffort" class="backend-model-selector__effort">{{ reasoningEffort }}</span>
        <span v-if="serviceTierName" class="backend-model-selector__effort">{{ serviceTierName }}</span>
        <ChevronDown class="backend-model-selector__chevron" aria-hidden="true" />
      </button>
    </template>
    <div class="backend-model-selector__header">
      <el-tabs v-model="backend" :aria-label="t('surface.agentDialog.codingAgent')">
        <el-tab-pane v-for="choice in tabs" :key="choice" :name="choice" :label="backendDisplayName(choice)" :disabled="disabled">
          <template #label><span class="backend-model-selector__tab" role="img" :title="backendDisplayName(choice)" :aria-label="backendDisplayName(choice)"><BackendIcon :backend="choice" /></span></template>
        </el-tab-pane>
      </el-tabs>
      <el-tooltip v-if="serviceTiers.length" :content="tierTooltip" :trigger-keys="[]" placement="top" :show-after="300">
        <span class="backend-model-selector__tier">
          <AppMenuButton v-if="serviceTiers.length > 1" v-model:open="tierOpen" :ariaLabel="t('modelPicker.serviceTier')" :items="tierItems" :width="188" :teleported="false" @select="serviceTier = $event">
            <template #trigger="{ attrs }"><button v-bind="attrs" class="app-icon-button backend-model-selector__tier-button" :class="{ 'backend-model-selector__tier-button--active': serviceTier }" type="button" :disabled="disabled" :aria-label="tierAccessibleName"><CodexUltrafastIcon v-if="serviceTier === 'ultrafast'" :size="16" /><BoltIcon v-else aria-hidden="true" /></button></template>
          </AppMenuButton>
          <button v-else class="app-icon-button backend-model-selector__tier-button" :class="{ 'backend-model-selector__tier-button--active': serviceTier }" type="button" :disabled="disabled" :aria-label="tierAccessibleName" :aria-pressed="Boolean(serviceTier)" @click="serviceTier = serviceTier ? '' : serviceTiers[0]!.id"><CodexUltrafastIcon v-if="serviceTier === 'ultrafast'" :size="16" /><BoltIcon v-else aria-hidden="true" /></button>
        </span>
      </el-tooltip>
    </div>
    <AppMenu class="app-menu--embedded" :items="modelItems" :ariaLabel="t('modelPicker.model')" @select="selectModel" />
    <!-- Only on a cold first load; a cached catalog is shown straight away and refreshed behind the scenes. -->
    <div v-if="loading" class="backend-model-selector__loading" aria-busy="true" role="status" :aria-label="t('modelPicker.loading')">
      <span v-for="row in 4" :key="row" />
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { executionSelectionControls } from '../execution-selection';
import { useI18n } from 'vue-i18n';
import { CodexUltrafastIcon } from '@codex-app-sdk/vue';
import type { AgentBackend, BackendModelOption, ExecutionSelection } from '@workspace/core/contracts';
import { backendDisplayName } from '@workspace/core/backend-driver';
import { agentBackends } from '@workspace/core/contracts/shared';
import AppMenu from '../shared/menu/AppMenu.vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { BoltIcon, ChevronDown } from '../shared/icons/app-icons';
import BackendIcon from './BackendIcon.vue';
import { useAgentHost, useBackendChoices, useCatalogAgentId, useNewAgentBackend, useRememberBackend, useSavedModelSelection } from './backend-selection';
import { cacheModels, cachedModels, defaultReasoningEffort, presentCatalog, useBackendModelCatalog } from './backend-model-catalog';

const props = defineProps<{
  agentId?: string; remoteConnectionId?: string | null; disabled?: boolean; allowedBackends?: AgentBackend[];
  selections?: Partial<Record<AgentBackend, ExecutionSelection>>;
}>();
const emit = defineEmits<{ loading: [loading: boolean]; error: [error: unknown] }>();
const selectionBinding = defineModel<ExecutionSelection>('selection');
const selection = ref(selectionBinding.value);
watch(selectionBinding, value => { selection.value = value; }, { flush: 'sync' });
watch(selection, value => { selectionBinding.value = value; }, { flush: 'sync' });
const { backend, model, reasoningEffort, serviceTier } = executionSelectionControls(selection);
const hostChoices = useBackendChoices(() => props.remoteConnectionId);
const choices = computed(() => hostChoices.value.filter(choice => !props.allowedBackends || props.allowedBackends.includes(choice)));
// Remembering a choice reorders `choices`; the tabs keep a fixed order so they never jump under the pointer.
const tabs = computed(() => agentBackends.filter(choice => choices.value.includes(choice)));
useNewAgentBackend(backend, choices);
const remember = useRememberBackend(() => props.remoteConnectionId);
watch(() => props.remoteConnectionId, () => { if (!props.disabled) backend.value = choices.value[0]; });
const { listModels } = useBackendModelCatalog();
const catalogAgentId = useCatalogAgentId(() => props.remoteConnectionId, () => props.agentId);
const agentHost = useAgentHost(() => catalogAgentId.value);
// A host without agents is still read through its own catalog.
const catalogHost = computed(() => catalogAgentId.value ? agentHost.value : props.remoteConnectionId || 'local');
const { t } = useI18n();
const open = ref(false);
const tierOpen = ref(false);
watch([open, backend, model], () => { tierOpen.value = false; });
const loading = ref(false);
watch(loading, value => emit('loading', value), { immediate: true });
const models = ref<BackendModelOption[]>([]);
let fallbackModel: BackendModelOption | undefined;
let aliasModel: BackendModelOption | undefined;
const saved = useSavedModelSelection(() => backend.value);
function showCatalog(catalog: BackendModelOption[]) {
  const presented = presentCatalog(catalog.filter(option => !option.hidden));
  models.value = presented.models;
  fallbackModel = presented.fallback;
  aliasModel = presented.alias;
}
const selectedModel = computed(() => models.value.find(option => option.model === model.value));
const efforts = computed(() => selectedModel.value?.supportedReasoningEfforts ?? []);
const serviceTiers = computed(() => selectedModel.value?.serviceTiers ?? []);
const currentTierName = computed(() => serviceTiers.value.find(tier => tier.id === serviceTier.value)?.name ?? t('modelPicker.standardTier'));
const tierAccessibleName = computed(() => t('modelPicker.currentServiceTier', { tier: currentTierName.value }));
const tierTooltip = computed(() => !serviceTier.value ? t('modelPicker.normalSpeed') : currentTierName.value.toLowerCase() === 'fast' ? t('modelPicker.fastMode') : currentTierName.value);
const tierItems = computed<AppMenuItem[]>(() => [
  { id: '', label: t('modelPicker.standardTier'), type: 'radio', checked: !serviceTier.value },
  ...serviceTiers.value.map((tier): AppMenuItem => ({ id: tier.id, label: tier.name, type: 'radio', checked: serviceTier.value === tier.id })),
]);
// Lowercase like the effort next to it, so the two read as one setting.
const tierLabel = (name: string) => name.toLowerCase();
const serviceTierName = computed(() => tierLabel(selectedModel.value?.serviceTiers?.find(tier => tier.id === serviceTier.value)?.name ?? ''));
// Reasoning stays model-specific; service tier is controlled separately in the header.
const modelItems = computed<AppMenuItem[]>(() => [
  ...models.value.map((option): AppMenuItem => {
    const selected = model.value === option.model;
    if (!option.supportedReasoningEfforts?.length) return { id: `model:${option.model}`, label: option.displayName, type: 'radio', checked: selected };
    const summary = selected ? reasoningEffort.value : '';
    return {
      id: `submenu:${option.model}`, type: 'submenu', label: option.displayName, checked: selected,
      ...(summary ? { value: summary } : {}),
      items: [
        ...(option.supportedReasoningEfforts ?? []).map((effort): AppMenuItem => ({
          id: `effort:${option.model}:${effort.reasoningEffort}`, label: effort.reasoningEffort, type: 'radio',
          checked: selected && reasoningEffort.value === effort.reasoningEffort,
        })),
      ],
    };
  }),
]);
watch([backend, catalogAgentId, () => props.remoteConnectionId], async ([nextBackend, agentId], previous, cleanup) => {
  let current = true;
  cleanup(() => { current = false; });
  const cached = nextBackend ? cachedModels(catalogHost.value, nextBackend) : undefined;
  showCatalog(cached ?? []);
  if (previous?.length) {
    model.value = '';
    reasoningEffort.value = '';
    serviceTier.value = '';
  }
  selectDefaultModel();
  loading.value = false;
  if (previous?.[0] !== undefined && previous[0] !== nextBackend && nextBackend) remember(nextBackend);
  if (!nextBackend) return;
  loading.value = !cached;
  try {
    const catalog = agentId ? await listModels(agentId, nextBackend) : await listModels(null, nextBackend, props.remoteConnectionId || undefined);
    if (!current) return;
    showCatalog(catalog);
    selectDefaultModel();
    cacheModels(catalogHost.value, nextBackend, catalog);
  } catch (error) { if (current) emit('error', error); }
  finally { if (current) loading.value = false; }
}, { immediate: true });
watch(model, () => {
  if (!efforts.value.some(option => option.reasoningEffort === reasoningEffort.value)) reasoningEffort.value = defaultReasoningEffort(selectedModel.value);
  if (serviceTier.value && !selectedModel.value?.serviceTiers?.some(tier => tier.id === serviceTier.value)) serviceTier.value = '';
}, { flush: 'sync' });
// There is no blank "default" entry: the user's saved model and effort for this provider (else the
// provider's own default) are selected explicitly.
function selectDefaultModel() {
  if (models.value.some(option => option.model === model.value) || !fallbackModel) return;
  const selection = (backend.value && props.selections?.[backend.value]) || saved.value;
  const savedModel = selection?.model;
  const target = (savedModel && models.value.find(option => option.model === savedModel || option.id === savedModel))
    || (savedModel && aliasModel && (aliasModel.model === savedModel || aliasModel.id === savedModel) ? fallbackModel : undefined)
    || fallbackModel;
  const savedEffort = target.model === savedModel || target === fallbackModel ? selection?.reasoningEffort : undefined;
  const savedTier = target.model === savedModel || target === fallbackModel ? selection?.serviceTier : undefined;
  model.value = target.model;
  reasoningEffort.value = target.supportedReasoningEfforts?.some(option => option.reasoningEffort === savedEffort) && savedEffort
    ? savedEffort
    : defaultReasoningEffort(target);
  serviceTier.value = savedTier && target.serviceTiers?.some(tier => tier.id === savedTier) ? savedTier : '';
}
function selectModel(id: string) {
  const [kind, chosen = '', ...rest] = id.split(':');
  if (kind === 'effort') {
    // Setting the model resets the effort, so the effort is applied once that watcher has run.
    model.value = chosen;
    reasoningEffort.value = rest.join(':');
  } else model.value = chosen;
  open.value = false;
}
</script>

<style scoped>
/* Reads as a form field so it sits naturally next to the el-select controls. */
.backend-model-selector {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  max-width: 100%;
  min-height: 32px;
  padding: 0 var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: var(--color-surface-lowest);
  font: inherit;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-regular);
  text-align: left;
  cursor: pointer;
}

.backend-model-selector:hover:not(:disabled),
.backend-model-selector:focus-visible {
  border-color: var(--color-border-strong);
}

.backend-model-selector:disabled {
  opacity: 0.5;
  cursor: default;
}

.backend-model-selector__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.backend-model-selector__effort {
  flex: none;
  margin-left: calc(var(--space-2) * -1);
  color: var(--color-text-muted);
}

.backend-model-selector svg,
.backend-model-selector :deep(.backend-icon) {
  flex: none;
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.backend-model-selector__chevron {
  margin-left: auto;
  color: var(--color-text-muted);
}
</style>

<style>
.backend-model-selector__popover.el-popper {
  padding: var(--space-4);
}

.backend-model-selector__popover .el-tabs__header {
  margin-bottom: 0;
}

.backend-model-selector__header {
  display: flex;
  align-items: center;
  margin-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.backend-model-selector__header .el-tabs {
  flex: 1;
  min-width: 0;
}

/* One divider carries the separation between provider and model lists. */
.backend-model-selector__popover .el-tabs__nav-wrap::after {
  display: none;
}

.backend-model-selector__tier {
  display: inline-flex;
  flex: none;
  padding-left: var(--space-4);
  margin-left: var(--space-4);
  border-left: 1px solid var(--color-border);
}

.backend-model-selector__tier-button.app-icon-button {
  width: 32px;
  height: 32px;
}

.backend-model-selector__tier-button--active.app-icon-button,
.backend-model-selector__tier-button--active.app-icon-button:hover:not(:disabled) {
  color: var(--color-primary);
  background: var(--color-primary-container);
}

.backend-model-selector__tier-button--active > svg {
  fill: currentcolor;
}

.backend-model-selector__popover .el-tabs__nav {
  display: flex;
  width: 100%;
}

.backend-model-selector__popover .el-tabs__item {
  flex: 1;
  justify-content: center;
  padding: 0 var(--space-4);
}

.backend-model-selector__loading {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
}

.backend-model-selector__loading span {
  height: 14px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-base);
  animation: backend-model-selector-pulse 1.2s ease-in-out infinite;
}

.backend-model-selector__loading span:nth-child(2) { width: 75%; }
.backend-model-selector__loading span:nth-child(3) { width: 60%; }
.backend-model-selector__loading span:nth-child(4) { width: 85%; }

@keyframes backend-model-selector-pulse {
  50% { opacity: 0.4; }
}

.backend-model-selector__tab {
  display: inline-grid;
}

.backend-model-selector__tab .backend-icon {
  width: var(--icon-lg);
  height: var(--icon-lg);
}


</style>
