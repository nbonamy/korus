<template>
  <AppMenuButton
    :ariaLabel="ariaLabel"
    :items="items"
    :placement="placement"
    :width="width"
    @select="emit('select', $event)"
  >
    <template #trigger="{ attrs }">
      <button v-bind="attrs" class="app-menu-chip" type="button" :aria-label="triggerLabel ?? ariaLabel">
        <span>{{ label }}</span>
        <ChevronDown aria-hidden="true" />
      </button>
    </template>
  </AppMenuButton>
</template>

<script setup lang="ts">
import { ChevronDown } from '../icons/app-icons';
import AppMenuButton from './AppMenuButton.vue';
import type { AppMenuItem } from './app-menu';

/** The compact "current choice ⌄" trigger for a menu, e.g. a sort or view mode. */
withDefaults(defineProps<{
  label: string;
  ariaLabel: string;
  /** Overrides the trigger's accessible name when it should describe the current choice. */
  triggerLabel?: string;
  items: AppMenuItem[];
  placement?: 'bottom-start' | 'bottom-end';
  width?: number;
}>(), { triggerLabel: undefined, placement: 'bottom-end', width: 200 });

const emit = defineEmits<{ select: [itemId: string] }>();
</script>

<style scoped>
.app-menu-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 28px;
  padding: 0 var(--space-3) 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-regular);
  white-space: nowrap;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.app-menu-chip:hover,
.app-menu-chip[aria-expanded="true"] {
  background: var(--color-surface-low);
}

.app-menu-chip:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.app-menu-chip svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  stroke-width: 1.75px;
}
</style>
