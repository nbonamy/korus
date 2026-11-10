import { CodexBackendDriver as NativeDriver } from '@korus-dev/multi-agent-sdk/providers/codex';
import type { Agent, BackendSession, BackendConversationRef, SendPromptOptions } from '@workspace/core/contracts';
import type { AgentBackendDriver, BackendCodeReviewInput, BackendTextGenerationInput } from '@workspace/core/backend-driver';
import type { CodexSurfaceAgentAdapter } from './codex-surface-adapter';
export class CodexBackendDriver extends NativeDriver<Agent> implements AgentBackendDriver {
  constructor(private readonly appAdapter: CodexSurfaceAgentAdapter) { super(appAdapter); }
  readConversationMessages(ref: BackendConversationRef, agentId: string) {
    if (ref.backend !== 'codex') throw new Error('Codex cannot read non-Codex conversation history.');
    return this.appAdapter.readConversationMessages(ref.threadId, agentId, { view: 'last' });
  }
  getCapabilities(agent: Agent) { return this.appAdapter.getCapabilities(agent); }
  generateText(agent: Agent, input: BackendTextGenerationInput) { return this.appAdapter.generateText(agent, input); }
  sendPrompt(agent: Agent, prompt: string, options: SendPromptOptions = {}) { return super.sendPrompt(agent, prompt, options); }
  preparePromptOptions(agent: Agent, options?: SendPromptOptions): SendPromptOptions | undefined { return super.preparePromptOptions(agent, options); }
  runCodeReview(agent: Agent, input: BackendCodeReviewInput) { return this.appAdapter.runCodeReview(agent, input); }
  disposeCodeReview(_agent: Agent, session: BackendSession) { return this.appAdapter.disposeCodeReview(session); }
}
