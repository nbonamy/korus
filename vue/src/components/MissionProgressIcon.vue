<template>
  <component :is="icon" aria-hidden="true" class="mission-progress-icon" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Mission } from '@workspace/core/missions';
import { missionWorkflow } from '@workspace/core/mission-workflows';
import { Percentage0Icon, Percentage20Icon, Percentage40Icon, Percentage60Icon, Percentage80Icon, Percentage100Icon } from '../shared/icons/app-icons';

const props = defineProps<{ mission: Mission }>();
const missionProgressIcons = [Percentage0Icon, Percentage20Icon, Percentage40Icon, Percentage60Icon, Percentage80Icon, Percentage100Icon];
function missionProgressIcon(mission: Mission) {
  const stages = missionWorkflow(mission.workflow.type).stages;
  const progress = mission.status === 'completed' ? 5 : Math.max(0, Math.floor(stages.indexOf(mission.stage) / stages.length * 5));
  return missionProgressIcons[progress];
}
const icon = computed(() => missionProgressIcon(props.mission));
</script>

<style scoped>
.mission-progress-icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
  justify-self: center;
  stroke-width: 1.8;
  color: color-mix(in srgb, var(--color-primary) 35%, var(--color-surface-low));
}
</style>
