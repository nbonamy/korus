<template>
  <el-dialog
    class="app-dialog app-form-dialog-shell"
    :class="{ 'app-dialog--compact app-form-dialog-shell--compact': compact }"
    :model-value="modelValue"
    :width="width"
    :title="title"
    :append-to-body="teleported"
    :show-close="false"
    :destroy-on-close="destroyOnClose"
    @opened="focusInput"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <header ref="header" class="app-form-dialog__header">
        <h2 class="app-dialog__title">{{ title }}</h2>
        <p v-if="subtitle" class="app-dialog__subtitle">{{ subtitle }}</p>
      </header>
    </template>

    <slot />

    <template v-if="hasFooter" #footer>
      <footer class="app-dialog__footer app-form-dialog__footer">
        <div v-if="$slots['footer-left']" class="app-form-dialog__footer-left">
          <slot name="footer-left" />
        </div>
        <div class="app-form-dialog__footer-actions">
          <slot name="footer" />
        </div>
      </footer>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, useSlots } from 'vue';

withDefaults(defineProps<{
  compact?: boolean;
  destroyOnClose?: boolean;
  modelValue: boolean;
  subtitle?: string;
  teleported?: boolean;
  title: string;
  width?: string | number;
}>(), {
  compact: false,
  destroyOnClose: true,
  subtitle: '',
  teleported: false,
  width: '520px',
});

const emit = defineEmits<{
  'update:modelValue': [visible: boolean];
}>();

const header = ref<HTMLElement | null>(null);
function focusInput(): void {
  header.value?.closest('.el-dialog')?.querySelector<HTMLInputElement>('input[autofocus]:not(:disabled)')?.focus();
}

const slots = useSlots();
const hasFooter = computed(() => Boolean(slots.footer || slots['footer-left']));
</script>

<style scoped>
:global(.app-dialog.app-form-dialog-shell--compact .el-dialog__header) {
  padding: var(--space-8) var(--space-8) var(--space-4);
}

:global(.app-dialog.app-form-dialog-shell--compact .app-dialog__title) {
  font-size: var(--font-size-18);
  line-height: var(--line-height-22);
}

:global(.app-dialog.app-form-dialog-shell--compact .el-dialog__body) {
  padding: 0 var(--space-8);
}

:global(.app-dialog.app-form-dialog-shell--compact .el-dialog__footer) {
  border-top: 0;
}
</style>
