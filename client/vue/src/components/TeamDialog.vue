<template>
  <FormDialog
    class="team-dialog"
    :model-value="visible"
    :title="dialogTitle"
    @update:model-value="onVisibilityChanged"
  >
    <form class="app-form-dialog" @submit.prevent="submit">
      <FormField
        :label="$t('surface.teamDialog.name')"
        label-for="team-dialog-name"
      >
        <div class="app-form-dialog__control app-form-dialog__input-control">
          <input
            id="team-dialog-name"
            v-model="name"
            class="app-form-dialog__text-input"
            type="text"
            :placeholder="$t('surface.teamDialog.enterTeamName')"
            autofocus
          />
        </div>
      </FormField>

      <FormField :label="$t('surface.teamDialog.color')">
        <div
          class="team-dialog__colors"
          role="radiogroup"
          :aria-label="$t('surface.teamDialog.teamColor')"
        >
          <button
            v-for="color in teamColors"
            :key="color"
            class="team-dialog__color"
            :class="{ 'team-dialog__color--selected': color === selectedColor }"
            :style="{ '--team-color': color }"
            type="button"
            role="radio"
            :aria-label="$t('dynamic.teamColor', { color })"
            :aria-checked="color === selectedColor"
            @click="selectedColor = color"
          >
            <CheckIcon
              v-if="color === selectedColor"
              aria-hidden="true"
            />
          </button>
        </div>
      </FormField>

      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        :closable="false"
        show-icon
      />
    </form>

    <template #footer>
      <button class="app-button app-button--tertiary" type="button" @click="close">{{ $t('surface.teamDialog.cancel') }}</button>
      <button
        class="app-button app-button--primary"
        type="button"
        :aria-busy="submitting"
        :disabled="submitting || !canSave"
        @click="submit"
      >
        {{ submitLabel }}
      </button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed, ref, watch } from 'vue';
import type { CreateTeamInput, Team, UpdateTeamInput } from '@workspace/core/contracts';
import { defaultTeamColor, teamColors } from '@workspace/core/team-colors';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import { CheckIcon } from '../shared/icons/app-icons';

const props = withDefaults(defineProps<{
  createTeam: (input: CreateTeamInput) => Promise<Team | null | void>;
  mode?: 'create' | 'edit';
  team?: Team | null;
  updateTeam?: (input: UpdateTeamInput) => Promise<void>;
  visible: boolean;
}>(), {
  mode: 'create',
  team: null,
  updateTeam: async () => undefined,
});

const emit = defineEmits<{
  close: [];
}>();

const name = ref('');
const selectedColor = ref<string>(defaultTeamColor);
const errorMessage = ref<string | null>(null);
const submitting = ref(false);

const canSave = computed(() => name.value.trim().length > 0 && !submitting.value);
const dialogTitle = computed(() => props.mode === 'edit' ? translate('surface.teamDialog.editTeam') : translate('surface.teamDialog.createTeam'));
const submitLabel = computed(() => props.mode === 'edit' ? translate('surface.teamDialog.save') : translate('surface.teamDialog.createTeam'));

watch(() => props.visible, (visible) => {
  if (visible) {
    resetForm();
  }
}, { immediate: true });

async function submit(): Promise<void> {
  if (!canSave.value) {
    return;
  }

  submitting.value = true;
  errorMessage.value = null;
  try {
    if (props.mode === 'edit' && props.team) {
      await props.updateTeam({ id: props.team.id, name: name.value, color: selectedColor.value });
    } else {
      await props.createTeam({ name: name.value, color: selectedColor.value });
    }
    close();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    submitting.value = false;
  }
}

function onVisibilityChanged(nextVisible: boolean): void {
  if (!nextVisible) {
    close();
  }
}

function close(): void {
  errorMessage.value = null;
  emit('close');
}

function resetForm(): void {
  name.value = props.mode === 'edit' ? props.team?.name ?? '' : '';
  selectedColor.value = props.mode === 'edit' ? props.team?.color ?? defaultTeamColor : defaultTeamColor;
  errorMessage.value = null;
  submitting.value = false;
}
</script>

<style scoped>
.team-dialog__colors {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  justify-items: center;
  gap: var(--space-4);
  margin: var(--space-8) 0;
}

.team-dialog__color {
  --team-color: var(--color-primary);
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--radius-full);
  color: var(--color-on-primary);
  background: var(--team-color);
  cursor: pointer;
}

.team-dialog__color--selected {
  border-color: var(--color-surface-lowest);
  box-shadow: 0 0 0 2px var(--color-primary);
}

.team-dialog__color svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  stroke-width: 3px;
}
</style>
