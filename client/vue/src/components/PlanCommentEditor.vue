<template>
  <div v-show="open || modelValue" class="comment">
    <button
      v-if="!open && modelValue"
      class="comment-preview"
      type="button"
      :disabled="disabled"
      @click="emit('edit')"
    >
      <MessageIcon aria-hidden="true" /><span>{{ modelValue }}</span
      ><PencilIcon aria-hidden="true" />
    </button>
    <label :for="id" class="sr-only">{{ t('planFeedback.comment') }}</label>
    <textarea
      v-show="open"
      :id="id"
      ref="editor"
      :value="modelValue"
      :disabled="disabled"
      :placeholder="t('planFeedback.comment')"
      maxlength="4000"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @keydown.esc.prevent.stop="emit('close')"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { MessageIcon, PencilIcon } from '../shared/icons/app-icons';
const props = defineProps<{ id: string; modelValue: string; open: boolean; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; edit: []; close: [] }>();
const { t } = useI18n();
const editor = ref<HTMLTextAreaElement>();
watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick();
      editor.value?.focus();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.comment {
  margin: 12px 0;
}
.comment-preview {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  text-align: left;
  border: 1px solid color-mix(in srgb, var(--color-border) 65%, var(--color-surface-lowest));
  border-radius: 7px;
  background: color-mix(in srgb, var(--color-text) 3%, var(--color-surface-lowest));
}
.comment-preview svg {
  width: 18px;
  height: 18px;
  stroke-width: 1.6;
  flex-shrink: 0;
  color: color-mix(in srgb, var(--color-text) 62%, var(--color-surface-lowest));
}
.comment-preview span {
  flex: 1;
  white-space: pre-wrap;
}
textarea {
  display: block;
  width: 100%;
  min-height: 78px;
  resize: vertical;
  max-height: 240px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-surface-lowest);
  padding: 10px 12px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.comment-preview,
textarea {
  font: inherit;
  color: var(--color-text);
}
</style>
