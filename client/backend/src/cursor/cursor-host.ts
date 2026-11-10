import { CursorHost as NativeHost } from '@korus-dev/multi-agent-sdk/providers/cursor';
import type { Agent } from '@workspace/core/contracts';
import type { AgentBackendDriver, BackendCodeReviewInput, BackendCodeReviewResult } from '@workspace/core/backend-driver';
import { cursorBackendCapabilities } from '@workspace/core/backend-capabilities';
import { product } from '@workspace/core/product';
import type { BackendDriverRegistryOptions } from '../driver-rpc';
import { sessionMcpServer } from '../acp/mcp-bridge';
import { appMcpUrlForAgent, agentScopedMcpUrl } from '../mcp/codex-config';
import { appDeveloperInstructions } from '../mcp/agent-prompts';
import { promptWithSelectedReferences } from '../agents/prompt-content';
import { backendHomeDir } from '../state';
import { cursorRuntime, resolveCursorExecutable } from './runtime';

const reviewTools = ['read-skill', 'report_finding', 'update_finding', 'delete_finding', 'finish_review_round', 'send-message', 'set-status', 'finish_turn'];

/** Product identity, collaboration scope and workflow policy around the generic harness. */
export class CursorHost extends NativeHost<Agent> implements AgentBackendDriver {
  readonly coordinationPolicy = { permissionModeScope: 'provider' as const, rollbackStorageState: 'active' as const, authentication: { actions: ['check', 'cancel', 'logout', 'login'] as const, refreshOnAdmission: true, enableOnSuccess: false } };
  constructor(options: BackendDriverRegistryOptions = {}) {
    const generalSettings = () => options.getGeneralSettings?.() ?? options.generalSettings;
    super({
      runtime: cursorRuntime(generalSettings()?.providerHomes?.cursor),
      resolveCommand: resolveCursorExecutable,
      sessionOptions: { client: { name: product.mcpServerName, metadataDirectory: 'korus-sessions' }, resolveCommand: resolveCursorExecutable },
      stateDirectory: backendHomeDir,
      trustedMcpServerName: product.mcpServerName,
      steeringFallbackEnabled: () => generalSettings()?.cursorSteeringFallbackEnabled === true,
      formatPrompt: promptWithSelectedReferences,
      instructions: agent => appDeveloperInstructions(agent, options.pluginSettings?.(), {
        celebrationsEnabled: options.celebrationsEnabled?.(), developerInstructions: options.additionalDeveloperInstructions?.(agent),
      }),
      mcpServers: agent => [...(options.appMcpServerUrl ? [sessionMcpServer(appMcpUrlForAgent(options.appMcpServerUrl, agent))] : []), ...Object.entries(options.hostedMcpServerUrls?.() ?? {}).map(([name, url]) => sessionMcpServer(agentScopedMcpUrl(url, agent.id), name))],
    });
  }
  getCapabilities() {
    return { ...super.getCapabilities(), codeReview: true, planReview: true, conversationShare: false, permissionModes: cursorBackendCapabilities.permissionModes };
  }
  async runCodeReview(agent: Agent, input: BackendCodeReviewInput): Promise<BackendCodeReviewResult> {
    const result = await this.executeScopedPrompt(agent, { prompt: input.prompt, cwd: input.cwd, session: input.reviewerSession,
      scope: { id: input.reviewMcpServerUrl, mcpServers: [{ name: product.mcpServerName, url: input.reviewMcpServerUrl, enabledTools: reviewTools }] },
    });
    return { text: result.text, reviewerSession: result.session };
  }
  disposeCodeReview(agent: Agent, session: Parameters<NativeHost<Agent>['disposeScopedSession']>[1]) {
    return this.disposeScopedSession(agent, session);
  }
}
