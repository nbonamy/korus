<template>
  <button class="app-button app-button--secondary" type="button" :aria-label="$t('runProfiles.title')" @click="open">{{ $t('runProfiles.run') }}</button>
  <FormDialog :model-value="visible" :title="$t('runProfiles.title')" :subtitle="`${hostLabel} · ${catalog?.worktree ?? agent.folder ?? ''}`" width="680px" @update:model-value="setVisible">
    <div class="run-profiles__body">
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading && !catalog" role="status">{{ $t('runProfiles.loading') }}</p>
    <template v-if="editor">
      <form id="run-profile-editor" @submit.prevent="save">
        <FormField :label="$t('runProfiles.name')" label-for="profile-name"><el-input id="profile-name" v-model="editor.name" /></FormField>
        <FormField :label="$t('runProfiles.command')" label-for="profile-command" :help="$t('runProfiles.credentialsHelp')"><el-input id="profile-command" v-model="editor.command" :placeholder="$t('runProfiles.commandExample')" /></FormField>
        <FormField :label="$t('runProfiles.directory')" label-for="profile-directory" :help="$t('runProfiles.directoryHelp')"><el-input id="profile-directory" v-model="editor.directory" placeholder="." /></FormField>
        <FormField :label="$t('runProfiles.previewUrl')" label-for="profile-preview"><el-input id="profile-preview" v-model="editor.previewUrl" :placeholder="$t('runProfiles.previewExample')" /></FormField>
      </form>
    </template>
    <template v-else-if="confirmation">
      <p>{{ $t('runProfiles.confirm', { name: confirmation.profile.name, host: hostLabel }) }}</p>
      <pre class="run-profiles__command">{{ confirmation.profile.command }}</pre>
      <p class="run-profiles__target">{{ confirmation.cwd }}</p>
    </template>
    <template v-else>
      <p v-if="catalog && !catalog.profiles.length">{{ $t('runProfiles.empty') }}</p>
      <ul class="run-profiles__list">
        <li v-for="profile in catalog?.profiles ?? []" :key="profile.id">
          <div class="run-profiles__identity"><strong>{{ profile.name }}</strong><code>{{ profile.command }}</code><span>{{ profile.directory }}</span></div>
          <div class="run-profiles__actions">
            <button class="app-button app-button--secondary" :disabled="busy || running(profile.id) || !catalog?.targets[profile.id]?.cwd" @click="review(profile)">{{ $t('runProfiles.runNamed', { name: profile.name }) }}</button>
            <button class="app-button app-button--tertiary" :disabled="busy" @click="edit(profile)">{{ $t('runProfiles.editNamed', { name: profile.name }) }}</button>
            <button class="app-button app-button--tertiary" :disabled="busy || running(profile.id)" @click="remove(profile.id)">{{ $t('runProfiles.deleteNamed', { name: profile.name }) }}</button>
            <button v-if="profile.previewUrl" class="app-button app-button--tertiary" :disabled="!previewAvailable" :title="previewAvailable ? profile.previewUrl : $t('runProfiles.previewUnavailable')" @click="preview(profile.previewUrl)">{{ $t('runProfiles.previewNamed', { name: profile.name }) }}</button>
          </div>
          <p v-if="catalog?.targets[profile.id]?.error" role="alert">{{ catalog.targets[profile.id].error }}</p>
        </li>
      </ul>
      <ul class="run-profiles__list" :aria-label="$t('runProfiles.runs')">
        <li v-for="run in catalog?.runs ?? []" :key="run.id">
          <div class="run-profiles__identity"><code>{{ run.command }}</code><span role="status">{{ $t(`runProfiles.states.${run.state}`) }}{{ run.exitCode !== undefined ? ` · ${$t('runProfiles.exit', { code: run.exitCode })}` : '' }}</span><span>{{ run.cwd }}</span></div>
          <div class="run-profiles__actions">
            <button class="app-button app-button--tertiary" :disabled="busy" @click="outputId = run.id">{{ $t('runProfiles.openOutput') }}</button>
            <button v-if="run.state === 'running'" class="app-button app-button--secondary" :disabled="busy" @click="stop(run.id)">{{ $t('runProfiles.stop') }}</button>
          </div>
          <p v-if="run.error" role="alert">{{ run.error }}</p>
          <template v-if="outputId === run.id"><p v-if="run.outputTruncated">{{ $t('runProfiles.truncated') }}</p><pre class="run-profiles__output" :aria-label="$t('runProfiles.output')">{{ run.output || $t('runProfiles.noOutput') }}</pre></template>
        </li>
      </ul>
    </template>
    </div>
    <template #footer>
      <button v-if="editor || confirmation" class="app-button app-button--tertiary" :disabled="busy" @click="editor = null; confirmation = null">{{ $t('common.cancel') }}</button>
      <button v-else class="app-button app-button--tertiary" @click="setVisible(false)">{{ $t('common.close') }}</button>
      <button v-if="editor" class="app-button app-button--primary" form="run-profile-editor" type="submit" :disabled="busy || !editor.name.trim() || !editor.command.trim()">{{ $t('runProfiles.save') }}</button>
      <button v-else-if="confirmation" class="app-button app-button--primary" :disabled="busy" @click="start">{{ $t('runProfiles.runCommand') }}</button>
      <button v-else class="app-button app-button--primary" :disabled="busy" @click="edit()">{{ $t('runProfiles.new') }}</button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { Agent } from '@workspace/core/contracts';
import type { RunProfile, RunProfileCatalog, RunProfileInput } from '@workspace/core/run-profiles';
import { appApi } from '../platform-api';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';

const props = defineProps<{ agent: Agent; hostLabel: string; previewAvailable: boolean }>();
const emit = defineEmits<{ preview: [url: string]; visibility: [visible: boolean] }>();
const visible = ref(false);
const catalog = ref<RunProfileCatalog | null>(null);
const editor = ref<RunProfileInput | null>(null);
const confirmation = ref<{ profile: RunProfile; cwd: string } | null>(null);
const outputId = ref<string | null>(null);
const error = ref('');
const busy = ref(false);
const loading = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let requestId = 0;

function api() { if (!appApi) throw new Error('Connection unavailable. Reconnect to the owning host.'); return appApi; }
function running(id: string) { return catalog.value?.runs.some(run => run.profileId === id && run.state === 'running'); }
function reset() { revision++; requestId++; clearTimeout(timer); catalog.value = null; editor.value = null; confirmation.value = null; outputId.value = null; error.value = ''; }
function setVisible(value: boolean) { visible.value = value; if (!value) reset(); }
async function open() { reset(); visible.value = true; await refresh(); }
async function refresh() {
  const current = revision;
  const request = ++requestId;
  const agentId = props.agent.id;
  loading.value = true;
  try {
    const result = await api().getRunProfiles(agentId);
    if (current === revision && request === requestId && visible.value) catalog.value = result;
  } catch (cause) { if (current === revision && request === requestId) error.value = (cause as Error).message; }
  finally {
    if (current === revision && request === requestId) {
      loading.value = false;
      clearTimeout(timer);
      if (visible.value) timer = setTimeout(() => void refresh(), 1000);
    }
  }
}
async function act(action: (agentId: string) => Promise<unknown>) {
  if (busy.value) return;
  const current = revision;
  busy.value = true;
  error.value = '';
  try { await action(props.agent.id); if (current === revision) await refresh(); }
  catch (cause) { if (current === revision) error.value = (cause as Error).message; }
  finally { busy.value = false; }
}
function edit(profile?: RunProfile) { editor.value = profile ? { ...profile } : { name: '', command: '', directory: '.', previewUrl: '' }; }
async function save() {
  if (!editor.value) return;
  const input = { ...editor.value, directory: editor.value.directory.trim() || '.' };
  if (!input.previewUrl?.trim()) delete input.previewUrl;
  const current = revision;
  await act(async id => { await api().saveRunProfile(id, input); if (current === revision) editor.value = null; });
}
async function remove(profileId: string) { await act(id => api().deleteRunProfile(id, profileId)); }
function review(profile: RunProfile) {
  const cwd = catalog.value?.targets[profile.id]?.cwd;
  if (cwd) confirmation.value = { profile: { ...profile }, cwd };
}
async function start() {
  if (!confirmation.value) return;
  const { profile, cwd } = confirmation.value;
  const current = revision;
  await act(async id => { const run = await api().startRunProfile(id, { profileId: profile.id, command: profile.command, cwd }); if (current === revision) { outputId.value = run.id; confirmation.value = null; } });
}
async function stop(runId: string) { await act(id => api().stopProfileRun(id, runId)); }
function preview(url: string) { if (props.previewAvailable) { setVisible(false); emit('preview', url); } }
watch(visible, value => emit('visibility', value));
watch(() => props.agent.id, () => { setVisible(false); });
onBeforeUnmount(() => { revision++; clearTimeout(timer); emit('visibility', false); });
</script>

<style scoped>
.run-profiles__body { max-height: 60vh; overflow: auto; }
.run-profiles__list { list-style: none; padding: 0; margin: 0; }
.run-profiles__list li { padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border); }
.run-profiles__identity { display: flex; flex-direction: column; gap: var(--space-1); overflow-wrap: anywhere; }
.run-profiles__identity span, .run-profiles__target { color: var(--color-text-muted); font-size: var(--font-size-12); }
.run-profiles__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.run-profiles__command, .run-profiles__output { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow: auto; font-family: var(--font-family-mono); }
</style>
