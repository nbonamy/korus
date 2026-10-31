<template>
  <div class="design-interaction">
    <FormField density="compact" :label="t('design.onClick')">
      <select :value="modelValue?.type ?? ''" :aria-label="t('design.onClick')" @change="changeType(($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('design.noInteraction') }}</option>
        <option v-for="action in actions" :key="action" :value="action">{{ t(`design.action_${action}`) }}</option>
      </select>
    </FormField>
    <FormField v-if="modelValue && modelValue.type !== 'back'" density="compact" :label="t('design.interactionTarget')">
      <select :value="target" :aria-label="t('design.interactionTarget')" @change="changeTarget(($event.target as HTMLSelectElement).value)">
        <option v-for="item in targets" :key="item.id" :value="item.id">{{ item.label }}</option>
      </select>
    </FormField>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DesignArtboard, DesignInteraction, DesignNode } from '@workspace/core/design';
import FormField from '../shared/form/FormField.vue';
import { translate as t } from '../i18n';
const props = defineProps<{ modelValue: DesignInteraction | null; artboards: DesignArtboard[]; nodes: DesignNode[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: DesignInteraction | null] }>();
const actions = ['navigate', 'back', 'toggle', 'show', 'hide', 'scroll'] as const;
const targets = computed(() => props.modelValue?.type === 'navigate'
  ? props.artboards.map(board => ({ id: board.id, label: board.title }))
  : props.nodes.map(node => ({ id: node.id, label: `${node.tag} · ${node.text?.slice(0, 35) || node.id}` })));
const target = computed(() => props.modelValue && ('artboardId' in props.modelValue ? props.modelValue.artboardId : 'nodeId' in props.modelValue ? props.modelValue.nodeId : ''));
function changeType(type: string) {
  if (!type) emit('update:modelValue', null);
  else if (type === 'back') emit('update:modelValue', { type });
  else if (type === 'navigate') emit('update:modelValue', { type, artboardId: props.artboards[0].id });
  else if (type === 'toggle' || type === 'show' || type === 'hide' || type === 'scroll') emit('update:modelValue', { type, nodeId: props.nodes[0].id });
}
function changeTarget(id: string) {
  const action = props.modelValue;
  if (action?.type === 'navigate') emit('update:modelValue', { ...action, artboardId: id });
  else if (action && 'nodeId' in action) emit('update:modelValue', { ...action, nodeId: id });
}
</script>

<style scoped>
.design-interaction {
  display: grid;
  gap: var(--space-2);
}
.design-interaction select {
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
