<template>
  <div v-if="open || comment.body" class="annotation-comment" :class="{ 'annotation-comment--open': open }" :data-annotation-comment="comment.id">
    <div class="annotation-comment__frame">
      <div class="annotation-comment__line">
        <button
          v-if="number"
          class="annotation-comment__locate"
          type="button"
          :aria-label="t('chat.textAnnotations.show', { number })"
          @click="emit('reveal')"
        >{{ number }}</button>
        <MessageIcon v-else class="annotation-comment__icon" aria-hidden="true" />
        <button
          v-if="!open"
          class="annotation-comment__text"
          type="button"
          :aria-label="t('planFeedback.edit')"
          :title="quoted ? `${quote}\n${comment.body}` : comment.body"
          :disabled="disabled"
          @click="emit('edit')"
        >
          <span v-if="quoted" class="annotation-comment__quote">{{ quote }}</span>
          <span class="annotation-comment__body">{{ comment.body }}</span>
          <PencilIcon aria-hidden="true" />
        </button>
        <label :for="editorId" class="sr-only">{{ t('planFeedback.comment') }}</label>
        <textarea
          v-show="open"
          :id="editorId"
          ref="editor"
          :value="comment.body"
          :disabled="disabled"
          :placeholder="placeholder ?? t('planFeedback.comment')"
          maxlength="4000"
          @input="emit('update', ($event.target as HTMLTextAreaElement).value)"
          @keydown.enter.exact="saveOnEnter"
          @keydown.esc.prevent.stop="emit('close')"
        />
        <button
          v-if="!open"
          class="annotation-comment__remove"
          type="button"
          :aria-label="t('planFeedback.remove')"
          :disabled="disabled"
          @click="emit('remove')"
        >
          <Trash2Icon aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { MessageIcon, PencilIcon, Trash2Icon } from '../shared/icons/app-icons';

/**
 * One comment on a passage, in one line: its number, quote and text, then edit and delete.
 * Editing opens a text area in the same frame. Every review surface renders comments through this.
 */
const props = defineProps<{
  comment: { id: string; body: string };
  quote: string;
  editorId: string;
  open: boolean;
  number?: number;
  showQuote?: boolean;
  disabled?: boolean;
  placeholder?: string;
}>();
const emit = defineEmits<{ reveal: []; edit: []; close: []; remove: []; update: [body: string] }>();
const { t } = useI18n();
// A numbered comment is found by its number and highlight; the quote is for passages without either.
const quoted = computed(() => props.showQuote && !props.number);
const editor = ref<HTMLTextAreaElement>();
// The text is saved as it is typed, so Enter just closes the editor; Shift+Enter keeps writing.
// Enter that confirms an input-method composition is left alone.
function saveOnEnter(event: KeyboardEvent): void {
  if (event.isComposing) return;
  event.preventDefault();
  emit('close');
}
watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    editor.value?.focus();
  },
  { immediate: true },
);
</script>

<style scoped>
.annotation-comment {
  margin: 6px 0;
}
.annotation-comment__frame {
  border: 1px solid color-mix(in srgb, var(--color-border) 65%, var(--color-surface-lowest));
  border-radius: 7px;
  background: color-mix(in srgb, var(--color-text) 3%, var(--color-surface-lowest));
}
.annotation-comment__line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 0 4px 0 10px;
}
.annotation-comment__line button {
  border: 0;
  font: inherit;
  cursor: pointer;
}
.annotation-comment__line button:focus-visible {
  outline: none;
}
.annotation-comment__line .annotation-comment__text,
.annotation-comment__line .annotation-comment__remove {
  background: transparent;
}
.annotation-comment__line .annotation-comment__text:focus-visible,
.annotation-comment__line .annotation-comment__remove:focus-visible {
  background: var(--color-surface);
}
.annotation-comment__line .annotation-comment__locate {
  display: inline-grid;
  align-self: center;
  min-width: 16px;
  height: 16px;
  flex-shrink: 0;
  padding: 0 3px;
  border-radius: var(--radius-full);
  place-items: center;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font: 600 var(--font-size-10) / 1 var(--font-family-ui);
}
.annotation-comment__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  stroke-width: 1.6;
  color: color-mix(in srgb, var(--color-text) 62%, var(--color-surface-lowest));
}
.annotation-comment__text {
  display: flex;
  min-width: 0;
  min-height: 34px;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 0;
  text-align: start;
  color: var(--color-text);
}
.annotation-comment__quote {
  min-width: 0;
  flex: 0 1 38%;
  overflow: hidden;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.annotation-comment__body {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.annotation-comment__line > .annotation-comment__quote {
  min-height: 34px;
  flex: 1;
  line-height: 34px;
}
.annotation-comment__text svg,
.annotation-comment__remove svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  stroke-width: 1.6;
}
.annotation-comment__text svg {
  color: color-mix(in srgb, var(--color-text) 62%, var(--color-surface-lowest));
}
.annotation-comment__remove {
  display: inline-flex;
  height: 34px;
  align-items: center;
  padding: 0 8px;
  color: var(--color-error);
}
.annotation-comment__remove:hover:not(:disabled) {
  opacity: 0.75;
}
/* Editing keeps the number beside the text box, in the same frame. */
.annotation-comment--open .annotation-comment__line {
  align-items: flex-start;
  padding: 8px;
}
.annotation-comment--open .annotation-comment__line .annotation-comment__locate,
.annotation-comment--open .annotation-comment__icon {
  align-self: flex-start;
  /* Centres the 16px marker on the first line of the text box. */
  margin-top: 10px;
}
textarea {
  display: block;
  box-sizing: border-box;
  min-width: 0;
  flex: 1;
  min-height: 56px;
  max-height: 240px;
  margin: 0;
  padding: 8px 10px;
  resize: vertical;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface-lowest);
  color: var(--color-text);
  font: inherit;
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
</style>
