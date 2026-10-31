<template>
  <nav class="mission-stage-rail" :aria-label="t('missions.progress')">
    <ol ref="stageList" class="mission-stage-rail__stages">
      <li v-for="(stage, index) in stages" :key="stage">
        <button
          type="button"
          :class="{ 'mission-stage-rail__stage--viewed': viewedStage === stage }"
          :data-stage="stage"
          :data-state="stageState(stage)"
          :disabled="index > currentIndex"
          :aria-current="stage === mission.stage ? 'step' : undefined"
          :aria-pressed="viewedStage === stage"
          :aria-label="`${t(`missions.${stage}`)}, ${stageStatus(stage)}`"
          @click="emit('view-stage', stage)"
        >
          <span class="mission-stage-rail__marker" :data-state="stageState(stage)">
            <CheckIcon v-if="stageState(stage) === 'complete'" stroke="3" aria-hidden="true" />
            <span v-else>{{ index + 1 }}</span>
          </span>
          <span class="mission-stage-rail__copy">
            <strong>{{ t(`missions.${stage}`) }}</strong>
          </span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<script setup lang="ts">
import { computed, useTemplateRef, watchPostEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Mission, MissionStage } from '@workspace/core/missions';
import { missionWorkflow } from '@workspace/core/mission-workflows';
import { pendingMissionRun } from '@workspace/core/mission-execution';
import { CheckIcon } from '../shared/icons/app-icons';

const props = defineProps<{ mission: Mission; viewedStage: MissionStage }>();
const emit = defineEmits<{ 'view-stage': [stage: MissionStage] }>();
const { t } = useI18n();
const stages = computed(() => missionWorkflow(props.mission.workflow.type).stages);
const activeRun = computed(() => pendingMissionRun(props.mission));
const currentIndex = computed(() => stages.value.indexOf(props.mission.stage));
const stageList = useTemplateRef<HTMLOListElement>('stageList');

watchPostEffect(() => {
  const stage = props.viewedStage;
  stageList.value?.querySelector<HTMLButtonElement>(`[data-stage="${stage}"]`)
    ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
});

function stageState(stage: MissionStage): 'complete' | 'current' | 'upcoming' {
  const index = stages.value.indexOf(stage);
  if (index < currentIndex.value || props.mission.status === 'completed') return 'complete';
  return stage === props.mission.stage ? 'current' : 'upcoming';
}

function stageStatus(stage: MissionStage): string {
  const state = stageState(stage);
  if (state === 'complete') return t('missions.stageComplete');
  if (state === 'upcoming') return t('missions.notStarted');
  if (activeRun.value?.proposal) return t('missions.readyForReview');
  if (activeRun.value) return t(`missions.runStatus.${activeRun.value.status}`);
  if (stage === 'ship') {
    const deliveries = props.mission.execution?.deliveries ?? [];
    return t('missions.shipRepositoryCount', { complete: deliveries.filter(delivery => delivery.status !== 'pending').length, total: deliveries.length });
  }
  return t('missions.readyToStart');
}
</script>

<style scoped>
.mission-stage-rail {
  display: flex;
  height: var(--workbench-subheader-height);
  min-width: 0;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.mission-stage-rail__stages {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: repeat(5, minmax(108px, 1fr));
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2);
  overflow: auto hidden;
  list-style: none;
  scrollbar-width: thin;
  scroll-padding-inline: var(--space-2);
}

.mission-stage-rail__stages button {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-8);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.mission-stage-rail__stages button:disabled {
  color: var(--color-text-muted);
  cursor: default;
}

.mission-stage-rail__stages .mission-stage-rail__stage--viewed {
  background: var(--color-surface-high);
}

.mission-stage-rail__stages button[data-state="complete"] strong {
  color: var(--color-on-success-container);
}

.mission-stage-rail__stages button[data-state="current"] strong {
  color: var(--color-primary);
}

.mission-stage-rail__copy {
  min-width: 0;
  font-size: var(--font-size-12);
}

.mission-stage-rail__copy strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-stage-rail__marker {
  display: grid;
  width: var(--space-10);
  height: var(--space-10);
  flex: 0 0 var(--space-10);
  place-items: center;
  border: 1.5px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  background: var(--color-surface-lowest);
  font-size: var(--font-size-11);
  line-height: 1;
}

.mission-stage-rail__marker[data-state="current"] {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.mission-stage-rail__marker[data-state="complete"] {
  border-color: var(--color-success);
  color: var(--color-on-success);
  background: var(--color-success);
}

.mission-stage-rail__marker svg {
  width: var(--space-6);
  height: var(--space-6);
}
</style>
