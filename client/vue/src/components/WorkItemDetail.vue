<template>
  <section class="work-item-detail">
    <header class="work-item-detail__header">
      <div class="work-item-detail__title">
        <a :href="item.url" target="_blank" rel="noopener noreferrer">{{ workItemDisplayIdentifier(item) }} · {{ item.title }}</a>
        <span class="work-item-detail__state">{{ item.nativeState ?? item.state }}</span>
      </div>
      <div v-if="item.assignees?.length || item.labels.length" class="work-item-detail__meta">
        <span v-if="item.assignees?.length">{{ item.assignees.join(', ') }}</span>
        <span v-for="label in item.labels" :key="label.name" class="work-item-detail__label">{{ label.name }}</span>
      </div>
    </header>
    <MarkdownPanel v-if="item.body?.trim()" class="work-item-detail__body" :content="item.body" />
  </section>
</template>
<script setup lang="ts">
import { workItemDisplayIdentifier } from '@workspace/core/work-item-prompts';
import type { WorkItem } from '@workspace/core/contracts';
import MarkdownPanel from './MarkdownPanel.vue';
defineProps<{ item: WorkItem }>();
</script>
<style scoped>
.work-item-detail {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-8);
  color: var(--color-text);
}

.work-item-detail__header {
  display: grid;
  gap: var(--space-2);
}

.work-item-detail__header a {
  color: var(--color-primary);
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-22);
  text-decoration: none;
}

.work-item-detail__header a:hover {
  text-decoration: underline;
}

.work-item-detail__title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.work-item-detail__title .work-item-detail__state {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.work-item-detail__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.work-item-detail__state,
.work-item-detail__label {
  padding: 1px var(--space-3);
  border-radius: var(--radius-full);
  background: var(--color-surface-base);
}

.work-item-detail .work-item-detail__body {
  flex: none;
  padding: 0;
  font-size: var(--font-size-13);
}

/* The ticket title outranks any heading written inside the issue body. */
.work-item-detail__body :deep(h1),
.work-item-detail__body :deep(h2) {
  font-size: var(--font-size-15);
  line-height: var(--line-height-22);
}

.work-item-detail__body :deep(h3),
.work-item-detail__body :deep(h4) {
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
}
</style>
