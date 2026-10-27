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
    :review-finding="reviewFinding"
    :thread-flag-busy="conversation.threadFlagBusy.value"
    :plan="plan"
    :plan-visible="planVisible"
    @close-plan="emit('close-plan')"
    @retry-history="prepare"
    @thread-flag="respondToThreadFlag"
    @annotate-attachment="conversation.imageAnnotation.openAttachment"
    @add-text-annotation="
      conversation.chatTextAnnotation.add($event.selection, $event.comment)
    "
    @remove-text-annotation="conversation.chatTextAnnotation.remove"
    @remove-visualization-annotation="
      conversation.visualizationAnnotation.remove
    "
    @remove-review-finding="emit('remove-review-finding')"
  />
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
import { computed, onMounted, ref, watch } from 'vue';
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
import ConversationPane from './ConversationPane.vue';
import ImageAnnotationDialog from './ImageAnnotationDialog.vue';

const props = defineProps<{
  view: AgentConversationView;
  actions: AgentConversationActions;
  agents: Agent[];
  focused: boolean;
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
}>();
const pane = ref<InstanceType<typeof ConversationPane> | null>(null);
const provider = computed(
  () => props.view.codexSnapshot ?? props.view.claudeSnapshot ?? props.view.antigravitySnapshot,
);
const state = agentConversationState(() => props.view, {
  followUpBehavior: () => props.followUpBehavior ?? 'queue',
  mentionGroups: () => props.mentionGroups,
  modelMenuItems: () => props.modelMenuItems,
});
const engineChoices = useBackendChoices(() => props.view.agent.teamId);
const conversation = useAgentConversation({
  beforeSubmit: async () => {
    if (!engineChoices.value.includes(props.view.agent.backend)) throw new Error(translate('engineConnection.required'));
  },
  agentId: () => props.view.agent.id,
  state,
  actions: props.actions,
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
  debugFallbackImageSource: '',
  notifyError: (message) => ElMessage.error(message),
});
function respondToThreadFlag(response: import('@workspace/core/thread-flags').ThreadFlagResponse): void {
  if (response.id === 'delegate_to_worktree' && response.action === 'execute') emit('composer-command', props.view.agent.id, 'delegate');
  else void conversation.respondToThreadFlag(response);
}

async function prepare(): Promise<void> {
  try {
    await props.actions.prepare(props.view.agent.id);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}
onMounted(() => {
  watch(() => state.identity?.conversationKey, prepare, { immediate: true });
});
function addVisualizationAnnotation(
  annotation: VisualizationAnnotationInput,
): void {
  conversation.visualizationAnnotation.add(annotation);
  pane.value?.focusComposer();
}
defineExpose({
  focusComposer: () => pane.value?.focusComposer(),
  saveCurrentDraft: () => pane.value?.saveCurrentDraft(),
  openSavedDraftPicker: () => pane.value?.openSavedDraftPicker(),
  addVisualizationAnnotation,
});
</script>
