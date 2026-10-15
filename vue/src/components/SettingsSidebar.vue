<template>
  <aside
    class="settings-sidebar"
    :aria-label="$t('surface.settingsSidebar.settingsCategories')"
  >
    <el-menu
      :default-active="activeTab"
      @select="selectTab"
    >
      <el-menu-item-group :title="$t('surface.settingsSidebar.groupApp')">
        <el-menu-item index="general">
          <SettingsIcon aria-hidden="true" />
          <span>{{ $t('surface.settingsSidebar.general') }}</span>
        </el-menu-item>
        <el-menu-item index="usage"><SettingsIcon aria-hidden="true" /><span>{{ $t('telemetry.usage') }}</span></el-menu-item>
        <el-menu-item index="appearance">
          <PaletteIcon aria-hidden="true" />
          <span>{{ $t('surface.settingsSidebar.appearance') }}</span>
        </el-menu-item>
        <el-menu-item index="voice">
          <MicrophoneIcon aria-hidden="true" />
          <span>{{ $t('surface.settingsSidebar.voice') }}</span>
        </el-menu-item>
        <el-menu-item index="personalization">
          <UserIcon aria-hidden="true" />
          <span>{{ $t('surface.instructionSettings.personalization') }}</span>
        </el-menu-item>
        <el-menu-item v-if="appHostCapabilities.appshots" index="appshots">
          <ScreenshotIcon aria-hidden="true" />
          <span>{{ $t('surface.settingsSidebar.appshots') }}</span>
        </el-menu-item>
      </el-menu-item-group>
      <el-menu-item-group :title="$t('surface.settingsSidebar.groupAgents')">
        <el-menu-item index="codex">
          <BackendIcon backend="codex" monochrome />
          <span>{{ $t('surface.settingsSidebar.codex') }}</span>
        </el-menu-item>
        <el-menu-item index="claude-code">
          <BackendIcon backend="claude" monochrome />
          <span>{{ $t('surface.settingsSidebar.claudeCode') }}</span>
        </el-menu-item>
        <el-menu-item v-if="availableBackends?.includes('antigravity')" index="antigravity">
          <BackendIcon backend="antigravity" monochrome />
          <span>{{ $t('antigravity.name') }}</span>
        </el-menu-item>
        <el-menu-item index="plugins">
          <PuzzleIcon aria-hidden="true" />
          <span>{{ $t('surface.settingsSidebar.plugins') }}</span>
        </el-menu-item>
      </el-menu-item-group>
      <el-menu-item-group :title="$t('surface.settingsSidebar.groupWorkspace')">
        <el-menu-item index="git">
          <GitBranchIcon aria-hidden="true" />
          <span>{{ $t('surface.instructionSettings.git') }}</span>
        </el-menu-item>
        <el-menu-item index="integrations">
          <AffiliateIcon aria-hidden="true" />
          <span>{{ $t('surface.settingsSidebar.integrations') }}</span>
        </el-menu-item>
        <el-menu-item index="connections">
          <TerminalIcon aria-hidden="true" />
          <span>{{ $t('surface.settingsSidebar.connections') }}</span>
        </el-menu-item>
      </el-menu-item-group>
    </el-menu>
  </aside>
</template>

<script setup lang="ts">
import type { SettingsTab } from './settings-tabs';
import type { AgentBackend } from '@workspace/core/contracts';
import { AffiliateIcon, GitBranchIcon, MicrophoneIcon, PaletteIcon, PuzzleIcon, ScreenshotIcon, SettingsIcon, TerminalIcon, UserIcon } from '../shared/icons/app-icons';
import BackendIcon from './BackendIcon.vue';
import { appHostCapabilities } from '../platform-api';

defineProps<{
  activeTab: SettingsTab;
  availableBackends?: AgentBackend[];
}>();

const emit = defineEmits<{
  select: [tab: SettingsTab];
}>();

function selectTab(tab: string): void {
  if (tab === 'usage' || tab === 'antigravity' || tab === 'personalization' || tab === 'voice' || tab === 'git' || tab === 'general' || tab === 'codex' || tab === 'claude-code' || tab === 'appearance' || tab === 'appshots' || tab === 'plugins' || tab === 'integrations' || tab === 'connections') {
    emit('select', tab);
  }
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
