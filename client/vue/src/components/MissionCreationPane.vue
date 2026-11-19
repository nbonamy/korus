<template>
  <ConversationPane
    :controller="controller"
    :agent="null"
    :empty-headline="t('missions.whatDoYouWantToBuild')"
    empty-subhead=""
  >
    <template #empty-actions>
      <div class="mission-creation__actions">
        <AppMenuButton v-if="hosts.length" :ariaLabel="t('missions.environment')" :items="environmentOptions" placement="bottom-start" max-height="240px" block @select="host = $event">
          <template #trigger="{ attrs }">
            <button v-bind="attrs" type="button" class="app-button app-button--neutral agent-ui-interactive" :aria-label="t('missions.environment')" :disabled="pending || hostLocked">
              <component :is="host === 'local' ? DeviceImacIcon : WorldIcon" aria-hidden="true" />
              {{ environmentLabel }}
              <ChevronDown aria-hidden="true" />
            </button>
          </template>
        </AppMenuButton>
        <button type="button" class="app-button app-button--neutral agent-ui-interactive" :disabled="pending" @click="$emit('choose-issue')">
          <BacklogIcon aria-hidden="true" />
          {{ t('missions.chooseIssue') }}
        </button>
      </div>
    </template>
    <template #composer-after>
      <ProviderModelSelector class="mission-creation__engine" v-model:selection="selection" :remote-connection-id="remoteConnectionId" :disabled="pending" />
    </template>
  </ConversationPane>
</template>

<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { createConversationPaneController, type ComposerState, type HostAttachment } from '@korus-dev/agent-ui-sdk';
import type { ExecutionSelection, RemoteConnection, RendererSendPromptOptions } from '@workspace/core/contracts';
import ConversationPane from './ConversationPane.vue';
import ProviderModelSelector from './ProviderModelSelector.vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { BacklogIcon, ChevronDown, DeviceImacIcon, WorldIcon } from '../shared/icons/app-icons';

const props = defineProps<{
  hosts: RemoteConnection[];
  localAvailable: boolean;
  hostLocked: boolean;
  pending: boolean;
  submit: (text: string, options?: RendererSendPromptOptions) => Promise<void>;
}>();
defineEmits<{ 'choose-issue': [] }>();
const host = defineModel<string>('host', { required: true });
const selection = defineModel<ExecutionSelection>('selection');
const remoteConnectionId = computed(() => host.value === 'local' ? undefined : host.value);
const { t } = useI18n();
const environmentOptions = computed<AppMenuItem[]>(() => [
  ...(props.localAvailable ? [{ id: 'local', type: 'radio' as const, label: t('remoteTarget.thisComputer'), checked: host.value === 'local', icon: DeviceImacIcon }] : []),
  ...props.hosts.map((connection): AppMenuItem => ({ id: connection.id, type: 'radio', label: connection.name, checked: host.value === connection.id, icon: WorldIcon })),
]);
const environmentLabel = computed(() => host.value === 'local' ? t('remoteTarget.thisComputer')
  : props.hosts.find(connection => connection.id === host.value)?.name ?? t('missions.environment'));
const composerState = shallowRef<ComposerState>();
const attachments = shallowRef<readonly HostAttachment[]>([]);
const controller = createConversationPaneController({
  state: () => ({
    identity: { conversationKey: 'new-mission', messages: [], disabled: props.pending },
    composer: { state: composerState.value, attachments: attachments.value, placeholder: t('missions.describeWhatYouWantToBuild') },
    policy: { attachEnabled: true },
  }),
  actions: {
    updateComposerState: state => { composerState.value = state; },
    updateAttachments: next => { attachments.value = next; },
    submit: async (text, options) => {
      const submittedAttachments = attachments.value;
      try {
        await props.submit(text, options);
        return { renderOptimisticMessage: false };
      } catch (error) {
        composerState.value = { text, content: options?.content, selectionStart: text.length, selectionEnd: text.length };
        attachments.value = submittedAttachments;
        throw error;
      }
    },
  },
});
</script>

<style scoped>
.mission-creation__actions {
  display: grid;
  gap: var(--space-8);
  width: 240px;
  max-width: 100%;
  margin-inline: auto;
}

.mission-creation__actions .app-button {
  width: 100%;
  min-height: var(--space-24);
  font-size: var(--font-size-14);
}

.mission-creation__engine {
  order: -1;
}
</style>
