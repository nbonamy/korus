<template>
  <el-dialog
    class="app-dialog pull-request-cleanup-dialog"
    :model-value="visible"
    :teleported="false"
    width="520px"
    :show-close="false"
    destroy-on-close
    @update:model-value="onVisibilityChanged"
  >
    <template #header>
      <div class="app-form-dialog__header">
        <h2 class="app-dialog__title">
          {{ cleanupTitle }}
        </h2>
      </div>
    </template>

    <div class="pull-request-cleanup-dialog__body">
      <p>{{ cleanupDetail }}</p>
      <p v-if="error" class="pull-request-cleanup-dialog__error" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <div class="app-dialog__footer">
        <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="emit('close')">
          {{ t('pullRequestCleanup.later') }}
        </button>
        <button class="app-button app-button--primary" type="button" :aria-busy="busy" :disabled="busy" @click="emit('confirm')">
          {{ t('pullRequestCleanup.action') }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { Agent } from '@workspace/core/contracts';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(defineProps<{
  agent?: Agent | null;
  busy?: boolean;
  error?: string | null;
  visible: boolean;
}>(), {
  agent: null,
  busy: false,
  error: null,
});

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const { t } = useI18n();
const cleanupTitle = computed(() => t(
  props.agent?.pullRequest?.state === 'closed'
    ? (props.agent?.pullRequest?.provider === 'gitlab' ? 'pullRequestCleanup.mrClosedTitle' : 'pullRequestCleanup.closedTitle')
    : (props.agent?.pullRequest?.provider === 'gitlab' ? 'pullRequestCleanup.mrMergedTitle' : 'pullRequestCleanup.mergedTitle'),
  { number: props.agent?.pullRequest?.number },
));
const cleanupDetail = computed(() => t(
  props.agent?.pullRequest?.state === 'closed'
    ? (props.agent?.pullRequest?.provider === 'gitlab' ? 'pullRequestCleanup.mrClosedDetail' : 'pullRequestCleanup.closedDetail')
    : 'pullRequestCleanup.mergedDetail',
));

function onVisibilityChanged(visible: boolean): void {
  if (!visible && !props.busy) emit('close');
}
</script>

<style scoped>
.pull-request-cleanup-dialog__body {
  padding-bottom: var(--space-4);
}

.pull-request-cleanup-dialog__body p {
  margin: 0;
  color: var(--color-text-muted);
}

.pull-request-cleanup-dialog__error {
  margin-top: var(--space-6) !important;
  color: var(--color-error) !important;
}
</style>
