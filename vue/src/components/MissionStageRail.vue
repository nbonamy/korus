<template>
  <aside class="mission-stage-rail" :aria-label="t('missions.progress')">
    <div class="mission-stage-rail__heading">
      <ListIcon aria-hidden="true" />
      <strong>{{ t('missions.process') }}</strong>
    </div>
    <ol class="mission-stage-rail__stages">
      <li v-for="(stage, index) in stages" :key="stage">
        <button
          type="button"
          :class="{ 'mission-stage-rail__stage--viewed': viewedStage === stage }"
          :disabled="index > currentIndex"
          :aria-current="stage === mission.stage ? 'step' : undefined"
          @click="emit('view-stage', stage)"
        >
          <span class="mission-stage-rail__marker" :data-state="stageState(stage)">
            <CheckIcon v-if="stageState(stage) === 'complete'" aria-hidden="true" />
            <span v-else>{{ index + 1 }}</span>
          </span>
          <span class="mission-stage-rail__copy">
            <strong>{{ t(`missions.${stage}`) }}</strong>
            <small>{{ stageStatus(stage) }}</small>
          </span>
        </button>
      </li>
    </ol>
    <div class="mission-stage-rail__progress">
      <span>{{ t('missions.stageCount', { current: completedStageCount, total: stages.length }) }}</span>
      <strong>{{ progressPercent }}%</strong>
      <div role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100">
        <span :style="{ width: `${progressPercent}%` }" />
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Mission, MissionStage } from '@workspace/core/missions';
import { missionWorkflow } from '@workspace/core/mission-workflows';
import { pendingMissionRun } from '@workspace/core/mission-execution';
import { CheckIcon, ListIcon } from '../shared/icons/app-icons';

const props = defineProps<{ mission: Mission; viewedStage: MissionStage }>();
const emit = defineEmits<{ 'view-stage': [stage: MissionStage] }>();
const { t } = useI18n();
const stages = computed(() => missionWorkflow(props.mission.workflow.type).stages);
const activeRun = computed(() => pendingMissionRun(props.mission));
const currentIndex = computed(() => stages.value.indexOf(props.mission.stage));
const completedStageCount = computed(() => props.mission.status === 'completed' ? stages.value.length : currentIndex.value);
const progressPercent = computed(() => Math.round((completedStageCount.value / stages.value.length) * 100));

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
  min-height: 0;
  flex-direction: column;
  padding-bottom: var(--space-10);
  border-right: 1px solid var(--color-border);
  background: color-mix(
    in srgb,
    var(--color-surface),
    var(--color-shell-main) 80%
  );
}

.mission-stage-rail__heading {
  display: flex;
  min-height: var(--workbench-subheader-height);
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-6);
  padding: 0 var(--space-12);
  border-bottom: 1px solid var(--color-border);
}

.mission-stage-rail__heading > svg {
  width: var(--icon-lg);
  height: var(--icon-lg);
  color: var(--color-primary);
}

.mission-stage-rail__copy {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
}

.mission-stage-rail__copy small {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-stage-rail__stages {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-8);
  list-style: none;
}

.mission-stage-rail__stages button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-6);
  border: 0;
  border-radius: var(--radius-lg);
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
  background: var(--color-primary-container);
}

.mission-stage-rail__marker {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border: 2px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  background: var(--color-surface-lowest);
  font-size: var(--font-size-12);
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
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.mission-stage-rail__progress {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-4);
  margin: auto var(--space-8) 0;
  padding: var(--space-8) var(--space-4) 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-12);
}

.mission-stage-rail__progress [role="progressbar"] {
  height: 6px;
  grid-column: 1 / -1;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--color-surface-high);
}

.mission-stage-rail__progress [role="progressbar"] span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
}

@container (max-width: 680px) {
  .mission-stage-rail {
    min-height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
    border-left: 0;
  }
  .mission-stage-rail__stages {
    grid-template-columns: repeat(4, minmax(120px, 1fr));
    overflow-x: auto;
  }
  .mission-stage-rail__progress {
    margin-top: var(--space-8);
  }
}
</style>
