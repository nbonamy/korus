<template>
  <div class="mission-task-filters">
    <CountedFilterRow :model-value="statuses" :options="statusOptions" :total="tickets.length" wrap
      :label="t('missions.taskFilters.status')" :all-label="t('missions.taskFilters.all')"
      @update:model-value="emit('update:statuses', $event)" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MissionTicket } from '@workspace/core/missions';
import type { MissionImplementationTicketItem } from './mission-implementation-model';
import { missionTaskStatus, missionTaskStatuses, type MissionTaskStatus } from './mission-ticket-filters';
import CountedFilterRow from '../shared/CountedFilterRow.vue';
const props = defineProps<{ tickets: readonly MissionTicket[]; items: readonly MissionImplementationTicketItem[]; statuses: MissionTaskStatus[] }>();
const emit = defineEmits<{ 'update:statuses': [values: MissionTaskStatus[]] }>();
const { t } = useI18n();
const colors = { next: 'var(--color-text-muted)', active: 'var(--color-primary)', review: 'var(--color-warning)', blocked: 'var(--color-error)', done: 'var(--color-success)' };
const statusOptions = computed(() => missionTaskStatuses.map(value => ({ value, label: t(`missions.taskFilters.${value}`),
  count: props.items.filter(item => missionTaskStatus(item, props.tickets) === value).length, color: colors[value] })));
</script>

<style scoped>
.mission-task-filters { display: grid; gap: var(--space-4); margin-bottom: var(--space-8); }
</style>
