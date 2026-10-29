<template>
  <div class="run-profiles-control">
    <AppMenuButton v-model:open="menuOpen" :ariaLabel="$t('runProfiles.title')" :items="menuItems" :width="300" max-height="60vh" @select="selectAction">
      <template #trigger="{ attrs }"><button v-bind="attrs" class="run-profiles-control__trigger" type="button" :aria-label="$t('runProfiles.title')" :title="$t('runProfiles.title')"><PlayerPlayIcon aria-hidden="true" /></button></template>
    </AppMenuButton>
  </div>
  <RunProfileImport v-if="managing" :agent-id="agent.id" :profiles="catalog?.profiles ?? []" :running-profile-ids="catalog?.runs.filter(run => run.state === 'running').map(run => run.profileId) ?? []" @change="adopt" @done="closeManager" />
  <FormDialog v-if="selection" :model-value="true" :title="selection.profile.name" :subtitle="`${hostLabel} · ${latestRun?.state === 'running' ? latestRun.cwd : selection.cwd ?? selection.profile.directory}`" width="600px" @update:model-value="closeRunner">
    <div class="command-runner">
      <code class="command-runner__command">{{ latestRun?.state === 'running' ? latestRun.command : selection.profile.command }}</code>
      <p v-if="error || targetError" class="command-runner__error" role="alert">{{ error || targetError }}</p>
      <template v-if="latestRun">
        <div class="command-runner__status" role="status"><span class="command-runner__dot" :class="{ 'command-runner__dot--running': latestRun.state === 'running' }" />{{ $t(`runProfiles.states.${latestRun.state}`) }}<span v-if="latestRun.exitCode !== undefined">{{ $t('runProfiles.exit', { code: latestRun.exitCode }) }}</span></div>
        <p v-if="latestRun.error" class="command-runner__error" role="alert">{{ latestRun.error }}</p>
        <p v-if="latestRun.outputTruncated" class="command-runner__notice">{{ $t('runProfiles.truncated') }}</p>
        <pre class="command-runner__output" :aria-label="$t('runProfiles.output')">{{ latestRun.output || $t('runProfiles.noOutput') }}</pre>
      </template>
      <p v-else class="command-runner__notice">{{ $t('runProfiles.readyToRun') }}</p>
    </div>
    <template #footer>
      <button class="app-button app-button--tertiary" @click="closeRunner">{{ $t('common.close') }}</button>
      <button v-if="selection.profile.previewUrl" class="app-button app-button--secondary" :disabled="!previewAvailable" :title="previewAvailable ? selection.profile.previewUrl : $t('runProfiles.previewUnavailable')" @click="preview(selection.profile.previewUrl)">{{ $t('runProfiles.preview') }}</button>
      <button v-if="latestRun?.state === 'running'" class="app-button app-button--primary" :disabled="busy" @click="stop(latestRun.id)">{{ $t('runProfiles.stop') }}</button>
      <button v-else class="app-button app-button--primary" :disabled="busy || !selection.cwd || Boolean(targetError)" @click="start"><PlayerPlayIcon :size="16" aria-hidden="true" />{{ $t('runProfiles.runCommand') }}</button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, ref, watch } from 'vue';
import type { Agent } from '@workspace/core/contracts';
import type { RunProfile, RunProfileCatalog } from '@workspace/core/run-profiles';
import { appApi } from '../platform-api';
import FormDialog from '../shared/dialog/FormDialog.vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { PlayerPlayIcon, SettingsIcon } from '../shared/icons/app-icons';
import { translate } from '../i18n';
import RunProfileImport from './RunProfileImport.vue';

const props = defineProps<{ agent: Agent; hostLabel: string; previewAvailable: boolean }>();
const emit = defineEmits<{ preview: [url: string]; visibility: [visible: boolean] }>();
const managing = ref(false);
const menuOpen = ref(false);
const catalog = ref<RunProfileCatalog | null>(null);
const selection = ref<{ profile: RunProfile; cwd?: string } | null>(null);
const error = ref('');
const busy = ref(false);
const loading = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let requestId = 0;
const visible = computed(() => managing.value || Boolean(selection.value));
const latestRun = computed(() => {
  const reviewed = selection.value;
  if (!reviewed) return undefined;
  const runs = catalog.value?.runs.filter(run => run.profileId === reviewed.profile.id) ?? [];
  return runs.filter(run => run.state === 'running').at(-1)
    ?? runs.filter(run => run.command === reviewed.profile.command && run.cwd === reviewed.cwd).at(-1);
});
const targetError = computed(() => selection.value ? catalog.value?.targets[selection.value.profile.id]?.error : undefined);
const menuItems = computed<AppMenuItem[]>(() => [
  ...(catalog.value?.profiles ?? []).map(profile => ({ type: 'action' as const, id: `run:${profile.id}`, label: profile.name, description: profile.command, value: catalog.value?.runs.some(run => run.profileId === profile.id && run.state === 'running') ? translate('runProfiles.states.running') : undefined, icon: markRaw(PlayerPlayIcon), disabled: busy.value })),
  ...(!catalog.value?.profiles.length ? [{ type: 'info' as const, id: 'empty', label: translate(loading.value ? 'runProfiles.loading' : 'runProfiles.nothingPinnedShort') }] : []),
  ...(error.value ? [{ type: 'info' as const, id: 'error', label: error.value }] : []),
  { type: 'separator', id: 'configure-separator' },
  { type: 'action', id: 'configure', label: translate('runProfiles.chooseCommandsMenu'), icon: SettingsIcon },
]);
function selectAction(id: string) {
  menuOpen.value = false;
  if (id === 'configure') { clearTimeout(timer); managing.value = true; return; }
  const profile = catalog.value?.profiles.find(profile => `run:${profile.id}` === id);
  if (profile) { error.value = ''; selection.value = { profile: { ...profile }, cwd: catalog.value?.targets[profile.id]?.cwd }; void refresh(); }
}
function api() { if (!appApi) throw new Error('Connection unavailable. Reconnect to the owning host.'); return appApi; }
function adopt(value: RunProfileCatalog) { requestId++; catalog.value = value; }
function closeManager() { managing.value = false; void refresh(); }
function closeRunner() { selection.value = null; error.value = ''; clearTimeout(timer); }
async function refresh() {
  const current = revision;
  const request = ++requestId;
  loading.value = true;
  try {
    const result = await api().getRunProfiles(props.agent.id);
    if (current === revision && request === requestId) catalog.value = result;
  } catch (cause) { if (current === revision && request === requestId) error.value = (cause as Error).message; }
  finally {
    if (current === revision && request === requestId) {
      loading.value = false; clearTimeout(timer);
      if (!managing.value && (selection.value || menuOpen.value)) timer = setTimeout(() => void refresh(), 1000);
    }
  }
}
async function act(action: (agentId: string) => Promise<unknown>) {
  if (busy.value) return;
  const current = revision; busy.value = true; error.value = '';
  try { await action(props.agent.id); if (current === revision) await refresh(); }
  catch (cause) { if (current === revision) error.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function start() {
  const reviewed = selection.value;
  if (!reviewed?.cwd) return;
  await act(id => api().startRunProfile(id, { profileId: reviewed.profile.id, command: reviewed.profile.command, cwd: reviewed.cwd! }));
}
async function stop(runId: string) { await act(id => api().stopProfileRun(id, runId)); }
function preview(url: string) { if (props.previewAvailable) { closeRunner(); emit('preview', url); } }
watch(visible, value => emit('visibility', value));
watch(menuOpen, value => { if (value) { error.value = ''; void refresh(); } else if (!visible.value) clearTimeout(timer); });
watch(() => props.agent.id, () => { revision++; requestId++; clearTimeout(timer); menuOpen.value = false; managing.value = false; selection.value = null; catalog.value = null; error.value = ''; });
onBeforeUnmount(() => { revision++; clearTimeout(timer); emit('visibility', false); });
</script>

<style scoped>
.run-profiles-control { display: inline-flex; -webkit-app-region: no-drag; }
.run-profiles-control__trigger { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); height: 32px; padding: 0 var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-lowest); color: var(--color-text-muted); cursor: pointer; -webkit-app-region: no-drag; }
.run-profiles-control__trigger:hover { background: var(--color-surface-low); color: var(--color-text); }
.run-profiles-control__trigger svg { width: var(--icon-md); height: var(--icon-md); }
.command-runner { display: grid; gap: var(--space-6); }
.command-runner__command { display: block; padding: var(--space-6); border-radius: var(--radius-md); background: var(--color-surface-low); font-family: var(--font-family-mono); font-size: var(--font-size-13); overflow-wrap: anywhere; }
.command-runner__status { display: flex; align-items: center; gap: var(--space-3); font-size: var(--font-size-12); }
.command-runner__status > span:last-child { color: var(--color-text-muted); }
.command-runner__dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--color-text-muted); }
.command-runner__dot--running { background: var(--color-success); }
.command-runner__output { min-height: 160px; max-height: 320px; margin: 0; padding: var(--space-6); overflow: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-lowest); color: var(--color-text); font-family: var(--font-family-mono); font-size: var(--font-size-12); white-space: pre-wrap; overflow-wrap: anywhere; }
.command-runner__notice { margin: 0; color: var(--color-text-muted); font-size: var(--font-size-12); }
.command-runner__error { margin: 0; color: var(--color-error); font-size: var(--font-size-12); }
</style>
