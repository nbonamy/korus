<template>
  <FormDialog :model-value="true" :title="t('guest.join')" width="440px" @update:model-value="emit('close')">
    <FormField v-if="needsName" :label="t('guest.displayName')" :help="t('guest.displayNamePurpose')" label-for="guest-display-name">
      <el-input id="guest-display-name" v-model="name" autocomplete="nickname" :maxlength="80" :disabled="pending" @keyup.enter="submit" />
    </FormField>
    <FormField v-else :label="t('guest.invitation')" label-for="guest-invitation">
      <el-input id="guest-invitation" v-model="invitation" type="textarea" :rows="3" :maxlength="2048" :disabled="pending" />
    </FormField>
    <p v-if="saveFailed" role="alert">{{ t('guest.displayNameSaveFailed') }}</p>
    <p v-else-if="failed" role="alert">{{ t('guest.storageFailed') }}</p>
    <p v-else-if="view && ['invalid', 'upgradeRequired', 'rejected', 'storageUnavailable'].includes(view.status)" role="alert">{{ t(`guest.status.${view.status}`) }}</p>
    <template #footer>
      <button type="button" class="app-button app-button--tertiary" :disabled="pending" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button type="button" class="app-button app-button--primary" :disabled="pending || (needsName ? !validName : !invitation.trim())" @click="submit">{{ t('guest.join') }}</button>
    </template>
  </FormDialog>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GuestJoinControl, GuestJoinView } from '@workspace/core/guest-navigation';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
const props = defineProps<{ view: GuestJoinView | null; busy: boolean; failed: boolean; control: (input: GuestJoinControl) => Promise<boolean>; saveDisplayName: (name: string) => Promise<void> }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n(); const invitation = ref(''); const name = ref(''); const submitting = ref(false); const saveFailed = ref(false);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
const needsName = computed(() => props.view?.status === 'needsName');
const validName = computed(() => Boolean(name.value.trim()) && !/[\p{Cc}\p{Cf}]/u.test(name.value));
const pending = computed(() => props.busy || submitting.value);
async function submit() {
  if (pending.value) return;
  submitting.value = true;
  saveFailed.value = false;
  try {
    if (needsName.value && validName.value && props.view) {
      const displayName = name.value.trim();
      const id = props.view.id;
      try { await props.saveDisplayName(displayName); }
      catch { saveFailed.value = true; return; }
      if (disposed) return;
      if (await props.control({ action: 'join', id, name: displayName }) && !disposed) emit('close');
    } else if (invitation.value.trim()) {
      const ok = await props.control({ action: 'prepare', link: invitation.value.trim() });
      if (!disposed && ok && props.view && !['needsName', 'invalid', 'upgradeRequired'].includes(props.view.status)) emit('close');
    }
  } finally {
    submitting.value = false;
  }
}
</script>
