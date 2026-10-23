<template>
  <!-- Outside the popover so its own trigger handling runs first; row-level click handlers never see the trigger click. -->
  <span class="app-menu-button" :class="{ 'app-menu-button--block': block }" @click.stop @keydown.esc.stop.prevent="open = false">
  <el-popover
    v-model:visible="open"
    :placement="placement"
    trigger="click"
    :width="width"
    :teleported="true"
    :show-arrow="false"
    :offset="6"
    popper-class="app-popover"
  >
    <template #reference>
      <span class="app-menu-button__trigger" :class="{ 'app-menu-button--block': block }">
        <slot name="trigger" :open="open" :attrs="triggerAttrs" />
      </span>
    </template>
    <div v-if="heading" class="app-menu-button__heading">{{ heading }}</div>
    <p v-if="message" class="app-menu-button__message" :class="{ 'app-menu-button__message--error': messageTone === 'error' }">{{ message }}</p>
    <AppMenu
      v-else
      class="app-menu--embedded app-menu-button__menu"
      :class="{ 'app-menu-button__menu--submenus-left': placement.endsWith('-end') }"
      :style="maxHeight ? { maxHeight, overflowY: 'auto' } : undefined"
      :ariaLabel="ariaLabel"
      :items="items"
      @select="select"
      @keydown.esc.stop.prevent="open = false"
    />
  </el-popover>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AppMenu from './AppMenu.vue';
import type { AppMenuItem } from './app-menu';

/**
 * The one way to attach a menu to a trigger: it owns the popover, sizing, Esc, closing after a
 * choice and the trigger's aria attributes. Spread `attrs` onto the trigger button.
 */
withDefaults(defineProps<{
  ariaLabel: string;
  items: AppMenuItem[];
  heading?: string;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'right-end';
  width?: number;
  /** Bound long menus while keeping every action reachable by scrolling. */
  maxHeight?: string;
  /** Let the trigger fill its container instead of sizing to its content. */
  block?: boolean;
  /** Shown instead of the items while they load or when loading failed. */
  message?: string;
  messageTone?: 'default' | 'error';
}>(), { heading: undefined, placement: 'bottom-end', width: 220, maxHeight: undefined, block: false, message: undefined, messageTone: 'default' });

const emit = defineEmits<{ select: [itemId: string] }>();
const open = defineModel<boolean>('open', { default: false });
const triggerAttrs = computed(() => ({ 'aria-haspopup': 'menu' as const, 'aria-expanded': open.value }));

function select(itemId: string): void {
  open.value = false;
  emit('select', itemId);
}
</script>

<style scoped>
.app-menu-button,
.app-menu-button__trigger {
  display: inline-flex;
}

.app-menu-button.app-menu-button--block,
.app-menu-button__trigger.app-menu-button--block {
  display: flex;
  width: 100%;
}

.app-menu-button__message {
  margin: 0;
  padding: var(--space-4) var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.app-menu-button__message--error {
  color: var(--color-error);
}

.app-menu-button__menu--submenus-left :deep(.app-menu__submenu-menu) {
  right: 100%;
  left: auto;
}

.app-menu-button__heading {
  padding: var(--space-3) var(--space-6) var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-medium);
}
</style>
