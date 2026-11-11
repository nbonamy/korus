export type { ThreadGoalStatus, ThreadGoal, ThreadPlanStepStatus, ThreadPlanKind, ThreadPlanStatus, ThreadPlanStep, ThreadPlan, AgentContextUsage, ProviderConversationRef, ConversationStorageState, ConversationListInput, ConversationResumeTarget, ProviderConversationSummary as ConversationSummary, SubagentStatus, SubagentOperationKind, SubagentOperationLifecycle, SubagentOperationStatus, SubagentActivityKind, SubagentNode, SubagentOperation, SubagentOperationChange, SubagentActivity, SubagentActivityChange, SubagentStatusChange, SubagentIdentityChange, AgentSubagentTree, PromptSkillInput, PromptAttachment, PromptReferenceAttachment, ReferenceSendPromptOptions, PromptContentOptions, ProviderPromptOptions, MessageAttachment, MessageMedia, MessagePart, ToolPart, ToolPartUpdate, Message, ConversationContentInput, ConversationContentChunk, AgentFileActivity, ConversationFileLink, AgentHistoryLoadResult, ToolConfirmationDecision, ConfirmToolRequest, AskUserQuestionOption, AskUserQuestion, AskUserRequest, AskUserAnswers, ProviderClientRequest as ClientRequest, ProviderClientRequestResponse as ClientRequestResponse } from '@korus-dev/multi-agent-sdk';
// Electron renderer names for the SDK's conversation types; the wording belongs to Korus, not the SDK.
export type RendererPromptAttachment = import('@korus-dev/multi-agent-sdk').PromptReferenceAttachment;
export type RendererMessageAttachment = import('@korus-dev/multi-agent-sdk').MessageAttachment;
export type RendererMessageMedia = import('@korus-dev/multi-agent-sdk').MessageMedia;
export type RendererMessagePart = import('@korus-dev/multi-agent-sdk').MessagePart;
export type RendererToolPart = import('@korus-dev/multi-agent-sdk').ToolPart;
export type RendererToolPartUpdate = import('@korus-dev/multi-agent-sdk').ToolPartUpdate;
export type RendererMessage = import('@korus-dev/multi-agent-sdk').Message;
export { subagentStatuses, subagentOperationKinds, subagentOperationLifecycles, subagentOperationStatuses, subagentActivityKinds } from '@korus-dev/multi-agent-sdk/contracts';
import type { SendPromptOptions as HarnessSendPromptOptions } from '@korus-dev/multi-agent-sdk';
export type SendPromptOptions = HarnessSendPromptOptions & { delegation?: import('../delegation-context').DelegationOverrides };
export type RendererSendPromptOptions = Omit<SendPromptOptions, 'attachments' | 'recordUserMessage'> & { attachments?: readonly RendererPromptAttachment[] };
export type AgentQueuedPrompt = Omit<import('@korus-dev/multi-agent-sdk').AgentQueuedPrompt, 'options'> & { options?: SendPromptOptions };
