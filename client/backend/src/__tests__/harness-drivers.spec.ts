import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProviderDrivers } from '../driver-rpc';
import { createClaudeDriver, prepareGeneration, reviewScope } from '../harness-drivers';
import { plainTextGenerationPrompt, sessionHandoff } from '../agents/prompts';
import { createScriptedHarness } from '@korus-dev/multi-agent-sdk/testing';
import { defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
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

  it('gives every reviewer the same tools, trusting and requiring the review server only where the harness can express it', () => {
    const tools = ['read-skill', 'report_finding', 'update_finding', 'delete_finding', 'finish_review_round', 'send-message', 'set-status', 'finish_turn'];
    const scope = (provider: 'codex' | 'claude' | 'cursor' | 'antigravity') => reviewScope(() => defaultProviderCapabilities(provider))('http://review') as unknown as { mcpServers: Array<Record<string, unknown>> };
    const server = { name: 'korus', url: 'http://review', enabledTools: tools };
    expect(scope('codex')).toStrictEqual({ id: 'http://review', mcpServers: [{ ...server, approval: 'auto', required: true }] });
    expect(scope('claude')).toStrictEqual({ id: 'http://review', mcpServers: [{ ...server, approval: 'auto' }] });
    expect(scope('cursor')).toStrictEqual({ id: 'http://review', mcpServers: [server] });
    expect(scope('antigravity')).toStrictEqual({ id: 'http://review', mcpServers: [server] });
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

  it('reads banked resets and runs remote control through the harness that offers them', async () => {
    const { driver, script } = scriptedDriver('codex');
    const resets = { status: 'ready', summary: { availableCount: '1' }, accountCredits: { balance: '12', unlimited: false } };
    const status = { enabled: true, allowRemoteControl: true };
    script.on('getBankedResets', (async () => resets) as never);
    script.on('useBankedReset', (async () => ({ status: 'redeemed' })) as never);
    script.on('getRemoteControlStatus', (async () => status) as never);
    script.on('enableRemoteControl', (async () => status) as never);
    script.on('disableRemoteControl', (async () => ({ ...status, enabled: false })) as never);
    script.on('startDevicePairing', (async () => ({ code: 'ABCD' })) as never);
    script.on('checkDevicePairing', (async () => true) as never);
    script.on('listPairedDevices', (async () => [{ id: 'phone' }]) as never);
    script.on('revokePairedDevice', (async () => undefined) as never);
    expect(await driver.getBankedResets!()).toStrictEqual(resets);
    expect(await driver.useBankedReset!({ token: 't' } as never)).toStrictEqual({ status: 'redeemed' });
    expect(await driver.getRemoteControlStatus!()).toStrictEqual(status);
    expect(await driver.enableRemoteControl!()).toStrictEqual(status);
    expect(await driver.disableRemoteControl!()).toMatchObject({ enabled: false });
    expect(await driver.startDevicePairing!()).toStrictEqual({ code: 'ABCD' });
    expect(await driver.checkDevicePairing!({ code: 'ABCD' } as never)).toBe(true);
    expect(await driver.listPairedDevices!('env')).toStrictEqual([{ id: 'phone' }]);
    await driver.revokePairedDevice!('env', 'phone');
    expect(script.calls('revokePairedDevice')[0]?.args).toStrictEqual(['env', 'phone']);
    // A harness without them says so instead of failing.
    const other = scriptedDriver('claude').driver;
    expect(await other.getBankedResets!()).toStrictEqual({ status: 'unsupported' });
    await expect(other.getRemoteControlStatus!()).rejects.toThrow('claude does not support remote control.');
  });

  it('offers the permissions the harness offers, in Korus words, with the harness deciding which are dangerous', () => {
    const { driver } = scriptedDriver('cursor', { capabilities: { permissionModes: [{ id: 'default' }, { id: 'yolo', dangerous: true }] } });
    const { label, description } = defaultProviderCapabilities('cursor').permissionModes!.find(mode => mode.id === 'default')!;
    expect(driver.getRuntimeStatus().capabilities!.permissionModes).toStrictEqual([
      { id: 'default', label, ...(description ? { description } : {}) },
      { id: 'yolo', label: 'yolo', dangerous: true },
    ]);
  });

  it('follows what the running harness reports, not what the table says for its name', async () => {
    const { driver, script } = scriptedDriver('cursor', { capabilities: { mcpAutoApproval: true, mcpRequiredServers: true, structuredOutput: true, remoteControl: true, accountUsage: false } });
    const capabilities = driver.getRuntimeStatus().capabilities!;
    expect(capabilities).toMatchObject({ remoteControl: true, accountUsage: false });
    // Korus describes permissions with its own labels.
    expect(capabilities.permissionModes?.[0]).toHaveProperty('label');
    script.on('generateText', (async (_context: unknown, input: unknown) => { generated.push(input); return { text: 'ok' }; }) as never);
    const generated: unknown[] = [];
    const agent = { id: 'a', name: 'A', avatar: 'A', folder: '/repo', provider: 'cursor', status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never;
    await driver.generateText!(agent, { cwd: '/repo', prompt: 'Write it', outputSchema: { type: 'object' } } as never);
    expect(generated[0]).toMatchObject({ prompt: 'Write it', outputSchema: { type: 'object' } });
  });

  it('prepares a background generation the same way for every harness, from what the harness can do', () => {
    const icons = { name: 'diagram_icons_a1', url: 'http://127.0.0.1:4000/mcp/abc', enabledTools: ['fetch_tech_icon'] };
    const input = { cwd: '/repo', prompt: 'Write it', developerInstructions: 'Be brief.', outputSchema: { type: 'object' }, mcpServers: [icons], complexity: 'simple' } as never;
    const prepared = (provider: 'codex' | 'claude' | 'antigravity') => prepareGeneration(provider, () => defaultProviderCapabilities(provider))({} as never, input) as unknown as Record<string, unknown> & { selectModel: (models: unknown[]) => unknown };
    // Its own server is trusted, and required, wherever the harness can express that.
    expect(prepared('codex').mcpServers).toStrictEqual([{ ...icons, approval: 'auto', required: true }]);
    expect(prepared('claude').mcpServers).toStrictEqual([{ ...icons, approval: 'auto' }]);
    expect(prepared('antigravity').mcpServers).toStrictEqual([icons]);
    // A harness with structured output takes the schema and instructions as they are.
    for (const provider of ['codex', 'claude'] as const) expect(prepared(provider)).toMatchObject({ prompt: 'Write it', developerInstructions: 'Be brief.', outputSchema: { type: 'object' } });
    // One without it is asked for the same thing in words.
    expect(prepared('antigravity')).toMatchObject({ prompt: 'Be brief.\n\nReturn only the requested text. The supplied MCP tools are available; workspace tools are disabled.\n\nReturn JSON matching this schema: {"type":"object"}\n\nWrite it' });
    expect(prepared('antigravity')).not.toHaveProperty('outputSchema');
    expect(prepared('antigravity').developerInstructions).toBeUndefined();
    // Every harness picks its model the same way.
    const model = { id: 'm', model: 'm', displayName: 'M', isDefault: true };
    for (const provider of ['codex', 'claude', 'antigravity'] as const) expect(prepared(provider).selectModel([model])).toStrictEqual({ model: 'm' });
  });

  it('asks in words for what a harness without structured output cannot be given', () => {
    const base = { prompt: 'Write it', hasMcpServers: false };
    expect(plainTextGenerationPrompt({ ...base })).toBe('Return only the requested text. Do not call tools.\n\nWrite it');
    expect(plainTextGenerationPrompt({ ...base, developerInstructions: 'Be brief.' })).toMatch(/^Be brief\.\n\nReturn only the requested text/);
    expect(plainTextGenerationPrompt({ ...base, outputSchema: { type: 'object' } })).toContain('Return JSON matching this schema: {"type":"object"}');
  });

  it('delegates to a worktree through a native fork, or returns null so Korus hands off instead', async () => {
    const agent = { id: 'agent-a', name: 'A', avatar: 'A', folder: '/repo', provider: 'codex', providerSession: { kind: 'codex', conversationId: 't' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never;
    const worker = { ...(agent as object), id: 'worker', folder: '/repo-worktree', providerSession: undefined } as never;
    const { driver, script } = scriptedDriver('codex');
    script.on('forkConversation', () => ({ providerSession: { kind: 'codex', conversationId: 'forked' }, forkedFromTurnId: 'turn-1' }));
    await expect(driver.forkWorktreeConversation!(agent, worker)).resolves.toStrictEqual({ providerSession: { kind: 'codex', conversationId: 'forked' } });
    expect(script.calls('forkConversation')[0]?.args[1]).toMatchObject({ id: 'worker', folder: '/repo-worktree' });
    script.on('forkConversation', () => null);
    await expect(driver.forkWorktreeConversation!(agent, worker)).resolves.toBeNull();
    await expect(driver.forkConversation!(agent, worker)).rejects.toThrow('cannot fork this conversation right now');
    const cursor = scriptedDriver('cursor');
    const cursorAgent = { ...(agent as object), provider: 'cursor', providerSession: { kind: 'cursor', conversationId: 's' } } as never;
    await expect(cursor.driver.forkWorktreeConversation!(cursorAgent, { ...(cursorAgent as object), id: 'worker', folder: '/repo-worktree' } as never)).resolves.toBeNull();
    expect(cursor.script.calls('forkConversation')).toStrictEqual([]);
  });

  it('runs an agent with the harness\'s own default when its saved permission is no longer offered', async () => {
    const { driver, script } = scriptedDriver('antigravity');
    const agent = (permission: string) => ({ id: 'agent-a', name: 'A', avatar: 'A', folder: '/repo', provider: 'antigravity', providerDefaults: { kind: 'antigravity', model: 'gemini', permission }, status: { type: 'idle' }, createdAt: '', updatedAt: '' }) as never;
    const sent: unknown[] = [];
    script.on('sendPrompt', (async (context: { providerDefaults?: unknown }) => { sent.push(structuredClone(context.providerDefaults)); return { providerSession: { kind: 'antigravity', conversationId: 's' } }; }) as never);
    await driver.sendPrompt(agent('auto_edit'), 'hello');
    await driver.sendPrompt(agent('accept-edits'), 'again');
    expect(sent).toStrictEqual([{ kind: 'antigravity', model: 'gemini' }, { kind: 'antigravity', model: 'gemini', permission: 'accept-edits' }]);
  });

  it('publishes the conversation as neutral session state: a snapshot to start from, then patches', async () => {
    const { driver, script } = scriptedDriver('codex');
    const agent = { id: 'agent-a', name: 'A', avatar: 'A', folder: '/repo', provider: 'codex', providerSession: { kind: 'codex', conversationId: 's' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never;
    const seen: Array<{ type: string; agentId?: string; payload?: unknown }> = [];
    driver.onEvent(event => { if (event.type.startsWith('conversation.session')) seen.push(event as never); });
    await driver.loadConversation!(agent);
    script.emit({ type: 'agent.updated', agentId: 'agent-a', provider: 'codex', payload: { id: 'agent-a', conversationTitle: 'Release' } } as never);
    expect(seen.map(event => event.type)).toStrictEqual(['conversation.sessionSnapshot', 'conversation.sessionPatch']);
    expect(seen[0]).toMatchObject({ agentId: 'agent-a', provider: 'codex', payload: { conversation: 's', snapshot: { revision: 0 } } });
    expect(seen[1]).toMatchObject({ payload: { conversation: 's', patch: { revision: 1, ops: [{ op: 'set', key: 'title', value: 'Release' }] } } });
    seen.length = 0;
    await driver.loadConversation!(agent);
    expect(seen).toMatchObject([{ type: 'conversation.sessionSnapshot', payload: { snapshot: { revision: 1, state: { title: 'Release' } } } }]);
  });

  it('reloads a conversation whose provider stream broke, and hands readers the repaired state', async () => {
    const { driver, script } = scriptedDriver('cursor');
    const agent = { id: 'agent-a', name: 'A', avatar: 'A', folder: '/repo', provider: 'cursor', providerSession: { kind: 'cursor', conversationId: 's' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never;
    await driver.loadConversation!(agent);
    script.emit({ type: 'cursor.conversationSnapshotChanged', agentId: 'agent-a', provider: 'cursor', providerSessionId: 's', payload: { revision: 1, snapshot: { agentId: 'agent-a', sessionId: 's', activeTurnId: null, turns: [], messages: [], clientRequests: [], answeredClientRequestIds: [], busy: false, historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null } } } as never);
    const loads = script.calls('loadConversation').length;
    const seen: string[] = [];
    driver.onEvent(event => seen.push(event.type));
    // A native event that skips a revision cannot be applied: the provider stream must be reloaded.
    script.emit({ type: 'cursor.conversationEventReceived', agentId: 'agent-a', provider: 'cursor', providerSessionId: 's', payload: { revision: 3, event: {} } } as never);
    await vi.waitFor(() => expect(script.calls('loadConversation')).toHaveLength(loads + 1));
    await vi.waitFor(() => expect(seen.at(-1)).toBe('conversation.sessionSnapshot'));
  });

  it('starts readers over when a fresh agent adopts its conversation, without asking them to reload', async () => {
    const { driver, script } = scriptedDriver('codex');
    const agent = { id: 'agent-a', name: 'A', avatar: 'A', folder: '/repo', provider: 'codex', status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never;
    const seen: Array<{ type: string; payload: { conversation: string | null; epoch: string } }> = [];
    driver.onEvent(event => { if (event.type.startsWith('conversation.session')) seen.push(event as never); });
    script.on('sendPrompt', (async (context: { id: string }) => {
      script.emit({ type: 'agent.updated', agentId: context.id, provider: 'codex', payload: { id: context.id, conversationTitle: 'Before admission' } } as never);
      return { providerSession: { kind: 'codex', conversationId: 't' }, turnId: 'turn-1' };
    }) as never);
    await driver.sendPrompt(agent, 'Hello');
    script.emit({ type: 'agent.updated', agentId: 'agent-a', provider: 'codex', payload: { id: 'agent-a', conversationTitle: 'After admission' } } as never);
    script.emit({ type: 'agent.updated', agentId: 'agent-a', provider: 'codex', payload: { id: 'agent-a', conversationTitle: 'Streaming' } } as never);
    expect(seen.map(event => [event.type, event.payload.conversation])).toStrictEqual([
      ['conversation.sessionSnapshot', null], ['conversation.sessionSnapshot', 't'], ['conversation.sessionPatch', 't'],
    ]);
    expect(new Set(seen.map(event => event.payload.epoch)).size).toBe(1);
  });

  it('closes an agent that ran a review, and one whose review failed, leaving nothing open under its name', async () => {
    const { driver, script } = scriptedDriver('claude');
    opened.push(driver);
    const agent = { id: 'agent-a', name: 'A', avatar: 'A', folder: '/repo', provider: 'claude', providerSession: { kind: 'claude', conversationId: 's', transport: 'stdio' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never;
    script.on('executeScopedPrompt', (async () => ({ text: 'ok', session: { kind: 'claude', conversationId: 'review', transport: 'stdio' } })) as never);
    await driver.executeScopedPrompt!(agent, { prompt: 'x', cwd: '/repo', scope: { id: 's' } });
    script.on('executeScopedPrompt', (async () => { throw new Error('Scoped execution was interrupted.'); }) as never);
    await expect(driver.executeScopedPrompt!(agent, { prompt: 'x', cwd: '/repo', scope: { id: 's' } })).rejects.toThrow('interrupted');
    await expect(driver.releaseConversation!('agent-a')).resolves.toBeUndefined();
    // The agent can be used again: nothing of it is still open in the harness.
    expect(() => driver.getCapabilities(agent)).not.toThrow();
    await expect(driver.releaseConversation!('agent-a')).resolves.toBeUndefined();
  });

  it('reports a scope\'s run as interrupted only once the run has unwound, so its conversation can then be put away', async () => {
    const { driver, script } = scriptedDriver('codex');
    opened.push(driver);
    const agent = { id: 'agent-a', name: 'A', avatar: 'A', folder: '/repo', provider: 'codex', providerSession: { kind: 'codex', conversationId: 't' }, status: { type: 'working' }, createdAt: '', updatedAt: '' } as never;
    let stop!: (error: Error) => void;
    const order: string[] = [];
    script.on('executeScopedPrompt', (() => new Promise((_resolve, reject) => { stop = reject; })) as never);
    const run = driver.executeScopedPrompt!(agent, { prompt: 'x', cwd: '/repo', scope: { id: 's' } }).catch(() => { order.push('run ended'); });
    await vi.waitFor(() => expect(stop).toBeDefined());
    const interrupted = driver.interrupt(agent).then(() => { order.push('interrupt returned'); });
    await new Promise(resolve => setTimeout(resolve, 20));
    // The harness acknowledged the interrupt, but the run is still closing down its conversation.
    expect(order).toStrictEqual([]);
    stop(new Error('Scoped execution was interrupted.'));
    await Promise.all([run, interrupted]);
    expect(order).toStrictEqual(['run ended', 'interrupt returned']);
  });

  it('answers a history load from the scope an agent is running instead of loading its conversation a second time', async () => {
    const { driver, script } = scriptedDriver('codex');
    opened.push(driver);
    const agent = { id: 'agent-a', name: 'A', avatar: 'A', folder: '/repo', provider: 'codex', status: { type: 'working' }, createdAt: '', updatedAt: '' } as never;
    let finish!: (value: unknown) => void;
    script.on('executeScopedPrompt', ((context: { id: string }) => {
      script.emit({ type: 'agent.updated', agentId: context.id, provider: 'codex', payload: { id: context.id, conversationTitle: 'Review' } } as never);
      return new Promise(resolve => { finish = resolve; });
    }) as never);
    const run = driver.executeScopedPrompt!(agent, { prompt: 'x', cwd: '/repo', scope: { id: 's' } });
    await vi.waitFor(() => expect(finish).toBeDefined());
    const seen: Array<{ type: string; payload: { snapshot?: { state: { title: string | null } } } }> = [];
    driver.onEvent(event => { if (event.type.startsWith('conversation.session')) seen.push(event as never); });
    // The agent's record has adopted the review's conversation; a reader asks for its history while the review runs.
    await expect(driver.loadConversation!({ ...(agent as object), providerSession: { kind: 'codex', conversationId: 'review' } } as never)).resolves.not.toThrow();
    expect(script.calls('loadConversation')).toHaveLength(0);
    expect(seen).toMatchObject([{ type: 'conversation.sessionSnapshot', payload: { snapshot: { state: { title: 'Review' } } } }]);
    finish({ text: 'ok', session: { kind: 'codex', conversationId: 'review' } });
    await run;
  });

  it('publishes one conversation per agent: the scope it runs, then its own conversation again', async () => {
    const { driver, script } = scriptedDriver('codex');
    const agent = { id: 'agent-a', name: 'A', avatar: 'A', folder: '/repo', provider: 'codex', providerSession: { kind: 'codex', conversationId: 't' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never;
    await driver.loadConversation!(agent);
    const seen: Array<{ type: string; payload: { epoch: string; snapshot?: { state: { title: string | null } } } }> = [];
    driver.onEvent(event => { if (event.type.startsWith('conversation.session')) seen.push(event as never); });
    script.on('executeScopedPrompt', (async (context: { id: string }) => {
      script.emit({ type: 'agent.updated', agentId: context.id, provider: 'codex', payload: { id: context.id, conversationTitle: 'Review' } } as never);
      // The agent's own conversation changes meanwhile; readers keep seeing the scope it runs.
      script.emit({ type: 'agent.updated', agentId: 'agent-a', provider: 'codex', payload: { id: 'agent-a', conversationTitle: 'Main' } } as never);
      script.emit({ type: 'agent.updated', agentId: context.id, provider: 'codex', payload: { id: context.id, conversationTitle: 'Review done' } } as never);
      return { text: 'ok', session: { kind: 'codex', conversationId: 'review' } };
    }) as never);
    await driver.executeScopedPrompt!(agent, { prompt: 'x', cwd: '/repo', scope: { id: 's' } });
    expect(seen.map(event => event.type)).toStrictEqual(['conversation.sessionSnapshot', 'conversation.sessionPatch', 'conversation.sessionSnapshot']);
    expect(seen[0]!.payload.epoch).not.toBe(seen[2]!.payload.epoch);
    expect(seen[2]!.payload.snapshot?.state.title).toBe('Main');
  });

  it('publishes a scoped run as its agent, unless the run is silent', async () => {
    const { driver, script } = scriptedDriver('codex');
    const agent = { id: 'agent-a', name: 'A', avatar: 'A', folder: '/repo', provider: 'codex', providerSession: { kind: 'codex', conversationId: 't' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' } as never;
    await driver.loadConversation!(agent);
    script.on('executeScopedPrompt', async (context: { id: string }) => {
      script.emit({ type: 'agent.statusChanged', agentId: context.id, provider: 'codex', payload: { type: 'working' } } as never);
      return { text: 'ok', session: { kind: 'codex', conversationId: 't' } };
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
