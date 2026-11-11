import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultProviderDrivers } from '../driver-rpc';
import { createClaudeDriver } from '../harness-drivers';
import { antigravityGenerationPrompt, sessionHandoff } from '../agents/prompts';
import { createScriptedHarness } from '@korus-dev/multi-agent-sdk/testing';
import { scriptedDriver } from './support/scripted-driver';

const opened: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { for (const driver of opened.splice(0)) await driver.close(); });

describe('Korus provider drivers over the SDK Harness', () => {
  it('creates a driver for every provider without starting any runtime', () => {
    const drivers = createDefaultProviderDrivers({});
    opened.push(...drivers.values());
    expect([...drivers.keys()].sort()).toStrictEqual(['antigravity', 'claude', 'codex', 'cursor']);
    for (const [provider, driver] of drivers) {
      expect(driver.provider).toBe(provider);
      expect(driver.getRuntimeStatus()).toMatchObject({ provider });
    }
  });

  it('reports provider capabilities Korus layers its own review and share rules over', () => {
    const drivers = createDefaultProviderDrivers({});
    opened.push(...drivers.values());
    const agent = { id: 'a', name: 'A', folder: '/work', provider: 'cursor', status: { type: 'idle' }, avatar: 'A', createdAt: '', updatedAt: '' } as never;
    expect(drivers.get('cursor')!.getCapabilities(agent)).toMatchObject({ codeReview: true, planReview: true, conversationShare: false });
    expect(drivers.get('claude')!.getCapabilities({ ...(agent as object), provider: 'claude' } as never)).toMatchObject({ codeReview: true, conversationShare: true });
  });

  it('keeps plan capture wording in Korus, not the SDK', async () => {
    let captured: Parameters<Parameters<typeof createClaudeDriver>[1] & {}>[1] | undefined;
    const driver = createClaudeDriver({}, (provider, options) => { captured = options; return createScriptedHarness(provider as 'claude').harness; });
    opened.push(driver);
    expect(captured?.claude?.decideTool?.('ExitPlanMode', {})).toMatchObject({ behavior: 'deny', message: expect.stringContaining('proposed plan') });
    expect(captured?.claude?.decideTool?.('Bash', {})).toBeUndefined();
    expect(sessionHandoff.request).toContain('Prepare a handoff');
    expect(sessionHandoff.continuation('NOTES')).toContain('NOTES');
  });

  it('words an Antigravity generation itself, since the provider has no structured output or tool switches', () => {
    const base = { prompt: 'Write it', hasMcpServers: false };
    expect(antigravityGenerationPrompt({ ...base })).toBe('Return only the requested text. Do not call tools.\n\nWrite it');
    expect(antigravityGenerationPrompt({ ...base, developerInstructions: 'Be brief.' })).toMatch(/^Be brief\.\n\nReturn only the requested text/);
    expect(antigravityGenerationPrompt({ ...base, outputSchema: { type: 'object' } })).toContain('Return JSON matching this schema: {"type":"object"}');
  });

  it('publishes a scoped run as its agent, unless the run is silent', async () => {
    const { driver, script } = scriptedDriver('codex');
    const agent = { id: 'agent-a', name: 'A', avatar: 'A', folder: '/repo', provider: 'codex', providerSession: { kind: 'codex', threadId: 't' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never;
    await driver.loadConversation!(agent);
    script.on('executeScopedPrompt', async (context: { id: string }) => {
      script.emit({ type: 'agent.statusChanged', agentId: context.id, provider: 'codex', payload: { type: 'working' } } as never);
      return { text: 'ok', session: { kind: 'codex', threadId: 't' } };
    });
    const seen: Array<{ agentId?: string }> = [];
    driver.onEvent(event => seen.push(event as { agentId?: string }));
    await driver.executeScopedPrompt!(agent, { prompt: 'x', cwd: '/repo', scope: { id: 's' } });
    expect(seen.map(event => event.agentId)).toStrictEqual(['agent-a']);
    seen.length = 0;
    await driver.executeScopedPrompt!(agent, { prompt: 'x', cwd: '/repo', scope: { id: 's' }, silent: true });
    expect(seen).toStrictEqual([]);
  });
});
