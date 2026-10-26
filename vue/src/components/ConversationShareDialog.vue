<template>
  <FormDialog :model-value="true" :title="t('sharing.title')" width="460px" @update:model-value="close">
    <div class="app-form-dialog" aria-live="polite">
      <p class="app-form-dialog__help">{{ t('sharing.disclosure') }}</p>
      <p class="app-form-dialog__help">{{ t('sharing.approval') }}</p>
      <p v-if="loading" class="app-form-dialog__help" role="status">{{ t('common.loading') }}</p>
      <p v-else-if="state?.active" class="app-form-dialog__help" role="status">
        {{ state.connectedGuests === null ? t('sharing.active') : t('sharing.guests', { count: state.connectedGuests }) }}
      </p>
      <el-alert v-if="(state?.active && state.availability !== 'ready') || state?.availability === 'notConfigured'" :title="t('sharing.temporarilyUnavailable')" type="warning" :closable="false" show-icon />
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <p v-if="copied" class="app-form-dialog__help" role="status">{{ t('sharing.copied') }}</p>
    </div>
    <template #footer-left>
      <button type="button" v-if="state?.active" class="app-button app-button--tertiary" :disabled="busy" @click="run('revoke')">{{ t('sharing.stop') }}</button>
    </template>
    <template #footer>
      <button type="button" v-if="!state?.active" class="app-button app-button--tertiary" :disabled="busy" @click="close">{{ t('sharing.cancel') }}</button>
      <button type="button" v-if="!state && !loading" class="app-button app-button--primary" :disabled="busy" @click="load">{{ t('common.retry') }}</button>
      <button type="button" v-else class="app-button app-button--primary" :aria-busy="busy || loading" :disabled="busy || loading || !state || state.availability === 'notConfigured'" @click="run(state?.active ? 'copy' : 'create')">
        {{ state?.active ? t('sharing.copy') : t('sharing.create') }}
      </button>
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
function shareError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  // Only known, credential-free errors become specific UI copy.
  if (message.includes('Share storage is unavailable.')) return t('sharing.storageUnavailable');
  if (message.includes('Companion identity cannot be loaded.')) return t('sharing.identityUnavailable');
  if (message.includes('Conversation is unavailable for sharing.') || message.includes('Conversation changed.') || message.includes('Share link has changed.')) return t('sharing.conversationChanged');
  if (message.includes('does not support conversation sharing')) return t('sharing.unsupported');
  if (message.includes('conversationShareControl') || message.includes('No handler registered') || message.includes('Unknown backend method')) return t('sharing.restartRequired');
  return t('sharing.failed');
}
async function load() {
  const expected = revision;
  loading.value = true; error.value = '';
  try {
    const result = await props.control({ action: 'status', target: props.target });
    if (!disposed && expected === revision) state.value = result.state;
  } catch (cause) { if (!disposed) error.value = shareError(cause); }
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
  } catch (cause) { if (!disposed) error.value = shareError(cause); }
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
