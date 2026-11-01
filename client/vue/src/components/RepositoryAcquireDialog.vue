<template>
  <FormDialog
    v-if="mode === 'url'"
    class="repository-acquire-dialog"
    :model-value="visible"
    :title="t('repositories.acquire.cloneRepository')"
    @update:model-value="onVisibilityChanged"
  >
    <form class="app-form-dialog" @submit.prevent="submitUrl">
      <FormField :label="t('repositories.acquire.url')" label-for="repository-acquire-url">
        <div class="app-form-dialog__control app-form-dialog__input-control">
          <input
            id="repository-acquire-url"
            ref="urlInput"
            v-model="url"
            class="app-form-dialog__text-input"
            type="text"
            :aria-label="t('repositories.acquire.url')"
            autocomplete="url"
            :placeholder="t('repositories.acquire.urlPlaceholder')"
            spellcheck="false"
          >
        </div>
      </FormField>
      <p v-if="error" class="repository-acquire-dialog__url-error">{{ error }}</p>
    </form>
    <template v-if="backendChoices.length !== 1" #footer-left>
      <BackendSelector v-model="backend" :disabled="busy" />
    </template>
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="app-button app-button--primary" type="button" :disabled="!canSubmitUrl || busy" @click="submitUrl">
        {{ busy ? t('repositories.acquire.cloning') : t('repositories.acquire.cloneRepository') }}
      </button>
    </template>
  </FormDialog>
  <el-dialog
    v-else
    class="app-dialog app-dialog--compact repository-acquire-dialog"
    :model-value="visible"
    :teleported="false"
    :width="providerConnected ? '680px' : '560px'"
    destroy-on-close
    @update:model-value="onVisibilityChanged"
  >
    <template v-if="providerConnected" #header>
      <div class="repository-acquire-dialog__search">
        <SearchIcon aria-hidden="true" />
        <input
          ref="input"
          v-model="query"
          :placeholder="t('repositories.acquire.findProvider', { provider: providerLabel })"
          :aria-label="t('repositories.acquire.findProvider', { provider: providerLabel })"
          autocomplete="off"
          spellcheck="false"
        >
      </div>
    </template>
    <template v-else #header>
      <span class="repository-acquire-dialog__accessible-title">{{ t('repositories.providerOnboarding.title', { provider: providerLabel }) }}</span>
    </template>

    <section
      class="repository-acquire-dialog__body"
      :class="{
        'repository-acquire-dialog__body--state': providerConnected && providerStateOnly,
        'repository-acquire-dialog__scroll-region': providerConnected,
      }"
    >
      <template v-if="providerConnected">
        <p v-if="loading" class="repository-acquire-dialog__state">{{ t('repositories.acquire.loading') }}</p>
        <p v-else-if="error" class="repository-acquire-dialog__state repository-acquire-dialog__state--error">{{ error }}</p>
        <template v-else>
          <h3 v-if="filteredRepositories.length > 0">{{ t('repositories.acquire.repositories') }}</h3>
          <button
            v-for="repository in filteredRepositories"
            :key="repository.id"
            :disabled="busy"
            type="button"
            class="repository-acquire-dialog__row"
            @click="emit('select-repository', repository)"
          >
            <component :is="providerIcon" aria-hidden="true" />
            <span>
              <span class="repository-acquire-dialog__name">{{ repository.fullName }}</span>
              <small>{{ repositoryKindLabel(repository) }}</small>
            </span>
            <em>{{ isRepositoryLocal(repository) ? t('repositories.acquire.open') : t('repositories.acquire.clone') }}</em>
          </button>
          <p v-if="filteredRepositories.length === 0" class="repository-acquire-dialog__state">{{ t('repositories.acquire.noMatch') }}</p>
        </template>
      </template>
      <section
        v-else
        class="repository-acquire-dialog__onboarding"
        :class="{ 'repository-acquire-dialog__onboarding--initial': !providerAuthorization }"
      >
        <div class="repository-acquire-dialog__onboarding-heading">
          <component :is="providerIcon" class="repository-acquire-dialog__provider-mark" aria-hidden="true" />
          <h2>{{ t(providerAuthorization ? 'repositories.providerOnboarding.authorizeTitle' : 'repositories.providerOnboarding.title', { provider: providerLabel }) }}</h2>
          <p>{{ t(providerAuthorization ? 'repositories.providerOnboarding.authorizeDetail' : 'repositories.providerOnboarding.detail', { provider: providerLabel }) }}</p>
        </div>

        <WorkAuthorizationSteps
          v-if="providerAuthorization"
          :authorization="providerAuthorization"
          @open="emit('open-authorization')"
        />
        <div v-else class="repository-acquire-dialog__connect">
          <button
            class="app-button app-button--primary"
            type="button"
            :disabled="busy"
            @click="emit('connect')"
          >{{ busy ? t('repositories.providerOnboarding.connecting') : t('repositories.providerOnboarding.connect', { provider: providerLabel }) }}</button>
          <p>
            <ShieldCheckIcon aria-hidden="true" />
            <span>{{ t('repositories.providerOnboarding.deviceFlow', { provider: providerLabel }) }}</span>
          </p>
        </div>

        <p v-if="error" class="repository-acquire-dialog__onboarding-error" role="alert">{{ error }}</p>
      </section>
    </section>

  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconSearch as SearchIcon } from '@tabler/icons-vue';
import type { WorkIntegrationConnection, WorkProviderAuthorization, WorkSource } from '@workspace/core/contracts';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';
import { GitHubIcon, GitLabIcon, ShieldCheckIcon } from '../shared/icons/app-icons';
import WorkAuthorizationSteps from './WorkAuthorizationSteps.vue';
import BackendSelector from './BackendSelector.vue';
import { useBackendChoices, useNewAgentBackend } from './backend-selection';
const backendChoices = useBackendChoices();
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
const backend = defineModel<import('@workspace/core/contracts').AgentBackend>('backend');


const props = withDefaults(defineProps<{
  busy?: boolean;
  authorization?: WorkProviderAuthorization | null;
  connection?: WorkIntegrationConnection | null;
  error?: string | null;
  loading?: boolean;
  localRepositoryIdentities?: string[];
  mode: 'github' | 'gitlab' | 'url';
  repositories?: WorkSource[];
  visible: boolean;
}>(), {
  busy: false,
  authorization: null,
  connection: null,
  error: null,
  loading: false,
  localRepositoryIdentities: () => [],
  repositories: () => [],
});

useNewAgentBackend(backend, backendChoices, () => props.visible);
const emit = defineEmits<{
  close: [];
  'clone-url': [url: string];
  connect: [];
  'open-authorization': [];
  'select-repository': [repository: WorkSource];
}>();

const { t } = useI18n();

const input = ref<HTMLInputElement | null>(null);
const urlInput = ref<HTMLInputElement | null>(null);
const query = ref('');
const url = ref('');
const localRepositoryIdentities = computed(() => new Set(props.localRepositoryIdentities));
const providerLabel = computed(() => props.mode === 'gitlab' ? 'GitLab' : 'GitHub');
const providerIcon = computed(() => props.mode === 'gitlab' ? GitLabIcon : GitHubIcon);
const providerAuthorization = computed(() => props.authorization?.provider === props.mode ? props.authorization : null);
const providerConnected = computed(() => props.connection?.provider === props.mode && props.connection.status === 'connected');
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase());
const filteredRepositories = computed(() => props.repositories.filter((repository) => repository.provider === props.mode && (
  `${repository.fullName} ${repository.name}`.toLocaleLowerCase().includes(normalizedQuery.value)
)));
const providerStateOnly = computed(() => props.loading || Boolean(props.error) || filteredRepositories.value.length === 0);
const canSubmitUrl = computed(() => /^(?:https?:\/\/|ssh:\/\/|git@|[^\s]+@[^\s]+:)[^\s]+/iu.test(url.value.trim()));

watch(() => [props.visible, props.mode] as const, async ([visible, mode]) => {
  if (!visible) return;
  query.value = '';
  url.value = '';
  await nextTick();
  if (mode === 'url') urlInput.value?.focus();
  else input.value?.focus();
}, { immediate: true });

function onVisibilityChanged(visible: boolean): void {
  if (!visible) emit('close');
}

function submitUrl(): void {
  if (canSubmitUrl.value && !props.busy && backend.value && backendChoices.value.includes(backend.value)) emit('clone-url', url.value.trim());
}

function isRepositoryLocal(repository: WorkSource): boolean {
  const identity = canonicalGitRemoteIdentity(repository.url);
  return Boolean(identity && localRepositoryIdentities.value.has(identity));
}

function repositoryKindLabel(repository: WorkSource): string {
  if (isRepositoryLocal(repository)) return t('repositories.acquire.onMachine');
  return repository.isPrivate
    ? t('repositories.acquire.privateRepository')
    : t('repositories.acquire.providerRepository', { provider: providerLabel.value });
}
</script>

<style scoped>
.repository-acquire-dialog__search {
  display: grid;
  grid-template-columns: var(--icon-md) minmax(0, 1fr);
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
}

.repository-acquire-dialog__search svg {
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--color-text-muted);
}

.repository-acquire-dialog__search input {
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  color: var(--color-text);
  background: transparent;
  font: inherit;
}

.app-dialog--compact .repository-acquire-dialog__body {
  padding: var(--space-4) var(--space-6) var(--space-6);
}

.repository-acquire-dialog__body--state {
  display: grid;
  place-items: center;
}

.repository-acquire-dialog__scroll-region {
  height: min(60vh, 520px);
  min-height: 400px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.repository-acquire-dialog__body h3 {
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-13);
}

.repository-acquire-dialog__onboarding {
  display: grid;
  align-content: center;
  gap: var(--space-8);
  padding: var(--space-12) var(--space-16) var(--space-12);
}

.repository-acquire-dialog__onboarding--initial {
  gap: var(--space-12);
}

.repository-acquire-dialog__onboarding--initial .repository-acquire-dialog__onboarding-heading {
  gap: var(--space-6);
}

.repository-acquire-dialog__onboarding-heading {
  display: grid;
  justify-items: center;
  gap: var(--space-4);
  text-align: center;
}

.repository-acquire-dialog__provider-mark {
  width: 44px;
  height: 44px;
  margin-bottom: var(--space-2);
  color: var(--color-text);
}

.repository-acquire-dialog__onboarding-heading h2 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-20);
  line-height: var(--line-height-28);
}

.repository-acquire-dialog__onboarding-heading p,
.repository-acquire-dialog__connect p,
.repository-acquire-dialog__onboarding-error {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
}

.repository-acquire-dialog__onboarding-heading p {
  max-width: 420px;
}

.repository-acquire-dialog__connect {
  display: grid;
  justify-items: center;
  gap: var(--space-8);
}

.repository-acquire-dialog__connect .app-button {
  min-width: 176px;
}

.repository-acquire-dialog__connect p {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  text-align: center;
}

.repository-acquire-dialog__connect p svg {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
}

.repository-acquire-dialog__onboarding-error {
  color: var(--color-error);
  text-align: center;
}

.repository-acquire-dialog__accessible-title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  white-space: nowrap;
  clip-path: inset(50%);
}

.repository-acquire-dialog__row {
  width: 100%;
  min-height: 52px;
  display: grid;
  grid-template-columns: var(--icon-lg) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-4) var(--space-6);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.repository-acquire-dialog__row:hover,
.repository-acquire-dialog__row:focus-visible {
  background: var(--color-surface-base);
  outline: 0;
}

.repository-acquire-dialog__row > svg {
  width: var(--icon-lg);
  height: var(--icon-lg);
  color: var(--color-text-muted);
}

.repository-acquire-dialog__row > span {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.repository-acquire-dialog__name,
.repository-acquire-dialog__row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repository-acquire-dialog__name {
  font-weight: var(--font-weight-medium);
}

.repository-acquire-dialog__row small,
.repository-acquire-dialog__row em {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-style: normal;
}

.repository-acquire-dialog__url-error {
  margin: 0;
  color: var(--color-error);
  font-size: var(--font-size-13);
}

.repository-acquire-dialog__url-state svg {
  width: var(--icon-lg);
  height: var(--icon-lg);
  color: var(--color-text-muted);
}

.repository-acquire-dialog__url-state div {
  display: grid;
  gap: var(--space-2);
}

.repository-acquire-dialog__url-state span,
.repository-acquire-dialog__state {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.repository-acquire-dialog__state {
  margin: 0;
  text-align: center;
}

.repository-acquire-dialog__state--error {
  color: var(--color-error);
}
</style>
