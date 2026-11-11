export type { ApprovalPreset, ProviderSessionData, ProviderDefaults, AccountRateLimitWindow, AccountBilling, AccountRateLimits, ProviderPlanModeSupport, ProviderPermissionModeOption, ProviderReasoningEffortOption, ProviderServiceTier, ProviderModelOption, ProviderSkillSummary, ProviderPluginSummary, ProviderCommandSummary, ProviderConnectionState } from '@korus-dev/multi-agent-sdk';
export type { CodexApprovalsReviewer, CodexThreadSettings, CodexAccount, CodexAuthentication, CodexChatGptLogin, CodexChatGptDeviceCodeLogin } from '@korus-dev/multi-agent-sdk/codex';
import type { ProviderCapabilities as HarnessCapabilities, ProviderRuntimeStatus as HarnessRuntimeStatus } from '@korus-dev/multi-agent-sdk';

/** Product workflows are composed by Korus, independently of native primitives. */
export type ProviderCapabilities = HarnessCapabilities & {
  /** Compressing a session replaces its conversation with one seeded by a summary. */
  conversationReplaceWithSummary?: boolean;
  codeReview?: boolean;
  planReview?: boolean;
  conversationShare?: boolean;
  /** The pane loads older history page by page. */
  olderHistoryPaging?: boolean;
  /** The session data carries the model selection, so attaching a conversation updates the composer. */
  selectionInSession?: boolean;
  /** Long messages arrive shortened, and the pane loads the rest on request. */
  deferredMessageContent?: boolean;
  /** The plan comes only from the session state, never from one Korus kept for the agent. */
  sessionOwnsPlan?: boolean;
  /** The pane leaves the agent's reasoning out of its activity headings. */
  hideReasoning?: boolean;
};
export type ProviderRuntimeStatus = Omit<HarnessRuntimeStatus, 'capabilities'> & {
  capabilities?: Partial<ProviderCapabilities>;
};
