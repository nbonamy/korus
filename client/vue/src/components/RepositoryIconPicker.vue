<template>
  <IdentityPicker
    class="repository-icon-picker"
    :aria-label="t('repositories.icon.change', { repository: label })"
    :choose-image-aria-label="t('repositories.icon.chooseImage')"
    :choose-image-label="t('repositories.icon.chooseImageAction')"
    :crop-title="t('repositories.icon.cropTitle')"
    crop-shape="square"
    :custom-apply-aria-label="t('repositories.icon.customApply')"
    :custom-character-aria-label="t('repositories.icon.customCharacter')"
    :dialog-label="t('repositories.icon.dialog', { repository: label })"
    :empty-label="t('repositories.icon.empty')"
    :model-value="modelValue"
    :name="label"
    :preset-noun="t('repositories.icon.title')"
    :show-hint="false"
    :title="t('repositories.icon.title')"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #fallback>
      <FolderOpenIcon v-if="expanded" aria-hidden="true" />
      <FolderRootIcon v-else aria-hidden="true" />
    </template>
  </IdentityPicker>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { FolderOpenIcon, FolderRootIcon } from '../shared/icons/app-icons';
import IdentityPicker from '../shared/identity/IdentityPicker.vue';

defineProps<{
  label: string;
  modelValue?: string;
  expanded?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [icon: string | undefined];
}>();

const { t } = useI18n();
</script>

<style scoped>
.repository-icon-picker {
  justify-self: auto;
  justify-content: center;
  gap: 0;
}

.repository-icon-picker :deep(.identity-picker__trigger) {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  background: transparent;
}

.repository-icon-picker :deep(.identity-picker__trigger:hover),
.repository-icon-picker :deep(.identity-picker__trigger[aria-expanded="true"]) {
  color: var(--color-text);
  background: var(--color-surface-base);
}

.repository-icon-picker :deep(.identity-picker__trigger > svg) {
  width: 20px;
  height: 20px;
  stroke-width: 1.9;
}

.repository-icon-picker :deep(.identity-picker__preview) {
  --agent-avatar-size: 20px;

  border-radius: var(--radius-sm);
  font-size: var(--font-size-18);
}
</style>
