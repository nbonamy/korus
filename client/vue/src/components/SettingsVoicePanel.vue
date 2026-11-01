<template>
  <SettingsPanelFrame
    :title="$t('surface.settingsVoicePanel.voice')"
    title-id="settings-voice-title"
  >
    <template #banner>
      <SettingsIntro
        kind="voice"
        :title="$t('surface.settingsVoicePanel.introTitle')"
        :description="$t('surface.settingsVoicePanel.introDescription')"
      >
        <template #action>
          <el-switch
            :model-value="settings.spokenAnnouncementsEnabled"
            :aria-label="$t('surface.settingsVoicePanel.spokenAcknowledgments')"
            @update:model-value="updateSpokenAnnouncementsEnabled"
          />
        </template>
      </SettingsIntro>
    </template>

    <template v-if="settings.spokenAnnouncementsEnabled">
      <FormSection
        :title="$t('surface.settingsVoicePanel.voice')"
        title-id="settings-voice-choice-title"
      >
        <div class="settings-voice-panel__choice">
          <div
            class="settings-voice-panel__voices"
            role="radiogroup"
            :aria-label="$t('surface.settingsVoicePanel.voice')"
          >
            <div
              v-for="option in voiceOptions"
              :key="option.value"
              class="settings-voice-panel__voice"
              :class="{ 'settings-voice-panel__voice--selected': option.value === settings.spokenAnnouncementVoice }"
            >
              <button
                type="button"
                role="radio"
                class="settings-voice-panel__voice-select"
                :aria-checked="option.value === settings.spokenAnnouncementVoice"
                @click="updateSpokenAnnouncementVoice(option.value)"
              >
                <strong>{{ option.name }}</strong>
                <span>{{ option.accent }}</span>
              </button>
              <button
                type="button"
                class="settings-voice-panel__voice-play"
                :disabled="previewingVoice !== null"
                :aria-busy="previewingVoice === option.value"
                :aria-label="$t('surface.settingsVoicePanel.previewVoiceName', { name: option.name })"
                @click="previewVoice(option.value)"
              >
                <span
                  v-if="previewingVoice === option.value"
                  class="app-spinner"
                  aria-hidden="true"
                />
                <PlayerPlayIcon v-else aria-hidden="true" />
              </button>
            </div>
          </div>
          <p
            v-if="voicePreviewError"
            class="settings-voice-panel__error"
            role="alert"
          >{{ voicePreviewError }}</p>
          <p class="settings-voice-panel__help">{{ $t('surface.settingsVoicePanel.chooseAnOnDeviceNeuralVoice') }}</p>
        </div>
      </FormSection>

      <FormSection
        :title="$t('surface.settingsVoicePanel.whenToSpeak')"
        title-id="settings-voice-rules-title"
      >
        <FormRow
          :title="$t('surface.settingsVoicePanel.scope')"
          :description="$t('surface.settingsVoicePanel.chooseWhichAgentsMaySpeak')"
        >
          <template #control>
            <el-select
              class="settings-voice-panel__speech-scope-select"
              :model-value="settings.spokenAnnouncementScope"
              :aria-label="$t('surface.settingsVoicePanel.spokenAcknowledgmentScope')"
              @update:model-value="updateSpokenAnnouncementScope"
            >
              <el-option
                :label="$t('surface.settingsVoicePanel.selectedAgentOnly')"
                value="selected"
              />
              <el-option
                :label="$t('surface.settingsVoicePanel.allAgents')"
                value="all"
              />
            </el-select>
          </template>
        </FormRow>
        <FormRow
          as="label"
          :title="$t('surface.settingsVoicePanel.dictatedPromptsOnly')"
          :description="$t('surface.settingsVoicePanel.speakOnlyForTasksStartedWithVoiceDictation')"
        >
          <template #control>
            <el-switch
              :model-value="settings.spokenAnnouncementsOnlyForDictatedPrompts"
              :aria-label="$t('surface.settingsVoicePanel.dictatedPromptsOnly')"
              @update:model-value="updateSpokenAnnouncementsOnlyForDictatedPrompts"
            />
          </template>
        </FormRow>
        <FormRow
          as="label"
          :title="$t('surface.settingsVoicePanel.onlySpeakWhileFocused')"
          :description="$t('surface.settingsVoicePanel.silenceAcknowledgmentsWhileAppIsInTheBackground')"
        >
          <template #control>
            <el-switch
              :model-value="settings.spokenAnnouncementsOnlyWhenFocused"
              :aria-label="$t('surface.settingsVoicePanel.onlySpeakWhileFocused')"
              @update:model-value="updateSpokenAnnouncementsOnlyWhenFocused"
            />
          </template>
        </FormRow>
      </FormSection>
    </template>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { AppGeneralSettings, SpokenAnnouncementScope, SpokenAnnouncementVoice, UpdateSettingsInput } from '@workspace/core/contracts';
import { translate } from '../i18n';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsIntro from './SettingsIntro.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';
import { PlayerPlayIcon } from '../shared/icons/app-icons';
import { appApi } from '../platform-api';

const props = defineProps<{
  settings: AppGeneralSettings;
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
}>();

const previewingVoice = ref<SpokenAnnouncementVoice | null>(null);
const voicePreviewError = ref<string | null>(null);
const voiceOptions: Array<{ name: string; accent: string; value: SpokenAnnouncementVoice }> = [
  ['voiceHeart', 'af_heart'],
  ['voiceBella', 'af_bella'],
  ['voiceNicole', 'af_nicole'],
  ['voiceSarah', 'af_sarah'],
  ['voiceAdam', 'am_adam'],
  ['voiceMichael', 'am_michael'],
  ['voiceEmma', 'bf_emma'],
  ['voiceGeorge', 'bm_george'],
].map(([key, value]) => {
  const [name = '', accent = ''] = translate(`surface.settingsVoicePanel.${key}`).split(' · ');
  return { name, accent, value: value as SpokenAnnouncementVoice };
});

function updateSpokenAnnouncementsEnabled(value: boolean | string | number): void {
  void props.updateSettings?.({
    general: {
      spokenAnnouncementsEnabled: value === true,
    },
  });
}

function updateSpokenAnnouncementScope(value: SpokenAnnouncementScope): void {
  void props.updateSettings?.({
    general: { spokenAnnouncementScope: value },
  });
}

function updateSpokenAnnouncementsOnlyForDictatedPrompts(value: boolean | string | number): void {
  void props.updateSettings?.({
    general: { spokenAnnouncementsOnlyForDictatedPrompts: value === true },
  });
}

function updateSpokenAnnouncementsOnlyWhenFocused(value: boolean | string | number): void {
  void props.updateSettings?.({
    general: { spokenAnnouncementsOnlyWhenFocused: value === true },
  });
}

function updateSpokenAnnouncementVoice(value: SpokenAnnouncementVoice): void {
  voicePreviewError.value = null;
  void props.updateSettings?.({
    general: { spokenAnnouncementVoice: value },
  });
}

async function previewVoice(voice: SpokenAnnouncementVoice): Promise<void> {
  voicePreviewError.value = null;
  previewingVoice.value = voice;
  try {
    const result = await appApi?.previewSpokenAnnouncementVoice?.(voice);
    if (!result?.queued) {
      voicePreviewError.value = translate('surface.settingsVoicePanel.voicePreviewUnavailable');
    }
  } catch {
    voicePreviewError.value = translate('surface.settingsVoicePanel.voicePreviewUnavailable');
  } finally {
    previewingVoice.value = null;
  }
}
</script>

<style scoped>
.settings-voice-panel__choice {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-8);
}

.settings-voice-panel__voices {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-4);
}

.settings-voice-panel__voice {
  position: relative;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
}

.settings-voice-panel__voice--selected {
  border-color: var(--color-primary);
  background: var(--color-primary-container);
}

.settings-voice-panel__voice-select {
  width: 100%;
  min-height: var(--space-20);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-4) var(--space-12) var(--space-4) var(--space-6);
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.settings-voice-panel__voice-select:focus-visible,
.settings-voice-panel__voice-play:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.settings-voice-panel__voice-select strong {
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-20);
}

.settings-voice-panel__voice-select span {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  line-height: var(--line-height-16);
}

.settings-voice-panel__voice--selected .settings-voice-panel__voice-select span {
  color: var(--color-on-primary-container);
}

.settings-voice-panel__voice-play {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  width: var(--space-10);
  height: var(--space-10);
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.settings-voice-panel__voice-play:hover:not(:disabled) {
  background: var(--color-surface-high);
  color: var(--color-text);
}

.settings-voice-panel__voice-play:disabled {
  cursor: default;
  opacity: 0.4;
}

.settings-voice-panel__voice-play[aria-busy='true'] {
  opacity: 1;
}

.settings-voice-panel__voice-play svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.settings-voice-panel__speech-scope-select {
  width: 220px;
}

.settings-voice-panel__help,
.settings-voice-panel__error {
  margin: 0;
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.settings-voice-panel__help {
  color: var(--color-text-muted);
}

.settings-voice-panel__error {
  color: var(--color-error);
}

@media (max-width: 640px) {
  .settings-voice-panel__voices {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
