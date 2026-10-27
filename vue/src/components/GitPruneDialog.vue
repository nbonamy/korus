<template>
  <FormDialog
    :model-value="modelValue" class="git-prune-dialog" :title="$t('gitPrune.title')"
    :subtitle="inventory ? $t('gitPrune.subtitle', { repository: inventory.repository, branch: inventory.baseBranch }) : ''"
    width="min(560px, calc(100vw - 32px))" align-center
    :close-on-click-modal="!busy" :close-on-press-escape="!busy"
    @update:model-value="!busy && emit('update:modelValue', $event)"
  >
    <div class="git-prune-dialog__intro">
      <p>{{ $t('gitPrune.description') }}</p>
      <button class="git-prune-dialog__icon" type="button" :aria-label="$t('gitPrune.refresh')" :disabled="loading || busy" @click="refresh()">
        <ElIcon :size="14" :class="{ 'is-loading': loading }"><RefreshIcon /></ElIcon>
      </button>
    </div>
    <div v-if="eligibleRemotes.length" class="git-prune-dialog__actions">
      <el-button link type="primary" :disabled="loading || busy || eligibleRemotes.every(target => selected.has(target.id))" @click="selectMergedRemotes">{{ $t('gitPrune.selectMergedRemotes') }}</el-button>
    </div>
    <p v-if="error" class="git-prune-dialog__error" role="alert">{{ error }}</p>
    <p v-if="deletedCount" role="status" class="git-prune-dialog__message">{{ $t('gitPrune.deleted', { count: deletedCount }, deletedCount) }}</p>
    <p v-if="inventory?.unavailableRemotes.length" class="git-prune-dialog__message">{{ $t('gitPrune.remoteUnavailable', { remotes: inventory.unavailableRemotes.join(', ') }) }}</p>
    <div class="git-prune-dialog__list" :aria-busy="loading" :aria-label="$t('gitPrune.branches')">
      <p v-if="loading && !inventory" role="status">{{ $t('gitPrune.loading') }}</p>
      <p v-else-if="inventory && !inventory.groups.length" class="git-prune-dialog__empty">{{ $t('gitPrune.empty') }}</p>
      <section v-for="group in inventory?.groups ?? []" :key="group.branch" class="git-prune-dialog__group" :aria-label="group.branch">
        <template v-for="(target, index) in groupTargets(group)" :key="target.id">
          <div v-show="index === 0 || !collapsed.has(group.branch)" class="git-prune-dialog__row" :class="{ 'git-prune-dialog__row--remote': target.kind === 'remote' }">
            <el-switch :model-value="selected.has(target.id)" :aria-label="$t('gitPrune.deleteTarget', { name: target.name })" :disabled="loading || busy" @update:model-value="toggle(target, Boolean($event))" />
            <div class="git-prune-dialog__label">
              <span class="git-prune-dialog__name">{{ target.name }}</span>
              <p v-show="!collapsed.has(group.branch)" v-if="description(target)" class="git-prune-dialog__detail">{{ description(target) }}</p>
            </div>
            <div class="git-prune-dialog__state">
              <a v-if="target.pullRequest" class="git-prune-dialog__pr" :href="target.pullRequest.url" target="_blank" rel="noopener noreferrer" @click.prevent="openPullRequest(target)">{{ $t(target.pullRequest.url.startsWith('https://gitlab.com/') ? 'gitPrune.mr' : 'gitPrune.pr', { number: target.pullRequest.number, state: $t(`gitPrune.prStates.${target.pullRequest.state}`) }) }}</a>
              <span v-else :class="target.merged ? 'git-prune-dialog__merged' : 'git-prune-dialog__unmerged'">{{ $t(target.merged ? 'gitPrune.merged' : 'gitPrune.notMerged') }}</span>
              <button v-if="index === 0" class="git-prune-dialog__icon git-prune-dialog__fold" type="button" :aria-label="$t(collapsed.has(group.branch) ? 'gitPrune.expand' : 'gitPrune.collapse', { branch: group.branch })" :aria-expanded="!collapsed.has(group.branch)" @click="toggleGroup(group.branch)">
                <ChevronRightIcon v-if="collapsed.has(group.branch)" /><ChevronDown v-else />
              </button>
            </div>
          </div>
        </template>
      </section>
    </div>
    <template #footer>
      <button class="app-button app-button--secondary" type="button" :disabled="busy" @click="emit('update:modelValue', false)">{{ $t('gitPrune.cancel') }}</button>
      <button class="app-button app-button--primary" type="button" data-action="prune" :disabled="loading || busy || !selected.size" :aria-busy="busy" @click="submit">{{ busy ? $t('gitPrune.pruning') : $t('gitPrune.pruneCount', { count: selected.size }, selected.size) }}</button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElIcon, ElMessageBox } from 'element-plus';
import type { GitPruneInput, GitPruneInventory, GitPruneResult, GitPruneTarget } from '@workspace/core/contracts';
import FormDialog from '../shared/dialog/FormDialog.vue';
import { ChevronDown, ChevronRightIcon, RefreshIcon } from '../shared/icons/app-icons';
import { translate } from '../i18n';
import { localizedErrorMessage } from '../i18n/errors';
import { appPlatformActions } from '../platform-api';

const props = defineProps<{
  modelValue: boolean;
  agentId: string;
  load: (agentId: string) => Promise<GitPruneInventory>;
  prune: (agentId: string, input: GitPruneInput) => Promise<GitPruneResult>;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; pruned: [] }>();
const inventory = ref<GitPruneInventory | null>(null);
const selected = ref(new Set<string>());
const eligibleRemotes = computed(() => inventory.value?.groups.flatMap(group => group.remotes.filter(target => target.merged && !target.blocked)) ?? []);
const collapsed = ref(new Set<string>());
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const deletedCount = ref(0);
let generation = 0;

function groupTargets(group: GitPruneInventory['groups'][number]): GitPruneTarget[] {
  return [...(group.local ? [group.local] : []), ...group.remotes];
}
function toggle(target: GitPruneTarget, value: boolean): void {
  if (busy.value || loading.value) return;
  if (value) selected.value.add(target.id);
  else selected.value.delete(target.id);
}
function toggleGroup(branch: string): void {
  if (collapsed.value.has(branch)) collapsed.value.delete(branch);
  else collapsed.value.add(branch);
}
function selectMergedRemotes(): void {
  if (loading.value || busy.value) return;
  for (const target of eligibleRemotes.value) selected.value.add(target.id);
}
function description(target: GitPruneTarget): string {
  const details: string[] = [];
  if (target.worktree) details.push(translate(target.worktreeMissing ? 'gitPrune.missingWorktree' : target.blocked ? 'gitPrune.worktreeOnly' : 'gitPrune.worktree', { path: target.worktreeLabel ?? target.worktree }));
  else if (target.kind === 'local') details.push(translate('gitPrune.localBranch'));
  else details.push(translate('gitPrune.remoteBranch'));
  if (target.usedBy.length) details.push(translate('gitPrune.usedBy', { names: target.usedBy.join(', ') }));
  if (target.changedFiles) details.push(translate('gitPrune.changes', { count: target.changedFiles }));
  if (target.blocked === 'locked' || target.blocked === 'unavailable') details.push(translate(`gitPrune.${target.blocked}`));
  if (!target.merged && target.commitsAhead) details.push(translate('gitPrune.ahead', { count: target.commitsAhead, branch: inventory.value?.baseBranch ?? '' }));
  return details.join(' · ');
}
function openPullRequest(target: GitPruneTarget): void {
  if (target.pullRequest && /^https:\/\//u.test(target.pullRequest.url)) void appPlatformActions.openExternal?.(target.pullRequest.url);
}
async function refresh(defaults = true): Promise<void> {
  const request = ++generation;
  loading.value = true;
  if (defaults) { error.value = ''; deletedCount.value = 0; }
  selected.value.clear();
  try {
    const result = await props.load(props.agentId);
    if (request !== generation) return;
    inventory.value = result;
    if (defaults) selected.value = new Set(result.groups.flatMap(group => group.local?.merged && !group.local.blocked ? [group.local.id] : []));
  } catch (cause) {
    if (request === generation) { inventory.value = null; error.value = localizedErrorMessage(cause, translate); }
  } finally { if (request === generation) loading.value = false; }
}
async function submit(): Promise<void> {
  if (busy.value || loading.value || !selected.value.size || !inventory.value) return;
  const request = generation;
  busy.value = true;
  error.value = '';
  try {
    const selection = inventory.value.groups.flatMap(groupTargets).filter(target => selected.value.has(target.id));
    const force = selection.some(target => !target.merged || target.blocked || target.changedFiles || target.usedBy.length);
    if (force) {
      const worktreeRisk = selection.some(target => target.worktree && (target.blocked || target.changedFiles || target.usedBy.length));
      try {
        await ElMessageBox.confirm(
          translate(worktreeRisk ? 'gitPrune.confirmDiscardMessage' : 'gitPrune.confirmUnmergedMessage', { branch: inventory.value.baseBranch }),
          translate(worktreeRisk ? 'gitPrune.confirmDiscardTitle' : 'gitPrune.confirmUnmergedTitle'),
          { type: 'warning', confirmButtonText: translate('gitPrune.pruneAnyway'), cancelButtonText: translate('gitPrune.review') },
        );
      } catch { return; }
      if (request !== generation) return;
    }
    const targets = selection.map(({ id, revision }) => ({ id, revision }));
    const result = await props.prune(props.agentId, { confirmed: true, ...(force ? { force: true } : {}), targets });
    if (request !== generation) return;
    deletedCount.value = result.deleted.length;
    if (result.deleted.length) emit('pruned');
    if (result.failed.length) {
      error.value = result.failed.map(failure => failure.message).join('\n');
      await refresh(false);
    } else emit('update:modelValue', false);
  } catch (cause) {
    if (request === generation) { error.value = localizedErrorMessage(cause, translate); await refresh(false); }
  } finally { busy.value = false; }
}
watch([() => props.modelValue, () => props.agentId], ([open]) => {
  generation += 1;
  inventory.value = null;
  selected.value.clear();
  collapsed.value.clear();
  if (open) void refresh();
}, { immediate: true });
onBeforeUnmount(() => { generation += 1; });
</script>

<style scoped>
:global(.git-prune-dialog.el-dialog) {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 48px);
  padding: 0;
}
:global(.git-prune-dialog.el-dialog > .el-dialog__body) {
  min-height: 0;
  max-height: min(560px, calc(100dvh - 200px));
  overflow-y: auto;
  overscroll-behavior: contain;
}
:global(.git-prune-dialog.el-dialog > .el-dialog__header),
:global(.git-prune-dialog.el-dialog > .el-dialog__footer) { flex-shrink: 0; }
:global(.git-prune-dialog .app-form-dialog__header) {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  column-gap: var(--space-8);
}
:global(.git-prune-dialog .app-dialog__subtitle) {
  justify-self: end;
  text-align: right;
  overflow-wrap: anywhere;
  font-weight: var(--font-weight-regular);
}
.git-prune-dialog__intro { display: flex; align-items: start; gap: var(--space-3); margin-bottom: var(--space-8); }
.git-prune-dialog__intro p { flex: 1; margin: 0; color: var(--color-text-muted); font-size: var(--font-size-13); line-height: var(--line-height-18); }
.git-prune-dialog__actions { margin: calc(-1 * var(--space-4)) 0 var(--space-8); }
.git-prune-dialog__list { min-height: 0; }
.git-prune-dialog__group { border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.git-prune-dialog__group + .git-prune-dialog__group { margin-top: var(--space-4); }
.git-prune-dialog__row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; column-gap: var(--space-6); padding: var(--space-6); font-size: var(--font-size-14); line-height: var(--line-height-20); }
.git-prune-dialog__row + .git-prune-dialog__row { border-top: 1px solid var(--color-border); }
.git-prune-dialog__row :deep(.el-switch) { height: 20px; --el-switch-width: 30px; }
.git-prune-dialog__row :deep(.el-switch__core) { min-width: 30px; height: 16px; }
.git-prune-dialog__row :deep(.el-switch__action) { width: 12px; height: 12px; }
.git-prune-dialog__row :deep(.el-switch.is-checked .el-switch__core .el-switch__action) { left: calc(100% - 13px); }
.git-prune-dialog__name { color: var(--color-text); overflow-wrap: anywhere; }
.git-prune-dialog__row--remote .git-prune-dialog__name { color: var(--color-text-muted); }
.git-prune-dialog__detail { margin: var(--space-1) 0 0; color: var(--color-text-muted); font-size: var(--font-size-12); line-height: var(--line-height-18); overflow-wrap: anywhere; }
.git-prune-dialog__state { display: grid; grid-template-columns: auto 20px; align-items: center; gap: var(--space-2); font-size: var(--font-size-12); white-space: nowrap; }
.git-prune-dialog__merged { color: var(--color-success); }
.git-prune-dialog__unmerged { color: var(--color-warning); }
.git-prune-dialog__pr { padding: 0 var(--space-4); border-radius: var(--radius-full); background: var(--color-primary-container); color: var(--color-primary); text-decoration: none; }
.git-prune-dialog__icon { display: inline-flex; align-items: center; justify-content: center; padding: 0; width: 20px; height: 20px; border: 0; background: none; color: var(--color-text-muted); cursor: pointer; flex-shrink: 0; }
.git-prune-dialog__icon svg { width: var(--icon-sm); height: var(--icon-sm); }
.git-prune-dialog__icon:disabled { opacity: 0.5; cursor: default; }
.git-prune-dialog__icon:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.git-prune-dialog__message,
.git-prune-dialog__error,
.git-prune-dialog__empty { margin: 0 0 var(--space-4); color: var(--color-text-muted); font-size: var(--font-size-13); }
.git-prune-dialog__error { color: var(--color-error); white-space: pre-line; }
.git-prune-dialog :deep(.app-button--primary) { min-width: 118px; white-space: nowrap; }
@media (max-width: 520px) {
  .git-prune-dialog__row { column-gap: var(--space-3); padding: var(--space-4); }
  .git-prune-dialog__state { grid-column: 2 / -1; justify-content: space-between; margin-top: var(--space-2); }
}
</style>
