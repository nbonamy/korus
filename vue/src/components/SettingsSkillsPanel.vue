<template>
  <SettingsPanelFrame class="settings-skills" :title="$t('surface.skills.title')" title-id="settings-skills-title">
    <template #actions>
      <button class="app-button app-button--neutral" :disabled="busy || !state" :aria-busy="syncing || undefined" :aria-label="$t('surface.skills.syncLabel')" :title="$t('surface.skills.syncHint')" @click="confirmSync"><RefreshIcon v-if="!syncing" />{{ $t('surface.skills.sync') }}</button>
      <button class="app-button app-button--primary" :disabled="busy" @click="installDialog = true"><PlusIcon />{{ $t('surface.skills.installSkill') }}</button>
    </template>
    <p v-if="!installDialog && (error || state?.issues.length)" class="settings-skills__error" role="alert">{{ error || state?.issues.join('\n') }}</p>
    <el-tabs v-model="view" @tab-change="query = ''">
      <el-tab-pane :label="$t('surface.skills.discover')" name="discover">
        <el-input v-model="query" class="settings-skills__search" clearable :aria-label="$t('surface.skills.search')" :placeholder="$t('surface.skills.searchPlaceholder')" />
        <div class="settings-skills__cards">
          <article v-for="skill in featured" :key="skill.name" class="settings-skills__card" :data-skill="skill.name">
            <div class="settings-skills__art" aria-hidden="true"><img :src="skillArtwork[skill.name]" alt="" width="768" height="512" decoding="async" /></div>
            <div class="settings-skills__card-body">
              <span class="settings-skills__author">{{ skill.author }}</span>
              <a class="settings-skills__source" :href="skill.source" @click.prevent="appPlatformActions.openExternal?.(skill.source)">{{ skill.title }}</a>
              <p>{{ skill.description }}</p>
              <div class="settings-skills__actions">
                <template v-if="installed(skill)">
                  <button v-if="refreshable(skill)" class="app-button app-button--neutral" :disabled="busy" :aria-busy="activeSource === skill.source || undefined" @click="run({ action: 'install', source: skill.source, refresh: true })">
                    <RefreshIcon v-if="activeSource !== skill.source" />{{ $t('surface.skills.refresh') }}
                  </button>
                  <button class="app-button app-button--neutral settings-skills__icon-only" :disabled="busy" :aria-busy="uninstalling === skill.name || undefined" :aria-label="$t('surface.skills.uninstallLabel', { name: skill.title })" :title="$t('surface.skills.uninstall')" @click="uninstall(skill)">
                    <Trash2Icon v-if="uninstalling !== skill.name" aria-hidden="true" />
                  </button>
                </template>
                <button v-else class="app-button app-button--neutral" :disabled="busy" :aria-busy="activeSource === skill.source || undefined" @click="run({ action: 'install', source: skill.source })">
                  <PlusIcon v-if="activeSource !== skill.source" />
                  {{ $t(activeSource === skill.source ? 'surface.skills.installing' : skill.kind === 'pack' ? 'surface.skills.installPack' : 'surface.skills.install') }}
                </button>
              </div>
            </div>
          </article>
        </div>
        <p v-if="!featured.length" class="settings-skills__empty">{{ $t('surface.skills.noMatches') }}</p>
      </el-tab-pane>
      <el-tab-pane name="installed">
        <template #label><span>{{ $t('surface.skills.installed') }} <span v-if="state" class="settings-skills__count">{{ state.skills.length }}</span></span></template>
        <div class="settings-skills__toolbar">
          <el-input v-model="query" class="settings-skills__search" clearable :aria-label="$t('surface.skills.search')" :placeholder="$t('surface.skills.searchPlaceholder')" />
          <el-select v-model="kind" class="settings-skills__kind" :aria-label="$t('surface.skills.kind')">
            <el-option value="personal" :label="$t('surface.skills.personal')" />
            <el-option value="builtIn" :label="$t('surface.skills.builtIn')" />
          </el-select>
        </div>
        <div v-if="loading" class="settings-skills__skeleton" role="status" aria-busy="true" :aria-label="$t('surface.skills.loading')">
          <div v-for="row in 4" :key="row" class="settings-skills__skeleton-row"><span /><span /></div>
        </div>
        <AppDataList v-else class="settings-skills__inventory" :aria-label="$t('surface.skills.managed')" :columns="columns" :rows="rows" :empty-text="$t(query ? 'surface.skills.noMatches' : 'surface.skills.empty')" :aria-busy="busy">
          <template #cell-skill="{ row }">
            <div class="settings-skills__identity">
              <FileSparkIcon class="settings-skills__glyph" aria-hidden="true" />
              <div class="settings-skills__details">
                <div class="settings-skills__name"><strong :title="String(row.name)">{{ row.name }}</strong><span v-if="!row.managed || row.builtIn" class="settings-skills__origin">{{ originLabel(row) }}</span></div>
                <span class="settings-skills__description" :title="String(row.description)">{{ row.description }}</span>
              </div>
              <span class="settings-skills__providers">
                <span v-for="backend in state?.providers ?? []" :key="backend" class="settings-skills__availability" :data-status="statusFor(row, backend).status" :aria-label="availabilityLabel(row, backend)" :title="[availabilityLabel(row, backend), statusFor(row, backend).path].filter(Boolean).join('\n')" role="img">
                  <BackendIcon :backend="backend" />
                </span>
              </span>
            </div>
          </template>
          <template #actions="{ row }">
            <span v-if="rowTask?.name === row.name" class="app-spinner settings-skills__spinner" role="status" :aria-label="$t(rowTask?.action === 'remove' ? 'surface.skills.deleting' : 'surface.skills.syncing', { name: row.name })" />
            <AppMenuButton v-else :ariaLabel="$t('surface.skills.actions', { name: row.name })" :items="skillActions(row)" @select="selectSkillAction(row, $event)">
              <template #trigger="{ attrs }"><button v-bind="attrs" type="button" class="app-icon-button" :disabled="busy" :aria-label="$t('surface.skills.actions', { name: row.name })"><DotsVerticalIcon aria-hidden="true" /></button></template>
            </AppMenuButton>
          </template>
        </AppDataList>
      </el-tab-pane>
    </el-tabs>
    <FormDialog v-model="documentDialog" :title="viewingName" width="720px">
      <el-tabs v-if="document && document.files.length > 1" v-model="documentVersion">
        <el-tab-pane v-for="(file, index) in document.files" :key="index" :name="String(index)" :label="file.providers.map(backendDisplayName).join(', ') || $t('surface.skills.managedCopy')" />
      </el-tabs>
      <div v-if="!document" class="settings-skills__document-loading" role="status" aria-busy="true" :aria-label="$t('surface.skills.loadingDocument')">
        <span v-for="width in [38, 92, 74, 86, 56, 90, 64]" :key="width" :style="{ width: `${width}%` }" />
      </div>
      <article v-else class="settings-skills__viewer" tabindex="0">
        <p v-if="viewed?.description" class="settings-skills__summary">{{ viewed.description }}</p>
        <div class="codex-markdown settings-skills__body" v-html="viewedHtml" />
      </article>
      <template #footer><button class="app-button app-button--tertiary" @click="documentDialog = false">{{ $t('common.close') }}</button></template>
    </FormDialog>
    <FormDialog v-model="installDialog" :title="$t('surface.skills.installSkill')">
      <form id="skill-source-form" class="app-form-dialog" @submit.prevent="installSource">
        <FormField :label="$t('surface.skills.source')">
          <el-input v-model="source" :disabled="busy" :aria-label="$t('surface.skills.source')" :placeholder="$t('surface.skills.placeholder')" autofocus />
        </FormField>
        <FormField v-if="providerChoices.length > 1" :label="$t('surface.skills.codingAgents')">
          <el-select v-model="installBackends" multiple :disabled="busy" :aria-label="$t('surface.skills.codingAgents')">
            <el-option v-for="backend in providerChoices" :key="backend" :value="backend" :label="backendDisplayName(backend)">
              <span class="settings-skills__agent"><BackendIcon :backend="backend" />{{ backendDisplayName(backend) }}</span>
            </el-option>
          </el-select>
        </FormField>
        <p v-if="error" class="settings-skills__error" role="alert">{{ error }}</p>
      </form>
      <template #footer>
        <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="installDialog = false">{{ $t('common.cancel') }}</button>
        <button type="submit" form="skill-source-form" class="app-button app-button--primary" :aria-busy="busy || undefined" :disabled="busy || !source.trim() || (providerChoices.length > 1 && !installBackends.length)">{{ $t(busy ? 'surface.skills.installing' : 'surface.skills.install') }}</button>
      </template>
    </FormDialog>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import type { AgentBackend } from '@workspace/core/contracts';
import { curatedSkills, parseSkillDocument, type InstalledSkill, type CuratedSkill, type SkillManagerInput, type SkillManagerState, type SkillDocument } from '@workspace/core/skill-manager';
import { backendDisplayName } from '@workspace/core/backend-driver';
import { renderMarkdown } from '@codex-app-sdk/vue';
import { appApi, appPlatformActions } from '../platform-api';
import { translate } from '../i18n';
import { DotsVerticalIcon, EyeIcon, FileSparkIcon, PlusIcon, RefreshIcon, Trash2Icon } from '../shared/icons/app-icons';
import securityArtwork from '../assets/skills/security-audit.webp?url';
import webDesignArtwork from '../assets/skills/web-design-guidelines.webp?url';
import impeccableArtwork from '../assets/skills/impeccable.webp?url';
import mattPocockArtwork from '../assets/skills/matt-pocock.webp?url';
import pstackArtwork from '../assets/skills/pstack.webp?url';
import superpowersArtwork from '../assets/skills/superpowers.webp?url';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import BackendIcon from './BackendIcon.vue';
import AppDataList from './AppDataList.vue';
import type { AppDataListRow } from './app-data-list';

const state = ref<SkillManagerState>();
const skillArtwork: Record<string, string> = {
  'security-audit': securityArtwork, 'web-design-guidelines': webDesignArtwork,
  impeccable: impeccableArtwork, 'matt-pocock': mattPocockArtwork, pstack: pstackArtwork, superpowers: superpowersArtwork,
};
const document = ref<SkillDocument>(), documentDialog = ref(false), documentVersion = ref('0'), viewingName = ref('');
const view = ref('discover'), query = ref(''), installDialog = ref(false), kind = ref<'personal' | 'builtIn'>('personal');
const source = ref(''), error = ref(''), busy = ref(false), activeSource = ref(''), syncing = ref(false), rowTask = ref<{ name: string; action: 'remove' | 'sync' }>(), uninstalling = ref('');
// Only the installed inventory waits on the backend; the featured list is static.
const loading = computed(() => !state.value && busy.value);
const providerChoices = computed(() => state.value?.providers ?? []);
// Every configured coding agent starts selected for a new install.
const installBackends = ref<AgentBackend[]>([]);
watch(installDialog, open => { if (open) installBackends.value = [...providerChoices.value]; });
const columns = [{ id: 'skill', label: translate('surface.skills.skill'), width: 'minmax(0, 1fr)' }];
const matches = (text: string) => text.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase());
const rows = computed(() => (state.value?.skills ?? []).filter(skill => Boolean(skill.builtIn) === (kind.value === 'builtIn') && matches(`${skill.name} ${skill.description}`)).map(skill => ({ ...skill, id: skill.name })));
const featured = computed(() => curatedSkills.filter(skill => matches(`${skill.title} ${skill.description} ${skill.author}`)));
function originLabel(row: AppDataListRow) {
  return translate(row.builtIn ? 'surface.skills.builtIn' : row.origin === 'synced' ? 'surface.skills.synced' : 'surface.skills.personal');
}
// The document is shown as its parsed name, description and rendered Markdown body, never as raw front matter.
const viewed = computed(() => {
  const file = document.value?.files[Number(documentVersion.value)];
  return file ? parseSkillDocument(file.content, document.value!.name) : undefined;
});
const viewedHtml = computed(() => viewed.value?.body.trim() ? renderMarkdown(viewed.value.body) : '');
function statusFor(row: AppDataListRow, backend: AgentBackend) {
  const locations = (row.providers as InstalledSkill['providers']).filter(provider => provider.backend === backend);
  return { path: locations.map(provider => provider.path).join('\n'), status: locations.find(provider => provider.status === 'conflict')?.status ?? locations.find(provider => provider.status === 'installed')?.status ?? 'missing' };
}
function availabilityLabel(row: AppDataListRow, backend: AgentBackend) {
  const status = statusFor(row, backend).status;
  return translate(status === 'installed' ? 'surface.skills.installedFor' : status === 'conflict' ? 'surface.skills.conflictFor' : 'surface.skills.missingFor', { provider: backendDisplayName(backend) });
}
// A pack's skills are the ones Korus recorded when it installed the pack (older installs carry a marker instead).
function packSkills(skill: CuratedSkill): string[] {
  const present = new Set((state.value?.skills ?? []).map(value => value.name));
  const marked = (state.value?.skills ?? []).filter(value => value.collection === skill.name).map(value => value.name);
  return [...new Set([...(state.value?.installs?.[skill.name] ?? []), ...marked])].filter(name => present.has(name));
}
// Refreshing pulls the skill from its repository again, which only makes sense for what Korus installed.
function refreshable(skill: CuratedSkill) {
  return skill.kind === 'pack' || Boolean(state.value?.skills.some(value => value.name === skill.name && value.managed));
}
function installed(skill: CuratedSkill) {
  if (skill.kind !== 'pack') {
    const providers = state.value?.providers ?? [];
    return state.value?.skills.some(value => value.name === skill.name && (
      value.managed || providers.length > 0 && providers.every(backend => value.providers.some(provider => provider.backend === backend && provider.status === 'installed'))
    ));
  }
  return packSkills(skill).length > 0;
}
function skillActions(row: AppDataListRow): AppMenuItem[] {
  return [
    { id: 'view', type: 'action', label: translate('surface.skills.view'), icon: EyeIcon, disabled: busy.value },
    ...(row.builtIn || row.origin === 'synced' ? [] : [{ id: 'sync', type: 'action', label: translate('surface.skills.syncOne'), icon: RefreshIcon, disabled: busy.value } satisfies AppMenuItem]),
    { id: 'delete', type: 'action', label: translate('surface.skills.delete'), icon: Trash2Icon, danger: true, disabled: busy.value || Boolean(row.builtIn) },
  ];
}
async function uninstall(skill: CuratedSkill) {
  if (busy.value) return;
  // A pack is the skills Korus installed under its name; removing it removes each of them from every agent.
  const names = skill.kind === 'pack' ? packSkills(skill) : [skill.name];
  try {
    await ElMessageBox.confirm(
      translate(skill.kind === 'pack' ? 'surface.skills.uninstallPackMessage' : 'surface.skills.deleteMessage', { name: skill.title, count: names.length, skills: names.slice(0, 12).join(', ') + (names.length > 12 ? '…' : '') }),
      translate('surface.skills.uninstallTitle', { name: skill.title }),
      { type: 'warning', confirmButtonText: translate('surface.skills.uninstall'), cancelButtonText: translate('common.cancel'), confirmButtonClass: 'app-button app-button--danger' },
    );
  } catch { return; }
  uninstalling.value = skill.name;
  try {
    await run(skill.kind === 'pack' ? { action: 'remove', names, confirmed: true } : { action: 'remove', name: skill.name, confirmed: true });
  } finally { uninstalling.value = ''; }
}
async function selectSkillAction(row: AppDataListRow, action: string) {
  if (busy.value) return;
  const name = String(row.name);
  if (action === 'view') {
    // Open straight away; reading every copy of the skill can take a moment.
    viewingName.value = name; document.value = undefined; documentVersion.value = '0'; documentDialog.value = true;
    await run({ action: 'view', name });
    if (!document.value) documentDialog.value = false;
    return;
  }
  if (action === 'sync' && !row.builtIn && row.origin !== 'synced') { await run({ action: 'sync', name }); return; }
  if (action !== 'delete' || row.builtIn) return;
  try {
    await ElMessageBox.confirm(translate('surface.skills.deleteMessage', { name }), translate('surface.skills.deleteTitle', { name }), {
      type: 'warning', confirmButtonText: translate('surface.skills.delete'), cancelButtonText: translate('common.cancel'),
      confirmButtonType: 'danger',
    });
  } catch { return; }
  await run({ action: 'remove', name, confirmed: true });
}
async function run(input: SkillManagerInput) {
  if (busy.value) return;
  busy.value = true; error.value = ''; activeSource.value = input.action === 'install' ? input.source : ''; syncing.value = input.action === 'sync' && !input.name; rowTask.value = (input.action === 'remove' && 'name' in input) || (input.action === 'sync' && input.name) ? { name: input.name!, action: input.action } : undefined;
  try {
    if (!appApi) throw new Error(translate('surface.skills.unavailable'));
    const result = await appApi.manageSkills(input);
    const { document: viewed, ...catalog } = result;
    state.value = catalog;
    if (input.action === 'view' && viewed) { document.value = viewed; documentVersion.value = '0'; }
    if (input.action === 'install') { source.value = ''; installDialog.value = false; }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    if (!['list', 'view'].includes(input.action)) try {
      const refreshed = await appApi?.manageSkills({ action: 'list' });
      if (refreshed) state.value = refreshed;
    } catch { /* Keep the last known catalog and the operation error. */ }
  } finally { busy.value = false; activeSource.value = ''; syncing.value = false; rowTask.value = undefined; }
}
function installSource() {
  if (!source.value.trim()) return;
  const subset = providerChoices.value.length > 1 && installBackends.value.length < providerChoices.value.length;
  void run({ action: 'install', source: source.value.trim(), ...(subset ? { backends: installBackends.value } : {}) });
}
async function confirmSync() {
  try {
    await ElMessageBox.confirm(translate('surface.skills.syncMessage'), translate('surface.skills.syncTitle'), {
      type: 'warning', confirmButtonText: translate('surface.skills.sync'), cancelButtonText: translate('common.cancel'),
    });
  } catch { return; }
  await run({ action: 'sync' });
}
onMounted(() => run({ action: 'list' }));
</script>

<style scoped>
.settings-skills__toolbar { display: flex; gap: var(--space-6); margin: var(--space-4) 0 var(--space-12); }
.settings-skills__toolbar .settings-skills__search { flex: 1; min-width: 0; margin: 0; }
.settings-skills__kind { flex: 0 0 140px; width: 140px; }
.settings-skills__search { margin: var(--space-4) 0 var(--space-12); }
.settings-skills__count { margin-left: var(--space-3); padding: var(--space-1) var(--space-4); border-radius: var(--radius-full); background: var(--color-surface-high); font-size: var(--font-size-12); }
.settings-skills__error { color: var(--color-error); white-space: pre-line; }
.settings-skills__inventory { border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.settings-skills__inventory :deep(.app-data-list__row) { gap: var(--space-8); border-radius: 0; padding: var(--space-6) var(--space-8); }
.settings-skills__inventory :deep(.app-data-list__row + .app-data-list__row) { border-top: 1px solid var(--color-border); }
.settings-skills__inventory :deep(.app-data-list__actions) { width: 28px; min-width: 28px; }
.settings-skills__inventory :deep(.app-data-list__empty) { padding: var(--space-12); border: 0; }
.settings-skills__identity { display: flex; align-items: center; gap: var(--space-6); min-width: 0; }
.settings-skills__spinner { margin: 6px; }
.settings-skills__inventory :deep(.app-data-list__row:has(.settings-skills__spinner) .app-data-list__actions) { opacity: 1; pointer-events: auto; }
.settings-skills__agent { display: inline-flex; align-items: center; gap: var(--space-3); }
.settings-skills__glyph { flex: 0 0 auto; width: 32px; height: 32px; padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-high); color: var(--color-text-muted); }
.settings-skills__details { flex: 1; min-width: 0; display: grid; gap: var(--space-2); }
.settings-skills__name { display: flex; align-items: center; gap: var(--space-4); min-width: 0; }
.settings-skills__name strong { font-weight: var(--font-weight-medium); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-skills__origin { flex: 0 0 auto; border-radius: var(--radius-sm); padding: 0 var(--space-3); background: var(--color-surface-high); color: var(--color-text-muted); font-size: var(--font-size-11); }
.settings-skills__description { color: var(--color-text-muted); font-size: var(--font-size-12); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-skills__providers { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-4); max-width: 40%; }
.settings-skills__availability { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; color: var(--color-text); border-radius: var(--radius-sm); }
.settings-skills__availability[data-status='missing'] { opacity: 0.25; }
.settings-skills__availability[data-status='conflict'] { color: var(--color-on-warning-container); background: var(--color-warning-container); }
.settings-skills__cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr)); gap: var(--space-8); }
.settings-skills__card { display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-lowest); }
.settings-skills__art { aspect-ratio: 3 / 2; overflow: hidden; background: var(--color-surface-high); }
.settings-skills__art img { display: block; width: 100%; height: 100%; object-fit: cover; }
.settings-skills__card-body { display: flex; flex: 1; flex-direction: column; gap: var(--space-3); min-width: 0; padding: var(--space-8); }
.settings-skills__source { color: var(--color-text); font-size: var(--font-size-14); font-weight: var(--font-weight-semibold); text-decoration: none; }
.settings-skills__source:hover { text-decoration: underline; }
.settings-skills__card-body p { margin: 0 0 var(--space-6); color: var(--color-text-muted); font-size: var(--font-size-12); line-height: var(--line-height-18); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.settings-skills__actions { display: flex; gap: var(--space-4); margin-top: auto; }
.settings-skills__actions .app-button { flex: 1; }
.settings-skills__actions .settings-skills__icon-only { flex: 0 0 auto; width: var(--space-16); padding: 0; }
.settings-skills__skeleton { display: grid; border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.settings-skills__skeleton-row { display: grid; gap: var(--space-3); padding: var(--space-8); }
.settings-skills__skeleton-row + .settings-skills__skeleton-row { border-top: 1px solid var(--color-border); }
.settings-skills__skeleton-row span { height: 12px; border-radius: var(--radius-sm); background: var(--color-surface-high); animation: settings-skills-pulse 1.4s ease-in-out infinite; }
.settings-skills__skeleton-row span:first-child { width: 32%; }
.settings-skills__skeleton-row span:last-child { width: 68%; opacity: 0.6; }
@keyframes settings-skills-pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .settings-skills__skeleton-row span { animation: none; } }
.settings-skills__document-loading { display: grid; gap: var(--space-4); padding: var(--space-2) 0; }
.settings-skills__document-loading span { height: 12px; border-radius: var(--radius-sm); background: var(--color-surface-high); animation: settings-skills-pulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .settings-skills__document-loading span { animation: none; } }
.settings-skills__viewer { max-height: 60vh; overflow: auto; user-select: text; }
.settings-skills__summary { margin: 0 0 var(--space-8); padding-bottom: var(--space-8); border-bottom: 1px solid var(--color-border); color: var(--color-text-muted); font-size: var(--font-size-13); line-height: var(--line-height-20); }
.settings-skills__document { margin: 0; max-height: 60vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-family-mono); font-size: var(--font-size-12); line-height: var(--line-height-20); user-select: text; }
.settings-skills__author, .settings-skills__empty { color: var(--color-text-muted); font-size: var(--font-size-12); }
</style>
