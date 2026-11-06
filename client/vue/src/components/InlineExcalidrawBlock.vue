<template>
  <div ref="root" class="inline-diagram" :aria-busy="!preview && !failed">
    <img v-if="preview" :src="preview" :alt="t('visualize.inlineDiagram')" />
    <span v-else-if="!failed" class="inline-diagram__status" role="status">
      <LoaderIcon class="inline-diagram__spinner" aria-hidden="true" />
      {{ t('visualize.diagramRendering') }}
    </span>
    <span v-else class="inline-diagram__status" role="status">{{ t('visualize.diagramUnavailable') }}</span>
    <details v-if="complete" :open="failed">
      <summary>{{ t('visualize.showSource') }}</summary>
      <pre><code>{{ source }}</code></pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { LoaderIcon } from '../shared/icons/app-icons';
import { translate as t } from '../i18n';
import { parseInlineExcalidraw } from './inline-excalidraw';

const props = withDefaults(defineProps<{ source: string; complete?: boolean }>(), { complete: true });
const root = ref<HTMLElement | null>(null);
const preview = ref('');
const failed = ref(false);
const near = ref(false);
let revision = 0;
let observer: IntersectionObserver | undefined;
watch([() => props.source, () => props.complete, near], async ([source, complete, visible]) => {
  const expected = ++revision;
  preview.value = '';
  failed.value = false;
  if (!visible || !complete) return;
  try {
    parseInlineExcalidraw(source);
    const { renderInlineExcalidraw } = await import('./excalidraw-editor');
    const image = await renderInlineExcalidraw(source);
    if (expected === revision) preview.value = image;
  } catch {
    if (expected === revision) failed.value = true;
  }
});
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    near.value = entries.some(entry => entry.isIntersecting);
  }, { rootMargin: '200px' });
  observer.observe(root.value!);
});
onBeforeUnmount(() => { ++revision; observer?.disconnect(); });
</script>

<style scoped>
.inline-diagram {
  min-width: 0;
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.inline-diagram img {
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
}
.inline-diagram__status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.inline-diagram__spinner {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: none;
  animation: app-spin 1.2s linear infinite;
}
@media (prefers-reduced-motion: reduce) { .inline-diagram__spinner { animation: none; } }
.inline-diagram summary {
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
}
.inline-diagram details { margin-top: var(--space-4); }
.inline-diagram pre {
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-11);
}
</style>
