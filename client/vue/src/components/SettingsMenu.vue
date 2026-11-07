<template>
  <el-tooltip :virtual-ref="menuTrigger" virtual-triggering :content="account ? $t('surface.settingsMenu.accountMenu') : $t('surface.settingsMenu.settingsMenu')" :trigger="['hover', 'focus']" placement="right" :show-after="300" :disabled="popoverVisible" />
  <el-popover
    v-model:visible="popoverVisible"
    placement="right-end"
    popper-class="app-popover settings-menu-popover"
    trigger="click"
    :width="220"
  >
    <template #reference>
      <button
        ref="menuTrigger"
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
          <el-tooltip placement="top" :show-after="150" popper-class="settings-menu-legend-popper">
            <button class="settings-menu__legend-trigger" type="button" :aria-label="$t('surface.settingsMenu.usage')">
              <InfoCircleIcon aria-hidden="true" />
            </button>
            <template #content>
              <div class="settings-menu__legend">
                <span v-for="item in legend" :key="item.key" class="settings-menu__legend-item">
                  <i class="settings-menu__legend-dot" :style="{ background: item.color }" />{{ $t(`surface.settingsMenu.legend.${item.key}`) }}
                </span>
              </div>
            </template>
          </el-tooltip>
        </div>
        <div v-for="group in usageGroups" :key="group.backend" class="settings-menu__usage-group" :aria-label="group.name">
          <strong class="settings-menu__engine"><BackendIcon class="settings-menu__engine-icon" :backend="group.backend" />{{ group.name }}</strong>
          <span v-if="group.failed" class="settings-menu__usage-error">{{ $t('surface.settingsMenu.loadFailed') }}</span>
          <div v-for="row in group.rows" :key="row.label" class="settings-menu__rate-limit" :class="{ 'settings-menu__rate-limit--detail': row.detail }" :title="row.title ?? row.label" :aria-label="row.label">
            <span class="settings-menu__rate-limit-name">{{ row.label }}</span>
            <el-tooltip :content="row.pace ?? ''" :disabled="!row.pace" :trigger="['hover', 'focus']" placement="top" :show-after="150">
              <span class="settings-menu__rate-limit-remaining" :class="row.level && `settings-menu__rate-limit-remaining--${row.level}`" :tabindex="row.pace ? 0 : undefined" :aria-label="row.valueLabel ?? $t('surface.settingsMenu.remainingValue', { value: row.remaining })">{{ row.remaining }}</span>
            </el-tooltip>
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
import { i18n, translate } from '../i18n';
import { computed, ref, unref, watch } from 'vue';
import type { AccountRateLimitWindow, AccountRateLimits, AgentBackend, AppSnapshot, CodexAccount } from '@workspace/core/contracts';
import AppMenu from '../shared/menu/AppMenu.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { BrandSpeedTest, ChartBarIcon, InfoCircleIcon, ProductMarkIcon, QuitIcon, SettingsIcon, SparklesIcon } from '../shared/icons/app-icons';
import { appHostCapabilities, appApi } from '../platform-api';
import { supportsSubscriptionQuota } from '@workspace/core/agent-backends';
import BackendIcon from './BackendIcon.vue';
import { isAccountBilling } from '@workspace/core/snapshot-guard-collections';

const props = withDefaults(defineProps<{
  active?: boolean;
  rateLimits?: AccountRateLimits;
  enabledBackends?: AgentBackend[];
  backendRateLimits?: AppSnapshot['backendAccountRateLimits'];
  providerConnections?: AppSnapshot['providerConnections'];
  account?: CodexAccount | null;
}>(), {
  active: false,
  enabledBackends: () => [],
});

const emit = defineEmits<{
  'open-settings': [];
  'open-analytics': [];
  'open-whats-new': [];
  quit: [];
}>();
const popoverVisible = ref(false);
const menuTrigger = ref<HTMLElement | null>(null);
const nowMs = ref(Date.now());
const fetchedUsage = ref<Partial<Record<AgentBackend, AccountRateLimits | null>>>({});
const usageErrors = ref<Partial<Record<AgentBackend, boolean>>>({});
const quotaBackends = computed(() => props.enabledBackends.filter(backend => supportsSubscriptionQuota(backend, props.account)));
watch([popoverVisible, () => quotaBackends.value.join(','), () => JSON.stringify(props.account),
  () => JSON.stringify(props.providerConnections?.map(provider => [provider.backend, provider.authentication]))], ([visible], _previous, onCleanup) => {
  fetchedUsage.value = {};
  usageErrors.value = {};
  if (!visible) return;
  // Financial data from disk can belong to the previous native account. Wait
  // for a current read instead of flashing a persisted balance on opening.
  for (const backend of quotaBackends.value) if (isAccountBilling(props.backendRateLimits?.[backend]?.billing)) fetchedUsage.value[backend] = null;
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
    id: 'open-analytics',
    type: 'action',
    label: translate('analytics.title'),
    icon: ChartBarIcon,
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

const legend = [
  { key: 'ahead', color: 'var(--color-success)' },
  { key: 'onPace', color: 'var(--color-text-muted)' },
  { key: 'low', color: 'var(--color-warning)' },
  { key: 'critical', color: 'var(--color-error)' },
] as const;

type RateLimitRow = {
  label: string;
  remaining: string;
  valueLabel?: string;
  title?: string;
  detail?: boolean;
  /** Only quotas clearly off their pace, or almost out, stand out. */
  level: 'low' | 'critical' | 'ahead' | null;
  pace: string | null;
  reset: string;
};

const usageGroups = computed(() => quotaBackends.value.map(backend => {
  const limits = fetchedUsage.value[backend] !== undefined ? fetchedUsage.value[backend]
    : props.backendRateLimits?.[backend] ?? (backend === 'codex' ? props.rateLimits : undefined);
  const rows = [
    rateLimitRow(limits?.primary ?? null, translate('surface.settingsMenu.usage')),
    ...(isAccountBilling(limits?.billing) ? [] : [rateLimitRow(limits?.secondary ?? null, translate('surface.settingsMenu.weekly'))]),
  ].filter((row): row is RateLimitRow => Boolean(row));
  if (isAccountBilling(limits?.billing)) {
    const billing = limits.billing;
    const row = (key: string, value: string): RateLimitRow => ({ label: translate(`surface.settingsMenu.${key}`), remaining: value, valueLabel: value, detail: true, reset: '', level: null, pace: null,
      title: `${translate(`surface.settingsMenu.${key}`)}: ${value}` });
    if (limits.planType) rows.unshift(row('plan', limits.planType));
    rows.push(row('credits', billing.includedBalanceUsd === null ? translate('surface.settingsMenu.unknown') : usd(billing.includedBalanceUsd)));
    const demand = billing.onDemand;
    const value = demand.enabled === false ? translate('surface.settingsMenu.billingOff')
      : demand.enabled === true && demand.unlimited && demand.usedUsd !== null ? translate('surface.settingsMenu.usedValue', { value: usd(demand.usedUsd) })
        : demand.enabled === true && demand.remainingUsd !== null ? usd(demand.remainingUsd) : translate('surface.settingsMenu.unknown');
    rows.push({ ...row('onDemand', value), ...(demand.unlimited ? { title: translate('surface.settingsMenu.noPersonalLimit') } : {}),
      ...(demand.enabled === true && !demand.unlimited ? { valueLabel: translate('surface.settingsMenu.remainingValue', { value }) } : {}) });
  }
  return { backend, name: translate(`surface.settingsMenu.engine.${backend}`), rows, failed: usageErrors.value[backend] && !rows.length };
}).filter(group => group.rows.length > 0 || group.failed));

function usd(value: string | number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
}

function rateLimitRow(window: AccountRateLimitWindow | null, fallbackLabel: string): RateLimitRow | null {
  if (!window) {
    return null;
  }

  const expectedRemaining = rateLimitExpectedRemaining(window);
  const level = rateLimitLevel(window, expectedRemaining);
  return {
    label: rateLimitLabel(window, fallbackLabel),
    remaining: rateLimitRemaining(window),
    level,
    pace: expectedRemaining !== null && (level === 'ahead' || level === 'low')
      ? rateLimitPaceTooltip(window, expectedRemaining, level)
      : null,
    reset: rateLimitReset(window),
  };
}

function rateLimitLabel(window: AccountRateLimitWindow, fallbackLabel: string): string {
  if (window.label) {
    return window.label.replace(/\s+and\s+/iu, '/');
  }

  if (window.windowDurationMins === 10_080) {
    return translate('surface.settingsMenu.weekly');
  }

  if (typeof window.windowDurationMins === 'number' && window.windowDurationMins > 0) {
    if (window.windowDurationMins % 60 === 0) {
      return translate('surface.settingsMenu.hours', { count: window.windowDurationMins / 60 });
    }

    return translate('surface.settingsMenu.minutes', { count: window.windowDurationMins });
  }

  return fallbackLabel;
}

// Quota use is judged against how much of the window has elapsed; small gaps are normal.
const PACE_TOLERANCE_POINTS = 5;

function rateLimitPaceTooltip(window: AccountRateLimitWindow, expectedRemaining: number, level: 'ahead' | 'low'): string {
  const minutes = Math.max(1, Math.round(Math.abs(100 - window.usedPercent - expectedRemaining) * window.windowDurationMins! / 100));
  const hours = minutes >= 60;
  const duration = new Intl.NumberFormat(unref(i18n.global.locale), {
    style: 'unit', unit: hours ? 'hour' : 'minute', unitDisplay: 'long', maximumFractionDigits: 0,
  }).format(hours ? minutes / 60 : minutes);
  return translate(level === 'ahead' ? 'surface.settingsMenu.paceUnder' : 'surface.settingsMenu.paceOver', { duration });
}

function rateLimitExpectedRemaining(window: AccountRateLimitWindow): number | null {
  const { windowDurationMins: minutes, resetsAt } = window;
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0 || typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return null;
  return Math.min(100, Math.max(0, (resetsAt * 1000 - nowMs.value) / (minutes * 60_000) * 100));
}

function rateLimitLevel(window: AccountRateLimitWindow, expectedRemaining: number | null): RateLimitRow['level'] {
  if (!Number.isFinite(window.usedPercent)) return null;
  if (100 - window.usedPercent < 10) return 'critical';
  if (expectedRemaining === null) return null;
  const lead = window.usedPercent - (100 - expectedRemaining);
  return lead > PACE_TOLERANCE_POINTS ? 'low' : lead < -PACE_TOLERANCE_POINTS ? 'ahead' : null;
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
  } else if (itemId === 'open-analytics') {
    emit('open-analytics');
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

.settings-menu__legend-trigger {
  display: inline-flex;
  margin: 0 0 0 auto;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: help;
}

.settings-menu__legend { display: flex; flex-direction: column; }

.settings-menu__legend-item { display: flex; align-items: center; gap: var(--space-2); }

.settings-menu__legend-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.settings-menu__rate-limits-header svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.settings-menu__rate-limit {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  padding-left: calc(var(--icon-sm) + var(--space-2));
  align-items: baseline;
  column-gap: var(--space-2);
  min-width: 0;
  font-size: var(--font-size-12);
}

.settings-menu__usage-group {
  display: grid;
  grid-template-columns: minmax(54px, 1fr) 34px 48px;
  gap: var(--space-2);
  align-items: baseline;
  font-size: var(--font-size-13);
}

.settings-menu__rate-limit--detail {
  grid-template-columns: minmax(0, 1fr) max-content;
}

.settings-menu__rate-limit--detail .settings-menu__rate-limit-reset { display: none; }

.settings-menu__usage-group + .settings-menu__usage-group {
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.settings-menu__engine {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: var(--space-2);
  font-weight: var(--font-weight-medium);
}

.settings-menu__engine-icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.settings-menu__rate-limit-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.settings-menu__usage-error {
  grid-column: 1 / -1;
  padding-left: calc(var(--icon-sm) + var(--space-2));
  font-size: var(--font-size-12);
  color: var(--color-text-muted);
}

.settings-menu__rate-limit-remaining,
.settings-menu__rate-limit-reset {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: right;
}

.settings-menu__rate-limit-remaining--ahead { color: var(--color-success); }

.settings-menu__rate-limit-remaining--low { color: var(--color-warning); }

.settings-menu__rate-limit-remaining--critical {
  color: var(--color-error);
  font-weight: var(--font-weight-bold);
}

.settings-menu__usage-divider {
  height: 1px;
  background: var(--color-border);
}

.settings-menu__actions {
  padding-bottom: var(--space-2);
}
</style>

<style>
.settings-menu-legend-popper.el-popper {
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-12);
  line-height: 1.35;
}
</style>
