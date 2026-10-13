<template>
  <el-popover
    v-model:visible="popoverVisible"
    placement="right-end"
    popper-class="app-popover settings-menu-popover"
    trigger="click"
    :width="220"
  >
    <template #reference>
      <button
        class="settings-menu__trigger"
        :class="{ 'settings-menu__trigger--active': active }"
        type="button"
        :aria-label="account ? $t('surface.settingsMenu.accountMenu') : $t('surface.settingsMenu.settingsMenu')"
        :aria-pressed="active"
      >
        <ProductMarkIcon aria-hidden="true" />
      </button>
    </template>

    <div class="settings-menu" :aria-label="$t('surface.settingsMenu.settingsMenu')">
      <div v-if="usageGroups.length" class="settings-menu__rate-limits" :aria-label="$t('surface.settingsMenu.rateLimits')">
        <div class="settings-menu__rate-limits-header">
          <BrandSpeedTest />
          <span>{{ $t('surface.settingsMenu.usage') }}</span>
        </div>
        <div v-for="group in usageGroups" :key="group.backend" class="settings-menu__usage-group" :aria-label="group.name">
          <strong class="settings-menu__engine" :style="{ gridRow: `1 / span ${Math.max(1, group.rows.length)}` }">{{ group.name }}</strong>
          <span v-if="group.failed" class="settings-menu__usage-error">{{ $t('surface.settingsMenu.loadFailed') }}</span>
          <div v-for="row in group.rows" :key="row.label" class="settings-menu__rate-limit" :title="row.label" :aria-label="row.label">
            <span class="settings-menu__rate-limit-remaining" :aria-label="$t('surface.settingsMenu.remainingValue', { value: row.remaining })">{{ row.remaining }}</span>
            <span class="settings-menu__rate-limit-reset" :aria-label="row.reset ? $t('surface.settingsMenu.resetValue', { value: row.reset }) : undefined">{{ row.reset }}</span>
          </div>
        </div>
      </div>

      <div
        v-if="usageGroups.length"
        class="settings-menu__usage-divider"
        role="separator"
        :aria-label="$t('surface.settingsMenu.usageActionsDivider')"
      />

      <AppMenu
        class="app-menu--embedded settings-menu__actions"
        :ariaLabel="$t('surface.settingsMenu.settingsActions')"
        :items="menuItems"
        @select="selectMenuItem"
      />
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed, ref, watch } from 'vue';
import type { AccountRateLimitWindow, AccountRateLimits, AgentBackend, AppSnapshot, CodexAccount } from '@workspace/core/contracts';
import AppMenu from '../shared/menu/AppMenu.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { BrandSpeedTest, ProductMarkIcon, QuitIcon, SettingsIcon, SparklesIcon } from '../shared/icons/app-icons';
import { appHostCapabilities, appApi } from '../platform-api';

const props = withDefaults(defineProps<{
  active?: boolean;
  rateLimits?: AccountRateLimits;
  enabledBackends?: AgentBackend[];
  backendRateLimits?: AppSnapshot['backendAccountRateLimits'];
  account?: CodexAccount | null;
}>(), {
  active: false,
  enabledBackends: () => [],
});

const emit = defineEmits<{
  'open-settings': [];
  'open-whats-new': [];
  quit: [];
}>();
const popoverVisible = ref(false);
const nowMs = ref(Date.now());
const fetchedUsage = ref<Partial<Record<AgentBackend, AccountRateLimits | null>>>({});
const usageErrors = ref<Partial<Record<AgentBackend, boolean>>>({});
const quotaBackends = computed(() => props.enabledBackends.filter(backend => backend !== 'antigravity' && (backend !== 'codex' || props.account?.type !== 'apiKey')));
watch([popoverVisible, () => quotaBackends.value.join(','), () => JSON.stringify(props.account)], ([visible], _previous, onCleanup) => {
  fetchedUsage.value = {};
  usageErrors.value = {};
  if (!visible) return;
  let cancelled = false;
  async function refreshUsage(backend: AgentBackend): Promise<void> {
    try {
      const limits = await appApi?.getProviderUsage(backend);
      if (!cancelled && limits !== undefined) fetchedUsage.value[backend] = limits;
    } catch {
      if (!cancelled) usageErrors.value[backend] = true;
    }
  }
  for (const backend of quotaBackends.value) void refreshUsage(backend);
  nowMs.value = Date.now();
  const timer = window.setInterval(() => { nowMs.value = Date.now(); }, 60_000);
  onCleanup(() => { cancelled = true; window.clearInterval(timer); });
});
const menuItems = computed<AppMenuItem[]>(() => [
  {
    id: 'open-settings',
    type: 'action',
    label: translate('surface.settingsMenu.settings'),
    icon: SettingsIcon,
    value: '⌘,',
  },
  {
    id: 'open-whats-new',
    type: 'action',
    label: translate('surface.settingsMenu.whatSNew'),
    icon: SparklesIcon,
  },
  ...(appHostCapabilities.appLifecycle ? [{
    id: 'quit',
    type: 'action',
    label: translate('surface.settingsMenu.quit'),
    icon: QuitIcon,
    danger: true,
  } satisfies AppMenuItem] : []),
]);

type RateLimitRow = {
  label: string;
  remaining: string;
  reset: string;
};

const usageGroups = computed(() => quotaBackends.value.map(backend => {
  const limits = fetchedUsage.value[backend] !== undefined ? fetchedUsage.value[backend]
    : props.backendRateLimits?.[backend] ?? (backend === 'codex' ? props.rateLimits : undefined);
  const rows = [
    rateLimitRow(limits?.primary ?? null, translate('surface.settingsMenu.usage')),
    rateLimitRow(limits?.secondary ?? null, translate('surface.settingsMenu.weekly')),
  ].filter((row): row is RateLimitRow => Boolean(row));
  return { backend, name: translate(`surface.settingsMenu.engine.${backend}`), rows, failed: usageErrors.value[backend] && !rows.length };
}).filter(group => group.rows.length > 0 || group.failed));

function rateLimitRow(window: AccountRateLimitWindow | null, fallbackLabel: string): RateLimitRow | null {
  if (!window) {
    return null;
  }

  return {
    label: rateLimitLabel(window, fallbackLabel),
    remaining: rateLimitRemaining(window),
    reset: rateLimitReset(window),
  };
}

function rateLimitLabel(window: AccountRateLimitWindow, fallbackLabel: string): string {
  if (window.windowDurationMins === 10_080) {
    return translate('surface.settingsMenu.weekly');
  }

  if (typeof window.windowDurationMins === 'number' && window.windowDurationMins > 0) {
    if (window.windowDurationMins % 60 === 0) {
      return `${window.windowDurationMins / 60}h`;
    }

    return `${window.windowDurationMins}m`;
  }

  return fallbackLabel;
}

function rateLimitRemaining(window: AccountRateLimitWindow): string {
  if (!Number.isFinite(window.usedPercent)) {
    return translate('surface.settingsMenu.unknown');
  }

  return `${Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)))}%`;
}

function rateLimitReset(window: AccountRateLimitWindow): string {
  if (typeof window.resetsAt !== 'number' || !Number.isFinite(window.resetsAt)) {
    return '';
  }

  const remainingMinutes = Math.max(0, Math.ceil((window.resetsAt * 1000 - nowMs.value) / 60_000));
  const days = Math.floor(remainingMinutes / 1_440);
  const hours = Math.floor((remainingMinutes % 1_440) / 60);
  const minutes = remainingMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function selectMenuItem(itemId: string): void {
  popoverVisible.value = false;

  if (itemId === 'open-settings') {
    emit('open-settings');
  } else if (itemId === 'open-whats-new') {
    emit('open-whats-new');
  } else if (itemId === 'quit') {
    emit('quit');
  }
}
</script>

<style scoped>
.settings-menu__trigger {
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.settings-menu__trigger:hover,
.settings-menu__trigger:focus-visible {
  color: var(--color-text);
  outline: none;
}

.settings-menu__trigger--active {
  color: var(--color-primary);
}

.settings-menu {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.settings-menu__rate-limits {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
  color: var(--color-text);
}

.settings-menu__rate-limits-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-13);
  text-transform: uppercase;
  color: var(--color-text-muted);
  font-weight: var(--font-weight-medium);
}

.settings-menu__rate-limits-header svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.settings-menu__rate-limit {
  display: grid;
  grid-column: 2 / -1;
  grid-template-columns: subgrid;
  align-items: baseline;
  column-gap: var(--space-2);
  min-width: 0;
  font-size: var(--font-size-13);
}

.settings-menu__usage-group {
  display: grid;
  grid-template-columns: minmax(54px, 1fr) 38px 62px;
  gap: var(--space-2);
  align-items: baseline;
  font-size: var(--font-size-13);
}

.settings-menu__engine { font-weight: var(--font-weight-medium); }

.settings-menu__usage-error {
  grid-column: 2 / -1;
  color: var(--color-text-muted);
}

.settings-menu__rate-limit-remaining,
.settings-menu__rate-limit-reset {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: right;
}

.settings-menu__usage-divider {
  height: 1px;
  background: var(--color-border);
}

.settings-menu__actions {
  padding-bottom: var(--space-2);
}
</style>
