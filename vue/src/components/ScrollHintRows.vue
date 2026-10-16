<template>
  <div ref="root" class="scroll-hint-rows">
    <div ref="scroller" class="scroll-hint-rows__scroller" data-scroll-hint-rows @scroll.passive="measure">
      <div ref="content">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const emit = defineEmits<{ overflow: [state: { up: boolean; down: boolean }] }>();
const root = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
let observer: ResizeObserver | undefined;
let last = '';
let lastFloor = '';

const floorRows = 2;
const minOverflow = 8;

/** Height the enclosing section needs to show its header and the first rows, from their real sizes. */
function publishSectionFloor(): void {
  const rows = content.value?.children;
  const section = root.value?.parentElement;
  if (!rows || !section || !root.value) return;
  const first = rows[0] as HTMLElement | undefined;
  const after = rows[floorRows] as HTMLElement | undefined;
  const rowsHeight = first && after ? after.offsetTop - first.offsetTop : content.value?.offsetHeight ?? 0;
  const floor = `${root.value.offsetTop + rowsHeight}px`;
  if (floor === lastFloor) return;
  lastFloor = floor;
  section.style.setProperty('--section-floor', floor);
}

function measure(): void {
  const element = scroller.value;
  if (!element) return;
  const overflow = element.scrollHeight - element.clientHeight;
  // A few pixels of spill is layout noise, not rows worth a hint.
  const state = overflow < minOverflow ? { up: false, down: false }
    : { up: element.scrollTop > 1, down: element.scrollTop < overflow - 1 };
  const key = `${state.up}:${state.down}`;
  if (key === last) return;
  last = key;
  emit('overflow', state);
}

/** One page further down, or back to the top once the end is reached. */
function scrollMore(): void {
  const element = scroller.value;
  if (!element) return;
  if (element.scrollTop + element.clientHeight < element.scrollHeight - 1) element.scrollBy({ top: element.clientHeight, behavior: 'smooth' });
  else element.scrollTo({ top: 0, behavior: 'smooth' });
}

defineExpose({ scrollMore });

function measureAll(): void {
  publishSectionFloor();
  measure();
}

onMounted(() => {
  measureAll();
  if (typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(measureAll);
  if (scroller.value) observer.observe(scroller.value);
  if (content.value) observer.observe(content.value);
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<style scoped>
.scroll-hint-rows {
  position: relative;
  display: flex;
  flex-direction: column;
}

.scroll-hint-rows__scroller {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* Same hairline as the sidebar list: the thumb only shows while hovering. */
.scroll-hint-rows__scroller::-webkit-scrollbar {
  width: 3px;
}

.scroll-hint-rows__scroller::-webkit-scrollbar-thumb {
  border-radius: var(--radius-full);
  background: transparent;
}

.scroll-hint-rows__scroller:hover::-webkit-scrollbar-thumb {
  background: var(--color-outline);
}
</style>
