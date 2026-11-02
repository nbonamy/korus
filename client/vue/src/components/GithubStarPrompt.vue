<template>
  <CodexComposerDrawer v-if="visible" class="github-star-prompt" :aria-label="t('githubStar.title')">
    <CodexComposerDrawerRow>
      <template #leading><GitHubIcon class="github-star-prompt__icon" aria-hidden="true" /></template>
      <span>{{ t('githubStar.notice', { product: product.name }) }}</span>
      <template #actions>
        <button class="app-button app-button--small app-button--secondary" type="button" @click="star">{{ t('githubStar.action') }}</button>
        <CodexIconButton :label="t('githubStar.dismiss')" @click="dismiss"><XIcon aria-hidden="true" /></CodexIconButton>
      </template>
    </CodexComposerDrawerRow>
  </CodexComposerDrawer>
</template>
<script setup lang="ts">
import { CodexComposerDrawer, CodexComposerDrawerRow, CodexIconButton } from '@codex-app-sdk/vue';
import { useI18n } from 'vue-i18n';
import { product } from '@workspace/core/product';
import { appPlatformActions } from '../platform-api';
import { useGithubStarPrompt } from '../github-star-prompt';
import { GitHubIcon, XIcon } from '../shared/icons/app-icons';

const { t } = useI18n();
const { visible, dismiss } = useGithubStarPrompt();
function star(): void {
  appPlatformActions.openExternal?.(product.repositoryUrl);
  dismiss();
}
</script>
<style scoped>
.github-star-prompt__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.github-star-prompt :deep(.chat-composer-drawer-row__text) {
  white-space: normal;
}
</style>
