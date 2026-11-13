<template>
  <AppConversationPane
    ref="pane"
    :controller="conversation.controller"
    :agent="view.agent"
    :agents="agents"
    :keyboard-active="focused"
    :saved-prompt-drafts="savedPromptDrafts"
    :save-prompt-draft="savePromptDraft"
    :remove-prompt-draft="removePromptDraft"
    :history-load-failed="view.history.failed"
    :history-loading="view.history.hydrating"
    :has-visible-messages="Boolean(provider?.messages.length)"
    :attachment-annotation-counts="
      conversation.imageAnnotation.activeCounts.value
    "
    :text-annotations="conversation.chatTextAnnotation.activeAnnotations.value"
    :visualization-annotations="
      conversation.visualizationAnnotation.activeAnnotations.value
    "
    :code-annotations="conversation.codeAnnotation.activeAnnotations.value"
    :review-finding="reviewFinding"
    :thread-flag-busy="conversation.threadFlagBusy.value"
    :empty-headline="emptyHeadline"
    :empty-subhead="emptySubhead"
    :plan="plan"
    :plan-visible="planVisible"
    @close-plan="emit('close-plan')"
    @retry-history="retryHistory"
    @thread-flag="respondToThreadFlag"
    @annotate-attachment="conversation.imageAnnotation.openAttachment"
    @add-text-annotation="
      conversation.chatTextAnnotation.add($event.selection, $event.comment)
    "
    @edit-text-annotation="conversation.chatTextAnnotation.edit"
    @remove-text-annotation="conversation.chatTextAnnotation.remove"
    @remove-visualization-annotation="
      conversation.visualizationAnnotation.remove
    "
    @remove-code-annotation="conversation.codeAnnotation.remove"
    @remove-review-finding="emit('remove-review-finding')"
  >
    <template v-for="(_, name) in $slots" #[name]="bindings"><slot :name="name" v-bind="bindings ?? {}" /></template>
  </AppConversationPane>
  <ImageAnnotationDialog
    :visible="conversation.imageAnnotation.visible.value"
    :image-src="conversation.imageAnnotation.imageSource.value"
    :initial-annotations="conversation.imageAnnotation.initialAnnotations.value"
    :initial-pixel-ratio="conversation.imageAnnotation.pixelRatio.value"
    :file-name="conversation.imageAnnotation.fileName.value"
    @close="conversation.imageAnnotation.close"
    @image-error="conversation.imageAnnotation.handleError"
    @save="conversation.imageAnnotation.save"
  />
</template>
<script setup lang="ts">
import { conversationForView } from '../provider-conversation-bindings';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { translate } from '../i18n';
import { canSelectAgentProvider } from '@workspace/core/agent-providers';
import { harnessChoices } from './provider-harness-choices';
import { useProviderChoices, useProviderSwitch, useRememberProvider } from './provider-selection';
import { conversationMenuCommand, type ConversationMenuCommand } from './conversation-command-menu';
import type {
  Agent,
  AppGeneralSettings,
  SavedPromptDraft,
  ThreadPlan,
} from '@workspace/core/contracts';
import type { CodeReviewFinding } from '@workspace/core/code-review';
import type {
  ConversationPaneActions,
  ComposerMentionGroup,
  ComposerMenuItem,
} from '@korus-dev/agent-ui-sdk';
import type { AgentConversationView } from '../app-state';
import {
  agentConversationState,
  useAgentConversation,
  type AgentConversationActions,
} from './use-agent-conversation';
import type { VisualizationAnnotationInput } from './use-visualization-annotations';
import type { CodeAnnotationInput } from './use-code-annotations';
import AppConversationPane from './ConversationPane.vue';
import ImageAnnotationDialog from './ImageAnnotationDialog.vue';
import debugAnnotationScreenshotUrl from '../../assets/debug-annotation.png?url';

const props = defineProps<{
  view: AgentConversationView;
  actions: AgentConversationActions;
  agents: Agent[];
  focused: boolean;
  emptyHeadline?: string;
  emptySubhead?: string;
  placeholder?: string;
  previewMessage?: import('../conversation-presentation/presentation').PaneMessage;
  previewApproval?: import('@workspace/core/contracts').ProviderApprovalRequest;
  followUpBehavior?: AppGeneralSettings['followUpBehavior'];
  mentionGroups: readonly ComposerMentionGroup[];
  plan?: ThreadPlan | null;
  planVisible?: boolean;
  savedPromptDrafts: readonly SavedPromptDraft[];
  savePromptDraft: (agentId: string, text: string, content?: readonly import('@korus-dev/multi-agent-sdk').PromptPart[]) => Promise<void>;
  removePromptDraft: (id: string) => Promise<void>;
  reviewFinding?: CodeReviewFinding | null;
  openLink: NonNullable<ConversationPaneActions['openLink']>;
  openImage: NonNullable<ConversationPaneActions['openImage']>;
  openVisualization: NonNullable<
    ConversationPaneActions['openVisualization']
  >;
}>();
const emit = defineEmits<{
  'remove-review-finding': [];
  'open-review': [agentId: string];
  'composer-command': [agentId: string, command: ConversationMenuCommand];
  'close-plan': [];
  'annotation-dialog': [visible: boolean];
}>();
const pane = ref<InstanceType<typeof AppConversationPane> | null>(null);
const provider = computed(
  () => conversationForView(props.view),
);
const backendSwitch = useProviderSwitch();
const rememberProvider = useRememberProvider(() => props.view.agent.remoteConnectionId);
const engineChoices = useProviderChoices(() => props.view.agent.remoteConnectionId);
// Only a conversation that has not started can change harness; afterwards the picker shows the one it runs.
const harnesses = computed(() => harnessChoices(
  backendSwitch && engineChoices.value.length > 1 && canSelectAgentProvider(props.view.agent) && !props.view.history.hydrating && !provider.value?.messages.length
    ? engineChoices.value : [props.view.agent.provider],
));
async function selectHarness(harness: string): Promise<void> {
  const { agent } = props.view;
  if (!backendSwitch || backendSwitch.busy.value || harness === agent.provider) return;
  try { await backendSwitch.select(agent.id, harness as typeof agent.provider); rememberProvider(harness as typeof agent.provider); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : String(error)); }
}
const state = agentConversationState(() => props.view, {
  harnesses: () => harnesses.value,
  followUpBehavior: () => props.followUpBehavior ?? 'queue',
  mentionGroups: () => props.mentionGroups,
  placeholder: () => props.placeholder,
  previewMessage: () => props.previewMessage,
  previewApproval: () => props.previewApproval,
});
const conversation = useAgentConversation({
  beforeSubmit: async () => {
    if (!engineChoices.value.includes(props.view.agent.provider)) throw new Error(translate('engineConnection.required'));
  },
  agentId: () => props.view.agent.id,
  state,
  get actions() { return props.actions; },
  onSelectHarness: selectHarness,
  onMenuSelect: (item) => {
    const command = conversationMenuCommand(item.payload);
    if (command) return emit('composer-command', props.view.agent.id, command);
  },
  openLink: (...args) => props.openLink(...args),
  openImage: (...args) => props.openImage(...args),
  openVisualization: (...args) => props.openVisualization(...args),
  onThreadFlag: (agentId, response) => {
    if (response.id === 'ready_for_review' && response.action === 'execute')
      emit('open-review', agentId);
  },
  debugFallbackImageSource: debugAnnotationScreenshotUrl,
  notifyError: (message) => ElMessage.error(message),
});
function respondToThreadFlag(response: import('@workspace/core/thread-flags').ThreadFlagResponse): void {
  void conversation.respondToThreadFlag(response);
}

watch(conversation.imageAnnotation.visible, visible => emit('annotation-dialog', visible));
async function retryHistory(): Promise<void> {
  if (props.actions.retryHistory) await props.actions.retryHistory(props.view.agent.id);
  else await prepare();
}
async function prepare(): Promise<void> {
  try {
    await props.actions.prepare(props.view.agent.id);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}
onBeforeUnmount(() => { if (conversation.imageAnnotation.visible.value) emit('annotation-dialog', false); });
onMounted(() => {
  watch(() => state.identity?.conversationKey, prepare, { immediate: true });
});
function addVisualizationAnnotation(
  annotation: VisualizationAnnotationInput,
): void {
  conversation.visualizationAnnotation.add(annotation);
  pane.value?.focusComposer();
}
function addCodeAnnotation(annotation: CodeAnnotationInput): void {
  conversation.codeAnnotation.add(annotation);
  pane.value?.focusComposer();
}
defineExpose({
  getElement: (): HTMLElement | null => pane.value?.$el ?? null,
  focusComposer: () => pane.value?.focusComposer(),
  saveCurrentDraft: () => pane.value?.saveCurrentDraft(),
  openDebugImageAnnotation: (...args: Parameters<typeof conversation.imageAnnotation.openDebug>) => conversation.imageAnnotation.openDebug(...args),
  openSavedDraftPicker: () => pane.value?.openSavedDraftPicker(),
  addVisualizationAnnotation,
  addCodeAnnotation,
});
</script>
