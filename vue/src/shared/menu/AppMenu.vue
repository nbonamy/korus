<template>
  <div
    class="app-menu"
    role="menu"
    :aria-label="ariaLabel"
  >
    <template
      v-for="item in items"
      :key="item.id"
    >
      <div
        v-if="item.type === 'separator'"
        class="app-menu__separator"
        role="separator"
      />

      <div
        v-else-if="item.type === 'info'"
        class="app-menu__info"
        :class="{ 'app-menu__info--heading': !item.value && !item.description }"
      >
        <span
          v-if="item.leadingColor"
          class="app-menu__color-dot"
          :style="{ backgroundColor: item.leadingColor }"
          aria-hidden="true"
        />
        <span class="app-menu__copy">
          <span class="app-menu__label">{{ item.label }}</span>
          <span
            v-if="item.description"
            class="app-menu__description"
          > &bull; {{ item.description }}</span>
        </span>
        <span
          v-if="item.value"
          class="app-menu__value"
        >
          <template v-if="typeof item.value === 'string'">{{ item.value }}</template>
          <template v-else>
            <span class="app-menu__value-added">+{{ item.value.addedLines }}</span>{{ ' ' }}<span class="app-menu__value-removed">-{{ item.value.removedLines }}</span>
          </template>
        </span>
      </div>

      <div
        v-else-if="item.type === 'submenu'"
        class="app-menu__submenu"
      >
        <button
          class="app-menu__item app-menu__item--submenu"
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          :aria-expanded="!item.disabled && item.items.length > 0"
          :disabled="item.disabled || item.items.length === 0"
        >
          <CheckIcon
            v-if="item.checked"
            class="app-menu__icon app-menu__icon--check"
          />
          <component
            :is="item.icon"
            v-else-if="item.icon"
            class="app-menu__icon"
          />
          <span
            v-else
            class="app-menu__icon app-menu__icon--empty"
            aria-hidden="true"
          />
          <span class="app-menu__copy">
            <span class="app-menu__label">{{ item.label }}</span>
            <span
              v-if="item.description"
              class="app-menu__description"
            > &bull; {{ item.description }}</span>
          </span>
          <span
            v-if="item.value"
            class="app-menu__value"
          >
            <template v-if="typeof item.value === 'string'">{{ item.value }}</template>
            <template v-else>
              <span class="app-menu__value-added">+{{ item.value.addedLines }}</span>{{ ' ' }}<span class="app-menu__value-removed">-{{ item.value.removedLines }}</span>
            </template>
          </span>
          <ChevronRightIcon class="app-menu__chevron" />
        </button>

        <AppMenu
          v-if="!item.disabled && item.items.length > 0"
          class="app-menu__submenu-menu"
          :class="{ 'app-menu__submenu-menu--wide': item.submenuWidth === 'wide' }"
          :ariaLabel="item.label"
          :items="item.items"
          @select="$emit('select', $event)"
        />
      </div>

      <div
        v-else-if="item.type === 'action' && item.secondaryAction"
        class="app-menu__row"
      >
        <button
          class="app-menu__item"
          :class="{ 'app-menu__item--danger': item.danger }"
          type="button"
          role="menuitem"
          :disabled="item.disabled"
          @click="selectItem(item)"
        >
          <component
            :is="item.icon"
            v-if="item.icon"
            class="app-menu__icon"
          />
          <span
            v-else
            class="app-menu__icon app-menu__icon--empty"
            aria-hidden="true"
          />
          <span class="app-menu__copy">
            <span class="app-menu__label">{{ item.label }}</span>
          </span>
        </button>
        <span
          class="app-menu__row-divider"
          aria-hidden="true"
        />
        <button
          class="app-menu__secondary"
          type="button"
          role="menuitem"
          :aria-label="item.secondaryAction.label"
          :title="item.secondaryAction.label"
          :disabled="item.secondaryAction.disabled"
          @click="emit('select', item.secondaryAction.id)"
        >
          <component
            :is="item.secondaryAction.icon"
            class="app-menu__icon"
          />
        </button>
      </div>

      <button
        v-else
        class="app-menu__item"
        :class="{
          'app-menu__item--danger': item.type === 'action' && item.danger,
          'app-menu__item--selected': isSelected(item),
        }"
        type="button"
        :role="itemRole(item)"
        :aria-checked="itemChecked(item)"
        :disabled="item.disabled"
        @click="selectItem(item)"
      >
        <span
          v-if="item.type === 'action' && item.leadingColor"
          class="app-menu__color-dot"
          :style="{ backgroundColor: item.leadingColor }"
          aria-hidden="true"
        />
        <!-- A selected item shows its check where its icon would be. -->
        <CheckIcon
          v-else-if="showsCheck(item)"
          class="app-menu__icon app-menu__icon--check"
        />
        <component
          :is="item.icon"
          v-else-if="item.icon"
          class="app-menu__icon"
        />
        <img
          v-else-if="item.iconUrl"
          class="app-menu__icon app-menu__icon--image"
          :src="item.iconUrl"
          alt=""
        />
        <span
          v-else
          class="app-menu__icon app-menu__icon--empty"
          aria-hidden="true"
        />
        <span class="app-menu__copy">
          <span class="app-menu__label">{{ item.label }}</span>
          <span
            v-if="item.description"
            class="app-menu__description"
          > &bull; {{ item.description }}</span>
        </span>
        <span
          v-if="item.value"
          class="app-menu__value"
        >
          <template v-if="typeof item.value === 'string'">{{ item.value }}</template>
          <template v-else>
            <span class="app-menu__value-added">+{{ item.value.addedLines }}</span>{{ ' ' }}<span class="app-menu__value-removed">-{{ item.value.removedLines }}</span>
          </template>
        </span>
        <el-switch
          v-if="item.type === 'checkbox' && item.accessory === 'switch'"
          :model-value="item.checked"
          size="small"
          @click.stop
          @change="$emit('select', item.id)"
        />
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { CheckIcon, ChevronRightIcon } from '../icons/app-icons';
import type { AppMenuCheckboxItem, AppMenuItem, AppMenuRadioItem } from './app-menu';

defineOptions({
  name: 'AppMenu',
});

defineProps<{
  ariaLabel: string;
  items: AppMenuItem[];
}>();

const emit = defineEmits<{
  select: [itemId: string];
}>();

function selectItem(item: Exclude<AppMenuItem, { type: 'separator' | 'submenu' }>): void {
  if (!item.disabled) {
    emit('select', item.id);
  }
}

function itemRole(item: Exclude<AppMenuItem, { type: 'separator' | 'submenu' }>): 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' {
  if (item.type === 'checkbox') {
    return 'menuitemcheckbox';
  }
  if (item.type === 'radio') {
    return 'menuitemradio';
  }
  return 'menuitem';
}

function itemChecked(item: Exclude<AppMenuItem, { type: 'separator' | 'submenu' }>): boolean | undefined {
  return item.type === 'checkbox' || item.type === 'radio' ? item.checked : undefined;
}

function isSelected(item: Exclude<AppMenuItem, { type: 'separator' | 'submenu' }>): item is AppMenuCheckboxItem | AppMenuRadioItem {
  return (item.type === 'checkbox' || item.type === 'radio') && item.checked;
}

function showsCheck(item: Exclude<AppMenuItem, { type: 'separator' | 'submenu' }>): boolean {
  return isSelected(item) && !(item.type === 'checkbox' && item.accessory === 'switch');
}
</script>

<style scoped>
.app-menu {
  display: flex;
  flex-direction: column;
  min-width: 188px;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-menu-background);
  box-shadow: var(--shadow-menu);
  font-size: var(--font-size-13);
}

.app-menu--embedded {
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.app-menu__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 28px;
  margin-block: 0.125px;
  padding: var(--space-2) var(--space-4);
  border: 0;
  border-radius: var(--radius-xl);
  color: var(--color-text);
  background: transparent;
  font-size: var(--font-size-13-5);
  text-align: left;
  cursor: pointer;
}

.app-menu__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.app-menu__row .app-menu__item {
  flex: 1 1 auto;
  min-width: 0;
}

.app-menu__row-divider {
  flex: 0 0 auto;
  align-self: stretch;
  width: 1px;
  margin-block: var(--space-2);
  background: var(--color-border);
}

.app-menu__secondary {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-lg);
  color: var(--color-text);
  background: transparent;
  cursor: pointer;
}

.app-menu__secondary:hover:not(:disabled),
.app-menu__secondary:focus-visible {
  background: var(--color-surface-low);
}

.app-menu__secondary:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.app-menu__info {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 26px;
  padding: var(--space-2) var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-13-5);
}

.app-menu__info--heading {
  padding-top: var(--space-3);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.02em;
}

.app-menu__item:hover:not(:disabled),
.app-menu__item:focus-visible {
  background: var(--color-surface-low);
}

.app-menu__item:disabled {
  color: var(--color-text-muted);
  cursor: not-allowed;
  opacity: 0.58;
}

.app-menu__item--danger:not(:disabled) {
  color: var(--color-error);
}

.app-menu__item:has(.el-switch) {
  padding-top: var(--space-1);
  padding-bottom: var(--space-1);
}

.app-menu__item--submenu {
  padding-right: var(--space-2);
}

.app-menu__icon,
.app-menu__chevron {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
  stroke-width: 2.5px;
}

.app-menu__icon {
  opacity: 0.5;
  stroke-width: 2px;
}

.app-menu__item--selected .app-menu__icon {
  opacity: 1;
  stroke-width: 2.5px;
}

.app-menu__icon--check {
  opacity: 1;
  stroke-width: 2.5px;
}

.app-menu__icon--empty {
  visibility: hidden;
}

.app-menu__icon--image {
  border-radius: var(--radius-sm);
  object-fit: contain;
  opacity: 1;
}

.app-menu__chevron {
  color: var(--color-text-muted);
}

.app-menu__color-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: var(--radius-full);
}

.app-menu__copy {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
}

.app-menu__label {
  font-weight: var(--font-weight-regular);
}

.app-menu__description,
.app-menu__value {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.app-menu__value {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-menu__info .app-menu__value {
  flex: 0 0 auto;
  max-width: none;
  font-size: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.app-menu__value-added,
.app-menu__value-removed {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-12);
  line-height: var(--line-height-16);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.app-menu__value-added {
  color: var(--color-success);
}

.app-menu__value-removed {
  color: var(--color-error);
}

.app-menu__separator {
  height: 1px;
  margin: var(--space-2) var(--space-1);
  background: var(--color-border);
}

.app-menu__submenu {
  position: relative;
}

.app-menu__submenu::after {
  content: "";
  position: absolute;
  top: 0;
  right: calc(-1 * var(--space-4));
  width: var(--space-4);
  height: 100%;
}

.app-menu__submenu-menu {
  position: absolute;
  z-index: 1;
  top: 0;
  left: 100%;
  min-width: 188px;
}

.app-menu__submenu-menu--wide {
  width: 360px;
  max-width: min(360px, calc(100vw - var(--space-12)));
}

.app-menu__submenu:not(:hover):not(:focus-within) > .app-menu__submenu-menu {
  display: none;
}
</style>
