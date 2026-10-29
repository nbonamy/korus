<template>
  <FormDialog class="agent-handoff-dialog" width="480px" :model-value="true" :title="t('handoff.submit')" @update:model-value="close">
    <form id="agent-handoff-form" class="app-form-dialog agent-handoff-form" @submit.prevent="submitHandoff">
      <FormField :label="t('handoff.model')">
        <BackendModelSelector v-model:selection="selection" :agent-id="agent.id" :remote-connection-id="agent.remoteConnectionId" :disabled="busy" @loading="loadingModels = $event" />
      </FormField>
      <FormField :label="t('handoff.instructions')" label-for="handoff-instructions">
        <el-input id="handoff-instructions" v-model="instructions" type="textarea" :rows="3" :maxlength="4000" :disabled="busy" :placeholder="t('handoff.optional')" />
      </FormField>
      <p class="app-form-dialog__help agent-handoff-form__workspace" :title="agent.folder ?? undefined">{{ agent.folder }}</p>
      <p class="app-form-dialog__help">{{ t('handoff.permissions') }}</p>
      <el-alert v-if="blocker || error" :title="error || blocker || ''" type="error" :closable="false" />
      <p v-if="busy" role="status">{{ t('handoff.preparing') }}</p>
      <details v-if="agent.handoff?.note">
        <summary>{{ t('handoff.savedNote') }}</summary>
        <p v-if="agent.handoff.error">{{ agent.handoff.error }}</p>
        <pre class="handoff-note">{{ agent.handoff.note }}</pre>
        <button class="app-button app-button--tertiary" type="button" @click="openSource">{{ t('handoff.source') }}</button>
      </details>
    </form>
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" @click="close">{{ busy ? t('handoff.hide') : t('handoff.cancel') }}</button>
      <button class="app-button app-button--primary" type="submit" form="agent-handoff-form" :disabled="busy || !!blocker || !selection || loadingModels">{{ t('handoff.submit') }}</button>
    </template>
  </FormDialog>
  <AutomationExecutionConversationOverlay v-if="sourceVisible" :agent-name="agent.handoff?.sourceTitle ?? ''" :ticket="t('handoff.source')" :messages="sourceMessages" :loading="sourceLoading" :error="sourceError" @close="sourceVisible = false" />
</template>

<script setup lang="ts">
import { provide, ref } from 'vue';
import { defaultExecutionSelection } from '@workspace/core/execution-selection';
import { useI18n } from 'vue-i18n';
import type { Agent, AgentBackend, BackendConversationRef, BackendModelOption, ExecutionSelection, RendererMessage } from '@workspace/core/contracts';
import type { AgentHandoffInput } from '@workspace/core/agent-handoff';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import BackendModelSelector from './BackendModelSelector.vue';
import { backendModelCatalogKey } from './backend-model-catalog';
import { useBackendChoices } from './backend-selection';
import AutomationExecutionConversationOverlay from './AutomationExecutionConversationOverlay.vue';

const props = defineProps<{
  agent: Agent;
  blocker?: string | null;
  submit: (agentId: string, input: AgentHandoffInput) => Promise<void>;
  listModels: (agentId: string, backend: AgentBackend) => Promise<BackendModelOption[]>;
  readMessages?: (ref: BackendConversationRef, agentId: string) => Promise<RendererMessage[]>;
}>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const choices = useBackendChoices(() => props.agent.remoteConnectionId);
const initialBackend = choices.value.find(choice => choice !== props.agent.backend) ?? choices.value[0];
const selection = ref<ExecutionSelection | undefined>(initialBackend ? defaultExecutionSelection(initialBackend) : undefined);
provide(backendModelCatalogKey, { listModels: async (agentId, backend) => agentId ? await props.listModels(agentId, backend) : [] });
const instructions = ref('');
const busy = ref(false);
const error = ref('');
const loadingModels = ref(false);
const operationId = crypto.randomUUID();
const sourceVisible = ref(false);
const sourceLoading = ref(false);
const sourceError = ref('');
const sourceMessages = ref<RendererMessage[]>([]);
async function submitHandoff() {
  if (busy.value || props.blocker || !selection.value || loadingModels.value) return;
  busy.value = true;
  error.value = '';
  try {
    await props.submit(props.agent.id, { operationId, selection: { ...selection.value }, ...(instructions.value.trim() ? { instructions: instructions.value.trim() } : {}) });
    emit('close');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
function close() { emit('close'); }
async function openSource() {
  const handoff = props.agent.handoff;
  if (!handoff || !props.readMessages) return;
  sourceVisible.value = true;
  sourceLoading.value = true;
  sourceError.value = '';
  try { sourceMessages.value = await props.readMessages(handoff.sourceRef, props.agent.id); }
  catch (cause) { sourceError.value = cause instanceof Error ? cause.message : String(cause); }
  finally { sourceLoading.value = false; }
}
</script>

<style>
.agent-handoff-dialog.el-dialog {
  padding: 0;
}

.agent-handoff-dialog .el-dialog__header {
  padding: var(--space-8) var(--space-10) var(--space-6);
}

.agent-handoff-dialog .app-form-dialog__header {
  margin: 0;
}

.agent-handoff-dialog .app-dialog__title {
  font-size: var(--font-size-16);
  line-height: var(--line-height-22);
}

.agent-handoff-dialog .el-dialog__body {
  padding: 0 var(--space-10) var(--space-8);
}

.agent-handoff-dialog .el-dialog__footer {
  padding: var(--space-6) var(--space-10);
}
</style>

<style scoped>
.agent-handoff-form {
  gap: var(--space-6);
}

.agent-handoff-form__workspace {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.handoff-note {
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
