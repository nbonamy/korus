<template>
  <FormDialog :model-value="true" :title="t('guest.join')" width="440px" @update:model-value="emit('close')">
    <FormField v-if="needsName" :label="t('guest.displayName')" label-for="guest-display-name">
      <el-input id="guest-display-name" v-model="name" autocomplete="nickname" :maxlength="80" :disabled="busy" @keyup.enter="submit" />
    </FormField>
    <FormField v-else :label="t('guest.invitation')" label-for="guest-invitation">
      <el-input id="guest-invitation" v-model="invitation" type="textarea" :rows="3" :maxlength="2048" :disabled="busy" />
    </FormField>
    <p v-if="failed" role="alert">{{ t('guest.storageFailed') }}</p>
    <p v-else-if="view && ['invalid', 'upgradeRequired', 'rejected', 'storageUnavailable'].includes(view.status)" role="alert">{{ t(`guest.status.${view.status}`) }}</p>
    <template #footer>
      <el-button class="app-button app-button--tertiary" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</el-button>
      <el-button class="app-button" type="primary" :disabled="busy || (needsName ? !validName : !invitation.trim())" @click="submit">{{ t('guest.join') }}</el-button>
    </template>
  </FormDialog>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GuestJoinControl, GuestJoinView } from '@workspace/core/guest-navigation';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
const props = defineProps<{ view: GuestJoinView | null; busy: boolean; failed: boolean; control: (input: GuestJoinControl) => Promise<boolean> }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n(); const invitation = ref(''); const name = ref('');
const needsName = computed(() => props.view?.status === 'needsName');
const validName = computed(() => Boolean(name.value.trim()) && !/[\p{Cc}\p{Cf}]/u.test(name.value));
async function submit() {
  if (props.busy) return;
  if (needsName.value && validName.value && props.view) {
    if (await props.control({ action: 'join', id: props.view.id, name: name.value.trim() })) emit('close');
  } else if (invitation.value.trim()) {
    const ok = await props.control({ action: 'prepare', link: invitation.value.trim() });
    if (ok && props.view && !['needsName', 'invalid', 'upgradeRequired'].includes(props.view.status)) emit('close');
  }
}
</script>
