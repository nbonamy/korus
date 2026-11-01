import { describe, expect, it } from 'vitest';
import { resolveAppMcpToolModules, type AppMcpToolModuleProvider } from '../tool-modules';

const request = {
  agentId: 'agent-dina',
  url: new URL('http://127.0.0.1/mcp?agentId=agent-dina'),
};

describe('MCP tool module resolution', () => {
  it('rejects duplicate provider identities before composing a tool surface', () => {
    const providers: AppMcpToolModuleProvider[] = [
      { id: 'design', resolve: () => undefined },
      { id: 'design', resolve: () => undefined },
    ];

    expect(() => resolveAppMcpToolModules(providers, request))
      .toThrow("Duplicate MCP tool module provider 'design'.");
  });

  it('rejects two providers that resolve the same module identity', () => {
    const providers: AppMcpToolModuleProvider[] = [
      { id: 'design-primary', resolve: () => ({ id: 'design', register: () => undefined }) },
      { id: 'design-secondary', resolve: () => ({ id: 'design', register: () => undefined }) },
    ];

    expect(() => resolveAppMcpToolModules(providers, request))
      .toThrow("Duplicate MCP tool module 'design'.");
  });
});
