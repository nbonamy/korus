<template>
  <el-dialog
    class="app-dialog session-compression-dialog"
    :model-value="visible"
    :teleported="false"
    width="520px"
    :show-close="false"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    destroy-on-close
    @update:model-value="onVisibilityChanged"
  >
    <template #header>
      <div class="app-form-dialog__header">
        <h2 class="app-dialog__title">
          {{ busy ? t('sessionCompression.progressTitle') : t('sessionCompression.title') }}
        </h2>
      </div>
    </template>

    <div class="session-compression-dialog__body" aria-live="polite">
      <div v-if="busy" class="session-compression-dialog__progress" role="status" aria-busy="true">
        <span class="app-spinner app-spinner--lg app-spinner--primary" aria-hidden="true" />
        <p>{{ t('sessionCompression.progressDetail') }}</p>
      </div>
      <template v-else>
        <p>{{ t('sessionCompression.detail') }}</p>
        <el-checkbox v-model="dontShowAgain">
          {{ t('sessionCompression.dontShowAgain') }}
        </el-checkbox>
      </template>
      <p v-if="error" class="session-compression-dialog__error" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <div v-if="!busy" class="app-dialog__footer">
        <button class="app-button app-button--tertiary" type="button" @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
        <button class="app-button app-button--primary" type="button" @click="emit('confirm', dontShowAgain)">
          {{ t('sessionCompression.action') }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(defineProps<{
  busy?: boolean;
  error?: string | null;
  visible: boolean;
}>(), {
  busy: false,
  error: null,
});

const emit = defineEmits<{
  close: [];
  confirm: [dontShowAgain: boolean];
}>();

const { t } = useI18n();
const dontShowAgain = ref(false);

watch(() => props.visible, (visible) => {
  if (visible) dontShowAgain.value = false;
});

function onVisibilityChanged(visible: boolean): void {
  if (!visible && !props.busy) emit('close');
}
</script>

<style scoped>
.session-compression-dialog__body {
  display: grid;
  gap: var(--space-6);
  padding-bottom: var(--space-4);
}

.session-compression-dialog__body p {
  margin: 0;
  color: var(--color-text-muted);
  line-height: var(--line-height-22);
}

.session-compression-dialog__progress {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-height: 44px;
}

.session-compression-dialog__error {
  color: var(--color-error) !important;
}

</style>
