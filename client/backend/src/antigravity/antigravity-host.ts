import { AntigravityHost as NativeHost } from 'multi-agents-sdk/providers/antigravity';
import type { Agent } from '@workspace/core/contracts';
import type { AgentBackendDriver, BackendCodeReviewInput, BackendCodeReviewResult, BackendTextGenerationInput } from '@workspace/core/backend-driver';
import type { BackendDriverRegistryOptions } from '../driver-rpc';
import { product } from '@workspace/core/product';
import { antigravityBackendCapabilities } from '@workspace/core/backend-capabilities';
import { utilityMcpServers } from '../diagram-icons/utility-mcp';
import { utilityTextModel } from '../agents/utility-text-model';
import { promptWithSelectedReferences } from '../agents/prompt-content';
import { backendHomeDir } from '../state';
import { appMcpUrlForAgent, agentScopedMcpUrl } from '../mcp/codex-config';
import { appDeveloperInstructions } from '../mcp/agent-prompts';
import { sessionMcpServer } from './mcp-bridge';
import { appAcpRuntimeOptions } from './acp-runtime';
import { antigravityHome, resolveAcpRuntime } from './runtime';

export class AntigravityHost extends NativeHost<Agent> implements AgentBackendDriver {
  readonly coordinationPolicy = { authentication: { actions: ['check', 'cancel', 'logout', 'login'] as const } };
  constructor(options: BackendDriverRegistryOptions = {}) {
    super({ stateDirectory: backendHomeDir, home: antigravityHome, resolveRuntime: resolveAcpRuntime,
      runtimeOptions: appAcpRuntimeOptions,
      client: { name: product.mcpServerName, title: product.name, temporaryDirectory: 'korus-tmp', metadataDirectory: 'korus-sessions', trustedMcpServerName: product.mcpServerName },
      formatPrompt: promptWithSelectedReferences,
      instructions: (agent, { planMode }) => appDeveloperInstructions(agent, options.pluginSettings?.(), {
        celebrationsEnabled: options.celebrationsEnabled?.(), developerInstructions: options.additionalDeveloperInstructions?.(agent),
      }) + (planMode ? '\nWrite the plan and stop. Do not implement it or request implementation approval in this turn; Korus will collect the decision after showing the plan.' : ''),
      mcpServers: agent => [
        ...(options.appMcpServerUrl ? [sessionMcpServer(appMcpUrlForAgent(options.appMcpServerUrl, agent))] : []),
        ...Object.entries(options.hostedMcpServerUrls?.() ?? {}).map(([name, url]) => sessionMcpServer(agentScopedMcpUrl(url, agent.id), name)),
      ],
    });
  }
  getCapabilities() {
    return { ...super.getCapabilities(), codeReview: true, planReview: true, conversationShare: true, permissionModes: antigravityBackendCapabilities.permissionModes };
  }
  async runCodeReview(agent: Agent, input: BackendCodeReviewInput): Promise<BackendCodeReviewResult> {
    const result = await this.executeScopedPrompt(agent, { prompt: input.prompt, cwd: input.cwd, session: input.reviewerSession,
      scope: { id: input.reviewMcpServerUrl, developerInstructions: '', mcpServers: [{ name: product.mcpServerName, url: input.reviewMcpServerUrl, enabledTools: ['report_finding', 'update_finding', 'delete_finding', 'finish_review_round', 'set-status', 'finish_turn'] }] },
    });
    return { text: result.text, reviewerSession: result.session };
  }
  disposeCodeReview(agent: Agent, session: Parameters<NativeHost<Agent>['disposeScopedSession']>[1]) { return this.disposeScopedSession(agent, session); }
  generateText(agent: Agent, input: BackendTextGenerationInput) {
    return super.generateText(agent, { ...input, mcpServers: utilityMcpServers(input.mcpServers), selectModel: models => utilityTextModel(this.backend, models, input.complexity) });
  }
}
