<template>
  <form class="automation-editor" @submit.prevent="submit">
    <header class="automation-editor__header">
      <h3>{{ $t(mode === 'edit' ? 'surface.automationEditor.editAutomation' : 'surface.automationEditor.createAutomation') }}</h3>
      <label class="automation-editor__enabled">
        <span>{{ $t('promptAutomation.enabled') }}</span>
        <el-switch v-model="form.enabled" :aria-label="$t('surface.automationEditor.automationEnabled')" />
      </label>
    </header>
    <div class="automation-editor__body">
      <FormField density="compact" :label="$t('promptAutomation.name')" label-for="automation-name">
        <el-input id="automation-name" v-model="form.name" :aria-label="$t('promptAutomation.name')" :placeholder="$t('promptAutomation.namePlaceholder')" />
      </FormField>
      <FormField density="compact" class="automation-editor__prompt" :label="$t('promptAutomation.prompt')" label-for="automation-prompt">
        <VoiceTextarea id="automation-prompt" v-model="form.prompt" :label="$t('promptAutomation.prompt')" :rows="4"
          :placeholder="$t('promptAutomation.promptPlaceholder')" @busy-change="promptBusy = $event" />
      </FormField>
      <FormSection density="compact" :title="$t('promptAutomation.target')" title-id="automation-run-in">
        <FormGrid>
          <FormField density="compact" :label="$t('promptAutomation.team')" label-for="automation-team">
            <el-select id="automation-team" v-model="form.teamId" :aria-label="$t('surface.automationEditor.automationTargetTeam')">
              <el-option v-for="team in teams" :key="team.id" :value="team.id" :label="team.name" />
            </el-select>
          </FormField>
          <FormField density="compact" :label="$t('promptAutomation.conversation')" label-for="automation-target"
            :help="form.kind === 'newQuickChat' ? undefined : $t('promptAutomation.inheritsSettings')">
            <el-select id="automation-target" v-model="conversation" fit-input-width :aria-label="$t('promptAutomation.conversation')"
              :placeholder="$t('promptAutomation.conversation')">
              <el-option value="new" :label="$t('promptAutomation.newQuickChat')" />
              <el-option-group v-if="quickChats.length" :label="$t('promptAutomation.quickChat')">
                <el-option v-for="agent in quickChats" :key="agent.id" :value="`quickChat:${agent.id}`" :label="conversationLabel(agent)" :title="conversationLabel(agent)" />
              </el-option-group>
              <el-option-group v-if="agentChats.length" :label="$t('promptAutomation.agent')">
                <el-option v-for="agent in agentChats" :key="agent.id" :value="`agent:${agent.id}`" :label="conversationLabel(agent)" :title="conversationLabel(agent)" />
              </el-option-group>
            </el-select>
          </FormField>
        </FormGrid>
      </FormSection>
      <AutomationScheduleEditor v-model="schedule" :automation="automation" />
      <FormSection v-if="form.kind === 'newQuickChat'" class="automation-editor__model" density="compact" :title="$t('promptAutomation.model')" title-id="automation-model">
        <BackendModelSelector v-model:selection="selection" :agent-id="catalogAgentId"
          :disabled="saving" @loading="modelsLoading = $event" @error="modelsError = true" />
        <p v-if="modelsError" class="automation-editor__notice" role="status">{{ $t('promptAutomation.modelsUnavailable') }}</p>
      </FormSection>
      <p v-if="targetRemoved" class="automation-editor__notice" role="alert">{{ $t('promptAutomation.invalidTarget') }}</p>
      <p v-if="error" class="automation-editor__notice" role="alert">{{ error }}</p>
    </div>
    <footer class="automation-editor__footer">
      <el-button @click="emit('cancel')">{{ $t('surface.automationEditor.cancel') }}</el-button>
      <el-button type="primary" native-type="submit" :disabled="!canSubmit" :loading="saving">{{ $t('surface.automationEditor.saveAutomation') }}</el-button>
    </footer>
  </form>
</template>

<script setup lang="ts">
import { computed, provide, reactive, ref, watch } from 'vue';
import type { Agent, AgentBackend, Automation, AutomationSchedule, AutomationTarget, BackendModelOption, CreateAutomationInput, ExecutionSelection, Team } from '@workspace/core/contracts';
import { agentDisplayName } from '@workspace/core/agent-display';
import { normalizeAutomationSchedule } from '@workspace/core/automation-schedule';
import AutomationScheduleEditor from './AutomationScheduleEditor.vue';
import VoiceTextarea from '../shared/VoiceTextarea.vue';
import FormGrid from '../shared/form/FormGrid.vue';
import FormSection from '../shared/form/FormSection.vue';
import FormField from '../shared/form/FormField.vue';
import BackendModelSelector from './BackendModelSelector.vue';
import { defaultExecutionSelection } from '@workspace/core/execution-selection';
import { backendModelCatalogKey, useBackendModelCatalog } from './backend-model-catalog';
import { useBackendChoices } from './backend-selection';

const props = withDefaults(defineProps<{
  automation?: Automation | null; mode: 'create' | 'edit'; agents: Agent[]; teams: Team[];
  error?: string | null; saving?: boolean;
  listModels?: (agentId: string, backend: AgentBackend) => Promise<BackendModelOption[]>;
}>(), { automation: null, error: null, saving: false });
const emit = defineEmits<{ cancel: []; submit: [input: CreateAutomationInput] }>();
const target = props.automation?.target;
const form = reactive({
  name: props.automation?.name ?? '', prompt: props.automation?.prompt ?? '', enabled: props.automation?.enabled ?? true,
  kind: target?.kind ?? 'newQuickChat' as AutomationTarget['kind'],
  teamId: target?.kind === 'newQuickChat' ? target.teamId
    : props.agents.find(agent => target && agent.id === target.agentId)?.teamId ?? props.teams[0]?.id ?? '',
  agentId: target && target.kind !== 'newQuickChat' && props.agents.some(agent => agent.id === target.agentId) ? target.agentId : '',

});
const selection = ref<ExecutionSelection | undefined>(target?.kind === 'newQuickChat' ? { ...defaultExecutionSelection(target.selection.backend), ...target.selection } : undefined);
const inheritedCatalog = useBackendModelCatalog();
provide(backendModelCatalogKey, { listModels: (agentId, backend) => props.listModels?.(agentId, backend) ?? inheritedCatalog.listModels(agentId, backend) });
const catalogAgentId = computed(() => props.agents.find(agent => agent.teamId === form.teamId)?.id ?? props.agents[0]?.id ?? '');
const schedule = ref<AutomationSchedule>(props.automation?.schedule ?? { rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
// The saved conversation was removed; keep saving blocked until the user picks another.
const targetRemoved = computed(() => Boolean(target && target.kind !== 'newQuickChat' && form.kind === target.kind && !form.agentId
  && !props.agents.some(agent => agent.id === target.agentId)));
const promptBusy = ref(false);
const modelsLoading = ref(false);
const modelsError = ref(false);
const engineChoices = useBackendChoices();
const teamAgents = computed(() => props.agents.filter(agent => agent.teamId === form.teamId));
const quickChats = computed(() => teamAgents.value.filter(agent => agent.sessionKind === 'quickChat'));
const agentChats = computed(() => teamAgents.value.filter(agent => agent.sessionKind !== 'quickChat'));
const targetAgents = computed(() => form.kind === 'quickChat' ? quickChats.value : agentChats.value);
// One select covers the fresh-chat default and every existing conversation: 'new' | 'quickChat:<id>' | 'agent:<id>'.
const conversation = computed<string>({
  get: () => form.kind === 'newQuickChat' ? 'new' : form.agentId ? `${form.kind}:${form.agentId}` : '',
  set(value) {
    if (value === 'new') { form.kind = 'newQuickChat'; form.agentId = ''; return; }
    const separator = value.indexOf(':');
    form.kind = value.slice(0, separator) as 'quickChat' | 'agent';
    form.agentId = value.slice(separator + 1);
  },
});
function conversationLabel(agent: Agent): string {
  const name = agentDisplayName(agent);
  if (agent.sessionKind === 'quickChat') return name;
  const repository = agent.workspace?.kind === 'git' ? agent.workspace.repositoryName
    : agent.folder?.split(/[\\/]/).filter(Boolean).at(-1);
  return repository ? `${name} @ ${repository}` : name;
}
const canSubmit = computed(() => !props.saving && !promptBusy.value && Boolean(form.prompt.trim()) && normalizeAutomationSchedule(schedule.value) !== null &&
  (form.kind === 'newQuickChat'
    ? props.teams.some(team => team.id === form.teamId) && Boolean(selection.value && engineChoices.value.includes(selection.value.backend))
    : targetAgents.value.some(agent => agent.id === form.agentId)));
watch(() => form.teamId, () => { form.agentId = ''; });
function submit() {
  if (!canSubmit.value) return;
  const target: AutomationTarget = form.kind === 'newQuickChat'
    ? { kind: 'newQuickChat', teamId: form.teamId, selection: { ...selection.value! } }
    : { kind: form.kind, agentId: form.agentId };
  emit('submit', { name: form.name.trim(), enabled: form.enabled, prompt: form.prompt.trim(), target, schedule: { ...schedule.value } });
}
</script>
<style scoped>
.automation-editor {
  max-height: calc(100vh - var(--workbench-appbar-height) - var(--space-32));
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.automation-editor__header {
  position: sticky;
  top: 0;
  z-index: 1;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
  padding-bottom: var(--space-6);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-shell-main);
}

.automation-editor__header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-18);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-24);
}

.automation-editor__enabled {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.automation-editor__body {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: var(--space-8) var(--space-6) var(--space-8) 0;
  scrollbar-width: thin;
}

.automation-editor__body > * + * {
  margin-top: var(--space-12);
}

.automation-editor__backend {
  width: 100%;
}

.automation-editor__model :deep(.form-section__group) {
  border: 0;
  border-radius: 0;
  background: transparent;
}

.automation-editor__prompt .voice-textarea {
  width: 100%;
}

.automation-editor__notice {
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
  padding: var(--space-10) var(--space-12);
  border: 1px solid var(--color-warning-container);
  border-radius: var(--radius-md);
  color: var(--color-on-warning-container);
  background: var(--color-warning-container);
}

.automation-editor__footer {
  position: sticky;
  bottom: 0;
  z-index: 1;
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  padding-top: var(--space-6);
  border-top: 1px solid var(--color-border);
  background: var(--color-shell-main);
}
</style>
