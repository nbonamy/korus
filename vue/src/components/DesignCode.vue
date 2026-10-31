<template>
  <section class="design-code" :aria-label="t('design.codeRegion')">
    <section v-for="part in parts" :key="part.language" class="design-code__section">
      <header>
        <span>{{ part.label }}</span>
        <span v-if="copied === part.language" role="status">{{ t('design.copiedCode', { format: part.label }) }}</span>
        <button type="button" class="app-icon-button" :aria-label="t('design.copyCode', { format: part.label })" :title="t('design.copyCode', { format: part.label })" @click="copy(part.language, part.content)"><CopyIcon /></button>
      </header>
      <SourcePreviewPanel :content="part.content" :language="part.language" :show-line-numbers="false" word-wrap />
    </section>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { designNodeHtml, type DesignNode } from '@workspace/core/design';
import { translate as t } from '../i18n';
import { CopyIcon } from '../shared/icons/app-icons';
import SourcePreviewPanel from './SourcePreviewPanel.vue';

const props = defineProps<{ node: DesignNode; css: string }>();
const parts = computed(() => [
  { label: 'HTML', language: 'html', content: designNodeHtml(props.node).replaceAll('><', '>\n<') },
  { label: 'CSS', language: 'css', content: props.css },
]);
const copied = ref('');
const error = ref('');
watch(parts, () => { copied.value = ''; error.value = ''; });
async function copy(language: string, content: string) {
  error.value = '';
  try { await navigator.clipboard.writeText(content); copied.value = language; }
  catch { copied.value = ''; error.value = t('design.copyFailed'); }
}
</script>

<style scoped>
.design-code,
.design-code__section {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.design-code {
  gap: var(--space-4);
}
.design-code header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.design-code header > :first-child {
  flex: 1;
}
.design-code .source-preview-panel {
  flex: none;
  max-height: 420px;
}
.design-code p[role="alert"] {
  color: var(--color-error);
  margin: 0;
}
</style>
