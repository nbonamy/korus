<template>
  <FormDialog :model-value="true" :title="t('sharing.title')" width="460px" @update:model-value="close">
    <div class="app-form-dialog" aria-live="polite">
      <p class="app-form-dialog__help">{{ t('sharing.disclosure') }}</p>
      <p class="app-form-dialog__help">{{ t('sharing.approval') }}</p>
      <p v-if="loading" class="app-form-dialog__help" role="status">{{ t('common.loading') }}</p>
      <p v-else-if="state?.active" class="app-form-dialog__help" role="status">
        {{ state.connectedGuests === null ? t('sharing.active') : t('sharing.guests', { count: state.connectedGuests }) }}
      </p>
      <FormSection v-if="state?.guests?.length" class="conversation-share-guests">
        <FormRow v-for="guest in state.guests" :key="guest.identity" class="conversation-share-guest" :title="guest.name">
          <template #copy><span v-if="state.guests.filter(other => other.name === guest.name).length > 1">{{ guest.discriminator }}</span></template>
          <template #control>
            <span>{{ t('sharing.writeAccess') }}</span>
            <el-switch :model-value="guest.writeAccess" :aria-label="t('sharing.writeAccessFor', { name: guest.name, discriminator: guest.discriminator })" :disabled="busy || loading" @update:model-value="access(guest.identity, Boolean($event))" />
          </template>
        </FormRow>
      </FormSection>
      <el-alert v-if="(state?.active && state.availability !== 'ready') || state?.availability === 'notConfigured'" :title="t('sharing.temporarilyUnavailable')" type="warning" :closable="false" show-icon />
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    </div>
    <template #footer>
      <button type="button" class="app-button app-button--tertiary" :disabled="busy" @click="close">{{ t('sharing.close') }}</button>
      <button v-if="state?.active" type="button" class="app-button app-button--secondary" :disabled="busy" @click="run('revoke')">{{ t('sharing.stop') }}</button>
      <button v-if="!state && !loading" type="button" class="app-button app-button--primary" :disabled="busy" @click="load">{{ t('common.retry') }}</button>
      <button v-else-if="state" type="button" class="app-button app-button--primary" :aria-busy="busy || loading" :disabled="busy || loading || state.availability === 'notConfigured'" @click="run(state.active ? 'copy' : 'create')">
        {{ state.active ? t('sharing.copy') : t('sharing.share') }}
      </button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConversationShareControl, ConversationShareResult, ConversationShareState, ConversationShareTarget } from '@workspace/core/conversation-sharing';
import { ElMessage } from 'element-plus';
import { appApi } from '../platform-api';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormDialog from '../shared/dialog/FormDialog.vue';
import { conversationShareActiveByAgentIdKey } from './conversation-share-state';

const props = defineProps<{ target: ConversationShareTarget; control: (input: ConversationShareControl) => Promise<ConversationShareResult> }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const shareActiveByAgentId = inject(conversationShareActiveByAgentIdKey, null);
const state = ref<ConversationShareState | null>(null);
const loading = ref(true);
const busy = ref(false);
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
    if (!disposed && expected === revision) {
      state.value = result.state;
      if (shareActiveByAgentId) shareActiveByAgentId[props.target.agentId] = result.state.active;
    }
  } catch (cause) { if (!disposed) error.value = shareError(cause); }
  finally { if (!disposed) loading.value = false; }
}
async function run(action: 'create' | 'copy' | 'revoke') {
  if (busy.value || !state.value) return;
  busy.value = true; error.value = '';
  try {
    const input: ConversationShareControl = action === 'revoke'
      ? { action, target: props.target, handle: state.value.handle! }
      : { action, target: props.target };
    const result = await props.control(input);
    if (disposed) return;
    revision++; state.value = result.state;
    if (shareActiveByAgentId) shareActiveByAgentId[props.target.agentId] = result.state.active;
    if (result.link) {
      try {
        await navigator.clipboard.writeText(result.link);
        if (!disposed) {
          ElMessage.success(t('sharing.inviteLinkCopied'));
          emit('close');
        }
      }
      catch { if (!disposed) error.value = t('sharing.copyFailed'); }
    } else if (action === 'revoke' && !result.state.active) {
      emit('close');
    }
  } catch (cause) { if (!disposed) error.value = shareError(cause); }
  finally { if (!disposed) busy.value = false; }
}
async function access(identity: string, writeAccess: boolean) {
  if (busy.value || loading.value || !state.value?.handle) return;
  busy.value = true; error.value = '';
  const expected = revision;
  try {
    const result = await props.control({ action: 'access', target: props.target, handle: state.value.handle, identity, writeAccess });
    if (!disposed && expected === revision) { revision++; state.value = result.state; }
  } catch (cause) { if (!disposed) error.value = shareError(cause); }
  finally { if (!disposed) busy.value = false; }
}
onMounted(() => {
  unsubscribe = appApi?.onEvent(event => {
    if (event.type !== 'conversation.shareChanged' || event.agentId !== props.target.agentId) return;
    revision++; state.value = event.payload;
    if (shareActiveByAgentId) shareActiveByAgentId[props.target.agentId] = event.payload.active;
  });
  void load();
});
onBeforeUnmount(() => { disposed = true; unsubscribe?.(); });
</script>

<style scoped>
.conversation-share-guests {
  max-height: 40vh;
  overflow: auto;
}
.conversation-share-guests .conversation-share-guest {
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-8);
}
.conversation-share-guest :deep(.form-row__copy) {
  overflow-wrap: anywhere;
}
</style>
