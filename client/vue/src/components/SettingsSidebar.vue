<template>
  <aside
    class="settings-sidebar"
    :aria-label="$t('surface.settingsSidebar.settingsCategories')"
  >
    <el-menu
      :default-active="activeTab"
      @select="selectTab"
    >
      <el-menu-item-group v-for="group in groups" :key="group.id" :title="$t(group.labelKey)">
        <el-menu-item v-for="destination in destinations.filter(item => item.group === group.id)" :key="destination.id" :index="destination.id">
          <BackendIcon v-if="destination.backend" :backend="destination.backend" monochrome />
          <component :is="destination.icon" v-else aria-hidden="true" />
          <span>{{ $t(destination.labelKey) }}</span>
        </el-menu-item>
      </el-menu-item-group>
    </el-menu>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { availableSettingsDestinations, type SettingsTab } from './settings-tabs';
import type { AgentBackend } from '@workspace/core/contracts';
import BackendIcon from './BackendIcon.vue';
import { appHostCapabilities } from '../platform-api';

const props = defineProps<{
  activeTab: SettingsTab;
  availableBackends?: AgentBackend[];
}>();

const emit = defineEmits<{
  select: [tab: SettingsTab];
}>();

const groups = [
  { id: 'app', labelKey: 'surface.settingsSidebar.groupApp' },
  { id: 'agents', labelKey: 'surface.settingsSidebar.groupAgents' },
  { id: 'workspace', labelKey: 'surface.settingsSidebar.groupWorkspace' },
];
const destinations = computed(() => availableSettingsDestinations({ embeddedBrowser: appHostCapabilities.embeddedBrowser, appshots: appHostCapabilities.appshots, availableBackends: props.availableBackends ?? [] }));
function selectTab(tab: string): void {
  const destination = destinations.value.find(item => item.id === tab);
  if (destination) emit('select', destination.id);
}
</script>

<style scoped>
.settings-sidebar {
  border-right: 1px solid var(--color-border);
  background: var(--color-shell-sidebar);
  padding-top: var(--space-24);
}

.settings-sidebar :deep(.el-menu) {
  border-right: 0;
  background: transparent;
  padding: var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.settings-sidebar :deep(.el-menu-item-group__title) {
  padding: 0 var(--space-4) var(--space-2) var(--space-4) !important;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-bold);
  line-height: var(--line-height-16);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.settings-sidebar :deep(.el-menu-item-group > ul) {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0;
}

.settings-sidebar :deep(.el-menu-item) {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-4) !important;
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  font-size: var(--font-size-15);
}

.settings-sidebar :deep(.el-menu-item svg),
.settings-sidebar :deep(.el-menu-item .backend-icon) {
  flex: 0 0 auto;
  width: var(--icon-md);
  height: var(--icon-md);
  stroke-width: 1.5px;
}

.settings-sidebar :deep(.el-menu-item:hover) {
  background: var(--color-surface-high);
}

.settings-sidebar :deep(.el-menu-item .backend-icon) {
  transform: scale(1.15);
}

.settings-sidebar :deep(.el-menu-item.is-active) {
  color: var(--color-on-primary-container);
  font-weight: var(--font-weight-semibold);
  background: var(--color-primary-container);
}

.settings-sidebar :deep(.el-menu-item.is-active svg) {
  color: var(--color-primary);
}
</style>
