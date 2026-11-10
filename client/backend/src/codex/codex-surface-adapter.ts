import { CodexSurfaceAgentAdapter as NativeAdapter } from '@korus-dev/multi-agent-sdk/providers/codex';
import type { CodexSurface } from '@korus-dev/multi-agent-sdk/codex';
import type { Agent, BackendSession, ConversationListInput, ConversationResumeTarget } from '@workspace/core/contracts';
import type { BackendCodeReviewInput, BackendTextGenerationInput } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { codexApprovalPresetFromDefaults } from '@workspace/core/codex-approval-presets';
import { agentDisplayName } from '@workspace/core/agent-display';
import { shouldSyncConversationTitleFromAgent } from '@workspace/core/conversation-title';
import { product } from '@workspace/core/product';
import { promptWithSelectedReferences } from '../agents/prompt-content';
import { utilityTextModel } from '../agents/utility-text-model';
import { utilityMcpServers } from '../diagram-icons/utility-mcp';
import { warnMain } from '../log';
import { codexConversationDefaults } from './codex-model-defaults';
import { traceCodexDiagnostic } from './diagnostics';
import { statusFromSnapshot } from './codex-status';

/** Korus naming, approval defaults and workflow context around the native harness. */
export class CodexSurfaceAgentAdapter extends NativeAdapter<Agent> {
  private readonly appSurface: CodexSurface;
  constructor(surface: CodexSurface, closeSurface: () => Promise<void> = () => surface.close()) {
    super(surface, closeSurface, {
      defaultModel: codexConversationDefaults,
      onDiagnostic: traceCodexDiagnostic,
      displayName: agentDisplayName, shouldSyncTitle: shouldSyncConversationTitleFromAgent,
      approvalPresetFromDefaults: codexApprovalPresetFromDefaults,
      formatPrompt: promptWithSelectedReferences, statusFromSnapshot,
      runtimeStatusDetail: status => ({ key: status === 'connecting' ? 'backend.codexConnecting' : status === 'running' ? 'backend.codexConnected' : 'backend.codexNotConnected' }),
      extensionContext: (agent, scope) => scope ? { agent, reviewMcpServerUrl: scope.mcpServers?.[0]?.url } : agent,
      conversationConfiguration: (agent, scope) => scope ? { extensionContext: { agent, reviewMcpServerUrl: scope.mcpServers?.[0]?.url } } : { ...(agent.folder?.trim() ? { cwd: agent.folder.trim() } : {}), extensionContext: agent },
      retainedSessions: agent => {
        const active = agent.codeReview?.rounds.find(round => round.id === agent.codeReview?.activeRoundId);
        return active?.reviewerSession ? [active.reviewerSession] : [];
      },
      images: {
        selectModel: models => {
          const luna = models.filter(model => /(?:^|[-_\s])luna(?:$|[-_\s])/i.test(model.model)).sort((a, b) => b.model.localeCompare(a.model, undefined, { numeric: true }))[0];
          if (!luna) throw new Error('No Luna model is available in the Codex model catalog.');
          return { model: luna.model, ...(luna.supportedReasoningEfforts?.some(effort => effort.reasoningEffort === 'low') ? { reasoningEffort: 'low' } : {}) };
        },
        log: (message, details) => warnMain('image-generation', message, details),
      },
    });
    this.appSurface = surface;
  }
  async listConversations(agent: Agent, input: ConversationListInput = {}) {
    const scoped = { ...input, ...(agent.folder?.trim() ? { cwd: agent.folder.trim() } : {}) };
    const [active, archived] = await Promise.all([
      super.listConversations(agent, scoped), super.listConversations(agent, { ...scoped, archived: true }),
    ]);
    const current = agent.backendSession?.kind === 'codex' ? agent.backendSession.threadId : undefined;
    return [...active.filter(chat => chat.id === current), ...archived];
  }
  async resumeConversation(agent: Agent, target: ConversationResumeTarget) {
    const previous = agent.backendSession?.kind === 'codex' ? agent.backendSession.threadId : undefined;
    const result = await super.resumeConversation(agent, target);
    if (previous && target.ref.backend === 'codex' && previous !== target.ref.threadId) {
      try { await this.appSurface.archiveConversation(previous); }
      catch (error) {
        await super.resumeConversation(agent, { ref: { backend: 'codex', threadId: previous }, storageState: 'active' }).catch(() => undefined);
        if (target.storageState === 'archived') await this.appSurface.archiveConversation(target.ref.threadId).catch(() => undefined);
        throw error;
      }
    }
    return result;
  }
  getCapabilities(agent?: Agent) {
    return { ...super.getCapabilities(agent), codeReview: true, planReview: true, conversationShare: true, permissionModes: codexBackendCapabilities.permissionModes };
  }
  generateText(agent: Agent, input: BackendTextGenerationInput) {
    return super.generateText(agent, { ...input, mcpServers: utilityMcpServers(input.mcpServers).map(server => ({ ...server, approval: 'auto' as const, required: true })), selectModel: models => utilityTextModel('codex', models, input.complexity) });
  }
  async runCodeReview(agent: Agent, input: BackendCodeReviewInput) {
    const result = await this.executeScopedPrompt(agent, { cwd: input.cwd, prompt: input.prompt, session: input.reviewerSession ?? agent.backendSession,
      scope: { id: input.reviewMcpServerUrl, mcpServers: [{ name: product.mcpServerName, url: input.reviewMcpServerUrl, approval: 'auto', required: true, enabledTools: ['report_finding', 'update_finding', 'delete_finding', 'finish_review_round', 'send-message', 'set-status', 'finish_turn'] }] },
    });
    return { text: result.text, reviewerSession: result.session };
  }
  disposeCodeReview(session: BackendSession) { return this.disposeScopedSession(session); }
}
