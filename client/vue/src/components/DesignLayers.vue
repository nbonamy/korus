<template>
  <details class="design-layers" open>
    <summary>{{ t('design.layers') }}</summary>
    <div class="design-layers__body" :inert="disabled">
      <el-tree :data="tree" node-key="id" :current-node-key="selectedId ?? undefined" default-expand-all highlight-current :expand-on-click-node="false" :aria-label="t('design.layers')" @node-click="select" />
      <div class="design-layers__actions">
        <AppMenuButton :items="items" :ariaLabel="t('design.elementActions')" :width="200" @select="action">
          <template #trigger="{ attrs }"><button v-bind="attrs" class="app-button app-button--secondary" type="button" :disabled="disabled">{{ t('design.elementActions') }}</button></template>
        </AppMenuButton>
        <el-select v-if="parent" :model-value="parent.id" :aria-label="t('design.parentLayer')" :disabled="disabled" @change="reparent">
          <el-option v-for="node in containers" :key="node.id" :value="node.id" :label="label(node)" />
        </el-select>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DesignArtboard, DesignEdit, DesignNode } from '@workspace/core/design';
import { translate as t } from '../i18n';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';

const props = defineProps<{ board: DesignArtboard; selectedId: string | null; disabled: boolean }>();
const emit = defineEmits<{ select: [id: string]; edit: [edits: DesignEdit[]] }>();
const flatten = (node: DesignNode): DesignNode[] => [node, ...(node.children ?? []).flatMap(flatten)];
const label = (node: DesignNode) => `${node.tag} · ${node.text?.slice(0, 35) || node.id}`;
type Layer = { id: string; label: string; children: Layer[] };
const layer = (node: DesignNode): Layer => ({ id: node.id, label: label(node), children: (node.children ?? []).map(layer) });
const tree = computed(() => [layer(props.board.root)]);
const nodes = computed(() => flatten(props.board.root));
const selected = computed(() => nodes.value.find(node => node.id === props.selectedId));
const parent = computed(() => nodes.value.find(node => node.children?.some(child => child.id === props.selectedId)));
const index = computed(() => parent.value?.children?.findIndex(node => node.id === props.selectedId) ?? -1);
const isContainer = (node: DesignNode) => node.text === undefined && !['img', 'input', 'br', 'hr'].includes(node.tag);
const containers = computed(() => {
  const descendants = new Set(selected.value ? flatten(selected.value).map(node => node.id) : []);
  return nodes.value.filter(node => !descendants.has(node.id) && isContainer(node));
});
const items = computed<AppMenuItem[]>(() => [
  { type: 'action', id: 'text', label: t('design.addText') },
  { type: 'action', id: 'container', label: t('design.addContainer') },
  { type: 'action', id: 'button', label: t('design.addButton') },
  { type: 'separator', id: 'element-structure' },
  { type: 'action', id: 'duplicate', label: t('design.duplicateElement'), disabled: !parent.value },
  { type: 'action', id: 'up', label: t('design.moveUp'), disabled: index.value <= 0 },
  { type: 'action', id: 'down', label: t('design.moveDown'), disabled: !parent.value || index.value >= (parent.value.children?.length ?? 0) - 1 },
  { type: 'action', id: 'remove', label: t('design.removeElement'), disabled: !parent.value },
]);
function select(node: Layer) { if (!props.disabled) emit('select', node.id); }
function reparent(parentId: string) {
  const target = nodes.value.find(node => node.id === parentId);
  if (target && selected.value && !props.disabled) emit('edit', [{ type: 'move', nodeId: selected.value.id, parentId, index: target.children?.length ?? 0 }]);
}
function action(id: string) {
  if (props.disabled) return;
  if (['text', 'container', 'button'].includes(id)) {
    const target = selected.value && isContainer(selected.value) ? selected.value : parent.value ?? props.board.root;
    const node: DesignNode = { id: `node-${crypto.randomUUID()}`, tag: id === 'container' ? 'div' : id === 'button' ? 'button' : 'p' };
    if (id === 'container') { node.children = []; node.styles = { padding: '16px', 'min-height': '48px' }; }
    else node.text = t(id === 'button' ? 'design.newButton' : 'design.newText');
    emit('edit', [{ type: 'insert', nodeId: target.id, node }]);
  } else if (selected.value && parent.value) {
    if (id === 'duplicate' || id === 'remove') emit('edit', [{ type: id, nodeId: selected.value.id }]);
    else if (id === 'up' || id === 'down') emit('edit', [{ type: 'move', nodeId: selected.value.id, parentId: parent.value.id, index: index.value + (id === 'up' ? -1 : 1) }]);
  }
}
</script>

<style scoped>
.design-layers summary {
  cursor: pointer;
  font-weight: 500;
  padding-block: var(--space-1);
}
.design-layers__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-2);
}
.design-layers .el-tree {
  max-height: 180px;
  overflow: auto;
  background: transparent;
  font-size: var(--font-size-12);
}
.design-layers__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.design-layers__actions .el-select {
  flex: 1;
  min-width: 0;
}
</style>
