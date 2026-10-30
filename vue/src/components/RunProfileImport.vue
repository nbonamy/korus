<template>
  <FormDialog :model-value="true" :title="$t('runProfiles.chooseCommands')" width="min(960px, calc(100vw - 40px))" @update:model-value="!saving && emit('done')">
    <div class="command-picker">
      <p v-if="error" class="command-picker__error" role="alert">{{ error }}</p>
      <p v-for="warning in result?.warnings ?? []" :key="warning" class="command-picker__error" role="alert">{{ warning }}</p>
      <div class="command-picker__columns">
        <section class="command-picker__panel">
          <div v-if="!editor" class="command-picker__toolbar">
            <el-select v-model="source" class="command-picker__source" :aria-label="$t('runProfiles.sourceFiles')">
              <el-option :value="ALL_FILES" :label="$t('runProfiles.allFiles')" />
              <el-option v-for="file in sources" :key="file" :value="file" :label="file.split('/').at(-1)" />
            </el-select>
            <ClearableTextInput v-model="query" class="command-picker__search" :aria-label="$t('runProfiles.searchCommands')" :placeholder="$t('runProfiles.searchCommandsPlaceholder')" autofocus />
          </div>
          <header v-else class="command-picker__heading"><h3>{{ $t('runProfiles.customCommand') }}</h3></header>
          <template v-if="!editor">
            <div class="command-picker__scroll" :aria-label="$t('runProfiles.availableCommands')">
              <p v-if="loading" class="command-picker__empty" role="status">{{ $t('runProfiles.scanning') }}</p>
              <p v-else-if="!available.length" class="command-picker__empty">{{ $t(query ? 'runProfiles.noMatches' : 'runProfiles.noAvailableCommands') }}</p>
              <button v-for="action in available" :key="key(action)" class="command-picker__row" type="button" :aria-label="$t('runProfiles.pinNamed', { name: action.name })" :disabled="saving" @click="add(action)">
                <span class="command-picker__identity"><code><span class="command-picker__prefix">{{ commandParts(action).prefix }}</span>{{ commandParts(action).label }}</code></span><IconArrowRight class="command-picker__move" :size="16" aria-hidden="true" />
              </button>
            </div>
          </template>
          <form v-else class="command-picker__editor" @submit.prevent="saveEditor">
            <FormField :label="$t('runProfiles.name')" label-for="profile-name"><el-input id="profile-name" v-model="editor.name" /></FormField>
            <FormField :label="$t('runProfiles.command')" label-for="profile-command"><el-input id="profile-command" v-model="editor.command" :placeholder="$t('runProfiles.commandExample')" /></FormField>
            <FormField :label="$t('runProfiles.directory')" label-for="profile-directory"><el-input id="profile-directory" v-model="editor.directory" placeholder="." /></FormField>
            <FormField :label="$t('runProfiles.previewUrl')" label-for="profile-preview"><el-input id="profile-preview" v-model="editor.previewUrl" :placeholder="$t('runProfiles.previewExample')" /></FormField>
            <div class="command-picker__editor-actions"><button class="app-button app-button--tertiary" type="button" :disabled="saving" @click="editor = null">{{ $t('common.cancel') }}</button><button class="app-button app-button--primary" :disabled="saving || !editor.name.trim() || !editor.command.trim()">{{ $t('runProfiles.save') }}</button></div>
          </form>
        </section>
        <section class="command-picker__panel">
          <header class="command-picker__heading"><h3>{{ $t('runProfiles.pinnedHeading') }}</h3><span>{{ profiles.length }}</span></header>
          <div class="command-picker__scroll" :aria-label="$t('runProfiles.pinnedCommands')">
            <div v-if="!profiles.length" class="command-picker__empty command-picker__empty--pinned"><IconPin :size="24" aria-hidden="true" /><strong>{{ $t('runProfiles.nothingPinned') }}</strong><span>{{ $t('runProfiles.pinHelp') }}</span></div>
            <div v-for="profile in profiles" :key="profile.id" class="command-picker__pinned">
              <button class="command-picker__row" type="button" :aria-label="$t('runProfiles.removeNamed', { name: profile.name })" :disabled="saving || runningProfileIds.includes(profile.id)" :title="runningProfileIds.includes(profile.id) ? $t('runProfiles.stopBeforeRemoving') : undefined" @click="remove(profile)"><span class="command-picker__identity"><code><span class="command-picker__prefix">{{ commandParts(profile).prefix }}</span>{{ commandParts(profile).label }}</code><small v-if="profile.directory !== '.'">{{ profile.directory }}</small></span><IconArrowLeft class="command-picker__move" :size="16" aria-hidden="true" /></button>
              <button class="command-picker__icon" :aria-label="$t('runProfiles.editNamed', { name: profile.name })" :title="$t('runProfiles.editNamed', { name: profile.name })" :disabled="saving" @click="editor = { ...profile }"><IconPencil :size="16" aria-hidden="true" /></button>
            </div>
          </div>
        </section>
      </div>
    </div>
    <template #footer-left><button class="app-button app-button--tertiary" :disabled="saving" @click="editor = { name: '', command: '', directory: '.', previewUrl: '' }"><IconPlus :size="16" aria-hidden="true" />{{ $t('runProfiles.customCommand') }}</button></template>
    <template #footer><button class="app-button app-button--primary" :disabled="saving" @click="emit('done')">{{ $t('runProfiles.done') }}</button></template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { IconArrowLeft, IconArrowRight, IconPencil, IconPin, IconPlus } from '@tabler/icons-vue';
import type { RunProfile, RunProfileAction, RunProfileCatalog, RunProfileDiscovery, RunProfileInput } from '@workspace/core/run-profiles';
import { appApi } from '../platform-api';
import FormField from '../shared/form/FormField.vue';
import FormDialog from '../shared/dialog/FormDialog.vue';
import ClearableTextInput from '../shared/form/ClearableTextInput.vue';

const props = withDefaults(defineProps<{ agentId: string; profiles: RunProfile[]; runningProfileIds?: string[] }>(), { runningProfileIds: () => [] });
const emit = defineEmits<{ done: []; change: [catalog: RunProfileCatalog] }>();
const query = ref('');
const ALL_FILES = '__all__';
const source = ref(ALL_FILES);
const result = ref<RunProfileDiscovery | null>(null);
const editor = ref<RunProfileInput | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
let revision = 0;
const key = (action: { command: string; directory: string }) => JSON.stringify([action.command, action.directory]);
const sources = computed(() => [...new Set(result.value?.actions.map(action => action.source) ?? [])]);
const available = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return (result.value?.actions ?? []).filter(action => !props.profiles.some(profile => key(profile) === key(action)) && (source.value === ALL_FILES || action.source === source.value) && (!needle || `${action.name} ${action.command} ${action.source}`.toLocaleLowerCase().includes(needle)));
});
function commandParts({ command, name }: { command: string; name: string }) {
  const start = command.length - name.length;
  return name && start > 0 && command.endsWith(name) && /\s/.test(command[start - 1])
    ? { prefix: command.slice(0, start), label: name }
    : { prefix: '', label: command };
}
async function discover() {
  if (saving.value) return;
  const current = ++revision;
  loading.value = true; error.value = ''; result.value = null; source.value = ALL_FILES;
  try {
    const actions = await appApi!.getRunProfileActions(props.agentId, '.');
    if (current === revision) result.value = actions;
  } catch (cause) { if (current === revision) error.value = (cause as Error).message; }
  finally { if (current === revision) loading.value = false; }
}
async function mutate(action: () => Promise<void>) {
  if (saving.value) return;
  saving.value = true; error.value = '';
  try { await action(); } catch (cause) { error.value = (cause as Error).message; }
  finally { saving.value = false; }
}
async function add(action: RunProfileAction) {
  const current = revision;
  const agentId = props.agentId;
  await mutate(async () => {
    const catalog = await appApi!.saveRunProfile(agentId, { name: action.name, command: action.command, directory: action.directory });
    if (current === revision) emit('change', catalog);
  });
}
async function remove(profile: RunProfile) {
  const current = revision;
  const agentId = props.agentId;
  await mutate(async () => {
    const catalog = await appApi!.deleteRunProfile(agentId, profile.id);
    if (current === revision) emit('change', catalog);
  });
}
async function saveEditor() {
  if (!editor.value) return;
  const input = { ...editor.value, directory: editor.value.directory.trim() || '.' };
  if (!input.previewUrl?.trim()) delete input.previewUrl;
  await mutate(async () => { emit('change', await appApi!.saveRunProfile(props.agentId, input)); editor.value = null; });
}
onMounted(() => void discover());
onBeforeUnmount(() => { revision++; });
</script>

<style scoped>
.command-picker { display: grid; gap: var(--space-6); }
.command-picker__columns { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: var(--space-6); }
.command-picker__panel { display: flex; min-width: 0; height: clamp(280px, 50vh, 460px); flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.command-picker__heading { min-height: 60px; box-sizing: border-box; display: flex; flex: none; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-6); border-bottom: 1px solid var(--color-border); }
.command-picker__heading h3 { margin: 0; font-size: var(--font-size-13); font-weight: var(--font-weight-semibold); }
.command-picker__heading > span { color: var(--color-text-muted); font-size: var(--font-size-12); font-variant-numeric: tabular-nums; }
.command-picker__toolbar { display: flex; flex: none; align-items: center; gap: var(--space-3); min-height: 60px; padding: var(--space-4) var(--space-6); border-bottom: 1px solid var(--color-border); box-sizing: border-box; }
.command-picker__toolbar :deep(.app-form-dialog__input-control), .command-picker__source :deep(.el-select__wrapper) { height: 36px; min-height: 36px; box-sizing: border-box; }
.command-picker__toolbar :deep(.app-form-dialog__input-control) { flex: 1; min-width: 0; }
.command-picker__source { flex: none; width: 145px; }
.command-picker__scroll { flex: 1; min-height: 0; overflow-y: auto; }
.command-picker__row { display: flex; align-items: center; gap: var(--space-4); width: 100%; min-height: 36px; padding: var(--space-3) var(--space-4); border: 0; border-bottom: 1px solid var(--color-border); color: var(--color-text); background: transparent; text-align: left; cursor: pointer; }
.command-picker__row:hover:not(:disabled), .command-picker__row:focus-visible { background: var(--color-surface-low); }
.command-picker__row:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.command-picker__row:disabled { opacity: 0.5; cursor: default; }
.command-picker__move { flex: none; color: var(--color-text-muted); opacity: 0; }
.command-picker__row:hover .command-picker__move, .command-picker__row:focus-visible .command-picker__move { opacity: 1; }
.command-picker__pinned { display: flex; align-items: center; border-bottom: 1px solid var(--color-border); }
.command-picker__pinned .command-picker__row { flex: 1; min-width: 0; border: 0; }
.command-picker__pinned > .command-picker__icon { margin-right: var(--space-4); }
.command-picker__identity { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: var(--space-1); }
.command-picker__identity code { color: var(--color-text); font-family: var(--font-family-mono); font-weight: var(--font-weight-medium); font-size: var(--font-size-13); overflow-wrap: anywhere; }
.command-picker__prefix { color: var(--color-text-muted); font-weight: 200; }
.command-picker__identity small { color: var(--color-text-muted); font-size: var(--font-size-11); }
.command-picker__empty { margin: 0; padding: var(--space-10) var(--space-6); color: var(--color-text-muted); font-size: var(--font-size-13); }
.command-picker__empty--pinned { display: flex; align-items: center; flex-direction: column; gap: var(--space-4); padding-top: var(--space-20); text-align: center; }
.command-picker__empty--pinned strong { color: var(--color-text); font-weight: var(--font-weight-medium); }
.command-picker__empty--pinned span { max-width: 24ch; line-height: var(--line-height-20); }
.command-picker__icon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 32px; padding: 0; border: 0; border-radius: var(--radius-md); color: var(--color-text-muted); background: transparent; cursor: pointer; }
.command-picker__icon:hover:not(:disabled) { color: var(--color-text); background: var(--color-surface-high); }
.command-picker__icon:disabled { opacity: 0.4; cursor: default; }
.command-picker__editor { display: grid; gap: var(--space-4); padding: var(--space-6); overflow-y: auto; }
.command-picker__editor-actions { display: flex; justify-content: flex-end; gap: var(--space-4); }
.command-picker__error { margin: 0; color: var(--color-error); font-size: var(--font-size-12); }
@media (max-width: 680px) { .command-picker__columns { grid-template-columns: minmax(0, 1fr); } .command-picker__panel { height: 300px; } }
</style>
