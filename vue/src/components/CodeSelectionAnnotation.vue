<template>
  <button
    v-if="selection && !commenting"
    class="code-selection-annotation__add"
    type="button"
    :style="actionStyle"
    @pointerdown.prevent
    @click="startComment"
  >
    {{ t('chat.codeAnnotations.annotate') }}
  </button>
  <AnnotationPopup
    v-if="commenting"
    :anchor="commenting.anchor"
    :description="description(commenting)"
    :label="t('chat.codeAnnotations.commentLabel')"
    :placeholder="t('chat.codeAnnotations.commentPlaceholder')"
    :submit-label="t('chat.codeAnnotations.save')"
    strategy="fixed"
    @cancel="cancelComment"
    @submit="saveComment"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AnnotationPopup from './AnnotationPopup.vue';
import { describeCodeRange } from './use-code-annotations';
import type { CodeSelection } from './use-code-selection';

const props = defineProps<{ selection: CodeSelection | null; commenting?: CodeSelection | null }>();
const emit = defineEmits<{
  dismiss: [];
  save: [payload: { selection: CodeSelection; comment: string }];
}>();

const { t } = useI18n();
const commenting = ref<CodeSelection | null>(null);
const actionStyle = computed(() => {
  const anchor = props.selection?.anchor;
  if (!anchor) return {};
  const width = 96;
  return {
    left: `${Math.max(12, Math.min(anchor.x + anchor.width - width, window.innerWidth - width - 12))}px`,
    top: `${Math.max(12, Math.min(anchor.y + anchor.height + 8, window.innerHeight - 44))}px`,
  };
});

// A different file or range replaces the one being commented on.
watch(() => props.selection, (next) => {
  if (commenting.value && next !== commenting.value) commenting.value = null;
});
watch(() => props.commenting, next => { commenting.value = next ?? null; }, { immediate: true });

const description = (selection: CodeSelection) => describeCodeRange(selection);

function startComment(): void {
  if (props.selection) commenting.value = props.selection;
}

function cancelComment(): void {
  commenting.value = null;
  emit('dismiss');
}

function saveComment(comment: string): void {
  const selection = commenting.value;
  if (!selection) return;
  emit('save', { selection, comment });
  commenting.value = null;
  window.getSelection?.()?.removeAllRanges();
  emit('dismiss');
}
</script>

<style scoped>
.code-selection-annotation__add {
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

.code-selection-annotation__add:hover {
  background: var(--color-surface-low);
}

.code-selection-annotation__add:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
