<template>
  <OnboardingLandingFrame
    class="onboarding-complete"
    :label="$t('surface.onboardingCompleteLanding.appIsReady')"
  >
    <div class="onboarding-complete__content">
      <img
        class="onboarding-complete__mark"
        :src="appIconUrl"
        alt=""
      >
      <h1 class="onboarding-landing-title onboarding-complete__title">
        <span class="onboarding-landing-title__line">{{ t('auth.completeTitle') }}</span>
        <span class="onboarding-landing-title__line onboarding-landing-title__detail">{{ t('auth.completeDetail') }}</span>
      </h1>
      <TelemetryReportingControl v-model="enabled" :disabled="busy || loading" />
      <p v-if="error" role="alert">{{ t('telemetry.error') }}</p>
      <el-button
        class="onboarding-complete__action"
        type="primary"
        size="large"
        :loading="busy"
        :disabled="loading || busy"
        @click="complete"
      >{{ t('auth.completeAction') }}</el-button>
    </div>
  </OnboardingLandingFrame>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { telemetryDisclosureVersion } from '@workspace/core/telemetry';
import { appApi } from '../platform-api';
import TelemetryReportingControl from './TelemetryReportingControl.vue';
import { useI18n } from 'vue-i18n';
import { useConfetti } from '../shared/confetti/use-confetti';
import OnboardingLandingFrame from './OnboardingLandingFrame.vue';

const appIconUrl = new URL('../../assets/icon.png', import.meta.url).href;

const props = withDefaults(defineProps<{
  celebrate?: boolean;
}>(), {
  celebrate: true,
});

const emit = defineEmits<{
  complete: [];
}>();
const { t } = useI18n();
const enabled = ref(true);
const loading = ref(true);
const busy = ref(false);
const error = ref(false);
onMounted(async () => {
  if (props.celebrate) useConfetti().celebrate();
  try {
    const privacy = await appApi!.getTelemetryPrivacy();
    enabled.value = privacy.choice?.enabled ?? true;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
});
async function complete(): Promise<void> {
  if (busy.value || loading.value) return;
  busy.value = true;
  error.value = false;
  try {
    await appApi!.setTelemetryPrivacy({ enabled: enabled.value, disclosure: telemetryDisclosureVersion });
    emit('complete');
  } catch {
    error.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.onboarding-complete__content {
  width: min(720px, 100%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.onboarding-complete__mark {
  width: 72px;
  height: 72px;
}

.onboarding-complete__title {
  max-width: 720px;
}

.onboarding-complete__action {
  margin-top: var(--space-24);
  -webkit-app-region: no-drag;
}
</style>
