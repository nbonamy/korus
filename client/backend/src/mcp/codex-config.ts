import type { Agent, AppPluginSettings } from '@workspace/core/contracts';
import { product } from '@workspace/core/product';
import { defaultPluginSettings } from '@workspace/core/settings';
import { workProviderDefinition, workProviderKinds } from '@workspace/core/work-providers';
import type { HarnessConversationConfig as CodexThreadStartExtension } from '@korus-dev/multi-agent-sdk';

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

/**
 * The configuration keys only Codex has, for a conversation that receives Korus's instructions and MCP servers through
 * the options every harness shares.
 */
export function buildAppThreadExtras(
  pluginSettings: AppPluginSettings = defaultPluginSettings,
  hostedMcpServerUrls: Readonly<Record<string, string>> = {},
): CodexThreadStartExtension {
  const config = {
    // Korus hosts GitHub itself; ChatGPT's own connector would offer the same tools twice.
    ...(hostedMcpServerUrls.github ? { [`apps.${chatGptGitHubConnectorId}.enabled`]: false } : {}),
    ...(pluginSettings.chromeEnabled ? { 'mcp_servers.node_repl.enabled': true } : {}),
  };
  return Object.keys(config).length ? { config } : {};
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
