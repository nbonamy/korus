<template>
  <section
    class="agent-empty-state"
    :aria-label="t('sidebar.noAgents')"
  >

    <div class="agent-empty-state__drag">
    </div>

    <div class="agent-empty-state__mark">
      <img
        :src="appIconUrl"
        :alt="$t('surface.agentEmptyState.app')"
      >
    </div>

    <div class="agent-empty-state__copy">
      <h1>{{ t('sidebar.welcome') }}</h1>
      <p>{{ t('sidebar.welcomeDetail') }}</p>
    </div>

    <div class="agent-empty-state__actions">
      <AppMenu
        class="app-menu--embedded"
        :ariaLabel="t('startWork.addProjectFrom')"
        :items="menuItems"
        @select="select"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppMenu from '../shared/menu/AppMenu.vue';
import { isStartWorkAction, startWorkMenuItems, type StartWorkAction } from './start-work-actions';

const appIconUrl = new URL('../../assets/icon.png', import.meta.url).href;
const { t } = useI18n();
const menuItems = computed(() => startWorkMenuItems(t));

const emit = defineEmits<{
  'start-work': [action: StartWorkAction];
}>();

function select(action: string): void {
  if (isStartWorkAction(action)) emit('start-work', action);
}
</script>

<style scoped>
.agent-empty-state {
  width: 100%;
  height: 100%;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: var(--space-16);
  padding: var(--space-16);
  color: var(--color-text);
  background: var(--color-background);
}

.agent-empty-state__drag {
  position: absolute;
  top: 0;
  width: 100%;
  height: var(--space-16);
  -webkit-app-region: drag;
}

.agent-empty-state__mark {
  width: 112px;
  height: 112px;
  display: grid;
  place-items: center;
  color: var(--color-text);
  overflow: hidden;
}

.agent-empty-state__mark img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.agent-empty-state__copy {
  display: grid;
  gap: var(--space-2);
  text-align: center;
}

.agent-empty-state__copy h1,
.agent-empty-state__copy p {
  margin: 0;
}

.agent-empty-state__copy h1 {
  font-size: var(--font-size-24);
  font-weight: var(--font-weight-bold);
  line-height: var(--line-height-32);
}

.agent-empty-state__copy p {
  color: var(--color-text-muted);
  font-size: var(--font-size-20);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-28);
}

.agent-empty-state__actions {
  width: min(360px, 100%);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-sm);
}

.agent-empty-state__actions :deep(.app-menu__item) {
  min-height: 42px;
  padding-inline: var(--space-6);
  border-radius: var(--radius-lg);
}
</style>
