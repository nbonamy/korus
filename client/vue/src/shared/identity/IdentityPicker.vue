<template>
  <div class="identity-picker agent-avatar-picker">
    <el-popover
      v-model:visible="popoverOpen"
      placement="right-start"
      :fallback-placements="['left-start', 'bottom-start']"
      trigger="manual"
      :teleported="true"
      :width="276"
      :offset="4"
      :show-arrow="false"
      popper-class="identity-picker-popper"
    >
      <template #reference>
        <button
          class="identity-picker__trigger agent-avatar-picker__trigger"
          type="button"
          :aria-label="resolvedAriaLabel"
          :aria-expanded="popoverOpen"
          @click.stop="popoverOpen = !popoverOpen"
        >
          <slot v-if="!modelValue" name="fallback">
            <AgentAvatar
              class="identity-picker__preview agent-avatar-picker__preview"
              :name="name"
              size="xl"
            />
          </slot>
          <AgentAvatar
            v-else
            class="identity-picker__preview agent-avatar-picker__preview"
            :avatar="modelValue"
            :name="name"
            size="xl"
          />
        </button>
      </template>

      <div
        class="identity-picker__popover agent-avatar-picker__popover"
        role="dialog"
        :aria-label="resolvedDialogLabel"
      >
        <strong v-if="title" class="identity-picker__title agent-avatar-picker__title">{{ title }}</strong>
        <div class="identity-picker__grid">
          <button
            class="identity-picker__preset agent-avatar-picker__preset"
            type="button"
            :aria-label="resolvedEmptyLabel"
            :aria-pressed="!customAvatarActive && !modelValue"
            @click="selectAvatar(undefined)"
          >
          </button>
          <button
            v-for="preset in avatarPresets"
            :key="preset"
            class="identity-picker__preset agent-avatar-picker__preset"
            type="button"
            :aria-label="presetAriaLabel(preset)"
            :aria-pressed="!customAvatarActive && modelValue === preset"
            @click="selectAvatar(preset)"
          >
            <span class="identity-picker__preset-glyph" aria-hidden="true">{{ preset }}</span>
          </button>
          <input
            v-model="customAvatar"
            class="identity-picker__custom agent-avatar-picker__custom"
            :class="{
              'identity-picker__custom--active': customAvatarActive,
              'agent-avatar-picker__custom--active': customAvatarActive,
            }"
            type="text"
            :aria-label="resolvedCustomCharacterAriaLabel"
            :aria-invalid="customAvatarInvalid"
            placeholder="…"
            :title="resolvedCustomCharacterHint"
            @focus="customAvatarActive = true"
            @input="customAvatarInvalid = false"
            @keydown.enter.prevent="applyCustomAvatar"
          />
          <button
            class="identity-picker__custom-apply agent-avatar-picker__custom-apply"
            type="button"
            :aria-label="resolvedCustomApplyAriaLabel"
            :disabled="!customAvatar.trim()"
            @mousedown.prevent
            @click="applyCustomAvatar"
          >
            <CheckIcon aria-hidden="true" />
          </button>
        </div>

        <div class="identity-picker__divider" />

        <button
          class="identity-picker__choose-image agent-avatar-picker__choose-image"
          type="button"
          :aria-label="resolvedChooseImageAriaLabel"
          @click="openImagePicker"
        >
          <PhotoIcon aria-hidden="true" />
          <span>{{ resolvedChooseImageLabel }}</span>
        </button>
        <input
          ref="fileInput"
          class="identity-picker__file agent-avatar-picker__file"
          type="file"
          accept="image/*"
          @change="onImageFileSelected"
        />
      </div>
    </el-popover>
    <button
      v-if="showHint"
      class="identity-picker__hint agent-avatar-picker__hint"
      type="button"
      @click="popoverOpen = !popoverOpen"
    >
      {{ resolvedHint }}
    </button>
    <AgentAvatarCropDialog
      :visible="Boolean(pendingImage)"
      :image="pendingImage"
      :title="resolvedCropTitle"
      :shape="cropShape"
      @apply="applyCroppedAvatar"
      @cancel="cancelCrop"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CheckIcon, PhotoIcon } from '../icons/app-icons';
import AgentAvatar from '../../components/AgentAvatar.vue';
import AgentAvatarCropDialog from '../../components/AgentAvatarCropDialog.vue';

const avatarPresets = [
  '🤖', '🧠', '💻', '🖥️', '👾', '👨‍💻', '👩‍💻', '🦾', '🚀',
  '⚡', '🔧', '🛠️', '⚙️', '🔥', '💡', '🎯', '📡', '🦞', '🐙',
  '🦊', '🦄', '🐺', '🦅', '🦉', '🐝', '🦋', '🎾', '🎵', '👹',
  '🌟', '🎮', '💎', '🌈', '🔮', '🎨', '⭐', '🎧',
];

const props = withDefaults(defineProps<{
  ariaLabel?: string;
  chooseImageAriaLabel?: string;
  chooseImageLabel?: string;
  cropTitle?: string;
  cropShape?: 'circle' | 'square';
  customApplyAriaLabel?: string;
  customCharacterAriaLabel?: string;
  dialogLabel?: string;
  emptyLabel?: string;
  modelValue?: string;
  name: string;
  presetNoun?: string;
  showHint?: boolean;
  title?: string;
}>(), {
  modelValue: undefined,
  showHint: true,
  title: '',
});

const emit = defineEmits<{
  'update:modelValue': [avatar: string | undefined];
}>();

const { t } = useI18n();
const resolvedAriaLabel = computed(() => props.ariaLabel ?? t('identityPicker.change'));
const resolvedChooseImageAriaLabel = computed(() => props.chooseImageAriaLabel ?? t('identityPicker.chooseImage'));
const resolvedChooseImageLabel = computed(() => props.chooseImageLabel ?? t('identityPicker.chooseImageAction'));
const resolvedCropTitle = computed(() => props.cropTitle ?? t('identityPicker.cropTitle'));
const resolvedCustomApplyAriaLabel = computed(() => props.customApplyAriaLabel ?? t('identityPicker.customApply'));
const resolvedCustomCharacterAriaLabel = computed(() => props.customCharacterAriaLabel ?? t('identityPicker.customCharacter'));
const resolvedCustomCharacterHint = computed(() => t('identityPicker.customCharacterHint'));
const resolvedDialogLabel = computed(() => props.dialogLabel ?? t('identityPicker.dialog'));
const resolvedEmptyLabel = computed(() => props.emptyLabel ?? t('identityPicker.empty'));
const resolvedHint = computed(() => t('identityPicker.hint'));

const fileInput = ref<HTMLInputElement | null>(null);
const pendingImage = ref<string | null>(null);
const popoverOpen = ref(false);
const customAvatar = ref('');
const customAvatarInvalid = ref(false);
const customAvatarActive = ref(false);

function presetAriaLabel(preset: string): string {
  return t('identityPicker.usePreset', {
    preset,
    noun: props.presetNoun ?? t('identityPicker.presetNoun'),
  });
}

watch(() => props.modelValue, (value) => {
  const customValue = customAvatarValue(value);
  customAvatar.value = customValue;
  customAvatarActive.value = Boolean(customValue);
}, { immediate: true });

function openImagePicker(): void {
  fileInput.value?.click();
}

function selectAvatar(nextAvatar: string | undefined): void {
  emit('update:modelValue', nextAvatar);
  pendingImage.value = null;
  customAvatarActive.value = false;
  popoverOpen.value = false;
}

function applyCustomAvatar(): void {
  const segments = avatarSegments(customAvatar.value);
  if (segments.length !== 1) {
    customAvatarInvalid.value = true;
    return;
  }

  const [segment] = segments;
  customAvatar.value = '';
  customAvatarInvalid.value = false;
  selectAvatar(segment?.segment);
}

function customAvatarValue(value: string | undefined): string {
  if (!value || value.startsWith('data:image/') || avatarPresets.includes(value)) {
    return '';
  }
  const segments = avatarSegments(value);
  return segments.length === 1 ? segments[0]?.segment ?? '' : '';
}

function avatarSegments(value: string): Intl.SegmentData[] {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value.trim())];
}

function onImageFileSelected(event: Event): void {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  const file = input?.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      pendingImage.value = reader.result;
      popoverOpen.value = false;
    }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function cancelCrop(): void {
  pendingImage.value = null;
}

function applyCroppedAvatar(nextAvatar: string): void {
  emit('update:modelValue', nextAvatar);
  cancelCrop();
}
</script>

<style scoped>
.identity-picker {
  position: relative;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-4);
  min-width: 0;
}

.identity-picker__trigger {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--color-surface-base);
  cursor: pointer;
}

.identity-picker__trigger .identity-picker__preview {
  border-radius: var(--radius-md);
}

.identity-picker__hint {
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-18);
  cursor: pointer;
}

.identity-picker__popover {
  display: grid;
  gap: var(--space-3);
}

.identity-picker__title {
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-semibold);
}

.identity-picker__grid {
  display: grid;
  grid-template-columns: repeat(8, 28px);
  gap: var(--space-2);
}

.identity-picker__preset {
  position: relative;
  width: 28px;
  height: 28px;
  display: block;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  cursor: pointer;
}

.identity-picker__preset[aria-pressed="true"],
.identity-picker__preset:hover {
  background: var(--color-surface-base);
  border-color: var(--color-primary);
}

.identity-picker__preset-glyph {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
  font-size: var(--font-size-20);
  line-height: 1;
  text-align: center;
}

.identity-picker__divider {
  height: 1px;
  background: var(--color-border);
}

.identity-picker__custom {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-20);
  text-align: center;
  outline: none;
}

.identity-picker__custom:focus {
  border-color: var(--color-primary);
}

.identity-picker__custom--active {
  border-color: var(--color-primary);
  background: var(--color-surface-base);
}

.identity-picker__custom::placeholder {
  color: color-mix(in srgb, var(--color-text-muted) 45%, transparent);
  opacity: 1;
}

.identity-picker__custom[aria-invalid="true"] {
  border-color: var(--color-error);
}

.identity-picker__custom-apply {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.identity-picker__custom-apply:hover:not(:disabled) {
  color: var(--color-primary);
}

.identity-picker__custom-apply:disabled {
  color: var(--color-text-muted);
  cursor: default;
  opacity: 0.35;
}

.identity-picker__custom-apply svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  stroke-width: 2.5;
}

.identity-picker__choose-image {
  justify-self: stretch;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: 32px;
  padding: 0 var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: var(--color-surface-low);
  font: inherit;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
}

.identity-picker__choose-image svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.identity-picker__file {
  display: none;
}
</style>
