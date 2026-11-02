<template>
    <el-tooltip v-if="target" :visible="Boolean(file)" :virtual-ref="target"
      virtual-triggering placement="top" :show-arrow="false" effect="light" :enterable="false"
      :popper-options="{ modifiers: [{ name: 'preventOverflow', options: { padding: 12 } }] }">
      <template #content>
        <div v-if="file" class="diff-treemap__tooltip">
          <strong>{{ file.fullPath }}</strong>
          <GitDiffLineStats :added-lines="file.addedLines" :removed-lines="file.removedLines" />
        </div>
      </template>
    </el-tooltip>
</template>

<script setup lang="ts">
import type { MapFile } from './diff-treemap-files';
import GitDiffLineStats from './GitDiffLineStats.vue';
defineProps<{ target?: HTMLElement; file?: MapFile }>();
</script>

<style scoped>
.diff-treemap__tooltip { display: grid; gap: var(--space-2); max-width: min(360px, calc(100vw - 48px)); font-family: var(--font-family-ui); font-size: var(--font-size-12); overflow-wrap: anywhere; }
</style>
