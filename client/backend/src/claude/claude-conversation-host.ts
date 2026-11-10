import { ClaudeConversationHost as NativeHost, type ClaudeHistoryLoader } from 'multi-agents-sdk/providers/claude';
import type { Agent, AppPluginSettings, BackendSession } from '@workspace/core/contracts';
import type { AgentBackendDriver, BackendCodeReviewInput, BackendCodeReviewResult, BackendTextGenerationInput } from '@workspace/core/backend-driver';
import { claudeBackendCapabilities } from '@workspace/core/backend-capabilities';
import { agentDisplayName } from '@workspace/core/agent-display';
import { isAppMcpServerName, product } from '@workspace/core/product';
import { withInferredTurnWorkPhases } from '@workspace/core/conversation-work-phases';
import { ClaudeAgentSdkTransport } from './agent-sdk-transport';
import type { ClaudeTurnTransport } from './transport';
import { getLocalClaudeAuthentication, logoutLocalClaude } from './authentication';
import { getClaudeAccountUsage } from './account-usage';
import { presentClaudeMcpInput } from './tool-presentation-policy';
import { appDeveloperInstructions } from '../mcp/agent-prompts';
import { agentScopedMcpUrl, appMcpUrlForAgent } from '../mcp/codex-config';
import { promptWithSelectedReferences } from '../agents/prompt-content';
import { utilityTextModel } from '../agents/utility-text-model';
import { warnMain } from '../log';

type ClaudeBackendDriverOptions = {
  appMcpServerUrl?: string | null;
  hostedMcpServerUrls?: () => Readonly<Record<string, string>>;
  homeDir?: string;
  pluginSettings?: () => AppPluginSettings;
  celebrationsEnabled?: () => boolean;
  additionalDeveloperInstructions?: (agent: Agent) => string | undefined;
};
const reviewTools = ['report_finding', 'update_finding', 'delete_finding', 'finish_review_round', 'send-message', 'set-status', 'finish_turn'];

/** Korus prompts, tool presentation and workflow policy around the native harness. */
export class ClaudeConversationHost extends NativeHost<Agent> implements AgentBackendDriver {
  constructor(transport: ClaudeTurnTransport = new ClaudeAgentSdkTransport(), historyLoader: ClaudeHistoryLoader<Agent> | undefined = undefined, options: ClaudeBackendDriverOptions = {}) {
    super(transport, historyLoader, {
      homeDir: options.homeDir,
      configurePrompt: agent => {
        const mcpServerUrl = options.appMcpServerUrl ? appMcpUrlForAgent(options.appMcpServerUrl, agent) : null;
        return {
          title: agentDisplayName(agent), formatPrompt: promptWithSelectedReferences,
          appendSystemPrompt: appDeveloperInstructions(agent, options.pluginSettings?.(), {
            celebrationsEnabled: options.celebrationsEnabled?.(), developerInstructions: options.additionalDeveloperInstructions?.(agent),
          }),
          mcpServerUrl, mcpServerName: product.mcpServerName,
          hostedMcpServerUrls: Object.fromEntries(Object.entries(options.hostedMcpServerUrls?.() ?? {}).map(([name, url]) => [name, agentScopedMcpUrl(url, agent.id)])),
          allowedTools: mcpServerUrl ? [`mcp__${product.mcpServerName}__*`] : [],
        };
      },
      contextForConversation: (ref, id) => ({ id, name: id, folder: ref.folder, backend: 'claude', backendSession: { kind: 'claude', sessionId: ref.sessionId, transport: 'stdio' }, status: { type: 'idle' }, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }),
      authentication: { check: () => getLocalClaudeAuthentication(), logout: () => logoutLocalClaude() },
      readAccountUsage: () => getClaudeAccountUsage(),
      mcpServerLabel: server => isAppMcpServerName(server) ? product.name : server,
      statusText: status => ({ key: status === 'notConfigured' ? 'backend.claudeNotStarted' : 'backend.claudeConnected' }),
      toolOptions: { presentMcpInput: presentClaudeMcpInput }, inferWorkPhases: withInferredTurnWorkPhases,
      log: (_level, component, message, details) => warnMain(component, message, details),
    });
  }
  getCapabilities(agent?: Agent) {
    return { ...super.getCapabilities(agent), codeReview: true, planReview: true, conversationShare: true, permissionModes: claudeBackendCapabilities.permissionModes };
  }
  generateText(agent: Agent, input: BackendTextGenerationInput) {
    return super.generateText(agent, { ...input, selectModel: models => utilityTextModel('claude', models, input.complexity) });
  }
  async runCodeReview(agent: Agent, input: BackendCodeReviewInput): Promise<BackendCodeReviewResult> {
    const result = await this.executeScopedPrompt(agent, { prompt: input.prompt, cwd: input.cwd, session: input.reviewerSession ?? agent.backendSession,
      scope: { id: input.reviewMcpServerUrl, mcpServers: [{ name: product.mcpServerName, url: input.reviewMcpServerUrl, approval: 'auto', enabledTools: reviewTools }] },
    });
    return { text: result.text, reviewerSession: result.session };
  }
  disposeCodeReview(agent: Agent, session: BackendSession) { return this.disposeScopedSession(agent, session); }
}
