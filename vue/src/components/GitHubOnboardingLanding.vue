<template>
  <OnboardingLandingFrame
    class="github-onboarding"
    :label="$t('surface.githubOnboardingLanding.connectGitHub')"
  >
    <div class="github-onboarding__content">
      <GitHubIcon
        class="github-onboarding__mark"
        size="64"
        aria-hidden="true"
      />

      <template v-if="authorization">
        <h1 class="onboarding-landing-title github-onboarding__title">{{ t('auth.githubAuthorizationTitle') }}</h1>
        <WorkAuthorizationSteps
          class="github-onboarding__steps"
          :authorization="authorization"
          @open="emit('openAuthorization')"
        />
        <div class="github-onboarding__actions">
          <el-link
            class="github-onboarding__skip-link"
            :underline="false"
            @click="emit('skip')"
          >{{ t(cliDetected ? 'auth.githubUseCli' : 'auth.githubSkip') }}</el-link>
        </div>
      </template>

      <template v-else>
        <h1 class="onboarding-landing-title github-onboarding__title">
          <span class="onboarding-landing-title__line">{{ t('auth.githubTitle') }}</span>
          <span class="onboarding-landing-title__line onboarding-landing-title__detail">
            {{ t('auth.githubTitleDetailFirst') }}<br>
            {{ t('auth.githubTitleDetailSecond') }}
          </span>
        </h1>
        <p v-if="cliDetected" class="github-onboarding__description">{{ t('auth.githubCliDetected') }}</p>
        <div class="github-onboarding__actions">
          <el-button
            type="primary"
            size="large"
            :loading="busy"
            @click="emit('connect')"
          >{{ busy ? t('auth.githubConnecting') : t('auth.githubConnect') }}</el-button>
          <el-button
            size="large"
            @click="emit('skip')"
          >{{ t(cliDetected ? 'auth.githubUseCli' : 'auth.githubSkip') }}</el-button>
        </div>
      </template>
      <p v-if="error" class="github-onboarding__error" role="alert">{{ error }}</p>
    </div>
  </OnboardingLandingFrame>
</template>

<script setup lang="ts">
import type { WorkProviderAuthorization } from '@workspace/core/contracts';
import { useI18n } from 'vue-i18n';
import { GitHubIcon } from '../shared/icons/app-icons';
import WorkAuthorizationSteps from './WorkAuthorizationSteps.vue';
import OnboardingLandingFrame from './OnboardingLandingFrame.vue';

withDefaults(defineProps<{
  authorization?: WorkProviderAuthorization | null;
  cliDetected?: boolean;
  busy?: boolean;
  error?: string | null;
}>(), {
  authorization: null,
  cliDetected: false,
  busy: false,
  error: null,
});

const emit = defineEmits<{
  connect: [];
  openAuthorization: [];
  skip: [];
}>();
const { t } = useI18n();
</script>

<style scoped>
.github-onboarding__content {
  width: min(720px, 100%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.github-onboarding__mark {
  color: var(--color-text);
}

.github-onboarding__title {
  max-width: 720px;
}

.github-onboarding__description {
  margin: var(--space-12) 0 0;
  color: var(--color-text-muted);
  line-height: var(--line-height-20);
}

.github-onboarding__actions {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  margin-top: var(--space-24);
  -webkit-app-region: no-drag;
}

.github-onboarding__skip-link {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.github-onboarding__skip-link:hover {
  color: var(--color-text);
}

.github-onboarding__steps {
  width: min(620px, 100%);
  margin-top: var(--space-16);
  -webkit-app-region: no-drag;
}

.github-onboarding__error {
  margin: var(--space-6) 0 0;
  color: var(--color-error);
}
</style>
