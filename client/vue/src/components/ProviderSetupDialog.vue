<template>
  <FormDialog :model-value="Boolean(setup)" :title="confirming ? t('engineSetup.confirmTitle') : t('auth.customizeProvider', { provider: providerName })" teleported @update:model-value="!$event && !busy && emit('close')">
    <div v-if="confirming" class="app-form-dialog provider-setup__confirmation">
      <p>{{ t('engineSetup.warning', { count: setup?.affectedAgentIds?.length ?? 0, provider: providerName }) }}</p>
      <p>{{ t('engineSetup.historyPreserved') }}</p>
      <el-checkbox v-model="acknowledged" :disabled="busy" class="provider-setup__acknowledgment">{{ t('engineSetup.acknowledgment') }}</el-checkbox>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <div v-else class="app-form-dialog">
      <FormField :label="t('auth.conversations')" :help="t('auth.separateExplanation')">
        <el-radio-group v-model="isolated" class="provider-setup__choices" :disabled="busy || (setup?.locked && !allowReset)">
          <el-radio :value="false">{{ t('auth.existingSetup') }}</el-radio>
          <el-radio :value="true" class="provider-setup__separate">{{ t('auth.separateChats') }}</el-radio>
          <el-checkbox v-if="isolated" v-model="shareSkills" class="provider-setup__skills" :disabled="busy || (setup?.locked && !allowReset)">{{ t('auth.shareSkills') }}</el-checkbox>
        </el-radio-group>
      </FormField>
      <p v-if="setup?.locked && !allowReset">{{ t('auth.setupLocked') }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="emit('close')">{{ t(confirming ? 'common.cancel' : 'surface.remoteClaudeAuth.close') }}</button>
      <button class="app-button app-button--primary" type="button" :disabled="busy || (confirming ? !acknowledged : setup?.locked && (!allowReset || (isolated === setup.isolated && shareSkills === setup.shareSkills)))" @click="save">{{ t(busy ? 'auth.settingUp' : confirming ? 'engineSetup.removeAndSwitch' : 'auth.saveSetup') }}</button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { backendDisplayName } from '@workspace/core/backend-driver';
import { useI18n } from 'vue-i18n';
import type { ProviderSetupChange, ProviderSetupStatus } from '@workspace/core/contracts/provider-setup';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';

const props = defineProps<{ setup: ProviderSetupStatus | null; busy: boolean; error: string | null; allowReset?: boolean }>();
const providerName = computed(() => props.setup ? backendDisplayName(props.setup.backend) : '');
const emit = defineEmits<{ close: []; save: [choice: ProviderSetupChange] }>();
const { t } = useI18n();
const isolated = ref(true);
const shareSkills = ref(true);
const confirming = ref(false);
const acknowledged = ref(false);
watch(() => props.setup, setup => {
  isolated.value = setup?.isolated ?? true;
  shareSkills.value = setup?.shareSkills ?? true;
  confirming.value = false;
  acknowledged.value = false;
}, { immediate: true });
function save() {
  if (props.busy) return;
  const changesHome = props.setup && isolated.value !== props.setup.isolated;
  if (changesHome && props.setup?.locked && props.allowReset) {
    if (!confirming.value) { confirming.value = true; return; }
    if (!acknowledged.value || !props.setup.affectedAgentIds) return;
    emit('save', { isolated: isolated.value, shareSkills: shareSkills.value, removeAgentIds: [...props.setup.affectedAgentIds] });
  } else emit('save', { isolated: isolated.value, shareSkills: shareSkills.value });
}
</script>

<style scoped>
.provider-setup__confirmation {
  gap: var(--space-6);
}

.provider-setup__confirmation p {
  margin: 0;
  line-height: var(--line-height-20);
}

.provider-setup__choices {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.provider-setup__choices :deep(.el-radio) {
  margin-right: 0;
}

.provider-setup__skills {
  margin-left: var(--space-12);
}

.provider-setup__acknowledgment {
  height: auto;
  margin-top: var(--space-2);
  align-items: flex-start;
  white-space: normal;
}

.provider-setup__acknowledgment :deep(.el-checkbox__input) {
  margin-top: var(--space-1);
}

.provider-setup__acknowledgment :deep(.el-checkbox__label) {
  line-height: var(--line-height-20);
  white-space: normal;
}
</style>
