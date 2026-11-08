<template>
  <details v-if="annotations.length" class="chat-annotation-review">
    <summary>{{ t('chat.textAnnotations.count', annotations.length) }}</summary>
    <ol>
      <li v-for="(annotation, index) in annotations" :key="annotation.id">
        <button class="chat-annotation-review__edit" type="button" :disabled="disabled" :aria-label="t('chat.textAnnotations.edit', { number: index + 1 })" @click="open(annotation.id)">
          <blockquote>{{ annotation.text }}</blockquote>
          <span>{{ annotation.comment }}</span>
        </button>
        <button class="app-button app-button--tertiary" type="button" :disabled="disabled" :aria-label="t('chat.textAnnotations.remove')" @click="emit('remove', annotation.id)">×</button>
      </li>
    </ol>
  </details>
  <FormDialog :model-value="!!editing" :title="t('chat.textAnnotations.edit', { number: editingIndex + 1 })" teleported compact @update:model-value="!$event && (editingId = null)">
    <div v-if="editing" class="chat-annotation-editor">
      <blockquote>{{ editing.text }}</blockquote>
      <FormField :label="t('chat.textAnnotations.commentLabel')">
        <input v-model="comment" :aria-label="t('chat.textAnnotations.commentLabel')" autofocus :placeholder="t('chat.textAnnotations.commentPlaceholder')" @keydown.enter.prevent="save">
      </FormField>
    </div>
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" @click="editingId = null">{{ t('chat.textAnnotations.cancel') }}</button>
      <button class="app-button app-button--primary chat-annotation-editor__save" type="button" :disabled="disabled || !comment.trim()" @click="save">{{ t('chat.textAnnotations.saveChanges') }}</button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import FormField from '../shared/form/FormField.vue';
import FormDialog from '../shared/dialog/FormDialog.vue';
import type { ChatTextAnnotation } from './use-chat-text-annotations';

const props = defineProps<{ annotations: readonly ChatTextAnnotation[]; disabled?: boolean }>();
const emit = defineEmits<{ edit: [id: string, comment: string]; remove: [id: string] }>();
const { t } = useI18n();
const editingId = ref<string | null>(null);
const comment = ref('');
const editingIndex = computed(() => props.annotations.findIndex(annotation => annotation.id === editingId.value));
const editing = computed(() => props.annotations[editingIndex.value]);
function open(id: string): void {
  const annotation = props.annotations.find(annotation => annotation.id === id);
  if (!annotation || props.disabled) return;
  comment.value = annotation.comment;
  editingId.value = id;
}
function save(): void {
  if (!editing.value || props.disabled || !comment.value.trim()) return;
  emit('edit', editing.value.id, comment.value.trim());
  editingId.value = null;
}
defineExpose({ open });
</script>

<style scoped>
.chat-annotation-review {
  width: 100%;
  color: var(--color-text);
  font-size: var(--font-size-12);
}

.chat-annotation-review summary {
  padding: var(--space-2);
  cursor: pointer;
}

.chat-annotation-review ol {
  max-height: 200px;
  margin: 0;
  padding-inline-start: var(--space-8);
  overflow-y: auto;
}

.chat-annotation-review li {
  position: relative;
  padding-inline-end: var(--space-8);
}

.chat-annotation-review li > .app-button {
  position: absolute;
  top: 0;
  right: 0;
}

.chat-annotation-review__edit {
  width: 100%;
  padding: var(--space-2);
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.chat-annotation-review__edit:hover {
  background: var(--color-surface-low);
}

blockquote {
  max-height: 160px;
  margin: var(--space-2) 0;
  padding-inline-start: var(--space-3);
  overflow: auto;
  border-inline-start: 2px solid var(--color-border);
  color: var(--color-text-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-annotation-review__edit span {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-annotation-editor input {
  box-sizing: border-box;
  width: 100%;
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-lowest);
  color: var(--color-text);
  font: inherit;
}
</style>
