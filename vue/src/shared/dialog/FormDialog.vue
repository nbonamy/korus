<template>
  <el-dialog
    class="app-dialog app-form-dialog-shell"
    :model-value="modelValue"
    :width="width"
    :title="title"
    :append-to-body="teleported"
    :show-close="false"
    :destroy-on-close="destroyOnClose"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <header class="app-form-dialog__header">
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
import { computed, useSlots } from 'vue';

withDefaults(defineProps<{
  destroyOnClose?: boolean;
  modelValue: boolean;
  subtitle?: string;
  teleported?: boolean;
  title: string;
  width?: string | number;
}>(), {
  destroyOnClose: true,
  subtitle: '',
  teleported: false,
  width: '520px',
});

const emit = defineEmits<{
  'update:modelValue': [visible: boolean];
}>();

const slots = useSlots();
const hasFooter = computed(() => Boolean(slots.footer || slots['footer-left']));
</script>
