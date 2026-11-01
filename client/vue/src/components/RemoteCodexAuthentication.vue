<template>
  <section class="remote-codex-auth" aria-live="polite">
    <template v-if="connected">
      <span>{{ $t('surface.remoteCodexAuth.connected') }}<template v-if="email"> · {{ email }}</template></span>
    </template>
    <template v-else-if="login">
      <div class="remote-codex-auth__code-row">
        <span class="remote-codex-auth__step-number" aria-hidden="true">1</span>
        <el-button class="remote-codex-auth__step-action" text size="small"
          :aria-label="$t(codeCopied ? 'surface.remoteCodexAuth.copied' : 'surface.remoteCodexAuth.copy')"
          :title="$t(codeCopied ? 'surface.remoteCodexAuth.copied' : 'surface.remoteCodexAuth.copy')"
          @click="copyCode">
          <span>{{ $t(codeCopied ? 'surface.remoteCodexAuth.copied' : 'surface.remoteCodexAuth.copy') }}</span>
          <strong class="remote-codex-auth__code">{{ login.userCode }}</strong>
          <component :is="codeCopied ? CheckIcon : CopyIcon" aria-hidden="true" />
        </el-button>
      </div>
      <span v-if="copyFailed">{{ $t('surface.remoteCodexAuth.copyFailed') }}</span>
      <div class="remote-codex-auth__code-row">
        <span class="remote-codex-auth__step-number" aria-hidden="true">2</span>
        <el-button text size="small" @click="openVerification">{{ $t('surface.remoteCodexAuth.open') }}</el-button>
      </div>
      <div class="remote-codex-auth__actions">
        <el-button text size="small" :disabled="busy" @click="cancelLogin">{{ $t('surface.remoteCodexAuth.cancel') }}</el-button>
      </div>
    </template>
    <template v-else-if="!busy && (authentication || error)">
      <span v-if="!authentication" :title="error">{{ $t('surface.remoteCodexAuth.unavailable') }}</span>
      <button class="app-button app-button--secondary" type="button" :disabled="busy" :aria-busy="busy" @click="authentication ? start() : refresh()">
        {{ $t(authentication ? 'surface.remoteCodexAuth.retrySignIn' : 'surface.remoteCodexAuth.retry') }}
      </button>
    </template>
    <span v-else class="remote-codex-auth__progress" role="status">{{ $t(busy ? 'surface.remoteCodexAuth.starting' : 'surface.remoteCodexAuth.checking') }}</span>
    <p v-if="error && (authentication || login)" class="remote-codex-auth__error">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { CheckIcon, CopyIcon } from '../shared/icons/app-icons';
import type { RemoteConnection } from '@workspace/core/contracts';
import { useRemoteCodexAuthentication, type RemoteCodexAuthApi } from './use-remote-codex-authentication';

const props = defineProps<{ connection: RemoteConnection; api?: RemoteCodexAuthApi }>();
const emit = defineEmits<{ connected: []; cancel: []; activity: [active: boolean] }>();
const state = props.api
  ? useRemoteCodexAuthentication(() => props.connection, () => props.api)
  : useRemoteCodexAuthentication(() => props.connection);
const { authentication, login, connected, busy, error, start, cancel, refresh } = state;
watch(() => !connected.value && (busy.value || login.value !== null || (!authentication.value && !error.value)), active => emit('activity', active), { immediate: true });
onScopeDispose(() => emit('activity', false));
watch(connected, value => { if (value) emit('connected'); });
const codeCopied = ref(false);
const copyFailed = ref(false);
watch(() => login.value?.userCode, () => {
  codeCopied.value = false;
  copyFailed.value = false;
});
async function cancelLogin() {
  await cancel();
  if (!login.value) emit('cancel');
}
async function copyCode() {
  const code = login.value?.userCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    if (login.value?.userCode !== code) return;
    codeCopied.value = true;
    copyFailed.value = false;
  } catch {
    if (login.value?.userCode !== code) return;
    codeCopied.value = false;
    copyFailed.value = true;
  }
}
const email = computed(() => authentication.value?.account?.type === 'chatgpt' ? authentication.value.account.email : null);
function openVerification() {
  if (login.value) window.open(login.value.verificationUrl, '_blank', 'noopener,noreferrer');
}
</script>

<style scoped>
.remote-codex-auth {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  margin-top: var(--space-2);
  margin-bottom: var(--space-8);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.remote-codex-auth__progress {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
}

.remote-codex-auth__code {
  color: var(--color-text);
  user-select: all;
}

.remote-codex-auth__actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  margin-left: calc(var(--space-10) + var(--space-4));
}

.remote-codex-auth__code-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex: 0 0 auto;
}

.remote-codex-auth__step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 var(--space-10);
  width: var(--space-10);
  height: var(--space-10);
  border-radius: var(--radius-full);
  background: var(--color-text-muted);
  color: var(--color-surface-lowest);
  font-weight: var(--font-weight-semibold);
}

.remote-codex-auth__step-action :deep(> span) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
}

.remote-codex-auth__step-action :deep(svg) {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.remote-codex-auth__error {
  margin: 0;
  color: var(--color-error);
  overflow-wrap: anywhere;
}
</style>
