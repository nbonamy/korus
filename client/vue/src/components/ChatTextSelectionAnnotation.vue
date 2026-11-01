<template>
  <button
    v-if="selection && !commentingSelection"
    class="chat-text-selection-annotation__add"
    type="button"
    :style="actionStyle"
    @pointerdown.prevent
    @click="startComment"
  >
    {{ t('chat.textAnnotations.annotate') }}
  </button>
  <AnnotationPopup
    v-if="commentingSelection"
    :anchor="commentingSelection.anchor"
    :description="commentingSelection.text"
    :label="t('chat.textAnnotations.commentLabel')"
    :placeholder="t('chat.textAnnotations.commentPlaceholder')"
    :submit-label="t('chat.textAnnotations.save')"
    strategy="fixed"
    @cancel="cancelComment"
    @submit="saveComment"
  />
</template>

<script setup lang="ts">
import type { CodexMessageTextSelection } from '@codex-app-sdk/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AnnotationPopup from './AnnotationPopup.vue';

const props = defineProps<{
  conversationKey: string;
  selection: CodexMessageTextSelection | null;
}>();

const emit = defineEmits<{
  dismiss: [];
  save: [payload: { selection: CodexMessageTextSelection; comment: string }];
}>();

const { t } = useI18n();
const commentingSelection = ref<CodexMessageTextSelection | null>(null);
const actionStyle = computed(() => {
  const anchor = props.selection?.anchor;
  if (!anchor) return {};
  const width = 96;
  return {
    left: `${Math.max(12, Math.min(anchor.x + anchor.width - width, window.innerWidth - width - 12))}px`,
    top: `${Math.max(12, Math.min(anchor.y + anchor.height + 8, window.innerHeight - 44))}px`,
  };
});

watch(() => props.conversationKey, () => {
  commentingSelection.value = null;
  emit('dismiss');
});

function startComment(): void {
  if (props.selection) commentingSelection.value = props.selection;
}

function cancelComment(): void {
  commentingSelection.value = null;
  emit('dismiss');
}

function saveComment(comment: string): void {
  const selection = commentingSelection.value;
  if (!selection) return;
  emit('save', { selection, comment });
  commentingSelection.value = null;
  window.getSelection?.()?.removeAllRanges();
  emit('dismiss');
}
</script>

<style scoped>
.chat-text-selection-annotation__add {
  position: fixed;
  z-index: 2999;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-md);
  color: var(--color-text);
  font: 500 var(--font-size-13) / 1.2 var(--font-family-ui);
  cursor: pointer;
}

.chat-text-selection-annotation__add:hover {
  background: var(--color-surface-low);
}

.chat-text-selection-annotation__add:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
