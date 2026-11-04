<template>
  <template v-if="lock?.state.value.visible">
    <el-tooltip v-if="active" :content="activeLabel" :trigger="['hover', 'focus']" placement="right" :show-after="300">
      <button
        type="button"
        class="team-rail__lock team-rail__lock--active"
        :aria-label="activeLabel"
        @click="turnBackOn"
      >
        <LockOpenIcon aria-hidden="true" />
      </button>
    </el-tooltip>
    <AppMenuButton v-else :items="items" :ariaLabel="$t('surface.computerUseLock.enable')" :width="220" placement="right-end" @select="choose">
      <template #trigger="{ attrs, open }">
        <el-tooltip :content="$t('surface.computerUseLock.enable')" :trigger="['hover', 'focus']" placement="right" :show-after="300" :disabled="open">
          <button v-bind="attrs" type="button" class="team-rail__lock" :aria-label="$t('surface.computerUseLock.enable')">
            <LockIcon aria-hidden="true" />
          </button>
        </el-tooltip>
      </template>
    </AppMenuButton>
  </template>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { translate } from '../i18n';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import {
  IconClockHour1, IconClockHour2, IconClockHour3, IconClockHour4, IconClockHour5, IconClockHour6,
  IconClockHour7, ClockHour8Icon, IconClockHour9, IconClockHour10, IconClockHour11, IconClockHour12,
  InfinityIcon, LockIcon, LockOpenIcon, SunriseIcon,
} from '../shared/icons/app-icons';
import { computerUseLockKey, formatClock, holdExpiries, isHoldActive } from './computer-use-lock';

const lock = inject(computerUseLockKey, undefined);
const hold = computed(() => lock?.state.value.hold ?? false);
const active = computed(() => isHoldActive(hold.value, Date.now()));
const activeLabel = computed(() => {
  const current = hold.value;
  return current && current.until !== null
    ? translate('surface.computerUseLock.activeUntil', { time: formatClock(current.until) })
    : translate('surface.computerUseLock.activeIndefinitely');
});

// A clock face for each hour, starting at 12, so the one-hour choice shows the hour it will end.
const hourIcons = [IconClockHour12, IconClockHour1, IconClockHour2, IconClockHour3, IconClockHour4, IconClockHour5,
  IconClockHour6, IconClockHour7, ClockHour8Icon, IconClockHour9, IconClockHour10, IconClockHour11];

// Evaluated when the menu is built, so "Until 9:00 AM" always names the next morning.
const items = computed<AppMenuItem[]>(() => {
  const { hour, morning } = holdExpiries(new Date());
  return [
    { id: 'hour', type: 'action', icon: hourIcons[new Date(hour).getHours() % 12], label: translate('surface.computerUseLock.forOneHour') },
    { id: 'morning', type: 'action', icon: SunriseIcon, label: translate('surface.computerUseLock.untilClock', { time: formatClock(morning) }) },
    { id: 'manual', type: 'action', icon: InfinityIcon, label: translate('surface.computerUseLock.untilTurnedOff') },
  ];
});

function choose(id: string): void {
  const expiries = holdExpiries(new Date());
  if (id === 'hour') void lock?.setHold({ until: expiries.hour });
  else if (id === 'morning') void lock?.setHold({ until: expiries.morning });
  else if (id === 'manual') void lock?.setHold({ until: null });
}

function turnBackOn(): void {
  void lock?.setHold(false);
}
</script>

<style scoped>
.team-rail__lock {
  width: var(--team-rail-button-size);
  height: var(--team-rail-button-size);
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  color: var(--team-rail-icon-color);
  background: transparent;
  cursor: pointer;
  opacity: 0.6;
}

.team-rail__lock--active {
  opacity: 1;
  color: var(--color-warning);
}

.team-rail__lock:hover,
.team-rail__lock:focus-visible {
  color: var(--team-rail-icon-hover-color);
  opacity: 1;
  outline: none;
}

.team-rail__lock--active:hover,
.team-rail__lock--active:focus-visible {
  color: var(--color-warning);
}

.team-rail__lock svg {
  width: var(--icon-xl);
  height: var(--icon-xl);
  /* The lock glyph is taller than it is wide, so it reads narrower than the other rail icons. */
  transform: scaleX(1.12);
}
</style>
