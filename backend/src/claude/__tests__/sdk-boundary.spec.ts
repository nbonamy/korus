import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import { decodeAppBackendEvent, type AppBackendEvent } from '@workspace/core/backend-protocol/events';
import { getLocalClaudeAuthentication } from '../authentication';
import { ClaudeBackendDriver } from '../claude-driver';
import { ClaudeAgentSdkTransport } from '../agent-sdk-transport';
import { createQueryHarness } from './sdk-query-fixture';
import { AppBackendServer } from '../../server';
import { BackendDriverRpc } from '../../driver-rpc';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';

vi.mock('@workspace/core/runtime-discovery', () => ({
  resolveRuntimeLaunch: (command: string, env: NodeJS.ProcessEnv | undefined) => ({ command, env: { ...process.env, ...env } }),
}));
vi.mock('../authentication', () => ({ getLocalClaudeAuthentication: vi.fn() }));

function agent(id = 'claude-a'): Agent {
  return { id, name: id, folder: '/tmp/project', teamId: 'team-test', backend: 'claude', status: { type: 'idle' }, createdAt: '', updatedAt: '' };
}

describe(`Claude Agent SDK → ${product.name} backend`, () => {
  const servers: AppBackendServer[] = [];
  function setup(withConnections = false) {
    const sdk = createQueryHarness();
    const driver = new ClaudeBackendDriver(new ClaudeAgentSdkTransport({ createQuery: sdk.createQuery }));
    const snapshot = createTestSnapshot();
    snapshot.general.claudeCodeEnabled = true;
    snapshot.agents = [agent(), agent('claude-b')];
    snapshot.teams[0]!.agentIds = snapshot.agents.map((item) => item.id);
    const events: AppBackendEvent[] = [];
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot,
      driverRpc: new BackendDriverRpc(new Map([['claude', driver]])), onEvent: (event) => events.push(event),
      ...(withConnections ? { providerSetup: { isChanging: () => false, list: () => [{ backend: 'claude', installed: true, homePath: '/app/claude' }] } as never } : {}),
    });
    servers.push(server);
    return { sdk, driver, server, snapshot, events, send: (agentId: string, prompt: string) => server.handleMessage({ jsonrpc: '2.0', id: `${agentId}-${prompt}`, method: 'agent/prompt/send', params: { agentId, prompt } }) };
  }
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

  it('observes actual SDK executions once, ignoring chunks and steering, with per-turn main-loop consumption', async()=>{
    const {sdk,driver,snapshot}=setup();const observations:import('@workspace/core/usage').ExecutionObservation[]=[];driver.onUsage(o=>observations.push(o));
    const sending=driver.sendPrompt(snapshot.agents[0]!, 'CANARY prompt');
    await vi.waitFor(()=>expect(sdk.inputs).toHaveLength(1));
    sdk.emit({type:'system',subtype:'init',session_id:'usage-session',model:'claude-sonnet-4-6'});await sending;
    sdk.emit({type:'assistant',session_id:'usage-session',message:{content:[{type:'text',text:'chunk'}],usage:{input_tokens:9999}}});
    await driver.steerPrompt(snapshot.agents[0]!, 'steering');
    await vi.waitFor(()=>expect(sdk.inputs).toHaveLength(2));
    sdk.emit({type:'user',uuid:sdk.inputs[1]!.uuid,session_id:'usage-session',message:{content:'steering'}});
    sdk.emit({type:'result',subtype:'success',session_id:'usage-session',is_error:false,usage:{input_tokens:10,output_tokens:20,cache_read_input_tokens:30,cache_creation_input_tokens:5}});
    await vi.waitFor(()=>expect(observations).toHaveLength(2));
    expect(observations.map(o=>o.phase)).toStrictEqual(['started','completed']);
    expect(observations[1]?.tokens).toStrictEqual({input:45,output:20,cacheRead:30,cacheWrite:5,total:65});
    expect(observations[0]?.model).toBe('claude-sonnet-4-6');
  });

  it('marks a Claude reviewer working for its turn and idle only after completion', async () => {
    const { sdk, driver, snapshot, events } = setup();
    const reviewer = snapshot.agents[0]!;
    const reviewing = driver.runCodeReview(reviewer, {
      cwd: reviewer.folder!, prompt: 'Review the current diff.',
      reviewMcpServerUrl: 'http://review.test/mcp',
    });
    // Keep cleanup safe when an assertion fails before the SDK completes the turn.
    void reviewing.catch(() => undefined);
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    expect(reviewer.status.type).toBe('working');
    expect(snapshot.agents[1]!.status.type).toBe('idle');

    sdk.emit({ type: 'system', subtype: 'init', session_id: 'review-session' });
    sdk.emit({ type: 'assistant', session_id: 'review-session', message: { content: [{ type: 'text', text: 'Still reviewing.' }] } });
    await vi.waitFor(() => expect(events.some(event => event.type === 'claude.conversationEventReceived'
      && event.payload.event.type === 'message.delta')).toBe(true));
    expect(reviewer.status.type).toBe('working');

    sdk.emit({ type: 'result', subtype: 'success', session_id: 'review-session', is_error: false });
    await reviewing;
    expect(reviewer.status.type).toBe('idle');
    expect(events.filter(event => event.agentId === reviewer.id && event.type === 'agent.statusChanged')
      .map(event => event.payload)).toEqual([{ type: 'working' }, { type: 'idle' }]);
  });

  it('keeps a failed turn readable across the backend wire after refreshing its conversation', async () => {
    const { sdk, send, driver, snapshot, events } = setup();
    const pending = send('claude-a', 'keep my prompt');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: true, result: 'Service unavailable' });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    await driver.loadConversation(snapshot.agents[0]!);
    const frame = events.filter(event => event.type === 'claude.conversationSnapshotChanged').at(-1)!;
    expect(frame.payload.snapshot).toMatchObject({ busy: false, activeTurnId: null, turns: [{ status: 'failed' }], error: 'Service unavailable' });
    expect(frame.payload.snapshot.messages).toContainEqual(expect.objectContaining({ role: 'user', parts: expect.arrayContaining([expect.objectContaining({ text: 'keep my prompt' })]) }));
    expect(() => decodeAppBackendEvent(JSON.parse(JSON.stringify(frame)))).not.toThrow();
  });

  it.each([
    ['authentication_failed', 'Failed to authenticate: OAuth session expired and could not be refreshed', false],
    ['authentication_failed', 'Credentials rejected', false],
    [null, 'Failed to authenticate: OAuth session expired and could not be refreshed', false],
    ['server_error', 'Service unavailable', true],
    ['rate_limit', 'Usage limit reached', true],
  ])('updates engine connection after %s without changing enablement or losing the conversation', async (error, text, connected) => {
    vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true, account: { type: 'subscription', email: 'user@example.com' } });
    const { sdk, send, server, snapshot, events } = setup(true);
    const pending = send('claude-a', 'hello');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true, enabled: true });
    if (error) sdk.emit({ type: 'assistant', session_id: 'session-a', error, message: { content: [{ type: 'text', text }] } });
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: true, result: text });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    expect(snapshot.providerConnections?.[0]).toMatchObject({ connected, enabled: true, authentication: { kind: 'claude', connected, state: { loggedIn: connected } } });
    expect(snapshot.agents[0]!.backendSession).toMatchObject({ sessionId: 'session-a' });
    for (const event of events) expect(() => decodeAppBackendEvent(JSON.parse(JSON.stringify(event)))).not.toThrow();
    if (!connected) {
      expect(events.filter(event => event.type === 'provider.authenticationChanged')).toHaveLength(1);
      expect(events).toContainEqual(expect.objectContaining({ type: 'snapshot.updated', payload: expect.objectContaining({
        providerConnections: expect.arrayContaining([expect.objectContaining({ backend: 'claude', connected: false })]),
      }) }));
      expect(snapshot.providerConnections?.[0]?.authentication?.state).not.toHaveProperty('account');
      vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: false });
      expect(await send('claude-a', 'blocked until login')).toMatchObject({ error: { message: expect.stringContaining('not connected') } });
      vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true });
      await server.handleMessage({ jsonrpc: '2.0', id: 'reconnect', method: 'claude/authentication/get' });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true });
    }
  });

  it('admits a retried prompt after an external login without a manual authentication check', async () => {
    vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true, account: { type: 'subscription', email: 'user@example.com' } });
    const { sdk, send, snapshot } = setup(true);
    const pending = send('claude-a', 'hello');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    sdk.emit({ type: 'assistant', session_id: 'session-a', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'x' }] } });
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: true, result: 'x' });
    await vi.waitFor(() => expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: false }));
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true });
    const retry = await send('claude-a', 'try again');
    expect(retry).not.toHaveProperty('error');
    expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true });
  });

  it('marks Claude disconnected when authentication fails before session initialization', async () => {
    vi.mocked(getLocalClaudeAuthentication).mockResolvedValue({ loggedIn: true });
    const { sdk, send, snapshot } = setup(true);
    sdk.createQuery.mockImplementationOnce(() => { throw new Error('Failed to authenticate: OAuth session expired and could not be refreshed'); });
    await send('claude-a', 'hello');
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('error'));
    expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: false, enabled: true });
    expect(snapshot.agents).toHaveLength(2);
  });

  it('does not let a late interrupt callback settle or release the next turn', async () => {
    const { sdk, send, driver, snapshot, events } = setup();
    const started = send('claude-a', 'first');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await started;
    let finishInterrupt!: () => void;
    sdk.runtimes[0]!.interrupt.mockImplementationOnce(() => new Promise<void>(resolve => { finishInterrupt = resolve; }));
    const stopping = driver.interrupt(snapshot.agents[0]!);
    sdk.emit({ type: 'result', subtype: 'error_during_execution', session_id: 'session-a', is_error: true, errors: ['Stopped'] });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    const next = send('claude-a', 'next');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(2));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await next;
    finishInterrupt();
    await stopping;
    await expect(driver.sendPrompt(snapshot.agents[0]!, 'must not overlap', {})).rejects.toThrow('active turn');
    expect(snapshot.agents[0]!.status.type).toBe('working');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    expect(events.filter(event => event.type === 'claude.conversationEventReceived' && event.payload.event.type === 'turn.completed').map(event => event.type === 'claude.conversationEventReceived' && event.payload.event.type === 'turn.completed' ? event.payload.event.payload.turn.status : undefined)).toEqual(['interrupted', 'completed']);
  });

  it('keeps the agent working until a steered follow-up is consumed and answered', async () => {
    const { sdk, send, server, snapshot, events } = setup();
    const started = send('claude-a', 'first');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await started;
    sdk.emit({ type: 'assistant', session_id: 'session-a', message: { content: 'Before' } });
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'steer', method: 'agent/prompt/steer', params: { agentId: 'claude-a', prompt: 'Change it' } })).resolves.not.toHaveProperty('error');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(2));
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    sdk.emit({ type: 'user', uuid: sdk.inputs[1]!.uuid, isReplay: true, session_id: 'session-a', message: { content: 'Change it' } });
    sdk.emit({ type: 'assistant', session_id: 'session-a', message: { content: 'After' } });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'claude.conversationEventReceived' && event.payload.event.type === 'message.delta' && event.payload.event.payload.delta === 'After')).toBe(true));
    expect(snapshot.agents[0]!.status.type).toBe('working');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    const conversationEvents = events.filter((event) => event.type === 'claude.conversationEventReceived').map((event) => event.payload.event);
    expect(conversationEvents.filter((event) => event.type === 'turn.completed')).toHaveLength(1);
    expect(conversationEvents.filter((event) => event.type === 'message.userSubmitted')).toHaveLength(2);
  });

  it('projects Claude quota windows separately from Codex and retains the other reported window', async () => {
    const { sdk, send, snapshot, events } = setup();
    const pending = send('claude-a', 'hello');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    const quota = (rateLimitType: string, utilization?: number) => sdk.emit({
      type: 'rate_limit_event', session_id: 'session-a',
      rate_limit_info: { status: 'allowed', rateLimitType, utilization, resetsAt: 1_800_000_000 },
    });
    quota('five_hour', 0.2);
    quota('seven_day', 0.1);
    await vi.waitFor(() => expect(snapshot.backendAccountRateLimits?.claude).toMatchObject({
      primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: 1_800_000_000 },
    }));
    expect(snapshot.accountRateLimits).toBeUndefined();
    quota('seven_day_opus', 0.9);
    quota('five_hour');
    quota('five_hour', -1);
    quota('five_hour', 0.3);
    await vi.waitFor(() => expect(snapshot.backendAccountRateLimits?.claude?.primary?.usedPercent).toBe(30));
    expect(snapshot.backendAccountRateLimits?.claude?.secondary?.usedPercent).toBe(10);
    expect(events.filter(event => event.type === 'account.rateLimitsUpdated')).toHaveLength(3);
  });

  it('turns an SDK ExitPlanMode item into a durable review without UI semantics', async () => {
    const { sdk, driver, server, snapshot, events } = setup();
    const pending = driver.sendPrompt(agent(), 'plan it', { planMode: true });
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    expect(sdk.options[0]!.permissionMode).toBe('plan');
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    sdk.emit({ type: 'assistant', session_id: 'session-a', message: { content: [
      { type: 'tool_use', id: 'proposal', name: 'ExitPlanMode', input: { plan: '# Claude plan\n\nShip it.' } },
    ] } });
    await vi.waitFor(() => expect(snapshot.agents[0]!.planReview).toMatchObject({ status: 'pending', markdown: '# Claude plan\n\nShip it.' }));
    expect(events.filter((event) => event.type === 'plan.readyForReview')).toMatchObject([{ agentId: 'claude-a', payload: { markdown: '# Claude plan\n\nShip it.' } }]);
    expect(events.map((event) => event.type)).not.toContain('sidePanel.markdownRequested');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    const accepted = server.handleMessage({ jsonrpc: '2.0', id: 'accept', method: 'agent/planReview/respond', params: { agentId: 'claude-a', response: { reviewId: snapshot.agents[0]!.planReview!.id, resolution: 'accept' } } });
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(2));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await expect(accepted).resolves.not.toHaveProperty('error');
    expect(sdk.inputs[1]!.message.content).toEqual([{ type: 'text', text: 'implement the plan' }]);
    expect(snapshot.agents[0]!.planReview!.status).toBe('accept');
  });

  it('isolates SDK query streams and completion status across two concurrent agents', async () => {
    const { sdk, send, snapshot } = setup();
    const a = send('claude-a', 'first');
    const b = send('claude-b', 'second');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(2));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' }, 0);
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-b' }, 1);
    await Promise.all([a, b]);
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-b', is_error: false }, 1);
    await vi.waitFor(() => expect(snapshot.agents[1]!.status.type).toBe('idle'));
    expect(snapshot.agents[0]!.status.type).toBe('working');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false }, 0);
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
  });

  it.each([
    { toolName: 'Edit', input: { file_path: 'src/main.ts', old_string: 'obsolete();', new_string: '' }, summary: 'Edit file src/main.ts?', preview: 'Before:\nobsolete();\n\nAfter:\n(empty)' },
    { toolName: 'Edit', input: { file_path: 'src/main.ts', old_string: 'const enabled = false;\nstart();', new_string: 'const enabled = true;\nstart();', replace_all: true }, summary: 'Replace all matches in src/main.ts?', preview: 'Before:\nconst enabled = false;\nstart();\n\nAfter:\nconst enabled = true;\nstart();' },
    { toolName: 'Write', input: { file_path: 'src/main.ts', content: 'const enabled = true;\nstart();' }, summary: 'Write file src/main.ts?', preview: 'New contents (replaces any existing file contents):\nconst enabled = true;\nstart();' },
    { toolName: 'NotebookEdit', input: { notebook_path: 'notebook.ipynb', new_source: 'print(1)' }, summary: 'Edit notebook notebook.ipynb?', preview: '{\n  "notebook_path": "notebook.ipynb",\n  "new_source": "print(1)"\n}' },
    { toolName: `mcp__${product.mcpServerName}__set-status`, input: { status: 'Working' }, summary: 'Provider title', preview: '{\n  "status": "Working"\n}' },
  ])('preserves $toolName approval context and leaves Input only after the last response', async ({ toolName, input, summary, preview }) => {
    const { sdk, driver, server, snapshot, events } = setup();
    const pending = driver.sendPrompt(agent(), 'edit');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await pending;
    const permission = sdk.options[0]!.canUseTool!(toolName, input, {
      signal: new AbortController().signal, toolUseID: 'edit-item', requestId: 'permission', title: toolName.startsWith('mcp__') ? 'Provider title' : 'src/main.ts',
    });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'agentRequest.created')).toBe(true));
    expect(snapshot.agentRequests?.['claude-a']).toMatchObject([{ id: 'permission', kind: 'toolConfirmation', conversationId: 'session-a' }]);
    const isMcp = toolName.startsWith('mcp__');
    expect(events).toContainEqual(expect.objectContaining({ type: 'claude.conversationEventReceived', payload: expect.objectContaining({ event: expect.objectContaining({
      type: 'approval.requested', payload: expect.objectContaining({ payload: { confirmation: expect.objectContaining({
        integrationId: isMcp ? product.mcpServerName : 'claude', toolName: isMcp ? 'set-status' : toolName,
        summary, argumentsPreview: preview,
      }) } }),
    }) }) }));
    const secondPermission = sdk.options[0]!.canUseTool!('Read', { file_path: '/tmp/project/another.ts' }, {
      signal: new AbortController().signal, toolUseID: 'read-item', requestId: 'permission-2',
    });
    await vi.waitFor(() => expect(snapshot.agentRequests?.['claude-a']).toHaveLength(2));
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'answer', method: 'agent/request/respond', params: { response: { agentId: 'claude-a', id: 'permission', outcome: { kind: 'decision', decision: 'deny' } } } })).resolves.not.toHaveProperty('error');
    await expect(permission).resolves.toMatchObject({ behavior: 'deny' });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'agentRequest.resolved')).toBe(true));
    expect(snapshot.agents[0]!.status.type).toBe('awaitingInput');
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'answer-2', method: 'agent/request/respond', params: { response: { agentId: 'claude-a', id: 'permission-2', outcome: { kind: 'decision', decision: 'allow' } } } })).resolves.not.toHaveProperty('error');
    await expect(secondPermission).resolves.toMatchObject({ behavior: 'allow' });
    expect(snapshot.agents[0]!.status.type).toBe('working');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
  });

  it.each([false, true])('removes an SDK-cancelled permission before turn completion (already aborted: %s)', async (alreadyAborted) => {
    const { sdk, send, snapshot, events, driver } = setup();
    const started = send('claude-a', 'edit');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'session-a' });
    await started;
    const cancellation = new AbortController();
    if (alreadyAborted) cancellation.abort();
    const permission = sdk.options[0]!.canUseTool!('Edit', { file_path: '/tmp/project/file.ts' }, {
      signal: cancellation.signal, toolUseID: 'edit-item', requestId: 'cancelled',
    });
    if (!alreadyAborted) expect(snapshot.agentRequests?.['claude-a']).toHaveLength(1);
    cancellation.abort();
    await expect(permission).resolves.toMatchObject({ behavior: 'deny' });
    expect(snapshot.agentRequests?.['claude-a'] ?? []).toHaveLength(0);
    expect(snapshot.agents[0]!.status.type).toBe('working');
    expect(events.filter((event) => event.type === 'agentRequest.resolved')).toMatchObject([
      { agentId: 'claude-a', payload: { id: 'cancelled', outcome: { kind: 'cancelled' } } },
    ]);
    await expect(driver.respondToAgentRequest({ agentId: 'claude-a', id: 'cancelled', outcome: { kind: 'decision', decision: 'allow' } })).rejects.toThrow('no longer pending');
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'session-a', is_error: false });
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('idle'));
    expect(events.filter((event) => event.type === 'agentRequest.resolved')).toHaveLength(1);
  });

  it('reports SDK startup failure as an error and allows another attempt', async () => {
    const { sdk, send, snapshot } = setup();
    sdk.createQuery.mockImplementationOnce(() => { throw new Error('sdk unavailable'); });
    await send('claude-a', 'hello');
    await vi.waitFor(() => expect(snapshot.agents[0]!.status.type).toBe('error'));
    const retry = send('claude-a', 'retry');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'retry-session' });
    await retry;
    await vi.waitFor(() => expect(snapshot.agents[0]!.backendSession).toMatchObject({ sessionId: 'retry-session' }));
  });
});
