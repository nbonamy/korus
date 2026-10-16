<template>
  <article
    class="cockpit-view__agent-card"
    :class="{
      'cockpit-view__agent-card--drop-ready': dropReady,
      'cockpit-view__agent-card--drop-target': dropTarget,
    }"
    @click="emit('select')"
    @contextmenu.prevent="openAgentMenu"
    @dragenter="enterDropTarget"
    @dragleave="leaveDropTarget"
    @dragover="allowDrop"
    @drop="dropWorkItem"
  >
    <header class="cockpit-view__agent-header">
      <AgentAvatar
        v-if="repositoryIcon"
        :avatar="repositoryIcon"
        :name="displayName"
        shape="square"
        size="lg"
      />
      <FolderRootIcon
        v-else
        class="cockpit-view__repository-icon"
        aria-hidden="true"
      />
      <div class="cockpit-view__agent-title">
        <strong>{{ displayName }}</strong>
        <span v-if="agent.folder">{{ folderBasename(agent.folder) }}</span>
      </div>
      <div class="cockpit-view__agent-meta">
        <span
          v-if="backendChoices.length > 1"
          class="cockpit-view__agent-backend"
          role="img"
          :aria-label="backendDisplayName(agent.backend)"
          :title="backendDisplayName(agent.backend)"
        >
          <BackendIcon :backend="agent.backend" />
        </span>
        <span
          class="cockpit-view__agent-state"
          :data-status="agent.status.type"
        >
          {{ agentStatusLabel(agent.status.type, t) }}
        </span>
      </div>
    </header>

    <div class="cockpit-view__agent-body">
      <strong>{{ agentStatusText(agent, t) }}</strong>
      <span v-if="showLastActivity" :title="responsePreview || undefined">{{ responsePreview || lastActivity }}</span>
    </div>

    <form
      class="cockpit-view__prompt"
      @click.stop
      @submit.prevent="submitPrompt"
    >
      <input
        v-model="promptDraft"
        :disabled="!canReceivePrompt"
        :placeholder="canReceivePrompt ? t('cockpit.sendPromptPlaceholder') : t('cockpit.workingPlaceholder')"
        :aria-label="t('cockpit.prompt', { agent: displayName })"
      >
      <button
        type="submit"
        :disabled="!canSubmitPrompt"
        :aria-label="t('cockpit.sendPrompt', { agent: displayName })"
      >
        <SendIcon aria-hidden="true" />
      </button>
    </form>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Agent, WorkItem } from '@workspace/core/contracts';
import { agentDisplayName } from '@workspace/core/agent-display';
import { backendDisplayName } from '@workspace/core/backend-driver';
import { agentCanReceivePrompt, agentStatusLabel, agentStatusText, folderBasename } from '../shared/agent-display';
import { FolderRootIcon, SendIcon } from '../shared/icons/app-icons';
import AgentAvatar from './AgentAvatar.vue';
import BackendIcon from './BackendIcon.vue';
import { useBackendChoices } from './backend-selection';
import { relativeSessionDate } from './use-session-history';

const props = defineProps<{
  agent: Agent;
  repositoryIcon?: string;
  draggedWorkItem: WorkItem | null;
  dropTarget: boolean;
  showLastActivity?: boolean;
  responsePreview?: string;
}>();

const emit = defineEmits<{
  'assign-work-item': [payload: { agentId: string; item: WorkItem }];
  'clear-dragged-work-item': [];
  'drop-target-enter': [agentId: string];
  'drop-target-leave': [agentId: string];
  'open-agent-menu': [payload: { agentId: string; x: number; y: number }];
  prompt: [payload: { agentId: string; prompt: string }];
  select: [];
}>();

const { t } = useI18n();
const backendChoices = useBackendChoices(() => props.agent.teamId);

const promptDraft = ref('');
const canReceivePrompt = computed(() => agentCanReceivePrompt(props.agent));
const canSubmitPrompt = computed(() => canReceivePrompt.value && Boolean(promptDraft.value.trim()));
const dropReady = computed(() => Boolean(props.draggedWorkItem && canReceivePrompt.value));
const displayName = computed(() => agentDisplayName(props.agent));
const showLastActivity = computed(() => props.showLastActivity ?? false);
const lastActivity = computed(() => t('surface.cockpitAgentsView.lastActive', {
  time: relativeSessionDate(props.agent.lastActivityAt ?? props.agent.updatedAt, Date.now(), (key, params) => (
    params ? t(key, params) : t(key)
  )),
}));

function submitPrompt(): void {
  if (!canSubmitPrompt.value) {
    return;
  }

  const prompt = promptDraft.value.trim();
  promptDraft.value = '';
  emit('prompt', {
    agentId: props.agent.id,
    prompt,
  });
}

function allowDrop(event: DragEvent): void {
  if (!dropReady.value) {
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
}

function enterDropTarget(event: DragEvent): void {
  if (!dropReady.value) {
    return;
  }

  event.preventDefault();
  emit('drop-target-enter', props.agent.id);
}

function openAgentMenu(event: MouseEvent): void {
  event.stopPropagation();
  emit('open-agent-menu', {
    agentId: props.agent.id,
    x: event.clientX,
    y: event.clientY,
  });
}

function leaveDropTarget(event: DragEvent): void {
  if (isInternalDragLeave(event)) {
    return;
  }

  emit('drop-target-leave', props.agent.id);
}

function isInternalDragLeave(event: DragEvent): boolean {
  const currentTarget = event.currentTarget;
  const relatedTarget = event.relatedTarget;

  if (!(currentTarget instanceof HTMLElement)) {
    return false;
  }

  if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
    return true;
  }

  const rect = currentTarget.getBoundingClientRect();
  if (rect.right <= rect.left || rect.bottom <= rect.top) {
    return false;
  }

  return event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
}

function dropWorkItem(event: DragEvent): void {
  if (!dropReady.value || !props.draggedWorkItem) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  emit('assign-work-item', {
    agentId: props.agent.id,
    item: props.draggedWorkItem,
  });
  emit('clear-dragged-work-item');
}
</script>

<style scoped>
.cockpit-view__agent-card {
  width: min(100%, 320px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--color-surface-low) 70%, transparent);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-8);
  text-align: left;
  cursor: pointer;
}

.cockpit-view__agent-card:hover,
.cockpit-view__agent-card:focus-visible {
  border-color: var(--color-border-strong);
  background: color-mix(
    in srgb,
    var(--color-primary) 8%,
    var(--color-surface-low)
  );
}

.cockpit-view__agent-card--drop-ready {
  border-color: color-mix(
    in srgb,
    var(--color-primary) 45%,
    var(--color-border)
  );
}

.cockpit-view__agent-card--drop-target {
  border-color: var(--color-primary);
  background: color-mix(
    in srgb,
    var(--color-primary) 12%,
    var(--color-surface-low)
  );
  box-shadow: inset 0 0 0 1px var(--color-primary);
}

.cockpit-view__agent-card:focus-visible,
.cockpit-view__prompt button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.cockpit-view__agent-header {
  min-width: 0;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-8);
  padding-bottom: var(--space-8);
  border-bottom: 1px solid var(--color-border);
}

.cockpit-view__repository-icon {
  width: var(--icon-xl);
  height: var(--icon-xl);
  justify-self: center;
  color: var(--color-text-muted);
  stroke-width: 1.8;
}

.cockpit-view__agent-title {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.cockpit-view__agent-title strong,
.cockpit-view__agent-title span,
.cockpit-view__agent-body strong,
.cockpit-view__agent-body span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cockpit-view__agent-title strong {
  color: var(--color-text);
  font-size: var(--font-size-15);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-20);
}

.cockpit-view__agent-title span,
.cockpit-view__agent-body span {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.cockpit-view__agent-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-4);
}

.cockpit-view__agent-backend {
  display: flex;
}

.cockpit-view__agent-state {
  color: var(--color-success);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-18);
}

.cockpit-view__agent-state[data-status="working"],
.cockpit-view__agent-state[data-status="awaitingInput"] {
  color: var(--color-warning);
}

.cockpit-view__agent-state[data-status="error"] {
  color: var(--color-error);
}

.cockpit-view__agent-body {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: var(--space-3);
}

.cockpit-view__agent-body strong {
  color: var(--color-text);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-20);
}

.cockpit-view__prompt {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  align-items: center;
  gap: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-surface-lowest);
}

.cockpit-view__prompt input {
  min-width: 0;
  height: 34px;
  border: 0;
  padding: 0 0 0 var(--space-8);
  color: var(--color-text);
  background: transparent;
  outline: none;
}

.cockpit-view__prompt input::placeholder {
  color: var(--color-text-muted);
}

.cockpit-view__prompt input:disabled {
  opacity: 0.6;
}

.cockpit-view__prompt button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-primary);
  background: transparent;
  cursor: pointer;
}

.cockpit-view__prompt button:disabled {
  color: var(--color-text-muted);
  cursor: default;
  opacity: 0.45;
}

.cockpit-view__prompt svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
