import type { Agent, AppPluginSettings } from '@workspace/core/contracts';
import { product } from '@workspace/core/product';
import { defaultPluginSettings } from '@workspace/core/settings';
import { workProviderDefinition, workProviderKinds } from '@workspace/core/work-providers';
import type { CodexThreadStartExtension } from '@codex-app-sdk/backend';
import { appDeveloperInstructions, type AgentEffectInstructionSettings } from './agent-prompts';

const chatGptGitHubConnectorId = 'connector_76869538009648d5b282a4bb21c3d157';

export function buildAppMcpConfigOverrides(pluginSettings: AppPluginSettings = defaultPluginSettings): string[] {
  return [
    configOverride('features.apply_patch_streaming_events', true),
    configOverride('features.memories', true),
    ...workProviderKinds.flatMap(provider => {
      const plugin = workProviderDefinition(provider).hostedMcp?.plugin;
      return plugin ? [configOverride(`plugins."${plugin}".enabled`, false)] : [];
    }),
    configOverride('plugins."computer-use@openai-bundled".enabled', false),
    configOverride('plugins."unified-computer-use@openai-bundled".enabled', false),
    ...(pluginSettings.chromeEnabled
      ? [configOverride('mcp_servers.node_repl.enabled', true)]
      : []),
  ];
}

export function buildAppThreadConfig(
  agent: Agent,
  mcpServerUrl: string | null,
  pluginSettings: AppPluginSettings = defaultPluginSettings,
  effects: AgentEffectInstructionSettings = {},
  hostedMcpServerUrls: Readonly<Record<string, string>> = {},
): CodexThreadStartExtension {
  if (!mcpServerUrl) {
    return effects.developerInstructions?.trim() ? { developerInstructions: effects.developerInstructions.trim() } : {};
  }

  return {
    config: {
      [`mcp_servers.${product.mcpServerName}.url`]: appMcpUrlForAgent(mcpServerUrl, agent),
      [`mcp_servers.${product.mcpServerName}.default_tools_approval_mode`]: 'approve',
      ...Object.fromEntries(
        Object.entries(hostedMcpServerUrls).map(([serverId, serverUrl]) => [
          `mcp_servers.${serverId}.url`,
          agentScopedMcpUrl(serverUrl, agent.id),
        ]),
      ),
      ...(hostedMcpServerUrls.github
        ? { [`apps.${chatGptGitHubConnectorId}.enabled`]: false }
        : {}),
      ...(pluginSettings.chromeEnabled
        ? { 'mcp_servers.node_repl.enabled': true }
        : {}),
    },
    developerInstructions: appDeveloperInstructions(agent, pluginSettings, effects),
  };
}

export function agentScopedMcpUrl(serverUrl: string, agentId: string): string {
  const url = new URL(serverUrl);
  url.searchParams.set('agentId', agentId);
  return url.toString();
}

export function appMcpUrlForAgent(serverUrl: string, agent: Agent): string {
  const url = new URL(agentScopedMcpUrl(serverUrl, agent.id));
  if (agent.codeReview?.reviewerAgentId === agent.id && agent.codeReview.status !== 'finished') {
    url.searchParams.set('reviewContextId', agent.codeReview.id);
  }
  return url.toString();
}

function configOverride(path: string, value: boolean | string): string {
  return `${path}=${JSON.stringify(value)}`;
}
