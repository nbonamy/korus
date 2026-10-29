<template>
  <AppMenuButton
    :block="!$slots.trigger"
    placement="bottom-start"
    :width="240"
    :heading="t('startWork.addProjectFrom')"
    :ariaLabel="t('startWork.addProjectFrom')"
    :items="menuItems"
    @select="select"
  >
    <template #trigger="{ attrs }">
      <slot name="trigger" :attrs="attrs">
        <button
          v-bind="attrs"
          class="start-work-menu__trigger"
          type="button"
          :aria-label="t('startWork.addProject')"
        >
          <FoldersIcon data-icon="folders" aria-hidden="true" />
          <span>{{ t('startWork.addProject') }}</span>
        </button>
      </slot>
    </template>
  </AppMenuButton>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { FoldersIcon } from '../shared/icons/app-icons';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import { isStartWorkAction, startWorkMenuItems, type StartWorkAction } from './start-work-actions';

const emit = defineEmits<{
  select: [action: StartWorkAction];
}>();

const { t } = useI18n();
const menuItems = computed(() => startWorkMenuItems(t));

function select(action: string): void {
  if (!isStartWorkAction(action)) return;
  emit('select', action);
}
</script>

<style scoped>
.start-work-menu__trigger {
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-6);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-medium);
  text-align: left;
  cursor: pointer;
}

.start-work-menu__trigger:hover,
.start-work-menu__trigger:focus-visible {
  color: var(--color-text);
  outline: 0;
}

.start-work-menu__trigger svg {
  width: var(--icon-md);
  height: var(--icon-md);
}
</style>
