export * from '@korus-dev/multi-agent-sdk/contracts/conversation';
import type { SendPromptOptions as HarnessSendPromptOptions } from '@korus-dev/multi-agent-sdk/contracts/conversation';
export type SendPromptOptions = HarnessSendPromptOptions & { delegation?: import('../delegation-context').DelegationOverrides };
export type RendererSendPromptOptions = Omit<SendPromptOptions, 'attachments' | 'recordUserMessage'> & { attachments?: readonly import('@korus-dev/multi-agent-sdk/contracts/conversation').RendererPromptAttachment[] };
export type AgentQueuedPrompt = Omit<import('@korus-dev/multi-agent-sdk/contracts/conversation').AgentQueuedPrompt, 'options'> & { options?: SendPromptOptions };
