<template>
  <section class="design-code" :aria-label="t('design.codeRegion')">
    <section v-for="part in parts" :key="part.language" class="design-code__section">
      <header>
        <span class="design-code__title">{{ part.label }}<code v-if="part.selector" :title="part.selector">{{ part.selector }}</code></span>
        <CopyButton :label="t('design.copyCode', { format: part.label })" :copied-label="t('design.copiedCode', { format: part.label })" :action="() => copy(part.content)" />
      </header>
      <SourcePreviewPanel :content="part.content" language="text" :show-line-numbers="false" word-wrap />
    </section>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { designNodeHtml, type DesignNode } from '@workspace/core/design';
import { translate as t } from '../i18n';
import { CopyButton } from '@korus-dev/agent-ui-sdk';
import SourcePreviewPanel from './SourcePreviewPanel.vue';

const props = defineProps<{ node: DesignNode; styles?: Record<string, string> }>();
const parts = computed(() => [
  { label: 'HTML', language: 'html', selector: '', content: designNodeHtml(props.node).replaceAll('><', '>\n<') },
  { label: 'CSS', language: 'css', selector: `#${props.node.id}`, content: Object.entries(props.styles ?? props.node.styles ?? {}).map(([property, value]) => `${property}: ${value};`).join('\n') },
]);
const error = ref('');
watch(parts, () => { error.value = ''; });
// The button shows its own tick; a failure is reported here and leaves no tick.
async function copy(content: string) {
  error.value = '';
  try { await navigator.clipboard.writeText(content); }
  catch (cause) { error.value = t('design.copyFailed'); throw cause; }
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
.design-code__title { display: flex; align-items: center; gap: var(--space-4); min-width: 0; }
.design-code__title code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-size-12); }
.design-code .source-preview-panel {
  --code-font-size: var(--font-size-12);

  flex: none;
  max-height: 420px;
  border-radius: var(--radius-lg);
  background: var(--color-surface-low);
}
.design-code .source-preview-panel :deep(code),
.design-code .source-preview-panel :deep(.line),
.design-code .source-preview-panel :deep(.line span) { color: var(--color-text-muted) !important; }
.design-code p[role="alert"] {
  color: var(--color-error);
  margin: 0;
}
</style>
