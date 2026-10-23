<template>
  <section class="automations-view" :aria-label="$t('surface.automationsView.automations')">
    <WorkspaceHeader class="automations-view__header" sidebar-collapsed>
      <h1 id="automations-title" class="workspace-header__title">{{ $t('surface.automationsView.automations') }}</h1>
    </WorkspaceHeader>

    <main class="automations-view__content">
      <div class="automations-view__panel" :class="{ 'automations-view__panel--wide': !editorVisible && !logAutomation }">
        <section aria-labelledby="automations-title">
          <div v-if="!editorVisible && !logAutomation" class="automations-view__list-header">
            <div class="automations-view__location-heading">
              <el-select
                v-model="selectedLocationValue"
                class="automations-view__location-select"
                :aria-label="$t('surface.automationsView.automationLocation')"
                size="small"
              >
                <el-option :label="$t('surface.automationsView.local')" value="local" />
                <el-option
                  v-for="connection in readyRemoteConnections"
                  :key="connection.id"
                  :label="connection.name"
                  :value="remoteLocationValue(connection.id)"
                />
              </el-select>
            </div>
            <el-button v-if="locationAutomations.length > 0" type="primary" @click="openCreate">
              {{ $t('surface.automationsView.newAutomation') }}
            </el-button>
          </div>

          <AutomationEditor
            v-if="editorVisible"
            :key="editorKey"
            :automation="editingAutomation"
            :mode="editorMode"
            :agents="locationAgents"
            :list-models="listModels"
            :saving="saving"
            :error="operationError"
            :teams="locationTeams"
            @cancel="closeEditor"
            @submit="saveAutomation"
          />

          <AutomationExecutionLog
            v-else-if="logAutomation"
            :automation="logAutomation"
            :read-conversation-messages="readLocationConversationMessages"
            @clear-history="confirmClearAutomationHistory"
            @close="closeLog"
            @delete-execution="confirmDeleteAutomationExecution"
          />

          <div v-else-if="locationStatus === 'loading'" class="automations-view__location-state">
            {{ $t('surface.automationsView.loadingAutomations') }}
          </div>

          <div v-else-if="locationStatus === 'error'" class="automations-view__error">
            {{ locationError }}
          </div>

          <AutomationWelcome v-else-if="locationAutomations.length === 0" @create="openCreate" />

          <div v-else class="automations-view__list">
            <AppDataList :aria-label="$t('surface.automationsView.automations')" :columns="automationColumns" :rows="automationRows">
              <template #cell-automation="{ row }">
                <div class="automations-view__automation-cell" :data-enabled="row.enabled">
                  <div class="automations-view__info">
                    <strong>{{ row.name }}</strong>
                    <span>{{ row.sourceLine }}</span>
                  </div>
                </div>
              </template>

              <template #cell-lastExecution="{ row }">
                <span class="automations-view__meta-cell">{{ row.lastExecution }}</span>
              </template>

              <template #actions="{ row }">
                <div class="automations-view__row-actions">
                  <el-switch
                    size="small"
                    :model-value="Boolean(row.enabled)"
                    :disabled="togglingAutomationId === row.id"
                    :aria-label="$t('dynamic.automations.enable', { automation: row.name })"
                    @change="toggleAutomation(row.id, $event === true)"
                  />
                  <button
                    type="button"
                    :aria-label="$t('dynamic.automations.run', { automation: row.name })"
                    :disabled="!row.enabled || Boolean(row.running)"
                    @click="runAutomation(row.id)"
                  >
                    <PlayerPlayIcon aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    :aria-label="
                      $t('dynamic.automations.viewLogs', {
                        automation: row.name,
                      })
                    "
                    @click="openLog(row.id)"
                  >
                    <LogsIcon aria-hidden="true" />
                  </button>
                  <AppMenuButton
                    :ariaLabel="$t('surface.automationsView.automationActions')"
                    :items="automationMenuItems"
                    @select="selectAutomationMenuItem(row.id, $event)"
                  >
                    <template #trigger="{ attrs }">
                      <button v-bind="attrs" type="button" :aria-label="`${row.name} actions`">
                        <DotsVerticalIcon aria-hidden="true" />
                      </button>
                    </template>
                  </AppMenuButton>
                </div>
              </template>
            </AppDataList>

            <div v-if="operationError" class="automations-view__error" role="alert">{{ operationError }}</div>
          </div>
        </section>
      </div>
    </main>
  </section>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { ElMessageBox } from 'element-plus';
import { computed, ref, watch } from 'vue';
import type {
  Agent,
  AgentBackend,
  BackendModelOption,
  AppSnapshot,
  BackendConversationRef,
  CreateAutomationInput,
  Automation,
  AutomationLocation,
  RemoteConnection,
  RendererMessage,
  UpdateAutomationInput,
} from '@workspace/core/contracts';
import { agentDisplayName } from '@workspace/core/agent-display';
import { automationCalendarDescription } from '@workspace/core/automation-schedule';
import { automationExecutionIsActive, automationTargetIsAvailable, canTargetAutomationAgent } from '@workspace/core/automation-manager';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import AppDataList from './AppDataList.vue';
import type { AppDataListColumn, AppDataListRow } from './app-data-list';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import AutomationEditor from './AutomationEditor.vue';
import { provideBackendHost } from './backend-selection';
import AutomationExecutionLog from './AutomationExecutionLog.vue';
import AutomationWelcome from './AutomationWelcome.vue';
import WorkspaceHeader from '../shared/WorkspaceHeader.vue';
import { DotsVerticalIcon, LogsIcon, PencilIcon, PlayerPlayIcon, Trash2Icon } from '../shared/icons/app-icons';

const props = withDefaults(
  defineProps<{
    clearAutomationHistory?: (automationId: string, location?: AutomationLocation) => Promise<AppSnapshot | void>;
    createAutomation?: (input: CreateAutomationInput, location?: AutomationLocation) => Promise<AppSnapshot | void>;
    deleteAutomationExecution?: (automationId: string, executionId: string, location?: AutomationLocation) => Promise<AppSnapshot | void>;
    deleteAutomation?: (automationId: string, location?: AutomationLocation) => Promise<AppSnapshot | void>;
    getAutomationSnapshot?: (location?: AutomationLocation) => Promise<AppSnapshot>;
    automations: Automation[];
    agents: Agent[];
    missions?: AppSnapshot['missions'];
    listModels?: (agentId: string, backend: AgentBackend) => Promise<BackendModelOption[]>;
    remoteConnections?: RemoteConnection[];
    runAutomation?: (automationId: string, location?: AutomationLocation) => Promise<AppSnapshot | void>;
    readConversationMessages?: (ref: BackendConversationRef, agentId: string, location?: AutomationLocation) => Promise<RendererMessage[]>;
    teams: AppSnapshot['teams'];
    updateAutomation?: (input: UpdateAutomationInput, location?: AutomationLocation) => Promise<AppSnapshot | void>;
  }>(),
  {
    clearAutomationHistory: async () => undefined,
    createAutomation: async () => undefined,
    deleteAutomationExecution: async () => undefined,
    deleteAutomation: async () => undefined,
    getAutomationSnapshot: async () => createEmptySnapshot(),
    readConversationMessages: async () => [],
    listModels: async () => [],
    missions: () => [],
    remoteConnections: () => [],
    runAutomation: async () => undefined,
    updateAutomation: async () => undefined,
  },
);

type EditorMode = 'create' | 'edit';
type LocationStatus = 'idle' | 'loading' | 'error';

const editorMode = ref<EditorMode>('create');
const editingAutomationId = ref<string | null>(null);
const logAutomationId = ref<string | null>(null);
const selectedLocationValue = ref('local');
const remoteSnapshot = ref<AppSnapshot | null>(null);
const locationStatus = ref<LocationStatus>('idle');
const locationError = ref<string | null>(null);
const operationError = ref<string | null>(null);
const saving = ref(false);
const togglingAutomationId = ref<string | null>(null);
let locationLoadId = 0;

const editorVisible = computed(() => (editorMode.value === 'create' ? creating.value : Boolean(editingAutomation.value)));
const creating = ref(false);
const readyRemoteConnections = computed(() =>
  props.remoteConnections.filter((connection) => connection.status === 'ready' && Boolean(connection.transport)),
);
const selectedRemoteConnectionId = computed(() =>
  selectedLocationValue.value.startsWith('remote:') ? selectedLocationValue.value.slice('remote:'.length) : null,
);
const selectedLocation = computed<AutomationLocation>(() =>
  selectedRemoteConnectionId.value ? { kind: 'remote', remoteConnectionId: selectedRemoteConnectionId.value } : { kind: 'local' },
);
const isRemoteLocation = computed(() => selectedLocation.value.kind === 'remote');
provideBackendHost(() => selectedRemoteConnectionId.value
  ? { host: selectedRemoteConnectionId.value, connections: remoteSnapshot.value?.providerConnections ?? [] }
  : null);
const locationAutomations = computed(() => (isRemoteLocation.value ? (remoteSnapshot.value?.automations ?? []) : props.automations));
const locationTeams = computed(() => (isRemoteLocation.value ? (remoteSnapshot.value?.teams ?? []) : props.teams).filter(team => !team.remoteConnectionId));
const locationTargets = computed(() => isRemoteLocation.value
  ? { teams: remoteSnapshot.value?.teams ?? [], agents: remoteSnapshot.value?.agents ?? [], missions: remoteSnapshot.value?.missions ?? [] }
  : { teams: props.teams, agents: props.agents, missions: props.missions });
const locationAgents = computed(() => locationTargets.value.agents.filter(agent => canTargetAutomationAgent(locationTargets.value, agent)));
const editingAutomation = computed(() =>
  editingAutomationId.value ? (locationAutomations.value.find((automation) => automation.id === editingAutomationId.value) ?? null) : null,
);
const logAutomation = computed(() =>
  logAutomationId.value ? (locationAutomations.value.find((automation) => automation.id === logAutomationId.value) ?? null) : null,
);
const editorKey = computed(() => editingAutomation.value?.id ?? `create-${creating.value ? 'open' : 'closed'}`);
const automationColumns: AppDataListColumn[] = [
  {
    id: 'automation',
    label: translate('surface.automationsView.automation'),
    width: 'minmax(0, 1fr)',
  },
  {
    id: 'lastExecution',
    label: translate('surface.automationsView.lastExecution'),
    width: 'max-content',
    align: 'end',
  },
];
const automationMenuItems: AppMenuItem[] = [
  {
    id: 'edit',
    type: 'action',
    label: translate('surface.automationsView.edit'),
    icon: PencilIcon,
  },
  {
    id: 'delete',
    type: 'action',
    label: translate('surface.automationsView.delete'),
    icon: Trash2Icon,
    danger: true,
  },
];
const automationRows = computed<AppDataListRow[]>(() =>
  locationAutomations.value.map((automation) => ({
    id: automation.id,
    enabled: automation.enabled,
    running: automation.executionLog.some(automationExecutionIsActive),
    error: automation.lastError ?? '',
    lastExecution: automationLastExecutionLabel(automation),
    name: automation.name,
    source: automationSourceLabel(automation),
    sourceLine: `${automationSourceLabel(automation)} · ${automationScheduleLabel(automation)}`,
  })),
);

watch(selectedLocationValue, () => {
  closeEditor();
  closeLog();
  operationError.value = null;
  void loadSelectedLocation();
});

watch(readyRemoteConnections, (connections) => {
  if (selectedLocationValue.value === 'local') {
    return;
  }
  if (!connections.some((connection) => remoteLocationValue(connection.id) === selectedLocationValue.value)) {
    selectedLocationValue.value = 'local';
  }
});

function openCreate(): void {
  editorMode.value = 'create';
  editingAutomationId.value = null;
  logAutomationId.value = null;
  creating.value = true;
  operationError.value = null;
}

function openEdit(automationId: string): void {
  editorMode.value = 'edit';
  editingAutomationId.value = automationId;
  logAutomationId.value = null;
  creating.value = false;
}

function closeEditor(): void {
  creating.value = false;
  editingAutomationId.value = null;
}

function openLog(automationId: string): void {
  creating.value = false;
  editingAutomationId.value = null;
  logAutomationId.value = automationId;
}

function closeLog(): void {
  logAutomationId.value = null;
}

async function saveAutomation(input: CreateAutomationInput): Promise<void> {
  saving.value = true;
  operationError.value = null;
  try {
    const nextSnapshot = editorMode.value === 'edit' && editingAutomation.value
      ? await updateLocationAutomation({ ...input, id: editingAutomation.value.id })
      : await createLocationAutomation(input);
    refreshLocationFromSnapshot(nextSnapshot);
    closeEditor();
  } catch (error) { operationError.value = error instanceof Error ? error.message : String(error); }
  finally { saving.value = false; }
}

async function toggleAutomation(automationId: string, enabled: boolean): Promise<void> {
  const automation = locationAutomations.value.find(candidate => candidate.id === automationId);
  if (!automation) return;
  operationError.value = null;
  if (enabled && !automationTargetIsAvailable(locationTargets.value, automation.target)) {
    operationError.value = translate('promptAutomation.invalidTarget');
    return;
  }
  togglingAutomationId.value = automationId;
  try {
    const { id, name, prompt, target, schedule } = automation;
    // Store objects are reactive proxies; IPC needs plain data.
    refreshLocationFromSnapshot(await updateLocationAutomation({ id, name, enabled, prompt, target: { ...target }, schedule: { ...schedule } }));
  } catch (error) { operationError.value = error instanceof Error ? error.message : String(error); }
  finally { togglingAutomationId.value = null; }
}

async function runAutomation(automationId: string): Promise<void> {
  operationError.value = null;
  try { refreshLocationFromSnapshot(await runLocationAutomation(automationId)); }
  catch (error) { operationError.value = error instanceof Error ? error.message : String(error); }
}

function selectAutomationMenuItem(automationId: string, itemId: string): void {
  if (itemId === 'edit') {
    openEdit(automationId);
  } else if (itemId === 'delete') {
    void confirmDeleteAutomation(automationId);
  }
}

async function confirmDeleteAutomation(automationId: string): Promise<void> {
  const automation = locationAutomations.value.find((candidate) => candidate.id === automationId);
  if (!automation) {
    return;
  }

  try {
    await ElMessageBox.confirm(
      `Automation "${automation.name}" will stop sending scheduled prompts.`,
      translate('surface.automationsView.deleteAutomation'),
      {
        cancelButtonText: translate('common.cancel'),
        confirmButtonText: translate('dynamic.misc.deleteAutomation'),
        type: 'warning',
      },
    );
  } catch {
    return;
  }

  refreshLocationFromSnapshot(await deleteLocationAutomation(automation.id));
  if (logAutomationId.value === automation.id) {
    logAutomationId.value = null;
  }
}

async function confirmClearAutomationHistory(automationId: string): Promise<void> {
  const automation = locationAutomations.value.find((candidate) => candidate.id === automationId);
  if (!automation || automation.executionLog.length === 0) {
    return;
  }

  try {
    await ElMessageBox.confirm(
      `Finished execution history for "${automation.name}" will be cleared. Active runs are kept.`,
      translate('surface.automationsView.clearHistory'),
      {
        cancelButtonText: translate('common.cancel'),
        confirmButtonText: translate('dynamic.misc.clearHistory'),
        type: 'warning',
      },
    );
  } catch {
    return;
  }

  refreshLocationFromSnapshot(await clearLocationAutomationHistory(automation.id));
}

async function confirmDeleteAutomationExecution(payload: { executionId: string; automationId: string }): Promise<void> {
  const automation = locationAutomations.value.find((candidate) => candidate.id === payload.automationId);
  const execution = automation?.executionLog.find((candidate) => candidate.id === payload.executionId);
  if (!automation || !execution) {
    return;
  }

  try {
    await ElMessageBox.confirm(
      translate('surface.automationsView.thisExecutionWillBeRemovedFromTheAutomationHistory'),
      translate('surface.automationsView.deleteExecution'),
      {
        cancelButtonText: translate('common.cancel'),
        confirmButtonText: translate('dynamic.misc.deleteExecution'),
        type: 'warning',
      },
    );
  } catch {
    return;
  }

  refreshLocationFromSnapshot(await deleteLocationAutomationExecution(automation.id, execution.id));
}

async function readLocationConversationMessages(ref: BackendConversationRef, agentId: string): Promise<RendererMessage[]> {
  const location = requestLocation();
  return location ? props.readConversationMessages(ref, agentId, location) : props.readConversationMessages(ref, agentId);
}

async function loadSelectedLocation(): Promise<void> {
  const loadId = ++locationLoadId;
  locationError.value = null;
  if (!isRemoteLocation.value) {
    remoteSnapshot.value = null;
    locationStatus.value = 'idle';
    return;
  }

  locationStatus.value = 'loading';
  try {
    const snapshot = await props.getAutomationSnapshot(requestLocation());
    if (loadId !== locationLoadId) {
      return;
    }
    remoteSnapshot.value = snapshot;
    locationStatus.value = 'idle';
  } catch (error) {
    if (loadId !== locationLoadId) {
      return;
    }
    remoteSnapshot.value = null;
    locationStatus.value = 'error';
    locationError.value = error instanceof Error ? error.message : String(error);
  }
}

function refreshLocationFromSnapshot(snapshot: AppSnapshot | void): void {
  if (isRemoteLocation.value && snapshot) {
    remoteSnapshot.value = snapshot;
  }
}

function remoteLocationValue(connectionId: string): string {
  return `remote:${connectionId}`;
}

function createLocationAutomation(input: CreateAutomationInput): Promise<AppSnapshot | void> {
  const location = requestLocation();
  return location ? props.createAutomation(input, location) : props.createAutomation(input);
}

function updateLocationAutomation(input: UpdateAutomationInput): Promise<AppSnapshot | void> {
  const location = requestLocation();
  return location ? props.updateAutomation(input, location) : props.updateAutomation(input);
}

function runLocationAutomation(automationId: string): Promise<AppSnapshot | void> {
  const location = requestLocation();
  return location ? props.runAutomation(automationId, location) : props.runAutomation(automationId);
}

function clearLocationAutomationHistory(automationId: string): Promise<AppSnapshot | void> {
  const location = requestLocation();
  return location ? props.clearAutomationHistory(automationId, location) : props.clearAutomationHistory(automationId);
}

function deleteLocationAutomationExecution(automationId: string, executionId: string): Promise<AppSnapshot | void> {
  const location = requestLocation();
  return location
    ? props.deleteAutomationExecution(automationId, executionId, location)
    : props.deleteAutomationExecution(automationId, executionId);
}

function deleteLocationAutomation(automationId: string): Promise<AppSnapshot | void> {
  const location = requestLocation();
  return location ? props.deleteAutomation(automationId, location) : props.deleteAutomation(automationId);
}

function requestLocation(): AutomationLocation | undefined {
  return isRemoteLocation.value ? selectedLocation.value : undefined;
}

function automationSourceLabel(automation: Automation): string {
  const target = automation.target;
  if (!automationTargetIsAvailable(locationTargets.value, target)) return translate('promptAutomation.missingTarget');
  if (target.kind === 'newQuickChat') return translate('promptAutomation.newQuickChat');
  return agentDisplayName(locationTargets.value.agents.find(agent => agent.id === target.agentId)!);
}

function automationScheduleLabel(automation: Automation): string {
  if ('rrule' in automation.schedule) return `${automationCalendarDescription(automation.schedule, automation.scheduleAnchorAt ?? automation.createdAt)} · ${automation.schedule.timeZone}`;
  const minutes = automation.schedule.intervalMinutes;
  if (minutes < 60) return translate('dynamic.automations.everyMinutes', { count: minutes });
  if (minutes === 60) return translate('surface.automationEditor.everyHour');
  if (minutes < 1_440) return translate('dynamic.automations.everyHours', { count: minutes / 60 });
  return translate('surface.automationEditor.everyDay');
}

function automationLastExecutionLabel(automation: Automation): string {
  if (!automation.lastRunAt) {
    return translate('surface.automationsView.never');
  }

  return formatShortDate(automation.lastRunAt);
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return translate('surface.automationsView.unknown');
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
</script>

<style scoped>
.automations-view {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-shell-main);
}

.automations-view__header {
  padding-inline: var(--space-20);
  font-size: var(--font-size-16);
}

.automations-view__content {
  container-type: inline-size;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding-top: var(--space-12);
  padding-inline: var(--space-12);
}

.automations-view__panel {
  max-width: 720px;
  margin: 0 auto;
}

.automations-view__panel--wide {
  width: 100%;
  max-width: 920px;
}

.automations-view__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.automations-view__list-header {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
  padding-bottom: var(--space-12);
  border-bottom: 1px solid var(--color-border);
}

.automations-view__location-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.automations-view__location-select {
  width: 160px;
}

.automations-view__location-state {
  padding: var(--space-12);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.automations-view__error {
  padding: var(--space-10) var(--space-12);
  border: 1px solid var(--color-error-container);
  border-radius: var(--radius-md);
  color: var(--color-on-error-container);
  background: var(--color-error-container);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.automations-view__automation-cell {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

.automations-view__automation-cell[data-enabled="false"] strong {
  color: var(--color-text-muted);
}

.automations-view__info {
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-8);
}

.automations-view__automation-cell strong,
.automations-view__automation-cell span,
.automations-view__meta-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.automations-view__automation-cell strong {
  color: var(--color-text);
  font-size: var(--font-size-15);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-20);
}

.automations-view__automation-cell span,
.automations-view__meta-cell {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-18);
}

.automations-view__meta-cell {
  display: block;
  text-align: right;
}

.automations-view__row-actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.automations-view__row-actions .el-switch {
  margin-inline: var(--space-8) var(--space-6);
}

.automations-view__row-actions button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.automations-view__row-actions button:disabled {
  opacity: 0.4;
  cursor: default;
}

.automations-view__row-actions button:hover:not(:disabled),
.automations-view__row-actions button:focus-visible:not(:disabled) {
  color: var(--color-text);
}

.automations-view__row-actions svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.automations-view :deep(.app-data-list__actions) {
  opacity: 1;
  pointer-events: auto;
}

@container (max-width: 680px) {
  .automations-view__list-header {
    flex-wrap: wrap;
    gap: var(--space-6);
  }

  .automations-view__info {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .automations-view__info > * {
    max-width: 100%;
  }

  .automations-view__list :deep(.app-data-list__row) {
    grid-template-columns: minmax(0, 1fr) max-content max-content;
    gap: var(--space-4);
    padding-inline: var(--space-6);
  }

  .automations-view__list :deep(.app-data-list__cell:first-child) {
    grid-column: 1 / 3;
  }

  .automations-view__list :deep(.app-data-list__actions) {
    grid-column: 3;
    grid-row: 1 / 3;
  }

  .automations-view__meta-cell {
    text-align: left;
  }
}
</style>
