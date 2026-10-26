<template>
  <CodexComposerDrawer v-if="proposals.length" class="conversation-share-activity" :aria-label="t('guest.suggestions')">
    <CodexComposerDrawerRow v-for="proposal in proposals" :key="proposal.id">
      <template #leading>
        <ShareIcon class="conversation-share-activity__icon" aria-hidden="true" />
        <strong v-if="owner" class="conversation-share-activity__author" :title="proposal.name">{{ proposal.name }}</strong>
      </template>
      <span :title="proposal.text">{{ proposal.text }}</span>
      <template #actions>
        <span v-if="proposal.status !== 'pending'" class="conversation-share-activity__status" role="status">{{ t(`guest.${proposal.status}`) }}</span>
        <template v-else>
          <CodexIconButton v-if="owner" :label="t('guest.moveSuggestion')" :disabled="disabled || editDisabled" @click="emit('edit', proposal)"><PencilIcon aria-hidden="true" /></CodexIconButton>
          <CodexIconButton :label="t('guest.deleteSuggestion')" :disabled="disabled" @click="emit('delete', proposal.id)"><Trash2Icon aria-hidden="true" /></CodexIconButton>
        </template>
      </template>
    </CodexComposerDrawerRow>
    <p v-if="failed" role="alert">{{ t('sharing.failed') }}</p>
  </CodexComposerDrawer>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { CodexComposerDrawer, CodexComposerDrawerRow, CodexIconButton } from '@codex-app-sdk/vue';
import type { GuestProposal } from '@workspace/core/conversation-sharing';
import { PencilIcon, ShareIcon, Trash2Icon } from '../shared/icons/app-icons';
defineProps<{ proposals: readonly GuestProposal[]; owner?: boolean; disabled?: boolean; editDisabled?: boolean; failed?: boolean }>();
const emit = defineEmits<{ edit: [proposal: GuestProposal]; delete: [proposalId: string] }>();
const { t } = useI18n();
</script>
<style scoped>
.conversation-share-activity { max-height: 28vh; overflow-y: auto; }
.conversation-share-activity__icon { flex: 0 0 auto; width: var(--icon-sm); height: var(--icon-sm); }
.conversation-share-activity__author { min-width: 0; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: inherit; font-weight: var(--font-weight-semibold); }
.conversation-share-activity__status { font-size: var(--font-size-12); }
</style>
