<template>
  <OnboardingLandingFrame
    class="codex-login"
    :class="`codex-login--${variant}`"
    :layout="variant === 'connecting' ? 'centered' : 'editorial'"
    :label="t(variant === 'connecting'
      ? 'surface.codexLoginLanding.connectingToApp'
      : 'surface.codexLoginLanding.signInToApp')"
  >
    <div
      class="codex-login__content"
      :class="`codex-login__content--${variant}`"
    >
      <div class="codex-login__mark">
        <img
          :src="appIconUrl"
          :alt="$t('surface.codexLoginLanding.app')"
        >
      </div>
      <template v-if="variant === 'connecting'">
        <h1 class="onboarding-landing-title codex-login__connecting-title">{{ t('auth.connectingTitle') }}</h1>
        <div
          class="codex-login__progress"
          role="progressbar"
          :aria-label="connectionStatus ?? t('auth.connectingStatus')"
        >
          <span class="codex-login__progress-segment" />
        </div>
        <div class="codex-login__status" role="status" aria-live="polite">
          <span class="codex-login__status-dot" aria-hidden="true" />
          <span>{{ connectionStatus ?? t('auth.connectingStatus') }}</span>
        </div>
      </template>
      <template v-else>
        <h1 class="onboarding-landing-title codex-login__sign-in-title">
          <span class="onboarding-landing-title__line">{{ t('auth.signInTitleProduct') }}</span>
          <span class="onboarding-landing-title__line onboarding-landing-title__detail">
            {{ t('auth.signInTitleDetailFirst') }}<br>
            {{ t('auth.signInTitleDetailSecond') }}
          </span>
        </h1>
        <p class="codex-login__description">{{ t('auth.signInDescription') }}</p>
        <div class="codex-login__providers">
          <div class="codex-login__provider">
          <el-button size="large" :class="{ 'codex-login__connect--required': needsSignIn('codex', codexConnected) }" :disabled="missing('codex') || loading || (codexConnected && codexEnabled) || continuing || Boolean(updatingProvider)" @click="emit('login')">
            <BackendIcon backend="codex" />
            {{ t(codexConnected ? (codexEnabled ? 'auth.codexConnected' : 'auth.enableCodex') : 'auth.connectCodex') }}
          </el-button>
          <div class="codex-login__detection">
            <button v-if="cancellable" class="codex-login__cancel" type="button" :disabled="cancelling" @click="emit('cancel')"><i class="app-spinner" aria-hidden="true" />{{ t('auth.cancel') }}</button>
            <template v-else>
            <span v-if="!missing('codex') && updatingProvider === 'codex'" class="codex-login__checking" role="status" aria-busy="true"><i class="app-spinner" aria-hidden="true" /> {{ t('auth.checking') }}</span>
            <span v-else-if="codexConnected || detected('codex')"><CheckIcon aria-hidden="true" /> {{ t(codexConnected ? 'auth.connected' : 'auth.detected') }}</span>
            <ProviderInstallActions v-if="missing('codex')" backend="codex" :busy="updatingProvider === 'codex'" :disabled="Boolean(updatingProvider)" @refresh="emit('refresh-provider', 'codex')" />
            <button v-else-if="detected('codex') && updatingProvider !== 'codex'" type="button" :disabled="loading || continuing || Boolean(updatingProvider)" @click="emit('customize', 'codex')">{{ t('auth.customize') }}</button>
            </template>
          </div>
          </div>
          <div class="codex-login__provider">
          <el-button size="large" :class="{ 'codex-login__connect--required': needsSignIn('claude', claudeConnected) }" :disabled="missing('claude') || claudeLoading || (claudeConnected && claudeEnabled) || continuing || Boolean(updatingProvider)" @click="emit('connect-claude')">
            <BackendIcon backend="claude" />
            {{ t(claudeConnected ? (claudeEnabled ? 'auth.claudeConnected' : 'auth.enableClaude') : 'auth.connectClaude') }}
          </el-button>
          <div class="codex-login__detection">
            <span v-if="!missing('claude') && (updatingProvider === 'claude' || claudeLoading)" class="codex-login__checking" role="status" aria-busy="true"><i class="app-spinner" aria-hidden="true" /> {{ t('auth.checking') }}</span>
            <span v-else-if="claudeConnected || detected('claude')"><CheckIcon aria-hidden="true" /> {{ t(claudeConnected ? 'auth.connected' : 'auth.detected') }}</span>
            <ProviderInstallActions v-if="missing('claude')" backend="claude" :busy="updatingProvider === 'claude'" :disabled="Boolean(updatingProvider)" @refresh="emit('refresh-provider', 'claude')" />
            <button v-else-if="detected('claude') && updatingProvider !== 'claude' && !claudeLoading" type="button" :disabled="continuing || Boolean(updatingProvider)" @click="emit('customize', 'claude')">{{ t('auth.customize') }}</button>
          </div>
          </div>
          <div v-if="antigravityAvailable" class="codex-login__provider">
            <el-button size="large" :class="{ 'codex-login__connect--required': needsSignIn('antigravity', antigravityConnected) }" :disabled="missing('antigravity') || antigravityLoading || antigravityPending || (antigravityConnected && antigravityEnabled) || continuing || Boolean(updatingProvider)" @click="emit('connect-antigravity')">
              <BackendIcon backend="antigravity" />
              {{ t(antigravityConnected ? (antigravityEnabled ? 'antigravity.connected' : 'antigravity.enable') : 'antigravity.connect') }}
            </el-button>
            <div class="codex-login__detection">
              <ProviderInstallActions v-if="missing('antigravity')" backend="antigravity" :busy="updatingProvider === 'antigravity'" :disabled="Boolean(updatingProvider)" @refresh="emit('refresh-provider', 'antigravity')" @install="emit('install-provider', 'antigravity')" />
              <button v-else-if="antigravityPending" class="codex-login__cancel" type="button" @click="emit('cancel-antigravity')"><i class="app-spinner" aria-hidden="true" />{{ t('auth.cancel') }}</button>
              <template v-else>
                <span v-if="updatingProvider === 'antigravity' || antigravityLoading" role="status">{{ t('auth.checking') }}</span>
                <span v-else-if="antigravityConnected || detected('antigravity')"><CheckIcon aria-hidden="true" /> {{ t(antigravityConnected ? 'auth.connected' : 'auth.detected') }}</span>
                <button type="button" :disabled="antigravityLoading || continuing || Boolean(updatingProvider)" @click="emit('customize', 'antigravity')">{{ t('auth.customize') }}</button>
              </template>
            </div>
          </div>
          <el-button class="codex-login__continue" size="large" :loading="continuing" :disabled="Boolean(updatingProvider) || !(codexConnected && codexEnabled || claudeConnected && claudeEnabled || antigravityAvailable && antigravityConnected && antigravityEnabled)" @click="emit('continue')">
            {{ t('auth.continue') }}
          </el-button>
        </div>
        <p v-if="error" class="codex-login__error" role="alert">{{ error }}</p>
        <p v-if="claudeError" class="codex-login__error" role="alert">{{ claudeError }}</p>
        <p v-if="antigravityAvailable && antigravityError" class="codex-login__error" role="alert">{{ antigravityError }}</p>
        <p v-if="setupError" class="codex-login__error" role="alert">{{ setupError }}</p>
      </template>
    </div>
  </OnboardingLandingFrame>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import OnboardingLandingFrame from './OnboardingLandingFrame.vue';
import BackendIcon from './BackendIcon.vue';
import ProviderInstallActions from './ProviderInstallActions.vue';
import { CheckIcon } from '../shared/icons/app-icons';
import type { AgentBackend } from '@workspace/core/contracts';
import type { ProviderSetupStatus } from '@workspace/core/contracts/provider-setup';

const appIconUrl = new URL('../../assets/icon.png', import.meta.url).href;

const props = withDefaults(defineProps<{
  providerSetup?: ProviderSetupStatus[];
  updatingProvider?: AgentBackend | null;
  setupError?: string | null;
  variant?: 'connecting' | 'sign-in';
  connectionStatus?: string;
  loading?: boolean;
  cancellable?: boolean;
  cancelling?: boolean;
  error?: string | null;
  claudeError?: string | null;
  codexConnected?: boolean;
  claudeConnected?: boolean;
  codexEnabled?: boolean;
  claudeEnabled?: boolean;
  claudeLoading?: boolean;
  antigravityConnected?: boolean;
  antigravityEnabled?: boolean;
  antigravityLoading?: boolean;
  antigravityPending?: boolean;
  antigravityError?: string | null;
  continuing?: boolean;
}>(), {
  variant: 'sign-in',
  codexEnabled: true,
  claudeEnabled: true,
  antigravityEnabled: true,
});

const emit = defineEmits<{ cancel: []; login: []; 'connect-claude': []; 'connect-antigravity': []; 'cancel-antigravity': []; continue: []; customize: [backend: AgentBackend]; 'refresh-provider': [backend: AgentBackend]; 'install-provider': [backend: AgentBackend] }>();
const { t } = useI18n();
const detected = (backend: AgentBackend) => props.providerSetup?.some(setup => setup.backend === backend && setup.installed);
const antigravityAvailable = computed(() => props.providerSetup?.some(setup => setup.backend === 'antigravity') ?? false);
const missing = (backend: AgentBackend) => props.providerSetup?.some(setup => setup.backend === backend && !setup.installed);
const needsSignIn = (backend: AgentBackend, connected?: boolean) => !connected
  && props.providerSetup?.some(setup => setup.backend === backend && setup.installed && setup.isolated);
</script>

<style scoped>
.codex-login__content {
  display: flex;
  flex-direction: column;
}

.codex-login__content--sign-in {
  width: min(700px, 100%);
  align-items: flex-start;
  text-align: left;
}

.codex-login__content--connecting {
  width: min(760px, 100%);
  align-items: center;
  text-align: center;
  transform: translateY(calc(-1 * var(--space-12)));
}

.codex-login__mark {
  width: 104px;
  height: 104px;
  overflow: hidden;
}

.codex-login__content--connecting .codex-login__mark {
  width: 128px;
  height: 128px;
}

.codex-login__mark img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.codex-login__sign-in-title {
  max-width: 700px;
}

.codex-login .el-button {
  margin-top: var(--space-12);
  -webkit-app-region: no-drag;
}

.codex-login__provider .el-button.codex-login__connect--required {
  border-color: var(--color-error);
  color: var(--color-error);
}

.codex-login__providers {
  display: flex;
  align-items: flex-start;
  gap: var(--space-8);
}

.codex-login__detection {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-top: var(--space-6);
  min-height: var(--line-height-20);
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
}

.codex-login__detection > span:not(.provider-install-actions) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-success);
}

.codex-login__detection svg { width: 14px; height: 14px; }

.codex-login__detection .codex-login__checking {
  color: var(--color-text-muted);
}

.codex-login__detection > button {
  -webkit-app-region: no-drag;
  min-height: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}

.codex-login__detection > button:hover { color: var(--color-text); }

.codex-login__providers .el-button + .el-button {
  margin-left: 0;
}

.codex-login__providers :deep(.backend-icon) {
  margin-right: var(--space-6);
}

.codex-login__description {
  margin: var(--space-12) 0 0;
  color: var(--color-text-muted);
  line-height: var(--line-height-20);
}

.codex-login__progress {
  position: relative;
  width: min(280px, 70%);
  height: 4px;
  margin-top: var(--space-24);
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--color-border);
}

.codex-login__progress-segment {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 25%;
  border-radius: inherit;
  background: var(--color-primary);
  animation: codex-login-progress 1.4s ease-in-out infinite alternate;
}

.codex-login__status {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-12);
  color: var(--color-text-muted);
  line-height: var(--line-height-20);
}

.codex-login__status-dot {
  width: var(--space-4);
  height: var(--space-4);
  border-radius: var(--radius-full);
  background: var(--color-primary);
  animation: codex-login-status-pulse 1.4s ease-in-out infinite;
}

.codex-login__cancel:disabled {
  cursor: default;
  opacity: 0.5;
}

.codex-login__cancel {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
}

.codex-login__error {
  margin-top: var(--space-6) !important;
  color: var(--color-error) !important;
}

@keyframes codex-login-progress {
  from {
    transform: translateX(0);
  }

  to {
    transform: translateX(300%);
  }
}

@keyframes codex-login-status-pulse {
  0%,
  100% {
    opacity: 0.45;
  }

  50% {
    opacity: 1;
  }
}

@media (max-width: 720px) {
  .codex-login--sign-in {
    padding-inline: var(--space-24);
  }

  .codex-login__providers {
    flex-direction: column;
    align-items: stretch;
    align-self: stretch;
  }

  .codex-login__providers .el-button + .el-button {
    margin-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .codex-login__progress-segment {
    animation: none;
    transform: translateX(150%);
  }

  .codex-login__status-dot {
    animation: none;
  }
}
</style>
