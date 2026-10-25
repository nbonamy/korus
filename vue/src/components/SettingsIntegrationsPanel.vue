<template>
  <SettingsPanelFrame :title="$t('surface.settingsIntegrationsPanel.integrations')" title-id="settings-integrations-title">
    <template #banner>
      <SettingsIntro kind="integrations" :title="$t('surface.settingsIntegrationsPanel.introTitle')" :description="$t('surface.settingsIntegrationsPanel.introDescription')" />
    </template>
    <FormSection v-for="connection in integrations" :key="connection.provider">
      <article class="settings-integrations-panel__integration">
        <div class="settings-integrations-panel__identity">
          <span class="settings-integrations-panel__icon" aria-hidden="true">
            <component :is="workProviderIcon(connection.provider)" size="var(--icon-xl)" />
          </span>
          <div>
            <strong>{{ workProviderDefinition(connection.provider).label }}</strong>
            <span>{{ description(connection) }}</span>
            <span v-if="connection.detail && (['error', 'notConfigured'].includes(connection.status) || connection.source === 'cli' && connection.status === 'connected')" class="settings-integrations-panel__error">{{ localizedText(connection.detail, translate) }}</span>
          </div>
        </div>
        <div class="settings-integrations-panel__actions">
          <template v-if="connection.source === 'cli' && connection.status === 'connected'">
            <StatusPill tone="warning">{{ $t('surface.settingsIntegrationsPanel.usingCli', { provider: workProviderDefinition(connection.provider).label }) }}</StatusPill>
            <el-button size="small" type="primary" :aria-label="actionLabel('connect', connection.provider)" :loading="busyProviders.includes(connection.provider)" @click="emit('connect', connection.provider)">{{ $t('surface.settingsIntegrationsPanel.connect') }}</el-button>
          </template>
          <template v-else-if="connection.source === 'cli' && connection.status !== 'connecting'">
            <el-button size="small" type="primary" :aria-label="$t('surface.settingsIntegrationsPanel.reconnectCli', { provider: workProviderDefinition(connection.provider).label })" :loading="busyProviders.includes(connection.provider)" @click="emit('disconnect', connection.provider)">{{ $t('surface.settingsIntegrationsPanel.reconnectCli', { provider: workProviderDefinition(connection.provider).label }) }}</el-button>
            <el-button size="small" :aria-label="actionLabel('connect', connection.provider)" @click="emit('connect', connection.provider)">{{ $t('surface.settingsIntegrationsPanel.connect') }}</el-button>
          </template>
          <template v-else-if="connection.status === 'connected'">
            <StatusPill tone="success">{{ $t('surface.settingsIntegrationsPanel.connected') }}</StatusPill>
            <el-button size="small" :aria-label="actionLabel('disconnect', connection.provider)" :loading="busyProviders.includes(connection.provider)" @click="emit('disconnect', connection.provider)">{{ $t('surface.settingsIntegrationsPanel.disconnect') }}</el-button>
          </template>
          <el-button v-else-if="connection.status === 'connecting'" size="small" :aria-label="actionLabel('cancel', connection.provider)" :loading="busyProviders.includes(connection.provider)" @click="emit('disconnect', connection.provider)">{{ $t('linearIntegration.cancel') }}</el-button>
          <el-button v-else size="small" type="primary" :aria-label="actionLabel('connect', connection.provider)" :loading="busyProviders.includes(connection.provider)" @click="emit('connect', connection.provider)">{{ $t('surface.settingsIntegrationsPanel.connect') }}</el-button>
        </div>
      </article>
      <div v-if="pendingAuthorization(connection.provider)?.userCode && connection.status === 'connecting'" class="settings-integrations-panel__authorization">
        <WorkAuthorizationSteps :authorization="pendingAuthorization(connection.provider)!" @open="emit('open-authorization', connection.provider)" />
      </div>
    </FormSection>
    <p v-if="error" class="settings-integrations-panel__detail">{{ error }}</p>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { WorkIntegrationConnection, WorkProviderAuthorization, WorkProviderKind } from '@workspace/core/contracts';
import { workProviderDefinition, workProviderKinds } from '@workspace/core/work-providers';
import { translate } from '../i18n';
import { localizedText } from '../i18n/errors';
import { workProviderIcon } from './work-provider-icons';
import WorkAuthorizationSteps from './WorkAuthorizationSteps.vue';
import SettingsIntro from './SettingsIntro.vue';
import StatusPill from '../shared/form/StatusPill.vue';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import FormSection from '../shared/form/FormSection.vue';

const props = withDefaults(defineProps<{
  authorization?: WorkProviderAuthorization | null;
  authorizations?: Partial<Record<WorkProviderKind, WorkProviderAuthorization>>;
  busyProviders?: WorkProviderKind[];
  connections: WorkIntegrationConnection[];
  error?: string | null;
}>(), { authorization: null, authorizations: () => ({}), busyProviders: () => [], error: null });
const emit = defineEmits<{
  connect: [provider: WorkProviderKind];
  disconnect: [provider: WorkProviderKind];
  'open-authorization': [provider: WorkProviderKind];
}>();
const integrations = computed(() => workProviderKinds.map(provider => props.connections.find(connection => connection.provider === provider) ?? { provider, status: 'notConfigured' } as WorkIntegrationConnection));
const pendingAuthorization = (provider: WorkProviderKind) => props.authorizations[provider]
  ?? (props.authorization?.provider === provider ? props.authorization : null);
function description(connection: WorkIntegrationConnection): string {
  if (connection.status === 'connected') return connection.accountLabel
    ? translate('linearIntegration.signedInAs', { account: connection.accountLabel })
    : translate('surface.settingsIntegrationsPanel.signedIn');
  if (connection.status === 'connecting') return translate('surface.settingsIntegrationsPanel.waitingForAuthorization');
  return localizedText(workProviderDefinition(connection.provider).description, translate) ?? '';
}
function actionLabel(action: 'connect' | 'disconnect' | 'cancel', provider: WorkProviderKind): string {
  const label = action === 'cancel' ? translate('linearIntegration.cancel') : translate(`surface.settingsIntegrationsPanel.${action}`);
  return `${label} ${workProviderDefinition(provider).label}${action === 'cancel' ? ' authorization' : ''}`;
}
</script>

<style scoped>
.settings-integrations-panel__integration {
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding: var(--space-10) var(--space-12);
}

.settings-integrations-panel__identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.settings-integrations-panel__identity strong,
.settings-integrations-panel__identity span {
  display: block;
}

.settings-integrations-panel__identity strong {
  color: var(--color-text);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-20);
}

.settings-integrations-panel__identity span {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.settings-integrations-panel__icon {
  width: var(--space-16);
  height: var(--space-16);
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-integrations-panel__identity .settings-integrations-panel__error {
  color: var(--color-error);
}

.settings-integrations-panel__actions {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.settings-integrations-panel__authorization {
  padding: var(--space-16) var(--space-8) 0;
}

.settings-integrations-panel__detail {
  margin: var(--space-8) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}
</style>
