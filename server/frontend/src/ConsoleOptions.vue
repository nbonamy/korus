<template>
  <ElPopover
    v-model:visible="open"
    trigger="click"
    placement="bottom-end"
    :width="220"
    :show-arrow="false"
    :offset="6"
    popper-class="console-options-menu"
    @after-leave="trigger?.focus()"
  >
    <template #reference>
      <span
        ><button
          ref="trigger"
          type="button"
          class="app-icon-button console-options-trigger"
          aria-label="Analytics options"
          aria-haspopup="menu"
          :aria-expanded="open"
          @keydown.esc.stop.prevent="open = false"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="currentColor"
          >
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg></button
      ></span>
    </template>
    <div
      role="menu"
      aria-label="Analytics options"
      @keydown.esc.stop.prevent="close"
    >
      <button
        type="button"
        class="console-menu-item"
        role="menuitemcheckbox"
        :aria-checked="modelValue"
        @click="toggle"
      >
        <svg
          class="console-menu-icon"
          :class="{ 'is-checked': modelValue }"
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="modelValue ? 'M5 12l4 4L19 6' : 'M13 3 4 14h7l-1 7 10-13h-7z'" />
        </svg>
        <span>Group service tiers</span>
      </button>
    </div>
  </ElPopover>
</template>
<script setup lang="ts">
import { nextTick, ref } from "vue";
import { ElPopover } from "element-plus";
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  change: [];
}>();
const open = ref(false),
  trigger = ref<HTMLButtonElement>();
async function close() {
  open.value = false;
  await nextTick();
  trigger.value?.focus();
}
async function toggle() {
  emit("update:modelValue", !props.modelValue);
  emit("change");
  await close();
}
</script>
<style scoped>
.console-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 28px;
  margin-block: 0.125px;
  padding: var(--space-2) var(--space-4);
  border: 0;
  border-radius: var(--radius-xl);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-13-5);
  text-align: left;
  cursor: pointer;
}
.console-menu-icon {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
  opacity: 0.5;
  stroke-width: 2px;
}
.console-menu-icon.is-checked {
  opacity: 1;
  stroke-width: 2.5px;
}
.console-menu-item:hover,
.console-menu-item:focus-visible {
  background: var(--color-surface-low);
}
</style>
