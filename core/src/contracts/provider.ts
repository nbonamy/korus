export type { ApprovalPreset, ProviderSessionData, ProviderDefaults, AccountRateLimitWindow, AccountBilling, AccountRateLimits, ProviderPlanModeSupport, ProviderPermissionModeOption, ProviderReasoningEffortOption, ProviderServiceTier, ProviderModelOption, ProviderSkillSummary, ProviderPluginSummary, ProviderCommandSummary, ProviderConnectionState } from '@korus-dev/multi-agent-sdk';
import type { ProviderCapabilities as HarnessCapabilities, ProviderRuntimeStatus as HarnessRuntimeStatus } from '@korus-dev/multi-agent-sdk';

/** Product workflows are composed by Korus, independently of native primitives. */
export type ProviderCapabilities = HarnessCapabilities & {
  /** Compressing a session replaces its conversation with one seeded by a summary. */
  codeReview?: boolean;
  planReview?: boolean;
  conversationShare?: boolean;
  /** The harness reads a global instructions file that Korus can edit in Personalization. */
  personalInstructions?: boolean;
};
export type ProviderRuntimeStatus = Omit<HarnessRuntimeStatus, 'capabilities'> & {
  capabilities?: Partial<ProviderCapabilities>;
};
