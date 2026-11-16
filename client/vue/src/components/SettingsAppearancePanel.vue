<template>
  <SettingsPanelFrame
    :title="$t('surface.settingsAppearancePanel.appearance')"
    title-id="settings-appearance-title"
  >
    <template #banner>
      <SettingsIntro kind="appearance" :title="$t('surface.settingsAppearancePanel.introTitle')" :description="$t('surface.settingsAppearancePanel.introDescription')" />
    </template>
    <FormSection
      :title="$t('surface.settingsAppearancePanel.color')"
      title-id="settings-appearance-color-title"
    >
      <FormRow
        as="label"
        :title="$t('surface.settingsAppearancePanel.mode')"
        :description="$t('surface.settingsAppearancePanel.chooseHowAppFollowsLightAndDarkAppearances')"
      >
        <template #control>
          <el-segmented
            :model-value="settings.mode"
            :options="modeOptions"
            @update:model-value="updateMode"
          />
        </template>
      </FormRow>
      <FormRow
        as="label"
        :title="$t('surface.settingsAppearancePanel.theme')"
        :description="$t('surface.settingsAppearancePanel.selectTheColorPaletteUsedAcrossTheApp')"
      >
        <template #control>
          <el-select
            class="settings-appearance-panel__theme-select"
            :model-value="settings.skin ? 'custom-skin' : settings.id"
            :aria-label="$t('surface.settingsAppearancePanel.theme')"
            @update:model-value="updateThemeId"
          >
            <el-option v-if="settings.skin" :label="$t('surface.settingsAppearancePanel.customSkin')" value="custom-skin" disabled />
            <el-option
              v-for="theme in visibleThemes"
              :key="theme.id"
              :label="theme.name"
              :value="theme.id"
            />
          </el-select>
        </template>
      </FormRow>
      <FormRow :title="$t('surface.settingsAppearancePanel.skin')">
        <template #copy>
          <I18nT keypath="surface.settingsAppearancePanel.loadSkinsFrom" tag="span">
            <template #site><a class="settings-appearance-panel__skin-link" :href="skinGalleryUrl" target="_blank" rel="noopener noreferrer" @click.prevent="appPlatformActions.openExternal?.(skinGalleryUrl)">{{ skinGalleryLabel }}</a></template>
          </I18nT>
        </template>
        <template #control>
          <div class="settings-appearance-panel__theme-actions">
            <el-select
              class="settings-appearance-panel__skin-select"
              popper-class="settings-appearance-panel__skin-menu"
              :model-value="selectedSkin"
              :aria-label="$t('surface.settingsAppearancePanel.skin')"
              :placeholder="$t('surface.settingsAppearancePanel.chooseSkin')"
              :disabled="loadingSkin"
              filterable
              @visible-change="(visible: boolean) => visible && openSkinMenu()"
              @update:model-value="loadSkin"
            >
              <el-option :label="$t('surface.settingsAppearancePanel.loadSkinFile')" value="load-file" />
              <el-option v-if="settings.skin && selectedSkin === 'loaded-skin'" :label="settings.skin.name" value="loaded-skin" disabled />
              <el-option-group v-if="localSkins.length" :label="$t('surface.settingsAppearancePanel.localSkins')">
                <el-option v-for="local in localSkins" :key="local.name" class="settings-appearance-panel__skin-option" :label="local.skin.name" :aria-label="local.skin.name" :value="`${localSkinPrefix}${local.name}`">
                  <span class="settings-appearance-panel__skin-name">{{ local.skin.name }}</span>
                  <button class="settings-appearance-panel__skin-delete" type="button"
                    :aria-label="$t('surface.settingsAppearancePanel.deleteSkin', { name: local.skin.name })" :title="$t('surface.settingsAppearancePanel.deleteSkin', { name: local.skin.name })"
                    @mousedown.prevent @click.stop.prevent="deleteSkin(local)" @keydown.enter.stop @keydown.space.stop
                  ><Trash2Icon aria-hidden="true" /></button>
                </el-option>
              </el-option-group>
              <el-option-group v-if="skins.length" :label="skinGalleryLabel">
              <el-option v-for="skin in skins" :key="skin.slug" class="settings-appearance-panel__skin-option" :label="skin.name" :value="skin.slug" :aria-label="skin.name">
                <span class="settings-appearance-panel__skin-name">{{ skin.name }}</span>
                <a class="settings-appearance-panel__skin-preview" :href="`${skinGalleryUrl}/skins/${skin.slug}`" target="_blank" rel="noopener noreferrer"
                  :aria-label="$t('surface.settingsAppearancePanel.previewSkin', { name: skin.name })" :title="$t('surface.settingsAppearancePanel.previewSkin', { name: skin.name })"
                  @mousedown.prevent @click.stop.prevent="appPlatformActions.openExternal?.(`${skinGalleryUrl}/skins/${skin.slug}`)" @keydown.enter.stop
                ><ExternalLinkIcon aria-hidden="true" /></a>
              </el-option>
              </el-option-group>
            </el-select>
            <input ref="skinFileInput" type="file" accept=".json,application/json" hidden @change="loadSkinFile" />
            <button v-if="settings.skin" class="app-button app-button--neutral" type="button" :title="$t('surface.settingsAppearancePanel.removeSkinTitle', { name: settings.skin.name })" @click="removeTheme">{{ $t('surface.settingsAppearancePanel.removeSkin') }}</button>
          </div>
          <p v-if="skinError" class="settings-appearance-panel__error" role="alert">{{ skinError }}</p>
        </template>
      </FormRow>
    </FormSection>

    <FormSection
      :title="$t('surface.settingsAppearancePanel.typography')"
      title-id="settings-appearance-typography-title"
    >
      <FormGrid>
        <FormField
          density="compact"
          :label="$t('surface.settingsAppearancePanel.chatFontSize')"
          :help="$t('surface.settingsAppearancePanel.adjustConversationTextSize')"
        >
          <el-input-number
            :model-value="settings.chatFontSize"
            :aria-label="$t('surface.settingsAppearancePanel.chatFontSize')"
            :min="11"
            :max="22"
            @update:model-value="updateNumericTheme('chatFontSize', $event)"
          />
        </FormField>
        <FormField
          density="compact"
          :label="$t('surface.settingsAppearancePanel.codeFontSize')"
          :help="$t('surface.settingsAppearancePanel.adjustMonospaceTextSizeInCodeAndCommandOutput')"
        >
          <el-input-number
            :model-value="settings.codeFontSize"
            :aria-label="$t('surface.settingsAppearancePanel.codeFontSize')"
            :min="11"
            :max="22"
            @update:model-value="updateNumericTheme('codeFontSize', $event)"
          />
        </FormField>
      </FormGrid>
    </FormSection>

    <FormSection
      :title="$t('surface.settingsAppearancePanel.diffPreview')"
      title-id="settings-appearance-diff-preview-title"
    >
      <GitDiffPreviewPanel
        class="settings-appearance-panel__diff-preview"
        :diff="diffPreview"
      />
    </FormSection>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed, onBeforeUnmount, ref } from 'vue';
import { I18nT } from 'vue-i18n';
import { ElMessageBox } from 'element-plus';
import { appApi, appPlatformActions } from '../platform-api';
import { maxThemeFileSize, parseCustomTheme, type CustomAppTheme, type LocalSkin } from '@workspace/core/custom-themes';
import { fetchCatalogSkin, fetchSkinCatalog, skinGalleryUrl, type CatalogSkin } from '../theme/skin-catalog';
import { ExternalLinkIcon, Trash2Icon } from '../shared/icons/app-icons';
import type { AppThemeSettings, UpdateSettingsInput } from '@workspace/core/contracts';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsIntro from './SettingsIntro.vue';
import FormField from '../shared/form/FormField.vue';
import FormGrid from '../shared/form/FormGrid.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';
import GitDiffPreviewPanel from './GitDiffPreviewPanel.vue';
import { appThemes, themeIdForAppearance, themeIdForSystemMode } from '../theme/themes';

const props = defineProps<{
  settings: AppThemeSettings;
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
}>();

const skins = ref<CatalogSkin[]>([]);
const localSkins = ref<LocalSkin[]>([]);
// Catalog slugs and saved file names share one select value space.
const localSkinPrefix = 'local:';
const skinFileInput = ref<HTMLInputElement>();
const loadingSkins = ref(false);
const loadingSkin = ref(false);
const skinError = ref('');
let catalogRequest: AbortController | undefined;
let skinRequest: AbortController | undefined;
onBeforeUnmount(() => { catalogRequest?.abort(); skinRequest?.abort(); });
const selectedSkin = computed(() => {
  const active = props.settings.skin;
  if (!active) return undefined;
  const local = localSkins.value.find(entry => entry.skin.id === active.id);
  if (local) return `${localSkinPrefix}${local.name}`;
  return skins.value.find(skin => skin.name === active.name)?.slug ?? 'loaded-skin';
});
const skinGalleryLabel = new URL(skinGalleryUrl).hostname.replace(/^www\./, '');
const themes = appThemes;
const visibleThemes = computed(() => {
  if (props.settings.mode === 'system') {
    return themes;
  }

  return themes.filter((theme) => theme.appearance === props.settings.mode);
});
const modeOptions = [
  { label: translate('surface.settingsAppearancePanel.light'), value: 'light' },
  { label: translate('surface.settingsAppearancePanel.dark'), value: 'dark' },
  { label: translate('surface.settingsAppearancePanel.system'), value: 'system' },
];
const diffPreview = [
  'diff --git a/src/theme.ts b/src/theme.ts',
  '--- a/src/theme.ts',
  '+++ b/src/theme.ts',
  '@@ -29,5 +29,5 @@',
  ' export const appearance = {',
  "-  accent: 'blue',",
  "+  accent: 'app',",
  "   mode: 'system',",
  ' };',
].join('\n');

function updateTheme(theme: Partial<AppThemeSettings>): void {
  void saveTheme(theme);
}

function saveTheme(theme: Partial<AppThemeSettings>): Promise<void> | undefined {
  // Rebuild imported entries as plain data before crossing the host's IPC boundary.
  return props.updateSettings?.({ theme: {
    ...theme,
    ...(theme.skin ? { skin: parseCustomTheme(theme.skin) } : {}),
  } });
}

function updateMode(mode: string | number): void {
  if (mode !== 'dark' && mode !== 'light' && mode !== 'system') {
    return;
  }

  if (mode === 'system') {
    const systemThemeId = themeIdForSystemMode(props.settings.id);
    updateTheme({ mode, ...(systemThemeId !== props.settings.id ? { id: systemThemeId } : {}) });
    return;
  }

  const currentTheme = themes.find((theme) => theme.id === props.settings.id);
  const nextThemeId = currentTheme?.appearance === mode
    ? currentTheme.id
    : themeIdForAppearance(props.settings.id, mode);

  updateTheme({
    mode,
    ...(nextThemeId ? { id: nextThemeId } : {}),
  });
}

function updateThemeId(id: string): void {
  skinRequest?.abort();
  updateTheme({ id, ...(props.settings.skin ? { skin: null } : {}) });
}

function openSkinMenu(): void {
  void loadLocalSkins();
  void loadCatalog();
}

// Saved sources change outside the app (agents, editors), so every opening rereads them.
async function loadLocalSkins(): Promise<void> {
  try { localSkins.value = await appApi?.listLocalSkins?.() ?? []; }
  catch { localSkins.value = []; }
}

async function deleteSkin(local: LocalSkin): Promise<void> {
  try {
    await ElMessageBox.confirm(translate('surface.settingsAppearancePanel.deleteSkinMessage', { name: local.skin.name }), translate('surface.settingsAppearancePanel.deleteSkin', { name: local.skin.name }), {
      type: 'warning', confirmButtonText: translate('common.delete'), cancelButtonText: translate('common.cancel'), confirmButtonType: 'danger',
    });
  } catch { return; }
  loadingSkin.value = true;
  skinError.value = '';
  try {
    if (!appApi?.deleteLocalSkin) throw new Error('Skin deletion is unavailable.');
    await appApi.deleteLocalSkin(local.name);
    localSkins.value = localSkins.value.filter(entry => entry.name !== local.name);
  } catch { skinError.value = translate('surface.settingsAppearancePanel.deleteSkinError'); }
  finally { loadingSkin.value = false; }
}

async function loadCatalog(): Promise<void> {
  if (loadingSkins.value || skins.value.length) return;
  const request = catalogRequest = new AbortController();
  loadingSkins.value = true;
  skinError.value = '';
  try { skins.value = await fetchSkinCatalog(request.signal); }
  catch { if (!request.signal.aborted) skinError.value = translate('surface.settingsAppearancePanel.catalogError'); }
  finally { loadingSkins.value = false; }
}

async function loadSkin(slug: string): Promise<void> {
  if (slug === 'load-file') {
    skinFileInput.value?.click();
    return;
  }
  const local = slug.startsWith(localSkinPrefix) ? localSkins.value.find(entry => `${localSkinPrefix}${entry.name}` === slug) : undefined;
  if (local) {
    await applySkin(async () => local.skin);
    return;
  }
  await applySkin(signal => fetchCatalogSkin(slug, signal));
}

async function loadSkinFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  await applySkin(async () => {
    if (file.size > maxThemeFileSize) throw new Error('Skin file is too large.');
    return parseCustomTheme(JSON.parse(await file.text()));
  });
}

async function applySkin(load: (signal: AbortSignal) => Promise<CustomAppTheme>): Promise<void> {
  skinRequest?.abort();
  const request = skinRequest = new AbortController();
  loadingSkin.value = true;
  skinError.value = '';
  try {
    const theme = await load(request.signal);
    if (request.signal.aborted) return;
    // The skin layers over the chosen palette and mode, so removing it restores both.
    await saveTheme({ skin: theme });
  } catch { if (!request.signal.aborted) skinError.value = translate('surface.settingsAppearancePanel.loadError'); }
  finally { if (request === skinRequest) loadingSkin.value = false; }
}

function removeTheme(): void {
  skinRequest?.abort();
  updateTheme({
    skin: null,
  });
}

function updateNumericTheme(key: 'chatFontSize' | 'codeFontSize' | 'uiFontSize', value: number | null): void {
  if (typeof value !== 'number') {
    return;
  }

  updateTheme({ [key]: value });
}
</script>

<style scoped>
.settings-appearance-panel__theme-select,
.settings-appearance-panel__skin-select {
  width: 220px;
}

.settings-appearance-panel__skin-option { display: flex; align-items: center; padding-right: var(--space-6); }
.settings-appearance-panel__skin-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.settings-appearance-panel__skin-preview { display: inline-flex; margin-left: var(--space-4); color: var(--color-text-muted); }
.settings-appearance-panel__skin-preview svg { width: var(--icon-sm); height: var(--icon-sm); }
.settings-appearance-panel__skin-delete { display: inline-flex; margin-left: var(--space-4); padding: 0; border: 0; background: none; color: var(--color-text-muted); cursor: pointer; }
.settings-appearance-panel__skin-delete:hover { color: var(--color-error); }
.settings-appearance-panel__skin-delete svg { width: var(--icon-sm); height: var(--icon-sm); }
:global(.settings-appearance-panel__skin-menu .el-scrollbar) {
  --el-scrollbar-bg-color: var(--color-primary);
  --el-scrollbar-hover-bg-color: var(--color-primary);
}
:global(.settings-appearance-panel__skin-menu .el-scrollbar__bar.is-vertical) { width: var(--space-2); }
.settings-appearance-panel__error { color: var(--color-error); }

.settings-appearance-panel__skin-link {
  color: var(--color-secondary);
}

.settings-appearance-panel__theme-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.settings-appearance-panel__diff-preview {
  max-height: 280px;
}
</style>
