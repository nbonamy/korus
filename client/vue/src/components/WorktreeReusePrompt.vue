<template>
  <section class="worktree-reuse-prompt" role="status">
    <IconGitBranch aria-hidden="true" />
    <div>
      <strong>{{ t('worktreeReuse.title') }}</strong>
      <p>{{ t('worktreeReuse.detail', { branch }) }}</p>
      <code>{{ path }}</code>
      <p>{{ t('worktreeReuse.question') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { IconGitBranch } from '@tabler/icons-vue';
import { useI18n } from 'vue-i18n';

defineProps<{
  branch: string;
  path: string;
}>();

const { t } = useI18n();
</script>

<style scoped>
.worktree-reuse-prompt {
  display: grid;
  grid-template-columns: var(--icon-lg) minmax(0, 1fr);
  align-items: start;
  gap: var(--space-6);
  padding: var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text);
  background: var(--color-surface-lowest);
}

.worktree-reuse-prompt > svg {
  width: var(--icon-lg);
  height: var(--icon-lg);
  color: var(--color-primary);
}

.worktree-reuse-prompt div {
  min-width: 0;
  display: grid;
  gap: var(--space-3);
}

.worktree-reuse-prompt strong {
  font-size: var(--font-size-13);
}

.worktree-reuse-prompt p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  line-height: 1.4;
}

.worktree-reuse-prompt code {
  overflow-wrap: anywhere;
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-11);
}
</style>
