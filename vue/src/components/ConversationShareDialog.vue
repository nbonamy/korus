<template>
  <FormDialog :model-value="true" :title="t('sharing.title')" width="460px" @update:model-value="close">
    <p class="conversation-share__disclosure">{{ t('sharing.disclosure') }}</p>
    <p>{{ t('sharing.approval') }}</p>
    <p v-if="loading" role="status">{{ t('common.loading') }}</p>
    <p v-else-if="state?.active" role="status">
      {{ state.connectedGuests === null ? t('sharing.active') : t('sharing.guests', { count: state.connectedGuests }) }}
    </p>
    <p v-if="state?.availability === 'transportPending'" class="conversation-share__detail">{{ t('sharing.transportPending') }}</p>
    <p v-if="state?.active && ['unavailable', 'capacity', 'rateLimited', 'upgradeRequired'].includes(state.availability)" role="alert">{{ t(`sharing.${state.availability}`) }}</p>
    <p v-if="state?.availability === 'notConfigured'" role="alert">{{ t('sharing.notConfigured') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="copied" role="status">{{ t('sharing.copied') }}</p>
    <template #footer-left>
      <el-button v-if="state?.active" class="app-button app-button--tertiary" :disabled="busy" @click="run('revoke')">{{ t('sharing.stop') }}</el-button>
    </template>
    <template #footer>
      <el-button class="app-button app-button--tertiary" :disabled="busy" @click="close">{{ t('sharing.done') }}</el-button>
      <el-button v-if="!state && !loading" class="app-button" :disabled="busy" @click="load">{{ t('common.retry') }}</el-button>
      <el-button v-else class="app-button" type="primary" :disabled="busy || loading || !state || state.availability === 'notConfigured'" @click="run(state?.active ? 'copy' : 'create')">
        {{ state?.active ? t('sharing.copy') : t('sharing.create') }}
      </el-button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConversationShareControl, ConversationShareResult, ConversationShareState, ConversationShareTarget } from '@workspace/core/conversation-sharing';
import { appApi } from '../platform-api';
import FormDialog from '../shared/dialog/FormDialog.vue';

const props = defineProps<{ target: ConversationShareTarget; control: (input: ConversationShareControl) => Promise<ConversationShareResult> }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const state = ref<ConversationShareState | null>(null);
const loading = ref(true);
const busy = ref(false);
const copied = ref(false);
const error = ref('');
let disposed = false;
let revision = 0;
let unsubscribe: (() => void) | undefined;
function close() { if (!busy.value) emit('close'); }
async function load() {
  const expected = revision;
  loading.value = true; error.value = '';
  try {
    const result = await props.control({ action: 'status', target: props.target });
    if (!disposed && expected === revision) state.value = result.state;
  } catch { if (!disposed) error.value = t('sharing.failed'); }
  finally { if (!disposed) loading.value = false; }
}
async function run(action: 'create' | 'copy' | 'revoke') {
  if (busy.value || !state.value) return;
  busy.value = true; error.value = ''; copied.value = false;
  try {
    const input: ConversationShareControl = action === 'revoke'
      ? { action, target: props.target, handle: state.value.handle! }
      : { action, target: props.target };
    const result = await props.control(input);
    if (disposed) return;
    revision++; state.value = result.state;
    if (result.link) {
      try { await navigator.clipboard.writeText(result.link); if (!disposed) copied.value = true; }
      catch { if (!disposed) error.value = t('sharing.copyFailed'); }
    }
  } catch { if (!disposed) error.value = t('sharing.failed'); }
  finally { if (!disposed) busy.value = false; }
}
onMounted(() => {
  unsubscribe = appApi?.onEvent(event => {
    if (event.type !== 'conversation.shareChanged' || event.agentId !== props.target.agentId) return;
    revision++; state.value = event.payload; copied.value = false;
  });
  void load();
});
onBeforeUnmount(() => { disposed = true; unsubscribe?.(); });
</script>

<style scoped>
.conversation-share__disclosure {
  margin-top: 0;
}
.conversation-share__detail {
  color: var(--color-text-muted);
}
</style>
