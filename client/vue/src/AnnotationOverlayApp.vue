<template>
  <main class="annotation-overlay">
    <AnnotationPopup
      :anchor="anchor"
      :description="description"
      @cancel="resolve(null)"
      @submit="resolve"
    />
  </main>
</template>

<script setup lang="ts">
import AnnotationPopup, { type AnnotationPopupAnchor } from './components/AnnotationPopup.vue';
import { appApi } from './platform-api';

const params = new URLSearchParams(window.location.search);
const token = params.get('token') ?? '';
const description = params.get('description') ?? '';
const anchor = parseAnchor(params.get('anchor'));

async function resolve(comment: string | null): Promise<void> {
  if (!token) return;
  await appApi?.browserResolveAnnotation(token, comment);
}

function parseAnchor(value: string | null): AnnotationPopupAnchor {
  try {
    const parsed = JSON.parse(value ?? '') as Partial<AnnotationPopupAnchor>;
    if ([parsed.x, parsed.y, parsed.width, parsed.height].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
      return parsed as AnnotationPopupAnchor;
    }
  } catch {
    // The main process always supplies a validated anchor. Keep the overlay usable if it is absent.
  }
  return { x: 12, y: 12, width: 0, height: 0 };
}
</script>

<style scoped>
:global(html[data-surface='annotation-overlay']),
:global(html[data-surface='annotation-overlay'] body),
:global(html[data-surface='annotation-overlay'] #app) {
  overflow: hidden !important;
  background: transparent !important;
}

.annotation-overlay {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
