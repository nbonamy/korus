import type { Agent } from '@workspace/core/contracts';
import { codexHarnessOptions } from '../../harness-drivers';
import { AgentRegistry } from '../../harness-agent-driver';
import type { ProviderDriverRegistryOptions } from '../../driver-rpc';

/** The options Korus gives the SDK for Codex, with a way to ask what a conversation for an agent is configured with. */
export function codexOptions(options: ProviderDriverRegistryOptions = {}) {
  const agents = new AgentRegistry();
  const harness = codexHarnessOptions(options, agents);
  const context = (agent: Agent) => { agents.set(agent); return { id: agent.id, folder: agent.folder }; };
  return {
    ...harness,
    codex: harness.codex!,
    /** The harness context for an agent, registered so the options can look the agent up. */
    context,
    /** Codex's own configuration keys for a conversation, beyond the options every harness receives. */
    native(agent: Agent, scope?: { mcpServerUrl?: string }) { return harness.codex!.conversationConfig!(context(agent), scope); },
    /**
     * What a conversation ends up configured with: the shared instructions and MCP servers as the SDK's Codex harness
     * writes them, plus Codex's own keys. A scoped conversation is configured by its scope alone.
     */
    async configure(agent: Agent, scope?: { mcpServerUrl?: string }) {
      const native = await harness.codex!.conversationConfig!(context(agent), scope);
      if (scope) return native;
      const servers = harness.mcpServers?.(context(agent)) ?? [];
      const instructions = native.developerInstructions ?? harness.instructions?.(context(agent), { planMode: false });
      return {
        config: { ...native.config, ...Object.fromEntries(servers.flatMap(server => [
          [`mcp_servers.${server.name}.url`, server.url],
          ...(server.name === harness.trustedMcpServerName ? [[`mcp_servers.${server.name}.default_tools_approval_mode`, 'approve']] : []),
        ])) },
        ...(instructions === undefined ? {} : { developerInstructions: instructions }),
      };
    },
  };
}
