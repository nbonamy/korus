import { product } from '@workspace/core/product';
import { describe, expect, it } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import { agentScopedMcpUrl, buildAppMcpConfigOverrides, buildAppThreadConfig } from '../codex-config';

const agent: Agent = {
  id: 'agent-dina',
  name: 'Dina',
  avatar: 'DI',
  folder: '~/src/agent-workspace',
  backend: 'codex',
  backendDefaults: { kind: 'codex' },
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

  it(`keeps ${product.name} MCP config and agent instructions thread-scoped`, () => {
    expect(buildAppThreadConfig(agent, null)).toStrictEqual({});
    expect(buildAppThreadConfig(agent, 'http://127.0.0.1:8767/mcp')).toStrictEqual({
      config: {
        [`mcp_servers.${product.mcpServerName}.url`]: 'http://127.0.0.1:8767/mcp?agentId=agent-dina',
        [`mcp_servers.${product.mcpServerName}.default_tools_approval_mode`]: 'approve',
      },
      developerInstructions: expect.stringContaining(`Your ${product.name} agent ID is agent-dina.`),
    });
    expect(buildAppThreadConfig(agent, 'http://127.0.0.1:8767/mcp').developerInstructions)
      .toContain(`Use the ${product.mcpServerName} MCP server`);
  });

  it('adds connected hosted MCP servers without auto-approving their tools', () => {
    const config = buildAppThreadConfig(
      agent,
      'http://127.0.0.1:8767/mcp',
      undefined,
      {},
      { github: 'http://127.0.0.1:8767/mcp/providers/github' },
    );

    expect(config.config).toMatchObject({
      'mcp_servers.github.url': 'http://127.0.0.1:8767/mcp/providers/github?agentId=agent-dina',
      'apps.connector_76869538009648d5b282a4bb21c3d157.enabled': false,
    });
    expect(config.config).not.toHaveProperty('mcp_servers.github.default_tools_approval_mode');
  });

  it(`keeps the ChatGPT GitHub connector available when ${product.name} has no GitHub MCP connection`, () => {
    const config = buildAppThreadConfig(
      agent,
      'http://127.0.0.1:8767/mcp',
      undefined,
      {},
      {},
    );

    expect(config.config).not.toHaveProperty(
      'apps.connector_76869538009648d5b282a4bb21c3d157.enabled',
    );
    expect(config.config).not.toHaveProperty('mcp_servers.github.url');
  });

  it(`directs GUI automation to ${product.name} MCP rather than the built-in Codex Computer Use skill`, () => {
    const config = buildAppThreadConfig(agent, 'http://127.0.0.1:8767/mcp', {
      computerUseEnabled: true,
      chromeEnabled: true,
    });

    expect(config.developerInstructions).toContain('korus-computer-use');
    expect(config.config?.['mcp_servers.node_repl.enabled']).toBe(true);
  });

  it('adds celebration policy only when the setting is enabled', () => {
    const enabled = buildAppThreadConfig(agent, 'http://127.0.0.1:8767/mcp');
    const disabled = buildAppThreadConfig(
      agent,
      'http://127.0.0.1:8767/mcp',
      undefined,
      { celebrationsEnabled: false },
    );

    expect(enabled.developerInstructions).toContain('celebration in finish_turn');
    expect(disabled.developerInstructions).not.toContain('celebration in finish_turn');
  });

  it('preserves existing query params when scoping an MCP URL to an agent', () => {
    expect(agentScopedMcpUrl('http://127.0.0.1:8767/mcp?debug=1', 'agent-dina')).toBe('http://127.0.0.1:8767/mcp?debug=1&agentId=agent-dina');
  });

  it('keeps review finding tools on ordinary follow-up turns until the review closes', () => {
    const reviewer: Agent = {
      ...agent,
      codeReview: {
        id: 'review-1', targetAgentId: agent.id, reviewerAgentId: agent.id,
        scope: { type: 'uncommitted' }, threadMode: 'current', status: 'ready',
        activeRoundId: 'round-1', rounds: [{ id: 'round-1', number: 1, status: 'ready', findings: [], startedAt: '' }],
        createdAt: '', updatedAt: '',
      },
    };
    expect(buildAppThreadConfig(reviewer, 'http://127.0.0.1:8767/mcp').config?.[`mcp_servers.${product.mcpServerName}.url`])
      .toBe('http://127.0.0.1:8767/mcp?agentId=agent-dina&reviewContextId=review-1');
    reviewer.codeReview!.status = 'finished';
    expect(buildAppThreadConfig(reviewer, 'http://127.0.0.1:8767/mcp').config?.[`mcp_servers.${product.mcpServerName}.url`])
      .toBe('http://127.0.0.1:8767/mcp?agentId=agent-dina');
  });
});
