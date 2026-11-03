<template>
  <FormSection class="design-layout" density="compact" :title="t('design.layout')">
    <div class="design-layout__fields">
      <FormRow v-for="field in fields" :key="field.key" as="label" :title="t(field.label)">
        <template #control>
        <select :value="styles[field.key] ?? ''" :aria-label="t(field.label)" @change="change(field.key, $event)">
          <option value="">{{ t('design.inherit') }}</option>
          <option v-for="value in field.values" :key="value" :value="value">{{ value }}</option>
        </select>
        </template>
      </FormRow>
      <FormRow v-for="field in dimensions" :key="field.key" as="label" :title="t(field.label)">
        <template #control>
        <input :value="styles[field.key] ?? ''" :aria-label="t(field.label)" @input="change(field.key, $event)" />
        </template>
      </FormRow>
    </div>
  </FormSection>
</template>

<script setup lang="ts">
import { translate as t } from '../i18n';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';
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
  { key: 'padding', label: 'design.padding' }, { key: 'gap', label: 'design.gap' },
  { key: 'grid-template-columns', label: 'design.columns' }, { key: 'flex', label: 'design.flex' },
  { key: 'left', label: 'design.left' }, { key: 'top', label: 'design.top' },
  { key: 'margin', label: 'design.margin' }, { key: 'border', label: 'design.border' },
];
function change(key: string, event: Event) { emit('change', { ...props.styles, [key]: (event.target as HTMLInputElement).value }); }
</script>

<style scoped>
.design-layout__fields {
  display: flex;
  flex-direction: column;
}
.design-layout select,
.design-layout input {
  width: 100%;
  min-width: 0;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-lowest);
  color: var(--color-text);
  font: inherit;
}
</style>
