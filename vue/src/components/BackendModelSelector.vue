<template>
  <el-popover v-model:visible="open" trigger="click" placement="bottom-start" :width="320" :teleported="true" :disabled="disabled" popper-class="app-popover backend-model-selector__popover">
    <template #reference>
      <button class="backend-model-selector" type="button" :disabled="disabled" :aria-label="t('modelPicker.label')">
        <BackendIcon v-if="backend" :backend="backend" />
        <span class="backend-model-selector__label">{{ selectedModel?.displayName ?? (backend ? backendDisplayName(backend) : '') }}</span>
        <span v-if="reasoningEffort" class="backend-model-selector__effort">{{ reasoningEffort }}</span>
        <ChevronDown class="backend-model-selector__chevron" aria-hidden="true" />
      </button>
    </template>
    <el-tabs v-model="backend" :aria-label="t('surface.agentDialog.codingAgent')">
      <el-tab-pane v-for="choice in tabs" :key="choice" :name="choice" :label="backendDisplayName(choice)" :disabled="disabled">
        <template #label><span class="backend-model-selector__tab" role="img" :title="backendDisplayName(choice)" :aria-label="backendDisplayName(choice)"><BackendIcon :backend="choice" /></span></template>
      </el-tab-pane>
    </el-tabs>
    <AppMenu class="app-menu--embedded" :items="modelItems" :ariaLabel="t('modelPicker.model')" :show-selection-check="false" @select="selectModel" />
    <!-- Only on a cold first load; a cached catalog is shown straight away and refreshed behind the scenes. -->
    <div v-if="loading" class="backend-model-selector__loading" aria-busy="true" role="status" :aria-label="t('modelPicker.loading')">
      <span v-for="row in 4" :key="row" />
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AgentBackend, BackendModelOption } from '@workspace/core/contracts';
import { backendDisplayName } from '@workspace/core/backend-driver';
import { agentBackends } from '@workspace/core/contracts/shared';
import AppMenu from '../shared/menu/AppMenu.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { CheckIcon, ChevronDown } from '../shared/icons/app-icons';
import BackendIcon from './BackendIcon.vue';
import { useAgentHost, useBackendChoices, useCatalogAgentId, useNewAgentBackend, useRememberBackend, useSavedModelSelection } from './backend-selection';
import { cacheModels, cachedModels, defaultReasoningEffort, presentCatalog, useBackendModelCatalog } from './backend-model-catalog';

const props = defineProps<{ agentId?: string; teamId?: string | null; disabled?: boolean }>();
const backend = defineModel<AgentBackend>('backend');
const model = defineModel<string>('model', { default: '' });
const reasoningEffort = defineModel<string>('reasoningEffort', { default: '' });
const choices = useBackendChoices(() => props.teamId);
// Remembering a choice reorders `choices`; the tabs keep a fixed order so they never jump under the pointer.
const tabs = computed(() => agentBackends.filter(choice => choices.value.includes(choice)));
useNewAgentBackend(backend, choices);
const remember = useRememberBackend(() => props.teamId);
watch(() => props.teamId, () => { if (!props.disabled) backend.value = choices.value[0]; });
const { listModels } = useBackendModelCatalog();
const catalogAgentId = useCatalogAgentId(() => props.teamId, () => props.agentId);
const catalogHost = useAgentHost(() => catalogAgentId.value);
const { t } = useI18n();
const open = ref(false);
const loading = ref(false);
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
// A model that supports reasoning efforts opens a submenu of them, so model and effort are one gesture.
const modelItems = computed<AppMenuItem[]>(() => [
  ...models.value.map((option): AppMenuItem => {
    const selected = model.value === option.model;
    const icon = selected ? CheckIcon : undefined;
    if (!option.supportedReasoningEfforts?.length) return { id: `model:${option.model}`, label: option.displayName, type: 'radio', checked: selected, icon };
    return {
      id: `submenu:${option.model}`, type: 'submenu', label: option.displayName, icon,
      ...(selected && reasoningEffort.value ? { value: reasoningEffort.value } : {}),
      items: [
        ...option.supportedReasoningEfforts.map((effort): AppMenuItem => ({
          id: `effort:${option.model}:${effort.reasoningEffort}`, label: effort.reasoningEffort, type: 'radio',
          checked: selected && reasoningEffort.value === effort.reasoningEffort,
          icon: selected && reasoningEffort.value === effort.reasoningEffort ? CheckIcon : undefined,
        })),
      ],
    };
  }),
]);
watch([backend, catalogAgentId, () => props.teamId], async ([nextBackend, agentId], previous, cleanup) => {
  let current = true;
  cleanup(() => { current = false; });
  const cached = nextBackend && agentId ? cachedModels(catalogHost.value, nextBackend) : undefined;
  showCatalog(cached ?? []);
  if (previous?.length) {
    model.value = '';
    reasoningEffort.value = '';
  }
  selectDefaultModel();
  loading.value = false;
  if (previous?.[0] !== undefined && previous[0] !== nextBackend && nextBackend) remember(nextBackend);
  if (!nextBackend || !agentId) return;
  loading.value = !cached;
  try {
    const catalog = await listModels(agentId, nextBackend);
    if (!current) return;
    showCatalog(catalog);
    selectDefaultModel();
    cacheModels(catalogHost.value, nextBackend, catalog);
  } catch { /* The provider default remains available if the catalog is unavailable. */ }
  finally { if (current) loading.value = false; }
}, { immediate: true });
watch(model, () => {
  if (!efforts.value.some(option => option.reasoningEffort === reasoningEffort.value)) reasoningEffort.value = defaultReasoningEffort(selectedModel.value);
});
// There is no blank "default" entry: the user's saved model and effort for this provider (else the
// provider's own default) are selected explicitly.
function selectDefaultModel() {
  if (models.value.some(option => option.model === model.value) || !fallbackModel) return;
  const savedModel = saved.value?.model;
  const target = (savedModel && models.value.find(option => option.model === savedModel || option.id === savedModel))
    || (savedModel && aliasModel && (aliasModel.model === savedModel || aliasModel.id === savedModel) ? fallbackModel : undefined)
    || fallbackModel;
  const savedEffort = target.model === savedModel || target === fallbackModel ? saved.value?.reasoningEffort : undefined;
  model.value = target.model;
  reasoningEffort.value = target.supportedReasoningEfforts?.some(option => option.reasoningEffort === savedEffort) && savedEffort
    ? savedEffort
    : defaultReasoningEffort(target);
}
function selectModel(id: string) {
  const [kind, chosen = '', ...effort] = id.split(':');
  if (kind === 'effort') {
    // Setting the model resets the effort, so the effort is applied once that watcher has run.
    model.value = chosen;
    reasoningEffort.value = effort.join(':');
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
  font-size: var(--font-size-14);
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
  margin-bottom: var(--space-4);
}

/* One divider carries the separation between provider and model lists. */
.backend-model-selector__popover .el-tabs__nav-wrap::after {
  height: 1px;
  background-color: var(--color-border);
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
