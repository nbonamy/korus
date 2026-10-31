<template>
  <li class="mission-implementation__ticket-item">
    <button
      type="button"
      class="mission-implementation__ticket"
      :class="{ 'mission-implementation__ticket--selected': selected, 'mission-implementation__ticket--active': active }"
      :aria-label="t('missions.openTicketThread', { title: item.ticket.title })"
      :aria-pressed="Boolean(active)"
      :disabled="!item.run?.workerId"
      @click="emit('open-conversation', item.run?.workerId)"
    >
      <span class="mission-implementation__ticket-heading">
        <small>{{ missionTicketNumber(item.index) }}</small>
        <span :data-status="status">{{ t(`missions.ticketRunStatus.${status}`) }}</span>
      </span>
      <strong class="mission-implementation__ticket-title">{{ item.ticket.title }}</strong>
      <span class="mission-implementation__ticket-preview">{{ preview }}</span>
      <span class="mission-implementation__ticket-footer">
        <span v-if="item.ticket.dependsOn?.length" class="mission-implementation__dependencies">
          {{ t('missions.blockedByShort', { tickets: item.ticket.dependsOn.map(missionTicketNumber).join(', ') }) }}
        </span>
        <span v-else class="mission-implementation__repository">{{ missionRepositoryName(repositoryPath) }}</span>
        <span v-if="item.run?.workerId" class="mission-implementation__agent">
          <MessageCircleIcon aria-hidden="true" />{{ t('missions.builder') }}
        </span>
      </span>
    </button>
    <button
      type="button"
      class="mission-implementation__ticket-details"
      :aria-label="item.run?.implementationResult
        ? t('missions.viewTicketEvidence', { title: item.ticket.title })
        : t('missions.openTicketDetails', { title: item.ticket.title })"
      :aria-expanded="selected"
      aria-controls="mission-ticket-details"
      @click="emit('open-details')"
    >
      <FileTextIcon aria-hidden="true" />
    </button>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MissionTicket } from '@workspace/core/missions';
import { FileTextIcon, MessageCircleIcon } from '../shared/icons/app-icons';
import {
  implementationTicketStatus,
  missionRepositoryName,
  missionTicketNumber,
  missionTicketPreview,
  type MissionImplementationTicketItem,
} from './mission-implementation-model';

const props = defineProps<{
  allTickets: MissionTicket[];
  item: MissionImplementationTicketItem;
  repositoryPath: string;
  selected: boolean;
  active?: boolean;
}>();
const emit = defineEmits<{ 'open-conversation': [agentId?: string]; 'open-details': [] }>();
const { t } = useI18n();
const status = computed(() => implementationTicketStatus(props.item, props.allTickets));
const preview = computed(() => missionTicketPreview(props.item.ticket, t('missions.noTicketDescription')));
</script>

<style scoped>
.mission-implementation__ticket-item {
  position: relative;
  width: 100%;
  max-width: 320px;
}

.mission-implementation__ticket {
  display: grid;
  width: 100%;
  height: 196px;
  grid-template-rows: auto auto 1fr auto;
  gap: var(--space-3);
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text);
  background: var(--color-surface-lowest);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background 160ms ease;
}

.mission-implementation__ticket:hover:not(:disabled),
.mission-implementation__ticket:focus-visible {
  border-color: var(--color-border-strong);
  background: var(--color-surface-low);
}

.mission-implementation__ticket:disabled {
  cursor: default;
}

.mission-implementation__ticket--selected,
.mission-implementation__ticket--active,
.mission-implementation__ticket--active:hover:not(:disabled),
.mission-implementation__ticket--active:focus-visible {
  border-color: var(--color-primary);
  background: var(--color-primary-container);
}

.mission-implementation__ticket-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.mission-implementation__ticket-heading small {
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
  font-weight: var(--font-weight-semibold);
}

.mission-implementation__ticket-title {
  display: -webkit-box;
  overflow: hidden;
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.mission-implementation__ticket-heading > span {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: var(--color-surface-high);
  font-size: var(--font-size-11);
  white-space: nowrap;
}

.mission-implementation__ticket-heading > span[data-status="running"],
.mission-implementation__ticket-heading > span[data-status="preparing"] {
  color: var(--color-on-primary-container);
  background: var(--color-primary-container);
}

.mission-implementation__ticket-heading > span[data-status="awaitingReview"] {
  color: var(--color-on-warning-container);
  background: var(--color-warning-container);
}

.mission-implementation__ticket-heading > span[data-status="accepted"] {
  color: var(--color-on-success-container);
  background: var(--color-success-container);
}

.mission-implementation__ticket-heading > span[data-status="failed"],
.mission-implementation__ticket-heading > span[data-status="cancelled"] {
  color: var(--color-on-error-container);
  background: var(--color-error-container);
}

.mission-implementation__ticket-preview {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  line-height: var(--line-height-18);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.mission-implementation__ticket-footer {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
  padding-top: var(--space-3);
  padding-right: 34px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
}

.mission-implementation__ticket-footer > span:first-child {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-implementation__agent {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
  color: var(--color-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-implementation__agent svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.mission-implementation__ticket-details {
  position: absolute;
  right: var(--space-6);
  bottom: var(--space-4);
  z-index: 1;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.mission-implementation__ticket-details:hover,
.mission-implementation__ticket-details:focus-visible {
  color: var(--color-primary);
  background: var(--color-primary-container);
}

.mission-implementation__ticket-details svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

@media (prefers-reduced-motion: reduce) {
  .mission-implementation__ticket {
    transition-duration: 1ms;
  }
}
</style>
