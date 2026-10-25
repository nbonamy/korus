<template>
  <OnboardingLandingFrame class="repositories-onboarding" :label="t('repositoryOnboarding.title')">
    <div class="repositories-onboarding__content">
      <h1 class="onboarding-landing-title repositories-onboarding__title">
        <span class="onboarding-landing-title__line">{{ t('repositoryOnboarding.title') }}</span>
        <span class="onboarding-landing-title__line onboarding-landing-title__detail">{{ t('repositoryOnboarding.titleDetail') }}</span>
      </h1>
      <div class="repositories-onboarding__providers">
        <section v-for="provider in visibleProviders" :key="provider" class="repositories-onboarding__provider" :aria-label="label(provider)">
          <div class="repositories-onboarding__identity">
            <component :is="workProviderIcon(provider)" size="28" aria-hidden="true" />
            <h2>{{ label(provider) }}</h2>
            <StatusPill v-if="usingCli(provider)" tone="warning">{{ t('repositoryOnboarding.usingCli', { provider: label(provider) }) }}</StatusPill>
            <StatusPill v-else-if="connection(provider)?.status === 'connected'" tone="success">{{ t('surface.settingsIntegrationsPanel.connected') }}</StatusPill>
          </div>
          <p v-if="usingCli(provider)" class="repositories-onboarding__detail">{{ t('repositoryOnboarding.cliDetected', { provider: label(provider) }) }}</p>
          <p v-else-if="settled(provider)" class="repositories-onboarding__detail">{{ t('repositoryOnboarding.connectedHint', { provider: label(provider) }) }}</p>
          <p v-else-if="!['connected', 'connecting'].includes(connection(provider)?.status ?? '')" class="repositories-onboarding__detail">{{ t('repositoryOnboarding.connectHint', { provider: label(provider) }) }}</p>
          <WorkAuthorizationSteps v-if="connection(provider)?.status === 'connecting' && authorizations[provider]" :authorization="authorizations[provider]!" @open="run(provider, () => openAuthorization(provider))" />
          <p v-else-if="connection(provider)?.status === 'connecting'" class="repositories-onboarding__detail">{{ t('surface.settingsIntegrationsPanel.waitingForAuthorization') }}</p>
          <p v-if="providerError(provider)" class="repositories-onboarding__error" role="alert">{{ providerError(provider) }}</p>
          <div class="repositories-onboarding__actions">
            <el-button v-if="connection(provider)?.status === 'connecting' && authorizationErrors?.[provider]" :aria-label="t('repositoryOnboarding.retryAuthorization', { provider: label(provider) })" :loading="busy[provider]" @click="run(provider, () => connectProvider(provider))">{{ t('repositoryOnboarding.retry') }}</el-button>
            <el-button v-if="connection(provider)?.status === 'connecting'" :aria-label="t('repositoryOnboarding.cancel', { provider: label(provider) })" :loading="busy[provider]" @click="run(provider, () => disconnect(provider))">{{ t('linearIntegration.cancel') }}</el-button>
            <el-button v-else-if="connection(provider)?.status !== 'connected' || usingCli(provider)" type="primary" :aria-label="t('repositoryOnboarding.connect', { provider: label(provider) })" :loading="busy[provider]" @click="run(provider, () => connectProvider(provider))">{{ t('repositoryOnboarding.connect', { provider: label(provider) }) }}</el-button>
          </div>
        </section>
      </div>
      <div v-if="!authorizing" class="repositories-onboarding__footer">
        <el-button class="repositories-onboarding__continue" :type="connectedDirectly ? 'primary' : 'default'" size="large" :disabled="anyBusy" @click="continueOnboarding">{{ t(hasConnections ? 'auth.continue' : 'repositoryOnboarding.skip') }}</el-button>
        <span class="repositories-onboarding__hint">{{ t('repositoryOnboarding.settingsHint') }}</span>
      </div>
    </div>
  </OnboardingLandingFrame>
</template>

<script setup lang="ts">
import type { WorkIntegrationConnection, WorkProviderAuthorization, WorkProviderConnectOptions, WorkProviderKind } from '@workspace/core/contracts';
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
  connect: (provider: WorkProviderKind, options?: WorkProviderConnectOptions) => Promise<void>;
  disconnect: (provider: WorkProviderKind) => Promise<void>;
  openAuthorization: (provider: WorkProviderKind) => Promise<void>;
}>();
const emit = defineEmits<{ continue: [] }>();
const { t } = useI18n();
// Most users are on GitHub, so it comes first; both providers get the same row.
const providers = ['github', 'gitlab'] as const;
const busy = ref<Partial<Record<WorkProviderKind, boolean>>>({});
const errors = ref<Partial<Record<WorkProviderKind, string>>>({});
const connection = (provider: WorkProviderKind) => props.connections.find(value => value.provider === provider);
const label = (provider: WorkProviderKind) => workProviderDefinition(provider).label;
const usingCli = (provider: WorkProviderKind) => connection(provider)?.status === 'connected' && connection(provider)?.source === 'cli';
// Connected through Korus itself: no CLI fallback left to improve on.
const settled = (provider: WorkProviderKind) => connection(provider)?.status === 'connected' && !usingCli(provider);
// While a device authorization is pending, only that provider stays: Cancel returns to the full list.
const pendingProviders = computed(() => providers.filter(provider => connection(provider)?.status === 'connecting'));
const authorizing = computed(() => pendingProviders.value.length > 0);
const visibleProviders = computed(() => authorizing.value ? pendingProviders.value : providers);
const anyBusy = computed(() => providers.some(provider => busy.value[provider]));
const hasConnections = computed(() => providers.some(provider => connection(provider)?.status === 'connected'));
const connectedDirectly = computed(() => providers.some(settled));
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
// GitLab's grant includes MCP so agents can use it right away, without a second authorization in Settings.
const connectProvider = (provider: WorkProviderKind) => provider === 'gitlab' ? props.connect(provider, { hostedMcp: true }) : props.connect(provider);
function continueOnboarding(): void {
  if (!anyBusy.value) emit('continue');
}
onMounted(() => {
  for (const provider of providers) {
    if (connection(provider)?.status === 'connecting' && !props.authorizations[provider]) {
      // connect is idempotent for a pending backend-owned grant.
      void run(provider, () => connectProvider(provider));
    }
  }
});
</script>

<style scoped>
.repositories-onboarding {
  align-items: flex-start;
  overflow-y: auto;
}

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

.repositories-onboarding__detail,
.repositories-onboarding__error {
  margin: var(--space-8) 0;
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
}

.repositories-onboarding__detail {
  /* Reserve two lines so the Connect buttons align across columns. */
  min-height: calc(var(--line-height-20) * 2);
  color: var(--color-text-muted);
}

.repositories-onboarding__error {
  color: var(--color-error);
}

.repositories-onboarding__actions {
  margin-top: var(--space-16);
}

.repositories-onboarding__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-12);
  margin-top: var(--space-32);
  -webkit-app-region: no-drag;
}

.repositories-onboarding__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

@media (max-width: 768px) {
  .repositories-onboarding__providers {
    grid-template-columns: minmax(0, 1fr);
  }

  .repositories-onboarding__detail {
    min-height: 0;
  }
}
</style>
