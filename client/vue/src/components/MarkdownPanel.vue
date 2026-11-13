<template>
  <MarkdownPanel v-bind="props" :translate="translate" @open-file="emit('openFile', $event)" />
</template>
<script setup lang="ts">
import { MarkdownPanel } from '@korus-dev/agent-ui-sdk';
import { translate } from '../i18n';
const props = withDefaults(defineProps<{
  content: string; error?: string | null; outlineEnabled?: boolean; state?: 'idle' | 'loading' | 'error';
}>(), { error: null, outlineEnabled: false, state: 'idle' });
const emit = defineEmits<{ openFile: [href: string] }>();
</script>
