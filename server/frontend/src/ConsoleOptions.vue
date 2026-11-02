<template>
  <ElPopover
    v-model:visible="open"
    trigger="click"
    placement="bottom-end"
    :width="220"
    :show-arrow="false"
    :offset="6"
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
        Group service tiers
        <span aria-hidden="true">{{ modelValue ? "✓" : "" }}</span>
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
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.console-menu-item:hover,
.console-menu-item:focus-visible {
  background: var(--color-surface-low);
}
</style>
