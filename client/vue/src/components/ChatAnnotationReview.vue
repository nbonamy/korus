<template>
  <ComposerContextCards
    v-if="annotations.length"
    class="chat-annotation-review"
    :context-label="t('chat.textAnnotations.contextLabel')"
    :items="cards"
    :disabled="disabled"
    @activate="emit('reveal', $event)"
    @edit="open"
    @remove="emit('remove', $event)"
  />
  <FormDialog :model-value="!!editing" :title="t('chat.textAnnotations.edit', { number: editingIndex + 1 })" teleported compact @update:model-value="!$event && (editingId = null)">
    <div v-if="editing" class="chat-annotation-editor">
      <blockquote>{{ editing.text }}</blockquote>
      <input v-model="comment" :aria-label="t('chat.textAnnotations.commentLabel')" autofocus :placeholder="t('chat.textAnnotations.commentPlaceholder')" @keydown.enter.prevent="save">
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
import { Message2Icon } from '../shared/icons/app-icons';
import ComposerContextCards from './ComposerContextCards.vue';
import FormDialog from '../shared/dialog/FormDialog.vue';
import type { ChatTextAnnotation } from './use-chat-text-annotations';

const props = defineProps<{ annotations: readonly ChatTextAnnotation[]; disabled?: boolean }>();
const emit = defineEmits<{ edit: [id: string, comment: string]; remove: [id: string]; reveal: [id: string] }>();
const { t } = useI18n();
const cards = computed(() => props.annotations.map((annotation, index) => ({
  id: annotation.id,
  label: String(index + 1),
  detail: annotation.comment,
  icon: Message2Icon,
  title: `${annotation.text}\n${annotation.comment}`,
  activateLabel: t('chat.textAnnotations.show', { number: index + 1 }),
  editLabel: t('chat.textAnnotations.edit', { number: index + 1 }),
  removeLabel: t('chat.textAnnotations.remove'),
})));
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
