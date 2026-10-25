<template>
  <OnboardingLandingFrame class="repositories-onboarding" :label="t('repositoryOnboarding.title')">
    <div class="repositories-onboarding__content">
      <h1 class="onboarding-landing-title">{{ t('repositoryOnboarding.title') }}</h1>
      <div class="repositories-onboarding__providers">
        <section v-for="provider in providers" :key="provider" class="repositories-onboarding__provider" :aria-label="label(provider)">
          <div class="repositories-onboarding__identity">
            <component :is="workProviderIcon(provider)" size="28" aria-hidden="true" />
            <h2>{{ label(provider) }}</h2>
            <StatusPill v-if="connection(provider)?.status === 'connected'" tone="success">{{ t('surface.settingsIntegrationsPanel.connected') }}</StatusPill>
          </div>
          <p v-if="connection(provider)?.accountLabel" class="repositories-onboarding__account">{{ connection(provider)?.accountLabel }}</p>
          <p v-if="connection(provider)?.source === 'cli' && connection(provider)?.accountLabel && ['connected', 'connecting'].includes(connection(provider)!.status)" class="repositories-onboarding__detail">{{ t('repositoryOnboarding.usingCli', { provider: label(provider) }) }}</p>
          <WorkAuthorizationSteps v-if="connection(provider)?.status === 'connecting' && authorizations[provider]" :authorization="authorizations[provider]!" @open="run(provider, () => openAuthorization(provider))" />
          <p v-else-if="connection(provider)?.status === 'connecting'" class="repositories-onboarding__detail">{{ t('surface.settingsIntegrationsPanel.waitingForAuthorization') }}</p>
          <p v-if="providerError(provider)" class="repositories-onboarding__error" role="alert">{{ providerError(provider) }}</p>
          <div class="repositories-onboarding__actions">
            <el-button v-if="connection(provider)?.status === 'connecting' && authorizationErrors?.[provider]" :aria-label="t('repositoryOnboarding.retryAuthorization', { provider: label(provider) })" :loading="busy[provider]" @click="run(provider, () => connect(provider))">{{ t('repositoryOnboarding.retry') }}</el-button>
            <el-button v-if="connection(provider)?.status === 'connecting'" :aria-label="t('repositoryOnboarding.cancel', { provider: label(provider) })" :loading="busy[provider]" @click="run(provider, () => disconnect(provider))">{{ t('linearIntegration.cancel') }}</el-button>
            <el-button v-else-if="connection(provider)?.status !== 'connected' || connection(provider)?.source === 'cli'" :aria-label="t('repositoryOnboarding.connect', { provider: label(provider) })" :loading="busy[provider]" @click="run(provider, () => connect(provider))">{{ t('repositoryOnboarding.connect', { provider: label(provider) }) }}</el-button>
          </div>
        </section>
      </div>
      <el-button class="repositories-onboarding__continue" type="primary" size="large" :disabled="anyBusy" @click="continueOnboarding">{{ t(hasConnections ? 'auth.continue' : 'repositoryOnboarding.skip') }}</el-button>
    </div>
  </OnboardingLandingFrame>
</template>

<script setup lang="ts">
import type { WorkIntegrationConnection, WorkProviderAuthorization, WorkProviderKind } from '@workspace/core/contracts';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { workProviderDefinition } from '@workspace/core/work-providers';
import { localizedErrorMessage, localizedText } from '../i18n/errors';
import { workProviderIcon } from './work-provider-icons';
import StatusPill from '../shared/form/StatusPill.vue';
import WorkAuthorizationSteps from './WorkAuthorizationSteps.vue';
import OnboardingLandingFrame from './OnboardingLandingFrame.vue';

const props = defineProps<{
  connections: WorkIntegrationConnection[];
  authorizations: Partial<Record<WorkProviderKind, WorkProviderAuthorization>>;
  authorizationErrors?: Partial<Record<WorkProviderKind, string>>;
  connect: (provider: WorkProviderKind) => Promise<void>;
  disconnect: (provider: WorkProviderKind) => Promise<void>;
  openAuthorization: (provider: WorkProviderKind) => Promise<void>;
}>();
const emit = defineEmits<{ continue: [] }>();
const { t } = useI18n();
const providers = ['github', 'gitlab'] as const;
const busy = ref<Partial<Record<WorkProviderKind, boolean>>>({});
const errors = ref<Partial<Record<WorkProviderKind, string>>>({});
const anyBusy = computed(() => providers.some(provider => busy.value[provider]));
const hasConnections = computed(() => providers.some(provider => connection(provider)?.status === 'connected'));
const connection = (provider: WorkProviderKind) => props.connections.find(value => value.provider === provider);
const label = (provider: WorkProviderKind) => workProviderDefinition(provider).label;
function providerError(provider: WorkProviderKind): string | null {
  if (errors.value[provider]) return errors.value[provider];
  if (props.authorizationErrors?.[provider]) return props.authorizationErrors[provider];
  const current = connection(provider);
  return current && current.status !== 'connecting' && current.detail ? localizedText(current.detail, t) : null;
}
async function run(provider: WorkProviderKind, action: () => Promise<void>): Promise<boolean> {
  if (busy.value[provider]) return false;
  busy.value[provider] = true;
  delete errors.value[provider];
  try { await action(); return true; }
  catch (error) { errors.value[provider] = localizedErrorMessage(error, t); return false; }
  finally { busy.value[provider] = false; }
}
async function continueOnboarding(): Promise<void> {
  if (anyBusy.value) return;
  // Finish deliberately: a skipped device grant must not connect after onboarding.
  const results = await Promise.all(providers.filter(provider => connection(provider)?.status === 'connecting')
    .map(provider => run(provider, () => props.disconnect(provider))));
  if (results.every(Boolean)) emit('continue');
}
onMounted(() => {
  for (const provider of providers) {
    if (connection(provider)?.status === 'connecting' && !props.authorizations[provider]) {
      // connect is idempotent for a pending backend-owned grant.
      void run(provider, () => props.connect(provider));
    }
  }
});
</script>

<style scoped>
.repositories-onboarding__content {
  width: min(880px, 100%);
  min-width: 0;
  margin-block: auto;
  padding-block: var(--space-24);
}

.repositories-onboarding__providers {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-24);
  margin-top: var(--space-32);
  -webkit-app-region: no-drag;
}

.repositories-onboarding__provider {
  min-width: 0;
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-16);
  overflow-wrap: anywhere;
}

.repositories-onboarding__identity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-8);
}

.repositories-onboarding__identity h2 {
  margin: 0;
  font-size: var(--font-size-18);
  font-weight: var(--font-weight-semibold);
}

.repositories-onboarding__account,
.repositories-onboarding__detail,
.repositories-onboarding__error {
  margin: var(--space-8) 0;
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
}

.repositories-onboarding__detail {
  color: var(--color-text-muted);
}

.repositories-onboarding__error {
  color: var(--color-error);
}

.repositories-onboarding__actions {
  margin-top: var(--space-16);
}

.repositories-onboarding__continue {
  margin-top: var(--space-32);
  -webkit-app-region: no-drag;
}

.repositories-onboarding {
  align-items: flex-start;
  overflow-y: auto;
}

@media (max-width: 768px) {
  .repositories-onboarding__providers {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
