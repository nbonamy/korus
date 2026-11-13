<template>
  <HarnessModelSelector :models="models" :selection="{ model: model || null, reasoningEffort: reasoningEffort || null, serviceTier: serviceTier || null }"
    :harnesses="harnesses" :harness="provider" :disabled="disabled" :loading="loading"
    @update:selection="updateModelSelection" @update:harness="provider = $event as HarnessProvider" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { executionSelectionControls } from '../execution-selection';
import { useI18n } from 'vue-i18n';
import { defaultChatTranslate, HarnessModelSelector, provideChatTranslate, type ModelSelection } from '@korus-dev/agent-ui-sdk';
import type { HarnessProvider, ProviderModelOption, ExecutionSelection } from '@workspace/core/contracts';
import { harnessProviders } from '@workspace/core/contracts/shared';
import { harnessChoices } from './provider-harness-choices';
import { useAgentHost, useProviderChoices, useCatalogAgentId, useNewAgentProvider, useRememberProvider, useSavedModelSelection } from './provider-selection';
import { cacheModels, cachedModels, defaultReasoningEffort, presentCatalog, useProviderModelCatalog } from './provider-model-catalog';

const props = defineProps<{
  agentId?: string; remoteConnectionId?: string | null; disabled?: boolean; allowedBackends?: HarnessProvider[];
  selections?: Partial<Record<HarnessProvider, ExecutionSelection>>;
}>();
const emit = defineEmits<{ loading: [loading: boolean]; error: [error: unknown] }>();
const selectionBinding = defineModel<ExecutionSelection>('selection');
const selection = ref(selectionBinding.value);
watch(selectionBinding, value => { selection.value = value; }, { flush: 'sync' });
watch(selection, value => { selectionBinding.value = value; }, { flush: 'sync' });
const { provider, model, reasoningEffort, serviceTier } = executionSelectionControls(selection);
const hostChoices = useProviderChoices(() => props.remoteConnectionId);
const choices = computed(() => hostChoices.value.filter(choice => !props.allowedBackends || props.allowedBackends.includes(choice)));
// Remembering a choice reorders `choices`; the tabs keep a fixed order so they never jump under the pointer.
const harnesses = computed(() => harnessChoices(harnessProviders.filter(choice => choices.value.includes(choice))));
useNewAgentProvider(provider, choices);
const remember = useRememberProvider(() => props.remoteConnectionId);
watch(() => props.remoteConnectionId, () => { if (!props.disabled) provider.value = choices.value[0]; });
const { listModels } = useProviderModelCatalog();
const catalogAgentId = useCatalogAgentId(() => props.remoteConnectionId, () => props.agentId);
const agentHost = useAgentHost(() => catalogAgentId.value);
// A host without agents is still read through its own catalog.
const catalogHost = computed(() => catalogAgentId.value ? agentHost.value : props.remoteConnectionId || 'local');
const { t, te } = useI18n();
provideChatTranslate((key, params) => te(key) ? t(key, params ?? {}) : defaultChatTranslate(key, params));
const loading = ref(false);
watch(loading, value => emit('loading', value), { immediate: true });
const models = ref<ProviderModelOption[]>([]);
let fallbackModel: ProviderModelOption | undefined;
let aliasModel: ProviderModelOption | undefined;
const saved = useSavedModelSelection(() => provider.value);
function showCatalog(catalog: ProviderModelOption[]) {
  const presented = presentCatalog(catalog.filter(option => !option.hidden));
  models.value = presented.models;
  fallbackModel = presented.fallback;
  aliasModel = presented.alias;
}
const selectedModel = computed(() => models.value.find(option => option.model === model.value));
const efforts = computed(() => selectedModel.value?.supportedReasoningEfforts ?? []);
watch([provider, catalogAgentId, () => props.remoteConnectionId], async ([nextBackend, agentId], previous, cleanup) => {
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
  const selection = (provider.value && props.selections?.[provider.value]) || saved.value;
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
function updateModelSelection(value: ModelSelection) {
  model.value = value.model ?? '';
  reasoningEffort.value = value.reasoningEffort ?? '';
  serviceTier.value = value.serviceTier ?? '';
}
</script>
