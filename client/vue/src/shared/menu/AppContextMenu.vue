<template>
  <Teleport to="body">
    <div ref="menuRoot" class="app-context-menu" :style="menuStyle">
      <AppMenu :ariaLabel="ariaLabel" :items="items" @select="emit('select', $event)" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppMenu from './AppMenu.vue';
import type { AppMenuItem } from './app-menu';

const props = defineProps<{
  ariaLabel: string;
  items: AppMenuItem[];
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  close: [];
  select: [itemId: string];
}>();

const viewportMargin = 8;
const menuRoot = ref<HTMLElement | null>(null);
const position = ref({ x: props.x, y: props.y });
const menuStyle = computed(() => ({ left: `${position.value.x}px`, top: `${position.value.y}px` }));

onMounted(() => {
  document.addEventListener('click', closeOnOutsideClick);
  document.addEventListener('keydown', closeOnEscape);
  window.addEventListener('resize', fitInViewport);
  void nextTick(fitInViewport);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeOnOutsideClick);
  document.removeEventListener('keydown', closeOnEscape);
  window.removeEventListener('resize', fitInViewport);
});

watch(() => [props.x, props.y], () => {
  void nextTick(fitInViewport);
});

function closeOnOutsideClick(event: MouseEvent): void {
  if (event.target instanceof Node && menuRoot.value?.contains(event.target)) return;
  emit('close');
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

function fitInViewport(): void {
  const menu = menuRoot.value;
  if (!menu) return;
  const { width, height } = menu.getBoundingClientRect();
  position.value = {
    x: Math.max(viewportMargin, Math.min(props.x, window.innerWidth - width - viewportMargin)),
    y: Math.max(viewportMargin, Math.min(props.y, window.innerHeight - height - viewportMargin)),
  };
}
</script>

<style scoped>
.app-context-menu {
  position: fixed;
  z-index: 2000;
}
</style>
