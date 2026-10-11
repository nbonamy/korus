<template>
  <article
    class="markdown-panel"
    :class="{ 'markdown-panel--outline-enabled': outlineEnabled }"
    :aria-busy="state === 'loading'"
  >
    <div v-if="headings.length" class="markdown-panel__controls">
      <button
        type="button"
        :aria-expanded="outlineOpen"
        :aria-controls="outlineId"
        @click="outlineOpen = !outlineOpen"
      >
        <ListIcon aria-hidden="true" />
        {{ $t('surface.markdownPanel.outline') }}
      </button>
    </div>
    <nav
      v-if="outlineOpen && headings.length"
      :id="outlineId"
      class="markdown-panel__outline"
      :aria-label="$t('surface.markdownPanel.documentOutline')"
    >
      <ol>
        <li v-for="heading in headings" :key="heading.id">
          <button
            type="button"
            :aria-label="$t('surface.markdownPanel.headingLevel', { title: heading.text, level: heading.level })"
            :aria-current="activeHeading === heading.id ? 'location' : undefined"
            :style="{ '--outline-depth': heading.depth }"
            @click="navigateToHeading(heading)"
          >{{ heading.text }}</button>
        </li>
      </ol>
    </nav>
    <div ref="documentRoot" class="markdown-panel__document" @scroll="updateActiveHeading">
      <div
        v-if="state === 'loading'"
        class="markdown-panel__empty codex-text-shimmer"
      > {{ $t('surface.markdownPanel.loadingMarkdown') }} </div>
      <div
        v-else-if="state === 'error'"
        class="markdown-panel__empty markdown-panel__empty--error"
      >
        {{ error ?? $t('surface.markdownPanel.unableToLoadMarkdown') }}
      </div>
      <div
        v-else-if="content.trim()"
        class="markdown-panel__content codex-markdown"
        v-html="renderedMarkdown"
      />
      <div
        v-else
        class="markdown-panel__empty"
      > {{ $t('surface.markdownPanel.noMarkdownContent') }} </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { renderMarkdown } from '@codex-app-sdk/vue';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue';
import { ListIcon } from '../shared/icons/app-icons';
import { collectMarkdownHeadings, type MarkdownHeading } from './markdown-outline';

const props = withDefaults(defineProps<{
  content: string;
  error?: string | null;
  outlineEnabled?: boolean;
  state?: 'idle' | 'loading' | 'error';
}>(), {
  error: null,
  outlineEnabled: false,
  state: 'idle',
});

const documentId = `markdown-${useId()}`;
const outlineId = `${documentId}-outline`;
const documentRoot = ref<HTMLElement | null>(null);
const headings = shallowRef<MarkdownHeading[]>([]);
const activeHeading = ref<string | null>(null);
const outlineOpen = ref(false);
const renderedMarkdown = computed(() => props.state === 'idle' && props.content.trim() ? renderMarkdown(props.content) : '');
let resizeObserver: ResizeObserver | undefined;

function updateActiveHeading(): void {
  const viewport = documentRoot.value;
  if (!viewport || !headings.value.length) return;
  const top = viewport.getBoundingClientRect().top + 16;
  let active = headings.value[0];
  for (const heading of headings.value) {
    if (heading.element.getBoundingClientRect().top > top) break;
    active = heading;
  }
  if (viewport.scrollTop > 0 && viewport.clientHeight > 0 && Math.ceil(viewport.scrollTop + viewport.clientHeight) >= viewport.scrollHeight) {
    active = headings.value[headings.value.length - 1];
  }
  activeHeading.value = active.id;
}

function navigateToHeading(heading: MarkdownHeading): void {
  const viewport = documentRoot.value;
  if (!viewport) return;
  viewport.scrollTo({
    top: viewport.scrollTop + heading.element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 8,
    behavior: 'auto',
  });
  activeHeading.value = heading.id;
}

function refreshOutline(): void {
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  const contentRoot = documentRoot.value?.querySelector<HTMLElement>('.markdown-panel__content');
  headings.value = props.outlineEnabled && contentRoot ? collectMarkdownHeadings(contentRoot, documentId) : [];
  activeHeading.value = null;
  if (!headings.value.length) {
    outlineOpen.value = false;
    return;
  }
  updateActiveHeading();
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(updateActiveHeading);
    resizeObserver.observe(documentRoot.value!);
    resizeObserver.observe(contentRoot!);
  }
}

onMounted(refreshOutline);
watch(() => [props.content, props.state, props.outlineEnabled], refreshOutline, { flush: 'post' });
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  headings.value = [];
});
</script>

<style scoped>
.markdown-panel {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: var(--space-8);
  scrollbar-width: thin;
}

.markdown-panel--outline-enabled {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.markdown-panel--outline-enabled .markdown-panel__document {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: var(--space-8);
  scrollbar-width: thin;
}

.markdown-panel__controls {
  flex: none;
  padding: var(--space-2) var(--space-8);
  border-bottom: 1px solid var(--color-border);
}

.markdown-panel__controls button,
.markdown-panel__outline button {
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-12);
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.markdown-panel__controls button {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
}

.markdown-panel__controls svg {
  width: 14px;
  height: 14px;
}

.markdown-panel__outline {
  flex: 0 0 auto;
  min-height: 0;
  max-height: min(35%, 12rem);
  overflow: auto;
  padding: var(--space-4) var(--space-8);
  border-bottom: 1px solid var(--color-border);
  scrollbar-width: thin;
}

.markdown-panel__outline ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.markdown-panel__outline button {
  --outline-depth: 0;
  display: block;
  width: 100%;
  padding: var(--space-3) var(--space-4);
  padding-left: calc(var(--space-4) + var(--outline-depth) * var(--space-12));
  overflow-wrap: anywhere;
}

.markdown-panel__controls button:hover,
.markdown-panel__outline button:hover {
  background: var(--color-surface-high);
  color: var(--color-text);
}

.markdown-panel__outline button[aria-current] {
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
}

.markdown-panel__controls button:focus-visible,
.markdown-panel__outline button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.markdown-panel__empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.markdown-panel__empty--error {
  color: var(--color-error);
}
</style>
