<template>
  <div class="rate-limit-resume" role="status">
    <ClockHour8Icon class="rate-limit-resume__icon" aria-hidden="true" />
    <div class="rate-limit-resume__text">
      <span>{{ $t('autoResume.title') }}</span>
      <time :datetime="new Date(pause.resumeAt).toISOString()">{{ $t(pause.enabled ? 'autoResume.resumesAt' : 'autoResume.resetsAt', { time: resetTime }) }}</time>
    </div>
    <el-switch size="small" :model-value="pause.enabled" :disabled="busy" :aria-label="$t('autoResume.title')" @change="setEnabled(Boolean($event))" />
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { RateLimitPause } from '@workspace/core/auto-resume';
import { appApi } from '../platform-api';
import { ClockHour8Icon } from '../shared/icons/app-icons';
const props = defineProps<{ agentId: string; pause: RateLimitPause }>();
const busy = ref(false);
const resetTime = computed(() => new Intl.DateTimeFormat(undefined, {
  ...(new Date(props.pause.resumeAt).toDateString() !== new Date().toDateString() ? { month: 'short', day: 'numeric' } as const : {}),
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
}).format(props.pause.resumeAt));
async function setEnabled(enabled: boolean) {
  if (busy.value || !appApi) return;
  busy.value = true;
  try { await appApi.setAutoResume(props.agentId, enabled); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : String(error)); }
  finally { busy.value = false; }
}
</script>
<style scoped>
.rate-limit-resume { display: flex; width: 100%; align-items: center; gap: var(--space-4); color: var(--color-text); font-size: var(--font-size-14); line-height: var(--line-height-18); }
.rate-limit-resume__icon { width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto; color: var(--color-text-muted); }
.rate-limit-resume__text { display: flex; flex: 1; min-width: 0; flex-wrap: wrap; column-gap: var(--space-4); }
.rate-limit-resume time { color: var(--color-text-muted); font-size: var(--font-size-12); }
.rate-limit-resume :deep(.el-switch) { flex: 0 0 auto; }
</style>
