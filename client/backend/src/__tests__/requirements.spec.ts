import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { BackendModelOption } from '@workspace/core/contracts';
import { loadRequirements } from '../requirements';
import { BackendDriverRpc } from '../driver-rpc';
import { AppBackendServer } from '../server';
import { createTestSnapshot } from './server-test-fixtures';

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function homeWith(content?: string) {
  const home = await mkdtemp(path.join(tmpdir(), 'korus-requirements-'));
  homes.push(home);
  if (content !== undefined) await writeFile(path.join(home, 'requirements.json'), content);
  return home;
}

describe('host requirements', () => {
  it('keeps hosts without a requirements file unrestricted', async () => {
    expect(await loadRequirements(await homeWith())).toStrictEqual({});
  });

  it.each([
    '{',
    '{"models":{"codex":"gpt-6-luna"}}',
    '{"models":{"codex":[""]}}',
    '{"models":{"codex":["   "]}}',
    '{"models":{"typo":[]}}',
    '{"model":{"codex":[]}}',
  ])('rejects invalid requirements instead of silently lifting restrictions: %s', async content => {
    await expect(loadRequirements(await homeWith(content))).rejects.toThrow('requirements.json');
  });

  it('filters catalogs and catalog updates per provider without changing the provider catalog', async () => {
    const requirements = await loadRequirements(await homeWith(JSON.stringify({ models: { codex: ['gpt-6-luna'], claude: [] } })));
    const models: BackendModelOption[] = [
      { id: 'sol', model: 'gpt-6-sol', displayName: 'Sol', isDefault: true },
      { id: 'luna', model: 'gpt-6-luna', displayName: 'Luna', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }] },
    ];
    const emitters = new Map<string, (event: BackendEvent) => void>();
    const unexpectedExecution = async (): Promise<never> => { throw new Error('Catalog reads must not execute a turn.'); };
    const drivers = new Map((['codex', 'claude', 'antigravity'] as const).map(backend => [backend, {
      backend,
      getRuntimeStatus: () => ({ backend, status: 'running' }),
      getCapabilities: () => defaultBackendCapabilities(backend),
      sendPrompt: unexpectedExecution, interrupt: unexpectedExecution, respondToAgentRequest: unexpectedExecution,
      listModels: async () => models,
      onEvent: (listener: (event: BackendEvent) => void) => { emitters.set(backend, listener); return () => {}; },
      close: async () => {},
    } satisfies AgentBackendDriver] as const));
    const rpc = new BackendDriverRpc(drivers, undefined, undefined, undefined, requirements);
    const events: BackendEvent[] = [];
    rpc.onEvent(event => events.push(event));
    const filtered = [{ ...models[1]!, isDefault: true }];
    try {
      for (const [backend, expected] of [['codex', filtered], ['claude', []], ['antigravity', models]] as const) {
        await expect(rpc.handle(backendMethods.driverModelsList, { agent: { id: 'agent', backend } })).resolves.toStrictEqual(expected);
        emitters.get(backend)!({ type: 'models.changed', backend, payload: { models } });
        expect(events.at(-1)).toStrictEqual({ type: 'models.changed', backend, payload: { models: expected } });
      }
      expect(models[0]!.isDefault).toBe(true);
      expect(models[1]).not.toHaveProperty('isDefault');
    } finally { await rpc.close(); }
  });

  it('keeps an empty-list provider disabled in connection state and admission, including after a settings toggle', async () => {
    const requirements = await loadRequirements(await homeWith('{"models":{"claude":[]}}'));
    const snapshot = createTestSnapshot();
    const server = new AppBackendServer({
      version: 'test', snapshot, requirements,
      providerSetup: { isChanging: () => false, list: () => [
        { backend: 'codex', installed: true, homePath: '/codex' },
        { backend: 'claude', installed: true, homePath: '/claude' },
      ] } as never,
      driverRpc: {
        handle: vi.fn(async (_method, params) => params.backend === 'claude'
          ? { kind: 'claude', connected: true, state: { loggedIn: true } }
          : { kind: 'codex', connected: true }),
        onEvent: () => () => {}, close: async () => {},
      } as never,
    });
    try {
      await expect(server.requireConnectedEngine()).resolves.toBe('codex');
      expect(snapshot.providerConnections?.find(item => item.backend === 'claude')).toMatchObject({ connected: true, enabled: false });
      await expect(server.requireConnectedEngine('claude')).rejects.toThrow('disabled');
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: backendMethods.providerEnabledSet, params: { backend: 'claude', enabled: true } });
      expect(snapshot.providerConnections?.find(item => item.backend === 'claude')?.enabled).toBe(false);
      await expect(server.requireConnectedEngine('claude')).rejects.toThrow('disabled');
    } finally { await server.close(); }
  });
});
