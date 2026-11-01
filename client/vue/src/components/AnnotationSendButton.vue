<template>
  <button
    class="annotation-send-button"
    type="button"
    :aria-label="label"
    :disabled="disabled"
    @click="emit('click')"
  > {{ $t('surface.annotationSendButton.send') }} <span>{{ count }}</span>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  count: number;
  disabled?: boolean;
  label: string;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  click: [];
}>();
</script>

<style scoped>
.annotation-send-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 70px;
  height: var(--annotation-send-button-height, 22px);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font: inherit;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.annotation-send-button:hover:not(:disabled) {
  background: var(--color-on-primary-container);
}

.annotation-send-button:disabled {
  opacity: 0.38;
  cursor: default;
}

.annotation-send-button span {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-left: var(--space-2);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-on-primary) 18%, transparent);
  font-size: var(--font-size-11);
}
</style>
