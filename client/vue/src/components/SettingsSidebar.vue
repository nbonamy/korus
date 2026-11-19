<template>
  <aside
    ref="sidebar"
    class="settings-sidebar"
    data-slot="sidebar-inner"
    data-workspace-area="settings-nav"
    tabindex="-1"
    @keydown.capture="navigate"
    :aria-label="$t('surface.settingsSidebar.settingsCategories')"
  >
    <div class="settings-sidebar__search">
      <ClearableTextInput
        v-model="search"
        role="searchbox"
        autocomplete="off"
        :placeholder="$t('surface.settingsSidebar.search')"
        :aria-label="$t('surface.settingsSidebar.search')"
        :clear-label="$t('surface.settingsSidebar.clearSearch')"
        @keydown.esc="clearSearch"
      />
    </div>
    <el-menu
      v-if="visibleGroups.length"
      :default-active="activeTab"
      @select="selectTab"
    >
      <el-menu-item-group v-for="group in visibleGroups" :key="group.id" :title="group.labelKey ? $t(group.labelKey) : undefined">
        <el-menu-item
          v-for="destination in group.destinations"
          :key="destination.id"
          :index="destination.id"
          class="agent-ui-interactive"
          data-variant="primary"
          :data-selected="activeTab === destination.id ? '' : undefined"
          :tabindex="tabStop === destination.id ? 0 : -1"
        >
          <ProviderIcon v-if="destination.provider" :provider="destination.provider" monochrome />
          <component :is="destination.icon" v-else aria-hidden="true" />
          <span>{{ $t(destination.labelKey) }}</span>
        </el-menu-item>
      </el-menu-item-group>
    </el-menu>
    <p v-else class="settings-sidebar__empty" role="status">{{ $t('surface.settingsSidebar.noMatches') }}</p>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { availableSettingsDestinations, type SettingsTab } from './settings-tabs';
import { normalizeSettingsSearch, settingsSearchText } from './settings-search';
import type { HarnessProvider } from '@workspace/core/contracts';
import ProviderIcon from './ProviderIcon.vue';
import ClearableTextInput from '../shared/form/ClearableTextInput.vue';
import { translate } from '../i18n';
import { appHostCapabilities } from '../platform-api';

const props = defineProps<{
  activeTab: SettingsTab;
  availableProviders?: HarnessProvider[];
}>();

const emit = defineEmits<{
  select: [tab: SettingsTab];
}>();

const groups = [
  { id: 'app', labelKey: 'surface.settingsSidebar.groupApp' },
  { id: 'agents', labelKey: 'surface.settingsSidebar.groupAgents' },
  { id: 'workspace', labelKey: 'surface.settingsSidebar.groupWorkspace' },
];
const destinations = computed(() => availableSettingsDestinations({ embeddedBrowser: appHostCapabilities.embeddedBrowser, appshots: appHostCapabilities.appshots, availableProviders: props.availableProviders ?? [] }));
const sidebar = ref<HTMLElement | null>(null);
const search = ref('');
const appliedSearch = ref('');
const searchIndex = computed(() => destinations.value.map(destination => ({
  destination,
  label: normalizeSettingsSearch(translate(destination.labelKey)),
  text: settingsSearchText(destination.id, destination.labelKey),
})));
const visibleDestinations = computed(() => {
  const query = appliedSearch.value;
  if (!query) return destinations.value;
  const terms = query.split(' ');
  const labelRank = (label: string) => label === query ? 2 : Number(label.includes(query));
  return searchIndex.value
    .filter(entry => terms.every(term => entry.text.includes(term)))
    .sort((a, b) => labelRank(b.label) - labelRank(a.label))
    .map(entry => entry.destination);
});
const visibleGroups = computed(() => {
  if (appliedSearch.value) {
    return visibleDestinations.value.length ? [{ id: 'search', labelKey: '', destinations: visibleDestinations.value }] : [];
  }
  return groups.map(group => ({
    ...group,
    destinations: visibleDestinations.value.filter(item => item.group === group.id),
  })).filter(group => group.destinations.length);
});
const firstResult = computed(() => visibleDestinations.value[0]?.id);
const tabStop = computed(() => visibleDestinations.value.find(destination => destination.id === props.activeTab)?.id ?? firstResult.value);

watch(() => normalizeSettingsSearch(search.value), (query, _previous, onCleanup) => {
  if (!query) {
    appliedSearch.value = '';
    return;
  }
  const timer = setTimeout(() => { appliedSearch.value = query; }, 180);
  onCleanup(() => clearTimeout(timer));
});

watch([appliedSearch, firstResult], ([query, first]) => {
  if (!query) return;
  if (sidebar.value) sidebar.value.scrollTop = 0;
  if (first && first !== props.activeTab) emit('select', first);
});

function clearSearch(event: KeyboardEvent): void {
  if (!search.value) return;
  event.stopPropagation();
  search.value = '';
}

function navigate(event: KeyboardEvent): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const sidebar = event.currentTarget as HTMLElement;
  const items = Array.from(sidebar.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'));
  const index = items.indexOf(event.target as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  event.stopPropagation();
  const target = items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
  target?.focus({ preventScroll: true });
  target?.click();
  target?.scrollIntoView({ block: 'nearest' });
}

function selectTab(tab: string): void {
  const destination = visibleDestinations.value.find(item => item.id === tab);
  if (destination) emit('select', destination.id);
}
</script>

<style scoped>
.settings-sidebar {
  --agent-ui-state-primary-selected: color-mix(in srgb, var(--color-primary) 8%, transparent);
  --settings-search-height: 36px;
  isolation: isolate;
  overflow-y: auto;
  border-right: 1px solid var(--color-border);
  scroll-padding-top: calc(var(--settings-nav-top, var(--space-24)) + var(--settings-search-height) + 2 * var(--space-8));
}

.settings-sidebar__search {
  position: sticky;
  z-index: 1;
  top: 0;
  padding: var(--space-8);
  padding-top: calc(var(--settings-nav-top, var(--space-24)) + var(--space-8));
  background: var(--color-shell-sidebar);
}

.settings-sidebar__search :deep(.app-form-dialog__control) {
  min-height: var(--settings-search-height);
}

.settings-sidebar__empty {
  margin: var(--space-8);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.settings-sidebar :deep(.el-menu) {
  border-right: 0;
  background: transparent;
  padding: var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

@layer app-surfaces {
  .settings-sidebar { background: var(--color-shell-sidebar); }
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

.settings-sidebar :deep(.el-menu-item-group__title:empty) {
  display: none;
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
  --agent-ui-state-rest-foreground: var(--color-text-muted);
  background: revert-layer;
  color: revert-layer;
  outline: revert-layer;
  cursor: revert-layer;
  font-size: var(--font-size-15);
}

.settings-sidebar :deep(.el-menu-item svg),
.settings-sidebar :deep(.el-menu-item .provider-icon) {
  flex: 0 0 auto;
  width: var(--icon-md);
  height: var(--icon-md);
  stroke-width: 1.5px;
}

.settings-sidebar :deep(.el-menu-item .provider-icon) {
  transform: scale(1.15);
}

.settings-sidebar :deep(.el-menu-item.is-active) {
  font-weight: var(--font-weight-semibold);
}

</style>
