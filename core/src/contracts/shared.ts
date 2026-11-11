export type AppTextDescriptor = {
  key: string;
  params?: Record<string, string | number>;
};

export type AppText = string | AppTextDescriptor;

export { harnessProviders, isHarnessProvider } from '@korus-dev/multi-agent-sdk/contracts';
export type { HarnessProvider } from '@korus-dev/multi-agent-sdk';

export type ApprovalPreset = 'ask-for-approval' | 'approve-for-me' | 'full-access';

export type ReasoningEffort = string;
