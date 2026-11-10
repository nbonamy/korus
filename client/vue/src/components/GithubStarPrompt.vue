<template>
  <CodexComposerDrawer v-if="visible" class="github-star-prompt" :aria-label="t('githubStar.title')">
    <CodexComposerDrawerRow>
      <template #leading><IconStarFilled class="github-star-prompt__icon" aria-hidden="true" /></template>
      <span>{{ t('githubStar.notice', { product: product.name }) }}</span>
      <template #actions>
        <button class="app-button app-button--small app-button--tertiary github-star-prompt__button" type="button" @click="star">
          <span class="codex-text-shimmer github-star-prompt__label">{{ t('githubStar.action') }}</span>
        </button>
        <CodexIconButton :label="t('githubStar.dismiss')" @click="dismiss"><XIcon aria-hidden="true" /></CodexIconButton>
      </template>
    </CodexComposerDrawerRow>
  </CodexComposerDrawer>
</template>
<script setup lang="ts">
import { ComposerDrawer as CodexComposerDrawer, ComposerDrawerRow as CodexComposerDrawerRow, IconButton as CodexIconButton } from 'ai-app-sdk';
import { useI18n } from 'vue-i18n';
import { product } from '@workspace/core/product';
import { appPlatformActions } from '../platform-api';
import { useGithubStarPrompt } from '../github-star-prompt';
import { IconStarFilled } from '@tabler/icons-vue';
import { XIcon } from '../shared/icons/app-icons';

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
  color: var(--color-bookmark-saved);
}
.github-star-prompt__button {
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-light);
  line-height: var(--line-height-20);
}
.github-star-prompt__label {
  background-image: linear-gradient(
    110deg,
    var(--chart-1) 0%,
    var(--chart-5) 20%,
    var(--chart-2) 40%,
    var(--chart-4) 55%,
    var(--chart-3) 75%,
    var(--chart-1) 100%
  );
}
.github-star-prompt :deep(.chat-composer-drawer-row__text) {
  white-space: normal;
}
@media (prefers-reduced-motion: reduce) {
  .github-star-prompt__label {
    animation: none;
    background: none;
    color: var(--color-primary);
    -webkit-text-fill-color: currentcolor;
  }
}
</style>
