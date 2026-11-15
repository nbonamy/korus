import { describe, expect, it } from 'vitest';
import { product } from '@workspace/core/product';
import { presentAppToolCall } from '../app-tool-call';
import { AgentRegistry } from '../../harness-agent-driver';

describe('presentAppToolCall', () => {
  const agents = new AgentRegistry();
  agents.set({ id: 'agent-dina', name: 'Dina', provider: 'codex', folder: '/repo', status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never);

  it("gives the harness the final title of a Korus tool call from the call's raw input and result", () => {
    const input = { app: 'Safari', element_index: 674, label: 'First Name', text: 'private' };

    expect(presentAppToolCall({ server: product.mcpServerName, tool: 'computer_use_click', input, state: 'running' }, agents)).toBe('Clicking First Name in Safari');
    expect(presentAppToolCall({ server: product.mcpServerName, tool: 'computer_use_click', input, result: { ok: true }, state: 'completed' }, agents)).toBe('Clicked First Name in Safari');
    expect(presentAppToolCall({ server: product.mcpServerName, tool: 'send_message', input: { to: 'agent-dina' }, state: 'running' }, agents)).toBe('Sending message to Dina');
  });

  it("leaves another server's tool calls to the harness", () => {
    expect(presentAppToolCall({ server: 'github', tool: 'computer_use_click', input: {}, state: 'completed' }, agents)).toBeUndefined();
  });
});
