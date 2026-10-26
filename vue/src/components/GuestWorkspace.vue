<template>
  <main class="guest-workspace">
    <aside class="guest-workspace__sidebar" :aria-label="t('guest.sharedWithMe')">
      <header class="guest-workspace__appbar">
        <button class="app-button app-button--tertiary" type="button" @click="emit('local')">{{ t('guest.localWorkspace') }}</button>
      </header>
      <h2>{{ t('guest.sharedWithMe') }}</h2>
      <nav :aria-label="t('guest.sharedWithMe')">
        <button v-for="entry in state.entries" :key="entry.id" class="guest-workspace__entry" type="button" :aria-current="state.view?.id === entry.id ? 'page' : undefined" @click="emit('control', { action: 'open', id: entry.id })">
          <span>{{ entry.title }}</span><small>{{ entry.name }}</small>
        </button>
      </nav>
      <p v-if="!state.entries.length">{{ t('guest.empty') }}</p>
    </aside>
    <section class="guest-workspace__main">
      <header class="guest-workspace__appbar">
        <span>{{ state.view?.title || t('guest.sharedWithMe') }}</span>
        <button v-if="state.entries.some(entry => entry.id === state.view?.id)" type="button" class="app-button app-button--tertiary" :disabled="busy" @click="emit('control', { action: 'leave', id: state.view!.id })">{{ t('guest.leave') }}</button>
      </header>
      <p v-if="failed" class="guest-workspace__notice" role="alert">{{ t('guest.storageFailed') }} <button type="button" class="app-button app-button--tertiary" @click="emit('control', { action: 'state' })">{{ t('common.retry') }}</button></p>
      <template v-if="state.view">
        <form v-if="state.view.status === 'needsName'" class="guest-workspace__join" @submit.prevent="join">
          <h1>{{ t('guest.join') }}</h1>
          <p>{{ t('guest.nameDisclosure') }}</p>
          <FormField :label="t('guest.displayName')" label-for="guest-display-name">
            <el-input id="guest-display-name" ref="nameInput" v-model="name" autocomplete="nickname" :maxlength="80" :disabled="busy" />
          </FormField>
          <el-button type="primary" native-type="submit" class="app-button" :disabled="busy || !validName">{{ t('guest.join') }}</el-button>
        </form>
        <template v-else>
          <div class="guest-workspace__notice" role="status" :aria-live="state.view.status === 'ready' ? 'off' : 'polite'">
            <span>{{ t(`guest.status.${state.view.status}`) }}</span>
            <span v-if="state.view.participant">{{ state.view.participant.name }} · {{ state.view.participant.discriminator }}</span>
            <button v-if="['unavailable', 'busy'].includes(state.view.status)" class="app-button app-button--tertiary" type="button" :disabled="busy" @click="emit('control', { action: 'open', id: state.view!.id })">{{ t('common.retry') }}</button>
          </div>
          <GuestConversationTranscript v-if="state.view.frame" :view="state.view" :busy="busy" @older="emit('control', { action: 'history', id: state.view!.id })" />
        </template>
      </template>
      <div v-else class="guest-workspace__empty">{{ t('guest.openLink') }}</div>
    </section>
  </main>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GuestJoinState, GuestJoinControl } from '@workspace/core/guest-navigation';
import FormField from '../shared/form/FormField.vue';
import GuestConversationTranscript from './GuestConversationTranscript.vue';
const props = defineProps<{ state: GuestJoinState; busy: boolean; failed: boolean }>();
const emit = defineEmits<{ local: []; control: [input: GuestJoinControl] }>();
const { t } = useI18n(); const name = ref(''); const nameInput = ref<{ focus(): void } | null>(null);
const validName = computed(() => Boolean(name.value.trim()) && !/[\p{Cc}\p{Cf}]/u.test(name.value));
watch(() => [props.state.view?.id, props.state.view?.status], async () => {
  if (props.state.view?.status === 'needsName') { name.value = props.state.view.name; await nextTick(); nameInput.value?.focus(); }
}, { immediate: true });
function join() { if (validName.value && props.state.view) emit('control', { action: 'join', id: props.state.view.id, name: name.value.trim() }); }
</script>
<style scoped>
.guest-workspace {
  display: flex;
  height: 100%;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-shell-main);
}
.guest-workspace__sidebar {
  display: flex;
  flex-direction: column;
  flex: 0 0 240px;
  min-width: 0;
  overflow: auto;
  border-right: 1px solid var(--color-border);
  background: var(--color-shell-rail);
}
.guest-workspace__sidebar h2,
.guest-workspace__sidebar > p {
  margin: var(--space-12) var(--space-16);
  font-size: var(--font-size-13);
}
.guest-workspace__appbar {
  display: flex;
  flex: 0 0 var(--workbench-appbar-height);
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding: 0 var(--space-16);
  border-bottom: 1px solid var(--color-border);
  -webkit-app-region: drag;
}
.guest-workspace__appbar button {
  -webkit-app-region: no-drag;
  white-space: nowrap;
}
.guest-workspace__sidebar .guest-workspace__appbar button {
  padding-inline: var(--space-4);
}
:global([data-platform="macos"] .guest-workspace__sidebar .guest-workspace__appbar) {
  padding-left: 80px;
}
.guest-workspace__entry {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: var(--space-4);
  padding: var(--space-12) var(--space-16);
  border: 0;
  text-align: left;
  color: var(--color-text);
  background: transparent;
  cursor: pointer;
}
.guest-workspace__entry:hover,
.guest-workspace__entry[aria-current] {
  background: var(--color-surface-low);
}
.guest-workspace__entry small,
.guest-workspace__sidebar > p {
  color: var(--color-text-muted);
}
.guest-workspace__main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.guest-workspace__join {
  display: grid;
  gap: var(--space-16);
  width: min(400px, 100% - var(--space-32));
  margin: auto;
}
.guest-workspace__join h1,
.guest-workspace__join p {
  margin: 0;
}
.guest-workspace__notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding: var(--space-8) var(--space-16);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  border-bottom: 1px solid var(--color-border);
}
.guest-workspace__empty {
  margin: auto;
  padding: var(--space-24);
  color: var(--color-text-muted);
}
</style>
