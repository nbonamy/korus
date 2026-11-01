<template>
  <CodexComposerDrawer class="mission-document-request" :aria-label="t('missions.documentRequest')">
    <CodexComposerDrawerRow>
      <template #leading><FileTextIcon class="mission-document-request__icon" aria-hidden="true" /></template>
      <span :title="label">{{ label }}</span>
      <template #actions>
        <CodexIconButton :label="t('missions.openDocument')" @click="emit('open')"><CheckIcon aria-hidden="true" /></CodexIconButton>
        <CodexIconButton :label="t('missions.dismissDocumentRequest')" @click="emit('dismiss')"><X aria-hidden="true" /></CodexIconButton>
      </template>
    </CodexComposerDrawerRow>
  </CodexComposerDrawer>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CodexComposerDrawer, CodexComposerDrawerRow, CodexIconButton } from '@codex-app-sdk/vue';
import { CheckIcon, FileTextIcon, X } from '../shared/icons/app-icons';
import type { PendingMissionDocument } from './use-mission-documents';
const props = defineProps<{ request: PendingMissionDocument }>();
const emit = defineEmits<{ open: []; dismiss: [] }>();
const { t } = useI18n();
const label = computed(() => t('missions.documentOpenRequest', { document: props.request.title }));
</script>
<style scoped>
.mission-document-request__icon { width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto; }
</style>
