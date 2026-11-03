<template>
  <div class="design-layers" :inert="disabled">
    <el-tree :data="tree" node-key="id" :current-node-key="selectedId ?? undefined" :default-expanded-keys="[board.root.id]" :indent="14" highlight-current :expand-on-click-node="false" :aria-label="t('design.layers')" @node-click="select">
      <template #default="{ data }">
        <span class="design-layers__node" :title="data.tooltip">
          <component :is="icons[data.kind as LayerKind]" class="design-layers__icon" stroke="1.5" aria-hidden="true" />
          <span class="design-layers__name">{{ data.name }}</span>
          <span v-if="data.preview" class="design-layers__preview">{{ data.preview }}</span>
        </span>
      </template>
    </el-tree>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DesignArtboard, DesignNode } from '@workspace/core/design';
import { translate as t } from '../i18n';
import { ArrowsHorizontalIcon, ArrowsVerticalIcon, HeadingIcon, LinkIcon, PhotoIcon, RectangleIcon, TextIcon } from '../shared/icons/app-icons';

const props = defineProps<{ board: DesignArtboard; selectedId: string | null; disabled: boolean }>();
const emit = defineEmits<{ select: [id: string] }>();
const icons = { group: RectangleIcon, heading: HeadingIcon, text: TextIcon, button: RectangleIcon, image: PhotoIcon, input: TextIcon, link: LinkIcon, row: ArrowsHorizontalIcon, column: ArrowsVerticalIcon };
type LayerKind = keyof typeof icons;
type Layer = { id: string; label: string; name: string; preview: string; tooltip: string; kind: LayerKind; children: Layer[] };
function kind(node: DesignNode): LayerKind {
  if (/^h[1-6]$/.test(node.tag)) return 'heading';
  if (node.tag === 'img' || node.tag === 'svg') return 'image';
  if (node.tag === 'button') return 'button';
  if (node.tag === 'a') return 'link';
  if (['input', 'textarea', 'select'].includes(node.tag)) return 'input';
  if (node.text !== undefined) return 'text';
  if (['flex', 'inline-flex'].includes(node.styles?.display ?? '')) return node.styles?.['flex-direction']?.startsWith('column') ? 'column' : 'row';
  return 'group';
}
function layer(node: DesignNode): Layer {
  const type = kind(node);
  const name = node.id === props.board.root.id ? props.board.title : t(`design.layer_${type}`);
  const preview = (node.text ?? node.attributes?.['aria-label'] ?? node.attributes?.alt ?? '').replace(/\s+/g, ' ').trim();
  return { id: node.id, label: `${name}${preview ? ` ${preview}` : ''}`, name, preview, tooltip: `${node.tag} · ${node.id}${preview ? ` — ${preview}` : ''}`, kind: type, children: (node.children ?? []).map(layer) };
}
const tree = computed(() => [layer(props.board.root)]);
function select(node: Layer) { if (!props.disabled) emit('select', node.id); }
</script>

<style scoped>
.design-layers :deep(.el-tree) {
  max-height: 240px;
  overflow: auto;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  --el-tree-node-hover-bg-color: var(--color-surface-low);
}
.design-layers :deep(.el-tree-node__content) { height: 28px; border-radius: var(--radius-md); }
.design-layers :deep(.el-tree-node__expand-icon) { padding: var(--space-2); color: var(--color-text-muted); font-size: var(--font-size-12); }
.design-layers :deep(.el-tree-node__expand-icon.is-leaf) { color: transparent; }
.design-layers :deep(.el-tree-node.is-current > .el-tree-node__content) { background: var(--color-surface-high); color: var(--color-text); }
.design-layers__node { display: flex; align-items: center; gap: var(--space-3); min-width: 0; flex: 1; padding-right: var(--space-4); overflow: hidden; }
.design-layers__icon { flex: none; width: var(--icon-sm); height: var(--icon-sm); color: var(--color-text-muted); opacity: .75; }
.design-layers__name { flex: none; font-weight: var(--font-weight-regular); }
.design-layers__preview { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-muted); opacity: .75; }
</style>
