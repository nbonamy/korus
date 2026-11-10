<template><SourcePreviewPanel v-bind="props" :translate="translate" @annotate="emit('annotate', $event)" /></template>
<script setup lang="ts">
import { SourcePreviewPanel, type CodeAnnotationInput } from '@korus-dev/agent-ui-sdk';
import { translate } from '../i18n';
const props = withDefaults(defineProps<{
  content: string;
  error?: string | null;
  language?: string | null;
  /** The file shown; annotating needs it to say where a comment belongs. */
  path?: string;
  /** Annotate from a line's plus button, or select code text. */
  annotatable?: boolean;
  showLineNumbers?: boolean;
  state?: 'idle' | 'loading' | 'error';
  wordWrap?: boolean;
}>(), {
  error: null,
  language: null,
  path: undefined,
  annotatable: false,
  showLineNumbers: true,
  state: 'idle',
  wordWrap: false,
});
const emit = defineEmits<{ annotate: [annotation: CodeAnnotationInput] }>();
</script>
