import type { Agent } from '@workspace/core/contracts';
import { codexHarnessOptions } from '../../harness-drivers';
import { AgentRegistry } from '../../harness-agent-driver';
import type { ProviderDriverRegistryOptions } from '../../driver-rpc';

/** The options Korus gives the SDK for Codex, with a way to ask what a conversation for an agent is configured with. */
export function codexOptions(options: ProviderDriverRegistryOptions = {}) {
  const agents = new AgentRegistry();
  const harness = codexHarnessOptions(options, agents);
  return {
    ...harness,
    codex: harness.codex!,
    configure(agent: Agent, scope?: { mcpServerUrl?: string }) {
      agents.set(agent);
      return harness.codex!.conversationConfig!({ id: agent.id, folder: agent.folder }, scope);
    },
  };
}
