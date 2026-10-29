<template>
  <details class="design-layout">
    <summary>{{ t('design.layout') }}</summary>
    <div class="design-layout__fields">
      <FormField v-for="field in fields" :key="field.key" density="compact" :label="t(field.label)">
        <select :value="styles[field.key] ?? ''" :aria-label="t(field.label)" @change="change(field.key, $event)">
          <option value="">{{ t('design.inherit') }}</option>
          <option v-for="value in field.values" :key="value" :value="value">{{ value }}</option>
        </select>
      </FormField>
      <FormField v-for="field in dimensions" :key="field.key" density="compact" :label="t(field.label)">
        <input :value="styles[field.key] ?? ''" :aria-label="t(field.label)" @input="change(field.key, $event)" />
      </FormField>
    </div>
  </details>
</template>

<script setup lang="ts">
import { translate as t } from '../i18n';
import FormField from '../shared/form/FormField.vue';
const props = defineProps<{ styles: Record<string, string> }>();
const emit = defineEmits<{ change: [styles: Record<string, string>] }>();
const fields = [
  { key: 'display', label: 'design.display', values: ['block', 'flex', 'grid', 'inline-flex', 'inline-block', 'none'] },
  { key: 'flex-direction', label: 'design.direction', values: ['row', 'column', 'row-reverse', 'column-reverse'] },
  { key: 'justify-content', label: 'design.justify', values: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] },
  { key: 'align-items', label: 'design.align', values: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'] },
  { key: 'flex-wrap', label: 'design.wrap', values: ['nowrap', 'wrap', 'wrap-reverse'] },
  { key: 'position', label: 'design.position', values: ['static', 'relative', 'absolute', 'fixed', 'sticky'] },
];
const dimensions = [
  { key: 'grid-template-columns', label: 'design.columns' }, { key: 'flex', label: 'design.flex' },
  { key: 'left', label: 'design.left' }, { key: 'top', label: 'design.top' },
  { key: 'margin', label: 'design.margin' }, { key: 'border', label: 'design.border' },
];
function change(key: string, event: Event) { emit('change', { ...props.styles, [key]: (event.target as HTMLInputElement).value }); }
</script>

<style scoped>
.design-layout summary {
  cursor: pointer;
  font-weight: 500;
  padding-block: var(--space-1);
}
.design-layout__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  padding-top: var(--space-2);
}
.design-layout select,
.design-layout input {
  width: 100%;
  min-width: 0;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}
</style>
