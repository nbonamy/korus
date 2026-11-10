export * from 'multi-agents-sdk/contracts/conversation';
import type { SendPromptOptions as HarnessSendPromptOptions } from 'multi-agents-sdk/contracts/conversation';
export type SendPromptOptions = HarnessSendPromptOptions & { delegation?: import('../delegation-context').DelegationOverrides };
export type RendererSendPromptOptions = Omit<SendPromptOptions, 'attachments' | 'recordUserMessage'> & { attachments?: readonly import('multi-agents-sdk/contracts/conversation').RendererPromptAttachment[] };
export type AgentQueuedPrompt = Omit<import('multi-agents-sdk/contracts/conversation').AgentQueuedPrompt, 'options'> & { options?: SendPromptOptions };
