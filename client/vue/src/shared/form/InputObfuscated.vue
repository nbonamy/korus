<template>
  <div class="obfuscated-input" :class="$attrs.class" :style="$attrs.style">
    <input v-bind="{ ...$attrs, class: undefined, style: undefined }" :type="visible ? 'text' : 'password'" :value="modelValue" :disabled="disabled" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" @blur="emit('blur')" @keydown.enter="emit('commit')" />
    <button class="app-icon-button" type="button" :disabled="disabled" :aria-label="visible ? hideLabel : showLabel" :title="visible ? hideLabel : showLabel" :aria-pressed="visible" @mousedown.prevent @click="visible = !visible">
      <component :is="visible ? IconEyeOff : IconEye" :size="16" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { IconEye, IconEyeOff } from '@tabler/icons-vue';
defineOptions({ inheritAttrs: false });
defineProps<{ modelValue: string; disabled?: boolean; showLabel: string; hideLabel: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; blur: []; commit: [] }>();
const visible = ref(false);
</script>

<style scoped>
.obfuscated-input { position: relative; }
.obfuscated-input input { width: 100%; box-sizing: border-box; padding: 6px 32px 6px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-lowest); color: var(--color-text); font-family: var(--font-family-mono); font-size: var(--font-size-13); }
.obfuscated-input input:focus { outline: 1px solid var(--color-primary); border-color: var(--color-primary); }
.obfuscated-input button { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); }
</style>
