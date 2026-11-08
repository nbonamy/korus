<template>
  <ConversationPane
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
    @remove-text-annotation="conversation.chatTextAnnotation.remove"
    @remove-visualization-annotation="
      conversation.visualizationAnnotation.remove
    "
    @remove-code-annotation="conversation.codeAnnotation.remove"
    @remove-review-finding="emit('remove-review-finding')"
  >
    <template v-for="(_, name) in $slots" #[name]="bindings"><slot :name="name" v-bind="bindings ?? {}" /></template>
  </ConversationPane>
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
import { useBackendChoices } from './backend-selection';
import { conversationMenuCommand, type ConversationMenuCommand } from './conversation-command-menu';
import type {
  Agent,
  AppGeneralSettings,
  SavedPromptDraft,
  ThreadPlan,
} from '@workspace/core/contracts';
import type { CodeReviewFinding } from '@workspace/core/code-review';
import type {
  CodexConversationPaneActions,
  CodexComposerMentionGroup,
  CodexComposerMenuItem,
} from '@codex-app-sdk/vue';
import type { AgentConversationView } from '../app-state';
import {
  agentConversationState,
  useAgentConversation,
  type AgentConversationActions,
} from './use-agent-conversation';
import type { VisualizationAnnotationInput } from './use-visualization-annotations';
import type { CodeAnnotationInput } from './use-code-annotations';
import ConversationPane from './ConversationPane.vue';
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
  previewMessage?: import('@codex-app-sdk/core/surface').SurfaceMessage;
  previewApproval?: import('@workspace/core/contracts').BackendApprovalRequest;
  followUpBehavior?: AppGeneralSettings['followUpBehavior'];
  mentionGroups: readonly CodexComposerMentionGroup[];
  modelMenuItems: CodexComposerMenuItem[];
  selectModelMenuItem: NonNullable<CodexConversationPaneActions['menuSelect']>;
  plan?: ThreadPlan | null;
  planVisible?: boolean;
  savedPromptDrafts: readonly SavedPromptDraft[];
  savePromptDraft: (agentId: string, text: string, content?: readonly import('@codex-app-sdk/core/surface').CodexPromptPart[]) => Promise<void>;
  removePromptDraft: (id: string) => Promise<void>;
  reviewFinding?: CodeReviewFinding | null;
  openLink: NonNullable<CodexConversationPaneActions['openLink']>;
  openImage: NonNullable<CodexConversationPaneActions['openImage']>;
  openVisualization: NonNullable<
    CodexConversationPaneActions['openVisualization']
  >;
}>();
const emit = defineEmits<{
  'remove-review-finding': [];
  'open-review': [agentId: string];
  'composer-command': [agentId: string, command: ConversationMenuCommand];
  'close-plan': [];
  'annotation-dialog': [visible: boolean];
}>();
const pane = ref<InstanceType<typeof ConversationPane> | null>(null);
const provider = computed(
  () => conversationForView(props.view),
);
const state = agentConversationState(() => props.view, {
  followUpBehavior: () => props.followUpBehavior ?? 'queue',
  mentionGroups: () => props.mentionGroups,
  modelMenuItems: () => props.modelMenuItems,
  placeholder: () => props.placeholder,
  previewMessage: () => props.previewMessage,
  previewApproval: () => props.previewApproval,
});
const engineChoices = useBackendChoices(() => props.view.agent.remoteConnectionId);
const conversation = useAgentConversation({
  beforeSubmit: async () => {
    if (!engineChoices.value.includes(props.view.agent.backend)) throw new Error(translate('engineConnection.required'));
  },
  agentId: () => props.view.agent.id,
  state,
  get actions() { return props.actions; },
  onMenuSelect: (item) => {
    const command = conversationMenuCommand(item.payload);
    if (command) return emit('composer-command', props.view.agent.id, command);
    return props.selectModelMenuItem(item);
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
  focusComposer: () => pane.value?.focusComposer(),
  saveCurrentDraft: () => pane.value?.saveCurrentDraft(),
  openDebugImageAnnotation: (...args: Parameters<typeof conversation.imageAnnotation.openDebug>) => conversation.imageAnnotation.openDebug(...args),
  openSavedDraftPicker: () => pane.value?.openSavedDraftPicker(),
  addVisualizationAnnotation,
  addCodeAnnotation,
});
</script>
