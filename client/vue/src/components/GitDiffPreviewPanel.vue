<template>
  <DiffPreviewPanel ref="preview" v-bind="paneProps" :overview="props.view === 'map'" :translate="translate" :exclude-lockfiles="preferences?.general().excludeLockfilesFromDiffs === true"
    @select="emit('update:view', 'diff')" @all-expanded-change="emit('allExpandedChange', $event)" @open-file="emit('openFile', $event)" @annotate="emit('annotate', $event)">
    <template #overview="{ files, select }"><GitDiffTreemap v-model:kinds="mapKinds" :files="files" @select="select" /></template>
  </DiffPreviewPanel>
</template>
<script setup lang="ts">
import { DiffPreviewPanel, type CodeAnnotationInput } from '@korus-dev/agent-ui-sdk';
import { translate } from '../i18n';
import { computed, nextTick, ref } from 'vue';
import { useGeneralPreferences } from '../general-preferences';
import type { FileKind } from '@workspace/core/file-kind';
import GitDiffTreemap from './GitDiffTreemap.vue';
const props = withDefaults(defineProps<{
  diff: string;
  view?: 'diff' | 'map';
  collapseAllSignal?: number;
  error?: string | null;
  expandAllSignal?: number;
  /** Limits the visible files without changing the loaded patch. */
  fileKindFilter?: FileKind | null;
  /** With a new `focusSequence`, opens only this group (once its files are loaded) and folds the others. */
  focusKind?: FileKind | null;
  focusSequence?: number;
  /** Lists files under code, tests, documentation and other headers instead of in diff order. */
  groupByKind?: boolean;
  /** Annotate from a line's plus button, or select code text. */
  annotatable?: boolean;
  openFileEnabled?: boolean;
  state?: 'idle' | 'loading' | 'error';
  wordWrap?: boolean;
}>(), {
  view: 'diff',
  collapseAllSignal: 0,
  error: null,
  expandAllSignal: 0,
  fileKindFilter: null,
  focusKind: null,
  focusSequence: 0,
  annotatable: false,
  groupByKind: false,
  openFileEnabled: false,
  state: 'idle',
  wordWrap: false,
});
const emit = defineEmits<{
  'update:view': [view: 'diff' | 'map'];
  allExpandedChange: [isAllExpanded: boolean];
  openFile: [filePath: string];
  annotate: [annotation: CodeAnnotationInput];
}>();

const preferences = useGeneralPreferences();
const paneProps = computed(() => { const { view: _view, ...rest } = props; return rest; });
const mapKinds = ref<FileKind[]>([]);
const preview = ref<InstanceType<typeof DiffPreviewPanel>>();
async function showFiles(...args: Parameters<InstanceType<typeof DiffPreviewPanel>['showFiles']>) { emit('update:view', 'diff'); await nextTick(); await preview.value?.showFiles(...args); }
defineExpose({ showFiles });
</script>
