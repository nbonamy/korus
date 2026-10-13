<template>
  <FormDialog :model-value="true" :title="$t('runProfiles.importActions')" :subtitle="subtitle" width="680px" @update:model-value="!saving && emit('cancel')">
  <div class="run-profile-import">
    <p>{{ $t('runProfiles.importHelp') }}</p>
    <form @submit.prevent="discover">
      <FormField :label="$t('runProfiles.directory')" label-for="import-directory" :help="$t('runProfiles.directoryHelp')">
        <el-input id="import-directory" v-model="directory" :disabled="saving" />
      </FormField>
      <button class="app-button app-button--secondary" type="submit" :disabled="loading || saving">{{ $t('runProfiles.scan') }}</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">{{ $t('runProfiles.scanning') }}</p>
    <p v-else-if="result && !result.actions.length">{{ $t('runProfiles.noImports') }}</p>
    <p v-for="warning in result?.warnings ?? []" :key="warning" role="alert">{{ warning }}</p>
    <ul v-if="result" class="run-profile-import__list" :aria-label="$t('runProfiles.importCandidates')">
      <li v-for="(action, index) in result.actions" :key="`${action.source}:${action.command}`">
        <el-checkbox :model-value="selected.has(index)" :disabled="saving || alreadySaved(action)" @update:model-value="toggle(index, $event)">
          <strong>{{ action.name }}</strong><span>{{ action.source }}</span>
        </el-checkbox>
        <code>{{ action.command }}</code>
        <span v-if="alreadySaved(action)">{{ $t('runProfiles.alreadyImported') }}</span>
      </li>
    </ul>
  </div>
    <template #footer>
      <button class="app-button app-button--tertiary" :disabled="saving" @click="emit('cancel')">{{ $t('common.cancel') }}</button>
      <button class="app-button app-button--primary" :disabled="loading || saving || !selected.size" @click="save">{{ $t('runProfiles.importSelected', { count: selected.size }) }}</button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { RunProfile, RunProfileAction, RunProfileDiscovery } from '@workspace/core/run-profiles';
import { appApi } from '../platform-api';
import FormField from '../shared/form/FormField.vue';
import FormDialog from '../shared/dialog/FormDialog.vue';

const props = defineProps<{ agentId: string; profiles: RunProfile[]; subtitle?: string }>();
const emit = defineEmits<{ done: []; cancel: [] }>();
const directory = ref('.');
const result = ref<RunProfileDiscovery | null>(null);
const selected = ref(new Set<number>());
const saved = ref(new Set<string>());
const loading = ref(false);
const saving = ref(false);
const error = ref('');
let revision = 0;
const key = (action: { command: string; directory: string }) => JSON.stringify([action.command, action.directory]);
function alreadySaved(action: RunProfileAction) { return saved.value.has(key(action)) || props.profiles.some(profile => key(profile) === key(action)); }
function toggle(index: number, value: unknown) { if (value) selected.value.add(index); else selected.value.delete(index); }
async function discover() {
  if (saving.value) return;
  const current = ++revision;
  loading.value = true; error.value = ''; result.value = null; selected.value.clear();
  try {
    const actions = await appApi!.getRunProfileActions(props.agentId, directory.value.trim() || '.');
    if (current !== revision) return;
    result.value = actions;
    selected.value = new Set(actions.actions.flatMap((action, index) => alreadySaved(action) ? [] : [index]));
  } catch (cause) { if (current === revision) error.value = (cause as Error).message; }
  finally { if (current === revision) loading.value = false; }
}
async function save() {
  if (saving.value || loading.value || !result.value) return;
  const current = revision;
  const agentId = props.agentId;
  saving.value = true; error.value = '';
  try {
    for (const index of [...selected.value]) {
      if (current !== revision) return;
      const action = result.value.actions[index];
      await appApi!.saveRunProfile(agentId, { name: action.name, command: action.command, directory: action.directory });
      if (current !== revision) return;
      saved.value.add(key(action)); selected.value.delete(index);
    }
    emit('done');
  } catch (cause) { if (current === revision) error.value = (cause as Error).message; }
  finally { saving.value = false; }
}
watch(directory, () => { revision++; loading.value = false; result.value = null; selected.value.clear(); });
onMounted(() => void discover());
onBeforeUnmount(() => { revision++; });
</script>

<style scoped>
.run-profile-import { max-height: 60vh; overflow: auto; }
.run-profile-import__list { list-style: none; padding: 0; }
.run-profile-import__list li { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border); }
.run-profile-import__list span { margin-left: var(--space-2); color: var(--color-text-muted); font-size: var(--font-size-12); }
.run-profile-import__list code { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
