import { product } from '@workspace/core/product';
import { describe, expect, it } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import { agentScopedMcpUrl, buildAppMcpConfigOverrides } from '../codex-config';
import { codexOptions } from '../../__tests__/support/codex-options';

const agent: Agent = {
  id: 'agent-dina',
  name: 'Dina',
  avatar: 'DI',
  folder: '~/src/agent-workspace',
  provider: 'codex',
  providerDefaults: { kind: 'codex' },
  status: { type: 'idle' },
  createdAt: '2026-06-05T00:00:00.000Z',
  updatedAt: '2026-06-05T00:00:00.000Z',
};

describe('codex-config', () => {
  it('enables required process-wide Codex features without creating a partial MCP server config', () => {
    expect(buildAppMcpConfigOverrides()).toStrictEqual([
      'features.apply_patch_streaming_events=true',
      'features.memories=true',
      'plugins."github@openai-curated-remote".enabled=false',
      'plugins."linear@openai-curated-remote".enabled=false',
      'plugins."computer-use@openai-bundled".enabled=false',
      'plugins."unified-computer-use@openai-bundled".enabled=false',
    ]);
  });

  it(`disables the global GitHub plugin only in ${product.name} app-server`, () => {
    expect(buildAppMcpConfigOverrides()).toContain(
      'plugins."github@openai-curated-remote".enabled=false',
    );
  });

  it('enables the host bridge only when Chrome is enabled', () => {
    expect(buildAppMcpConfigOverrides({ computerUseEnabled: false, chromeEnabled: true })).toContain(
      'mcp_servers.node_repl.enabled=true',
    );
  });

  const url = 'http://127.0.0.1:8767/mcp';
  /** What a Codex conversation is configured with, from the options Korus gives the harness. */
  const configured = (subject: Agent, options: Parameters<typeof codexOptions>[0] = {}) => codexOptions({ appMcpServerUrl: url, ...options }).configure(subject);

  it(`gives each conversation the ${product.name} MCP server, trusted, and the agent's instructions`, async () => {
    expect(await configured(agent)).toStrictEqual({
      config: {
        [`mcp_servers.${product.mcpServerName}.url`]: 'http://127.0.0.1:8767/mcp?agentId=agent-dina',
        [`mcp_servers.${product.mcpServerName}.default_tools_approval_mode`]: 'approve',
      },
      developerInstructions: expect.stringContaining(`Your ${product.name} agent ID is agent-dina.`),
    });
    expect((await configured(agent)).developerInstructions).toContain(`Use the ${product.mcpServerName} MCP server`);
    // Without the server there is nothing to configure; the agent still gets its instructions.
    expect((await codexOptions().configure(agent)).config).toStrictEqual({});
  });

  it('adds connected hosted MCP servers without auto-approving their tools', async () => {
    const { config } = await configured(agent, { hostedMcpServerUrls: () => ({ github: 'http://127.0.0.1:8767/mcp/providers/github' }) });
    expect(config).toMatchObject({
      'mcp_servers.github.url': 'http://127.0.0.1:8767/mcp/providers/github?agentId=agent-dina',
      'apps.connector_76869538009648d5b282a4bb21c3d157.enabled': false,
    });
    expect(config).not.toHaveProperty('mcp_servers.github.default_tools_approval_mode');
  });

  it(`keeps the ChatGPT GitHub connector available when ${product.name} has no GitHub MCP connection`, async () => {
    const { config } = await configured(agent, { hostedMcpServerUrls: () => ({}) });
    expect(config).not.toHaveProperty('apps.connector_76869538009648d5b282a4bb21c3d157.enabled');
    expect(config).not.toHaveProperty('mcp_servers.github.url');
  });

  it(`directs GUI automation to ${product.name} MCP rather than the built-in Codex Computer Use skill`, async () => {
    const result = await configured(agent, { pluginSettings: () => ({ computerUseEnabled: true, chromeEnabled: true }) });
    expect(result.developerInstructions).toContain('korus-computer-use');
    expect(result.config?.['mcp_servers.node_repl.enabled']).toBe(true);
  });

  it('adds celebration policy only when the setting is enabled', async () => {
    expect((await configured(agent)).developerInstructions).toContain('celebration in finish_turn');
    expect((await configured(agent, { celebrationsEnabled: () => false })).developerInstructions).not.toContain('celebration in finish_turn');
  });

  it('preserves existing query params when scoping an MCP URL to an agent', () => {
    expect(agentScopedMcpUrl('http://127.0.0.1:8767/mcp?debug=1', 'agent-dina')).toBe('http://127.0.0.1:8767/mcp?debug=1&agentId=agent-dina');
  });

  it('keeps review finding tools on ordinary follow-up turns until the review closes', async () => {
    const reviewer: Agent = {
      ...agent,
      codeReview: {
        id: 'review-1', targetAgentId: agent.id, reviewerAgentId: agent.id,
        scope: { type: 'uncommitted' }, threadMode: 'current', status: 'ready',
        activeRoundId: 'round-1', rounds: [{ id: 'round-1', number: 1, status: 'ready', findings: [], startedAt: '' }],
        createdAt: '', updatedAt: '',
      },
    };
    const serverUrl = async () => (await configured(reviewer)).config?.[`mcp_servers.${product.mcpServerName}.url`];
    expect(await serverUrl()).toBe('http://127.0.0.1:8767/mcp?agentId=agent-dina&reviewContextId=review-1');
    reviewer.codeReview!.status = 'finished';
    expect(await serverUrl()).toBe('http://127.0.0.1:8767/mcp?agentId=agent-dina');
  });

  it('leaves a review scope to its own server, adding only the keys Codex alone has', async () => {
    const options = codexOptions({ appMcpServerUrl: url, hostedMcpServerUrls: () => ({ github: 'http://127.0.0.1:8767/mcp/providers/github' }), pluginSettings: () => ({ computerUseEnabled: false, chromeEnabled: true }) });
    // A raw server entry beside the scope's own definition is a conflict Codex refuses.
    expect(await options.native(agent, { mcpServerUrl: 'http://127.0.0.1:8767/review' })).toStrictEqual({ config: { 'mcp_servers.node_repl.enabled': true } });
  });
});
