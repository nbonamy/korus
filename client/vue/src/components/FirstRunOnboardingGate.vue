<template>
  <CodexLoginLanding
    :provider-setup="providerSetup"
    :updating-provider="updatingProvider"
    :setup-error="setupError"
    @customize="emit('customize', $event)"
    @refresh-provider="emit('refresh-provider', $event)"
    @install-provider="emit('install-provider', $event)"
    v-if="showLoginLanding"
    :variant="initialAuthenticationLoading ? 'connecting' : 'sign-in'"
    :loading="authenticationLoading || authentication?.login.status === 'pending'"
    :cancellable="authentication?.login.status === 'pending'"
    :cancelling="authenticationCancelling"
    :error="authenticationError ?? authentication?.login.error"
    :codex-connected="codexConnected"
    :claude-connected="claudeConnected"
    :codex-enabled="snapshot.providerConnections?.find(engine => engine.backend === 'codex')?.enabled !== false"
    :claude-enabled="snapshot.providerConnections?.find(engine => engine.backend === 'claude')?.enabled !== false"
    :claude-loading="claudeLoading"
    :claude-error="claudeError"
    :continuing="continuing"
    @connect-claude="emit('connect-claude')"
    :antigravity-connected="antigravityConnected"
    :antigravity-loading="antigravityLoading"
    :antigravity-pending="antigravityPending"
    :antigravity-error="antigravityError"
    :antigravity-enabled="snapshot.providerConnections?.find(engine => engine.backend === 'antigravity')?.enabled !== false"
    @connect-antigravity="emit('connect-antigravity')"
    @cancel-antigravity="emit('cancel-antigravity')"
    @continue="emit('continue')"
    @cancel="cancelChatGptLogin"
    @login="startChatGptLogin"
  />
  <RepositoryOnboardingLanding
    v-else-if="repositoriesOnboardingVisible"
    :connections="snapshot.workBacklog.connections"
    :authorizations="workProviderAuthorizations"
    :authorization-errors="workProviderAuthorizationErrors"
    :connect="connectRepositoryProvider"
    :disconnect="disconnectRepositoryProvider"
    :open-authorization="openRepositoryAuthorization"
    @continue="emit('complete')"
  />
  <OnboardingCompleteLanding
    v-else-if="onboardingCompleteVisible"
    :celebrate="snapshot.general.celebrationsEnabled !== false"
    @complete="finishFirstRunOnboarding"
  />
  <LocalClaudeAuthenticationDialog
    :model-value="claudeDialogVisible"
    :executable-path="claudeAuthentication?.executablePath"
    :config-directory="claudeAuthentication?.configDirectory !== undefined ? claudeAuthentication.configDirectory : providerSetup?.find(setup => setup.backend === 'claude')?.homePath"
    :loading="claudeLoading"
    :error="claudeError"
    @update:model-value="emit('update:claudeDialogVisible', $event)"
    @refresh="emit('refresh-claude')"
  />
  <ProviderSetupDialog :setup="customizedSetup ?? null" :allow-reset="allowSetupReset" :busy="setupBusy ?? false" :error="setupError ?? null" @close="emit('close-setup')" @save="emit('save-setup', $event)" />
</template>

<script setup lang="ts">
import type { AgentBackend, AppSnapshot, ClaudeAuthentication, CodexAuthentication, WorkProviderAuthorization, WorkProviderConnectOptions, WorkProviderKind } from '@workspace/core/contracts';
import type { ProviderSetupChange, ProviderSetupStatus } from '@workspace/core/contracts/provider-setup';
import ProviderSetupDialog from './ProviderSetupDialog.vue';
import { toRefs } from 'vue';
import CodexLoginLanding from './CodexLoginLanding.vue';
import RepositoryOnboardingLanding from './RepositoryOnboardingLanding.vue';
import OnboardingCompleteLanding from './OnboardingCompleteLanding.vue';
import LocalClaudeAuthenticationDialog from './LocalClaudeAuthenticationDialog.vue';

const props = defineProps<{
  providerSetup?: ProviderSetupStatus[];
  allowSetupReset?: boolean;
  customizedSetup?: ProviderSetupStatus | null;
  setupBusy?: boolean;
  updatingProvider?: AgentBackend | null;
  setupError?: string | null;
  authentication: CodexAuthentication | null;
  claudeAuthentication?: ClaudeAuthentication | null;
  claudeDialogVisible: boolean;
  codexConnected: boolean;
  claudeConnected: boolean;
  antigravityConnected?: boolean;
  antigravityLoading?: boolean;
  antigravityPending?: boolean;
  antigravityError?: string | null;
  claudeLoading: boolean;
  claudeError: string | null;
  continuing: boolean;
  authenticationCancelling: boolean;
  authenticationError: string | null;
  authenticationLoading: boolean;
  repositoriesOnboardingVisible: boolean;
  initialAuthenticationLoading: boolean;
  onboardingCompleteVisible: boolean;
  connectRepositoryProvider: (provider: WorkProviderKind, options?: WorkProviderConnectOptions) => Promise<void>;
  disconnectRepositoryProvider: (provider: WorkProviderKind) => Promise<void>;
  openRepositoryAuthorization: (provider: WorkProviderKind) => Promise<void>;
  showLoginLanding: boolean;
  snapshot: AppSnapshot;
  workProviderAuthorizations: Partial<Record<WorkProviderKind, WorkProviderAuthorization>>;
  workProviderAuthorizationErrors?: Partial<Record<WorkProviderKind, string>>;
}>();

const emit = defineEmits<{
  customize: [backend: AgentBackend];
  'refresh-provider': [backend: AgentBackend];
  'install-provider': [backend: AgentBackend];
  'close-setup': [];
  'save-setup': [choice: ProviderSetupChange];
  cancel: [];
  complete: [];
  'connect-claude': [];
  'connect-antigravity': [];
  'cancel-antigravity': [];
  'refresh-claude': [];
  'update:claudeDialogVisible': [value: boolean];
  continue: [];
  finish: [];
  login: [];
}>();

const {
  authentication,
  authenticationCancelling,
  authenticationError,
  authenticationLoading,
  repositoriesOnboardingVisible,
  initialAuthenticationLoading,
  onboardingCompleteVisible,
  showLoginLanding,
  snapshot,
  workProviderAuthorizations,
} = toRefs(props);

function cancelChatGptLogin(): void {
  emit('cancel');
}

function finishFirstRunOnboarding(): void {
  emit('finish');
}

function startChatGptLogin(): void {
  emit('login');
}
</script>
