export type { ApprovalPreset, CodexApprovalsReviewer, ProviderSessionData, ProviderDefaults, CodexThreadSettings, AccountRateLimitWindow, AccountBilling, AccountRateLimits, ProviderPlanModeSupport, ProviderPermissionModeOption, CodexAccount, CodexAuthentication, CodexChatGptLogin, CodexChatGptDeviceCodeLogin, ProviderReasoningEffortOption, ProviderServiceTier, ProviderModelOption, ProviderSkillSummary, ProviderPluginSummary, ProviderCommandSummary, ProviderConnectionState } from '@korus-dev/multi-agent-sdk';
import type { ProviderCapabilities as HarnessCapabilities, ProviderRuntimeStatus as HarnessRuntimeStatus } from '@korus-dev/multi-agent-sdk';

/** Product workflows are composed by Korus, independently of native primitives. */
export type ProviderCapabilities = HarnessCapabilities & {
  codeReview?: boolean;
  planReview?: boolean;
  conversationShare?: boolean;
};
export type ProviderRuntimeStatus = Omit<HarnessRuntimeStatus, 'capabilities'> & {
  capabilities?: Partial<ProviderCapabilities>;
};
