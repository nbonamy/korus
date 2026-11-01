<template>
  <section
    class="app-data-list"
    :aria-label="ariaLabel ?? title"
  >
    <header
      v-if="title || $slots.headerActions"
      class="app-data-list__header"
    >
      <div
        v-if="title"
        class="app-data-list__heading"
      >
        <h3>{{ title }}</h3>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <div
        v-if="$slots.headerActions"
        class="app-data-list__header-actions"
      >
        <slot name="headerActions" />
      </div>
    </header>

    <div
      class="app-data-list__grid"
      :style="gridStyle"
    >
      <div
        v-if="showColumnHeader"
        class="app-data-list__columns"
        role="row"
      >
        <div
          v-for="column in columns"
          :key="column.id"
          class="app-data-list__column-heading"
          :data-align="column.align ?? 'start'"
          role="columnheader"
        >
          {{ column.label }}
        </div>
        <div
          v-if="$slots.actions"
          class="app-data-list__column-heading app-data-list__column-heading--actions"
          role="columnheader"
          :aria-label="$t('surface.appDataList.actions')"
        />
      </div>

      <div
        v-if="rows.length === 0"
        class="app-data-list__empty"
      >
        <slot name="empty">
          {{ emptyText }}
        </slot>
      </div>

      <div
        v-else
        class="app-data-list__rows"
        role="rowgroup"
      >
        <article
          v-for="row in rows"
          :key="row.id"
          class="app-data-list__row"
          role="row"
        >
          <div
            v-for="column in columns"
            :key="column.id"
            class="app-data-list__cell"
            :data-align="column.align ?? 'start'"
            role="cell"
          >
            <slot
              :name="`cell-${column.id}`"
              :column="column"
              :row="row"
              :value="row[column.id]"
            >
              {{ row[column.id] }}
            </slot>
          </div>
          <div
            v-if="$slots.actions"
            class="app-data-list__actions"
            role="cell"
          >
            <slot
              name="actions"
              :row="row"
            />
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed, useSlots } from 'vue';
import type { CSSProperties } from 'vue';
import type { AppDataListColumn, AppDataListRow } from './app-data-list';

const props = withDefaults(defineProps<{
  ariaLabel?: string;
  columns: AppDataListColumn[];
  emptyText?: string;
  rows: AppDataListRow[];
  showColumnHeader?: boolean;
  subtitle?: string;
  title?: string;
}>(), {
  ariaLabel: undefined,
  emptyText: translate('dynamic.misc.noItems'),
  showColumnHeader: false,
  subtitle: undefined,
  title: undefined,
});

const slots = useSlots();
const gridStyle = computed<CSSProperties>(() => ({
  '--app-data-list-row-columns': [
    ...props.columns.map((column) => column.width ?? 'minmax(0, 1fr)'),
    ...(slots.actions ? ['max-content'] : []),
  ].join(' '),
}));
</script>

<style scoped>
.app-data-list {
  --app-data-list-row-columns: minmax(0, 1fr);

  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

.app-data-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
  padding-bottom: var(--space-12);
  border-bottom: 1px solid var(--color-border);
}

.app-data-list__heading {
  min-width: 0;
}

.app-data-list__header h3,
.app-data-list__header p {
  margin: 0;
}

.app-data-list__header h3 {
  color: var(--color-text);
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-24);
}

.app-data-list__header p {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.app-data-list__header-actions {
  flex: 0 0 auto;
}

.app-data-list__grid,
.app-data-list__rows {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.app-data-list__columns,
.app-data-list__row {
  display: grid;
  grid-template-columns: var(--app-data-list-row-columns);
}

.app-data-list__columns {
  align-items: center;
  gap: var(--space-16);
  padding: 0 var(--space-12) var(--space-8);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-18);
}

.app-data-list__row {
  min-height: 48px;
  align-items: center;
  gap: var(--space-16);
  padding: var(--space-6) var(--space-10);
  border-radius: var(--radius-2xl);
}

.app-data-list__row:hover,
.app-data-list__row:focus-within {
  background: var(--color-surface);
}

.app-data-list__cell {
  min-width: 0;
}

.app-data-list__cell[data-align="end"],
.app-data-list__column-heading[data-align="end"] {
  text-align: right;
}

.app-data-list__actions {
  min-width: max-content;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.app-data-list__row:hover .app-data-list__actions,
.app-data-list__row:focus-within .app-data-list__actions {
  opacity: 1;
  pointer-events: auto;
}

.app-data-list__empty {
  padding: var(--space-12) 0;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}
</style>
