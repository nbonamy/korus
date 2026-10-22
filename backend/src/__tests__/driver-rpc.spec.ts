import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentBackendDriver, BackendSendResult } from '@workspace/core/backend-driver';
import type { Agent } from '@workspace/core/contracts';
import { defaultGeneralSettings } from '@workspace/core/settings';
import { BackendDriverRpc, appSurfaceOptions } from '../driver-rpc';
import { AppBackendServer } from '../server';
import { createTestSnapshot } from './server-test-fixtures';
import { CodexBackendDriver } from '../codex/codex-driver';
import { WORKTREE_DELEGATION_PROMPT } from '../agents/worktree-delegation';

// Provider discovery has its own coverage; RPC tests must not run the host login shell.
vi.mock('../codex/codex-command', () => ({
  resolveCodexLaunch: (configuredPath?: string) => ({ command: configuredPath || 'codex', env: {} }),
}));

describe('BackendDriverRpc', () => {
  it.each(['driver/prompt/send', 'driver/prompt/steer'])('checks the expected session after asynchronous engine preflight (%s)', async method => {
    const agent = { ...createAgent(), backendSession: { kind: 'codex' as const, threadId: 'original' } };
    const sendPrompt = vi.fn(); const steerPrompt = vi.fn();
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt, steerPrompt })]]), undefined,
      async () => { agent.backendSession = { kind: 'codex', threadId: 'replacement' }; });
    try {
      await expect(rpc.handle(method, { agent, prompt: 'Keep this in the original chat', expectedSessionId: JSON.stringify({ kind: 'codex', threadId: 'original' }) })).rejects.toThrow('stale');
      expect(sendPrompt).not.toHaveBeenCalled(); expect(steerPrompt).not.toHaveBeenCalled();
    } finally { await rpc.close(); }
  });
  it('routes bounded content reads through the owning driver and rejects invalid offsets', async () => {
    const snapshot = createTestSnapshot(); const agent = { ...createAgent(), backend: 'claude' as const, backendSession: { kind: 'claude' as const, sessionId: 'session', transport: 'stdio' as const } };
    snapshot.agents = [agent]; snapshot.teams[0].agentIds = [agent.id];
    const chunk = { data: 'e30=', totalBytes: 2, nextOffset: null };
    const readConversationContent = vi.fn().mockResolvedValue(chunk);
    const driver = createDriver({ backend: 'claude', readConversationContent });
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new BackendDriverRpc(new Map([['claude', driver]])), saveSnapshot: vi.fn().mockResolvedValue(undefined) });
    const input = { sessionId: 'session', contentId: 'a'.repeat(64), offset: 0 };
    try {
      const result = await server.handleMessage({ jsonrpc: '2.0', id: 'read', method: 'agent/conversation/content/read', params: { agentId: agent.id, input } });
      expect(result).toMatchObject({ result: chunk });
      expect(readConversationContent).toHaveBeenCalledExactlyOnceWith(agent, input);
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 'invalid', method: 'agent/conversation/content/read', params: { agentId: agent.id, input: { ...input, offset: -1 } } })).rejects.toThrow('Invalid conversation content');
      expect(readConversationContent).toHaveBeenCalledTimes(1);
    } finally { await server.close(); }
  });
  it('retains user-entered delegation controls through send and steering, then clears them for a new assignment', async () => {
    const snapshot = createTestSnapshot();
    const agent = createAgent();
    snapshot.agents = [agent];
    snapshot.teams[0].agentIds = [agent.id];
    const driver = createDriver({ steerPrompt: vi.fn().mockResolvedValue({ backendSession: { kind: 'codex', threadId: 'thread-send' }, turnId: 'turn-send' }) });
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])), saveSnapshot: vi.fn().mockResolvedValue(undefined) });
    const delegation = { startingContext: 'handoff', instructions: 'Say Hello only' } as const;
    try {
      const sent = await server.handleMessage({ jsonrpc: '2.0', id: 'send', method: 'agent/prompt/send', params: { agentId: agent.id, prompt: '/delegate Translate README', options: { delegation } } });
      expect(sent).not.toHaveProperty('error');
      await vi.waitFor(() => expect(agent.userDelegationOverrides).toStrictEqual({ ...delegation, execution: { backend: 'codex', conversationId: 'thread-send', turnId: 'turn-send' } }));
      expect(driver.sendPrompt).toHaveBeenCalledWith(agent, expect.stringContaining('Say Hello only'), { delegation });
      const updated = { startingContext: 'conversation', instructions: 'Say Bonjour only' } as const;
      const steered = await server.handleMessage({ jsonrpc: '2.0', id: 'steer', method: 'agent/prompt/steer', params: { agentId: agent.id, prompt: '/delegate Translate README', options: { delegation: updated } } });
      expect(steered).not.toHaveProperty('error');
      const acceptedControls = { ...updated, execution: { backend: 'codex', conversationId: 'thread-send', turnId: 'turn-send' } };
      expect(agent.userDelegationOverrides).toStrictEqual(acceptedControls);
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 'invalid', method: 'agent/prompt/steer', params: { agentId: agent.id, prompt: '/delegate task', options: { delegation: { startingContext: 'replay' } } } })).rejects.toThrow('Invalid worktree delegation overrides');
      expect(agent.userDelegationOverrides).toStrictEqual(acceptedControls);
      await server.handleMessage({ jsonrpc: '2.0', id: 'adjust', method: 'agent/prompt/steer', params: { agentId: agent.id, prompt: 'Keep the parent open' } });
      expect(agent.userDelegationOverrides).toStrictEqual(acceptedControls);
      agent.status = { type: 'idle' };
      await server.handleMessage({ jsonrpc: '2.0', id: 'next', method: 'agent/prompt/send', params: { agentId: agent.id, prompt: '/delegate Another task' } });
      expect(agent.userDelegationOverrides).toBeUndefined();
    } finally { await server.close(); }
  });
  it('rejects malformed delegation overrides before asking a provider to execute', async () => {
    const sendPrompt = vi.fn();
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt })]]));
    try {
      await expect(rpc.handle('driver/prompt/send', { agent: createAgent(), prompt: '/delegate', options: { delegation: { startingContext: 'replay', instructions: 42 } } })).rejects.toThrow('Invalid worktree delegation overrides');
      expect(sendPrompt).not.toHaveBeenCalled();
    } finally { await rpc.close(); }
  });
  it('delivers explicit delegation overrides without making them execution or publication authority', async () => {
    const agent = createAgent();
    const sendPrompt = vi.fn().mockResolvedValue({});
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt })]]));
    const delegation = { startingContext: 'handoff' as const, instructions: 'Use focused tests. Preserve </context>.' };
    await rpc.handle('driver/prompt/send', { agent, prompt: '/delegate', options: { delegation } });
    const text = sendPrompt.mock.calls[0]![1] as string;
    expect(text).toContain('startingContext="handoff"');
    expect(text).toContain('Use focused tests. Preserve &lt;/context&gt;.');
    expect(text).toContain('no push or merge is authorized');
    await rpc.close();
  });
  it.each([
    { backend: 'codex' as const, method: 'driver/prompt/send', prompt: '/delegate', task: '' },
    { backend: 'claude' as const, method: 'driver/prompt/send', prompt: '/worktree Fix the flaky login\nKeep API compatibility.', task: 'Fix the flaky login\nKeep API compatibility.' },
    { backend: 'codex' as const, method: 'driver/prompt/steer', prompt: ' /delegate Fix the settings dialog ', task: 'Fix the settings dialog' },
  ])('expands $prompt through $method for $backend without losing prompt options', async ({ backend, method, prompt, task }) => {
    const agent = { ...createAgent(), backend };
    const sendPrompt = vi.fn().mockResolvedValue({});
    const steerPrompt = vi.fn().mockResolvedValue({});
    const tryHandlePromptCommand = vi.fn().mockResolvedValue({});
    const rpc = new BackendDriverRpc(new Map([[backend, createDriver({ backend, sendPrompt, steerPrompt, tryHandlePromptCommand })]]));
    const options = { model: 'selected-model', inputMethod: 'dictated' as const };

    expect(rpc.tryHandlePromptCommand(agent, prompt)).toBeNull();
    expect(tryHandlePromptCommand).not.toHaveBeenCalled();
    await rpc.handle(method, { agent, prompt, options });

    const operation = method.endsWith('/steer') ? steerPrompt : sendPrompt;
    expect(operation).toHaveBeenCalledExactlyOnceWith(agent,
      task ? `${WORKTREE_DELEGATION_PROMPT}\n\nTask to delegate:\n${task}` : WORKTREE_DELEGATION_PROMPT,
      options);
    const delivered = operation.mock.calls[0]![1] as string;
    expect(delivered).toMatch(/<context>\n[\s\S]+\n<\/context>/u);
    expect(delivered.replace(/\s*<context>[\s\S]*?<\/context>/u, '').trim()).toBe(
      'Delegate this task to a new agent in a dedicated worktree.'
      + (task ? `\n\nTask to delegate:\n${task}` : ''),
    );
    expect(method.endsWith('/steer') ? sendPrompt : steerPrompt).not.toHaveBeenCalled();
    await rpc.close();
  });

  it.each(['/worktrees list', 'Explain /delegate', '/delegate-other'])('does not expand non-command text: %s', async (prompt) => {
    const agent = createAgent();
    const driver = createDriver();
    const rpc = new BackendDriverRpc(new Map([['codex', driver]]));
    await rpc.handle('driver/prompt/send', { agent, prompt });
    expect(driver.sendPrompt).toHaveBeenCalledExactlyOnceWith(agent, prompt, undefined);
    await rpc.close();
  });

  it.each([
    { account: null, requiresOpenaiAuth: true, connected: false },
    { account: null, requiresOpenaiAuth: false, connected: true },
    { account: { type: 'apiKey' }, requiresOpenaiAuth: true, connected: true },
  ])('lets the Codex driver normalize its authentication state: %j', async ({ account, requiresOpenaiAuth, connected }) => {
    const state = { account, requiresOpenaiAuth, login: { status: 'idle', error: null } };
    const adapter = { getAuthentication: vi.fn().mockResolvedValue(state), logout: vi.fn().mockResolvedValue(state) };
    const driver = new CodexBackendDriver(adapter as never);
    expect(await driver.authenticate({ action: 'check' })).toEqual({ kind: 'codex', connected, state });
    expect(await driver.authenticate({ action: 'logout' })).toEqual({ kind: 'codex', connected: false, state });
    expect(adapter.getAuthentication).toHaveBeenCalledOnce();
  });

  it('uses driver-owned authentication for the connection gate and explicit account actions', async () => {
    const snapshot = createTestSnapshot();
    const state = { account: null, requiresOpenaiAuth: true, login: { status: 'idle', error: null } };
    // The server must honor driver policy rather than infer connection from the account payload.
    const authenticate = vi.fn().mockResolvedValue({ kind: 'codex', connected: true, state });
    const driver = createDriver({ authenticate });
    const rpc = new BackendDriverRpc(new Map([['codex', driver]]));
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: rpc,
      providerSetup: { isChanging: () => false, list: () => [{ backend: 'codex', installed: true }] } as never });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/connections/get' });
      expect(snapshot.providerConnections?.[0]).toMatchObject({ connected: true, authentication: { state } });
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/connections/get' });
      expect(authenticate).toHaveBeenCalledExactlyOnceWith({ action: 'check' });
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'codex/authentication/login/cancel', params: { loginId: 'login-1' } }))
        .resolves.toMatchObject({ result: state });
      expect(authenticate).toHaveBeenLastCalledWith({ action: 'cancel', loginId: 'login-1' });
      authenticate.mockResolvedValue({ kind: 'codex', connected: false, state });
      await server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'provider/disconnect', params: { backend: 'codex' } });
      expect(authenticate).toHaveBeenLastCalledWith({ action: 'logout' });
      expect(snapshot.providerConnections?.[0]?.connected).toBe(false);
      expect(driver.sendPrompt).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it('fetches local engine quotas through the server without starting a chat or probing authentication', async () => {
    const snapshot = createTestSnapshot();
    const limits = { limitId: 'claude', limitName: null, primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: null }, secondary: null, credits: null, individualLimit: null, planType: null, rateLimitReachedType: null };
    const getAccountRateLimits = vi.fn().mockResolvedValue(limits);
    const claude = createDriver({ backend: 'claude', getAccountRateLimits });
    const codex = createDriver();
    const rpc = new BackendDriverRpc(new Map([['claude', claude], ['codex', codex]]));
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: rpc });
    try {
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/usage/get', params: { backend: 'claude' } })).resolves.toMatchObject({ result: limits });
      expect(snapshot.backendAccountRateLimits?.claude).toEqual(limits);
      expect(snapshot.accountRateLimits).toBeUndefined();
      expect(claude.sendPrompt).not.toHaveBeenCalled();
      snapshot.accountRateLimits = { ...limits, limitId: 'codex' };
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/usage/get', params: { backend: 'codex' } })).resolves.toMatchObject({ result: { limitId: 'codex' } });
      getAccountRateLimits.mockResolvedValueOnce(null);
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'provider/usage/get', params: { backend: 'claude' } })).resolves.toMatchObject({ result: null });
      snapshot.providerConnections!.find(engine => engine.backend === 'claude')!.enabled = false;
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'provider/usage/get', params: { backend: 'claude' } })).resolves.toMatchObject({ result: null });
      expect(getAccountRateLimits).toHaveBeenCalledTimes(2);
    } finally { await server.close(); }
  });

  it('uses the selected Codex home and replaces only the configured provider driver', async () => {
    expect(appSurfaceOptions({ generalSettings: { ...defaultGeneralSettings, providerHomes: { codex: { isolated: false, shareSkills: true, homePath: '/existing/codex' } } } }).codexHome).toBe('/existing/codex');
    const unsubscribe = vi.fn();
    const previous = createDriver({ onEvent: vi.fn(() => unsubscribe) });
    const next = createDriver();
    const claude = createDriver();
    const drivers = new Map([['codex' as const, previous], ['claude' as const, claude]]);
    const rpc = new BackendDriverRpc(drivers);
    await rpc.replaceDriver('codex', () => next);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(previous.close).toHaveBeenCalledOnce();
    expect(claude.close).not.toHaveBeenCalled();
    expect(drivers.get('codex')).toBe(next);
    await rpc.close();
    expect(next.close).toHaveBeenCalledOnce();
    expect(claude.close).toHaveBeenCalledOnce();
  });
  it('waits for process shutdown before upgrading and restores a usable driver even when the upgrade fails', async () => {
    let release!: () => void;
    const previous = createDriver({ close: vi.fn(() => new Promise<void>(resolve => { release = resolve; })) });
    const next = createDriver();
    const other = createDriver();
    const drivers = new Map([['codex' as const, previous], ['claude' as const, other]]);
    const rpc = new BackendDriverRpc(drivers);
    const upgrade = vi.fn(async () => { throw new Error('installer failed'); });
    const pending = rpc.replaceDriver('codex', () => next, upgrade);
    const failed = expect(pending).rejects.toThrow('installer failed');
    expect(upgrade).not.toHaveBeenCalled();
    release();
    await failed;
    expect(upgrade).toHaveBeenCalledOnce();
    expect(other.close).not.toHaveBeenCalled();
    expect(drivers.get('codex')).toBe(next);
    await rpc.close();
  });
  it(`appends agent-specific context after the default ${product.name} instructions`, async () => {
    const options = appSurfaceOptions({
      appMcpServerUrl: 'http://localhost:4321/mcp',
      additionalDeveloperInstructions: () => '<context>\nMission contract\n</context>',
    });
    const extension = await options.extensions?.[0]?.configureConversation?.({ extensionContext: createAgent() } as never);
    expect(extension?.developerInstructions).toContain(`Your ${product.name} agent ID`);
    expect(extension?.developerInstructions).toContain('<context>\nMission contract\n</context>');
    expect(extension!.developerInstructions!.indexOf(`Your ${product.name} agent ID`))
      .toBeLessThan(extension!.developerInstructions!.indexOf('<context>'));
  });

  it(`configures the ${product.name} MCP tools for a new Quick Chat without a folder`, async () => {
    const agent: Agent = { ...createAgent(), folder: null, sessionKind: 'quickChat' };
    const options = appSurfaceOptions({ appMcpServerUrl: 'http://127.0.0.1:4321/mcp' });

    const extension = await options.extensions?.[0]?.configureConversation?.({ extensionContext: agent } as never);

    expect(extension?.config?.[`mcp_servers.${product.mcpServerName}.url`])
      .toBe(`http://127.0.0.1:4321/mcp?agentId=${agent.id}`);
    expect(extension?.developerInstructions).toContain('use create-project');
  });

  it(`puts Codex app-server state below the ${product.name} home instead of ~/.codex`, () => {
    vi.stubEnv('APP_HOME', '/tmp/agent-workspace-isolated-home');
    vi.stubEnv('APP_BUNDLED_CODEX_PATH', '/app/resources/codex/codex');
    vi.stubEnv('CODEX_HOME', '/tmp/normal-codex-home');
    try {
      expect(appSurfaceOptions()).toMatchObject({
        clientInfo: { name: 'workspace', title: product.name, version: '0.3.0' },
        codexHome: '/tmp/agent-workspace-isolated-home/codex-home',
        loadingStrategy: 'lazy',
        transport: {
          command: expect.any(String),
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uses the live plugin settings for Codex transport overrides', () => {
    const pluginSettings = vi.fn().mockReturnValue({ computerUseEnabled: false, chromeEnabled: true });

    const options = appSurfaceOptions({ pluginSettings });

    expect(options).toMatchObject({
      transport: {
        configOverrides: expect.arrayContaining(['mcp_servers.node_repl.enabled=true']),
      },
    });
    expect(pluginSettings).toHaveBeenCalledOnce();
  });

  it('uses the live celebration setting when configuring a provider conversation', async () => {
    const celebrationsEnabled = vi.fn().mockReturnValue(false);
    const options = appSurfaceOptions({
      appMcpServerUrl: 'http://127.0.0.1:4321/mcp',
      celebrationsEnabled,
    });
    const configureConversation = options.extensions?.[0]?.configureConversation;
    const extension = await configureConversation?.({ extensionContext: createAgent() } as never);

    expect(celebrationsEnabled).toHaveBeenCalledOnce();
    expect(extension?.developerInstructions).not.toContain('celebration: true');
  });

  it('routes model requests to the agent backend driver', async () => {
    const agent = createAgent();
    const listModels = vi.fn().mockResolvedValue([{ id: 'gpt-test', name: 'GPT Test' }]);
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver({ listModels })]]));

    await expect(rpc.handle('driver/models/list', { agent })).resolves.toStrictEqual([
      { id: 'gpt-test', name: 'GPT Test' },
    ]);
    expect(listModels).toHaveBeenCalledWith(agent);
  });

  it('routes plugin catalog requests to the agent backend driver', async () => {
    const agent = createAgent();
    const plugins = [{ id: 'dropbox', name: 'dropbox', displayName: 'Dropbox', enabled: true }];
    const listPlugins = vi.fn().mockResolvedValue(plugins);
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver({ listPlugins })]]));

    await expect(rpc.handle('driver/plugins/list', { agent })).resolves.toStrictEqual(plugins);
    expect(listPlugins).toHaveBeenCalledWith(agent);
  });

  it('routes code review only through a driver that advertises the capability', async () => {
    const agent = createAgent();
    const result = { text: '', reviewerSession: { kind: 'codex' as const, threadId: 'review-thread' } };
    const runCodeReview = vi.fn().mockResolvedValue(result);
    const disposeCodeReview = vi.fn().mockResolvedValue(undefined);
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver({
      getCapabilities: vi.fn().mockReturnValue({ codeReview: true }),
      runCodeReview,
      disposeCodeReview,
    })]]));
    const input = {
      prompt: 'Review independently.',
      cwd: '/repo',
      reviewMcpServerUrl: 'http://127.0.0.1:4321/mcp?reviewContextId=one',
      reviewerSession: { kind: 'codex' as const, threadId: 'review-thread' },
    };

    await expect(rpc.handle('driver/codeReview/run', { agent, ...input })).resolves.toEqual(result);
    expect(runCodeReview).toHaveBeenCalledWith(agent, input);
    await expect(rpc.handle('driver/codeReview/dispose', {
      agent, reviewerSession: result.reviewerSession,
    })).resolves.toBeNull();
    expect(disposeCodeReview).toHaveBeenCalledWith(agent, result.reviewerSession);
  });

  it('routes only advertised permission modes to the backend driver', async () => {
    const agent: Agent = {
      ...createAgent(),
      backend: 'claude',
      backendDefaults: { kind: 'claude' },
    };
    const setPermissionMode = vi.fn().mockResolvedValue({
      backendDefaults: { kind: 'claude', permissionMode: 'acceptEdits' },
    });
    const driver = createDriver({
      backend: 'claude',
      getCapabilities: vi.fn().mockReturnValue({
        permissionModes: [{ id: 'acceptEdits', label: 'Accept edits', description: 'Allow file edits.' }],
      }),
      setPermissionMode,
    });
    const rpc = new BackendDriverRpc(new Map([['claude', driver]]));

    await expect(rpc.handle('driver/permissionMode/update', { agent, mode: 'acceptEdits' })).resolves.toStrictEqual({
      backendDefaults: { kind: 'claude', permissionMode: 'acceptEdits' },
    });
    await expect(rpc.handle('driver/permissionMode/update', { agent, mode: 'bypassPermissions' }))
      .rejects.toThrow('Unsupported permission mode for claude: bypassPermissions');
    expect(setPermissionMode).toHaveBeenCalledOnce();
    expect(setPermissionMode).toHaveBeenCalledWith(agent, 'acceptEdits');
  });

  it('lets backend drivers handle slash commands before normal prompts', async () => {
    const agent = createAgent();
    const commandResult: BackendSendResult = {
      backendSession: { kind: 'codex', threadId: 'thread-command' },
      turnId: 'turn-command',
    };
    const tryHandlePromptCommand = vi.fn().mockReturnValue(Promise.resolve(commandResult));
    const sendPrompt = vi.fn();
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver({ sendPrompt, tryHandlePromptCommand })]]));

    await expect(rpc.handle('driver/promptCommand/handle', { agent, prompt: '/compact' })).resolves.toStrictEqual(commandResult);
    expect(tryHandlePromptCommand).toHaveBeenCalledWith(agent, '/compact');
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('routes provider session controls through driver-scoped RPC methods', async () => {
    const agent = createAgent();
    const targetAgent = { ...agent, id: 'agent-forked', name: 'Dina (fork)', backendSession: undefined };
    const goal = {
      threadId: 'thread-goal',
      objective: 'Ship the goal shelf',
      status: 'active' as const,
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const setGoal = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-goal' },
      goal,
    });
    const clearGoal = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-goal' },
      cleared: true,
    });
    const setApprovalPreset = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-approval' },
      approvalPreset: 'approve-for-me',
    });
    const steerPrompt = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-steer' },
      turnId: 'turn-steer',
    });
    const interrupt = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-interrupt' },
      turnId: 'turn-interrupt',
    });
    const deleteTurn = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-updated' },
      activeTurnId: null,
    });
    const editTurn = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-updated' },
      activeTurnId: 'turn-new',
    });
    const retryTurn = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-updated' },
      activeTurnId: 'turn-new',
    });
    const resumeConversation = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-resumed' },
    });
    const replaceConversationWithSummary = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-compressed' },
    });
    const forkConversation = vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-forked' },
    });
    const releaseConversation = vi.fn();
    const archiveAgentConversation = vi.fn().mockResolvedValue(undefined);
    const reconcileConversations = vi.fn().mockResolvedValue(undefined);
    const respondToAgentRequest = vi.fn().mockResolvedValue(undefined);
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver({
      clearGoal,
      archiveAgentConversation,
      replaceConversationWithSummary,
      releaseConversation,
      forkConversation,
      interrupt,
      respondToAgentRequest,
      deleteTurn,
      editTurn,
      retryTurn,
      reconcileConversations,
      resumeConversation,
      setApprovalPreset,
      setGoal,
      steerPrompt,
    })]]));
    const ref = { backend: 'codex' as const, threadId: 'thread-resumed' };

    await expect(rpc.handle('driver/goal/update', { agent, objective: 'Ship the goal shelf' })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-goal' },
      goal,
    });
    await expect(rpc.handle('driver/goal/clear', { agent })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-goal' },
      cleared: true,
    });
    await expect(rpc.handle('driver/approvalPreset/update', { agent, preset: 'approve-for-me' })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-approval' },
      approvalPreset: 'approve-for-me',
    });
    await expect(rpc.handle('driver/prompt/steer', { agent, prompt: 'try smaller' })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-steer' },
      turnId: 'turn-steer',
    });
    await expect(rpc.handle('driver/interrupt', { agent })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-interrupt' },
      turnId: 'turn-interrupt',
    });
    await expect(rpc.handle('driver/turn/delete', { agent, turnId: 'turn-1' })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-updated' },
      activeTurnId: null,
    });
    await expect(rpc.handle('driver/turn/edit', { agent, turnId: 'turn-1', content: 'edited' })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-updated' },
      activeTurnId: 'turn-new',
    });
    await expect(rpc.handle('driver/turn/retry', { agent, turnId: 'turn-1' })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-updated' },
      activeTurnId: 'turn-new',
    });
    const target = { ref, storageState: 'archived' as const };
    await expect(rpc.handle('driver/conversation/resume', { agent, target })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-resumed' },
    });
    await expect(rpc.handle('driver/conversation/replaceWithSummary', { agent })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-compressed' },
    });
    await expect(rpc.handle('driver/conversation/fork', { agent, targetAgent })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-forked' },
    });
    await expect(rpc.handle('driver/conversation/fork', { agent, targetAgent, turnId: 'turn-5' })).resolves.toStrictEqual({
      backendSession: { kind: 'codex', threadId: 'thread-forked' },
    });
    await expect(rpc.handle('driver/conversation/release', { backend: 'codex', agentId: 'agent-dina' })).resolves.toBeNull();
    await expect(rpc.handle('driver/conversation/archive', { agent })).resolves.toEqual({ supported: true });
    await expect(rpc.handle('driver/conversations/reconcile', { backend: 'codex', agents: [agent] })).resolves.toBeNull();
    await expect(rpc.handle('driver/agentRequest/respond', {
      backend: 'codex',
      response: { id: 'approval-1', outcome: { kind: 'decision', decision: 'allow' } },
    })).resolves.toBeNull();

    expect(setGoal).toHaveBeenCalledWith(agent, 'Ship the goal shelf');
    expect(clearGoal).toHaveBeenCalledWith(agent);
    expect(setApprovalPreset).toHaveBeenCalledWith(agent, 'approve-for-me');
    expect(steerPrompt).toHaveBeenCalledWith(agent, 'try smaller');
    expect(interrupt).toHaveBeenCalledWith(agent);
    expect(deleteTurn).toHaveBeenCalledWith(agent, 'turn-1');
    expect(editTurn).toHaveBeenCalledWith(agent, 'turn-1', 'edited');
    expect(retryTurn).toHaveBeenCalledWith(agent, 'turn-1');
    expect(resumeConversation).toHaveBeenCalledWith(agent, target);
    expect(replaceConversationWithSummary).toHaveBeenCalledWith(agent);
    expect(forkConversation).toHaveBeenNthCalledWith(1, agent, targetAgent);
    expect(forkConversation).toHaveBeenNthCalledWith(2, agent, targetAgent, 'turn-5');
    expect(releaseConversation).toHaveBeenCalledWith('agent-dina');
    expect(archiveAgentConversation).toHaveBeenCalledWith(agent);
    expect(reconcileConversations).toHaveBeenCalledWith([agent]);
    expect(respondToAgentRequest).toHaveBeenCalledWith({ id: 'approval-1', outcome: { kind: 'decision', decision: 'allow' } });
  });

  it('returns undefined for methods outside the driver RPC surface', async () => {
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver()]]));

    await expect(rpc.handle('backend/unknown', undefined)).resolves.toBeUndefined();
  });

  it('routes source repository discovery through backend-owned filesystem scanning', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-rpc-source-'));
    const repoPath = path.join(tempDir, 'agent-workspace');
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver()]]));

    try {
      await mkdir(path.join(repoPath, '.git'), { recursive: true });
      await writeFile(path.join(repoPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');

      await expect(rpc.handle('source/repositories/list', { sourceFolderPath: tempDir })).resolves.toStrictEqual([{
        name: 'agent-workspace',
        path: repoPath,
        worktrees: [{ name: 'main', path: repoPath }],
      }]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rpc.close();
    }
  });

  it('routes source worktree path suggestions through backend-owned path policy', async () => {
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver()]]));

    await expect(rpc.handle('source/worktree/path/suggest', {
      input: {
        repoPath: '/Users/nbonamy/src/agent-workspace',
        branchName: 'feature/backend split',
      },
    })).resolves.toBe(path.join('/Users/nbonamy/src', 'agent-workspace-feature-backend-split'));
    await rpc.close();
  });

  it('routes agent file listing and previews through backend-owned filesystem access', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-rpc-files-'));
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver()]]));

    try {
      await mkdir(path.join(tempDir, 'src'), { recursive: true });
      await writeFile(path.join(tempDir, 'README.md'), '# Read me\n');
      await writeFile(path.join(tempDir, 'src', 'main.ts'), 'main');

      await expect(rpc.handle('workspace/files/list', { folder: tempDir })).resolves.toStrictEqual([
        { name: 'README.md', path: 'README.md' },
        { name: 'main.ts', path: 'src/main.ts' },
      ]);
      await expect(rpc.handle('workspace/file/preview', { folder: tempDir, filePath: 'README.md' })).resolves.toStrictEqual({
        path: 'README.md',
        size: 10,
        kind: 'text',
        content: '# Read me\n',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rpc.close();
    }
  });

  it('validates agent folders through backend-owned filesystem access', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-rpc-agent-folder-'));
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver()]]));

    try {
      const filePath = path.join(tempDir, 'README.md');
      await writeFile(filePath, '# Read me\n');

      await expect(rpc.handle('workspace/folder/validate', { folder: tempDir })).resolves.toBeNull();
      await expect(rpc.handle('workspace/folder/validate', { folder: filePath })).rejects.toThrow('Agent folder must be a directory.');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rpc.close();
    }
  });

  it('lists source folders through backend-owned filesystem access', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-rpc-source-folders-'));
    const rpc = new BackendDriverRpc(new Map([['codex', createDriver()]]));

    try {
      await mkdir(path.join(tempDir, 'src'));
      await mkdir(path.join(tempDir, 'code'));
      await writeFile(path.join(tempDir, 'README.md'), '# Read me\n');

      await expect(rpc.handle('source/folders/list', { path: tempDir })).resolves.toStrictEqual({
        path: tempDir,
        parentPath: path.dirname(tempDir),
        entries: [
          { name: 'code', path: path.join(tempDir, 'code') },
          { name: 'src', path: path.join(tempDir, 'src') },
        ],
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rpc.close();
    }
  });

  it('fans out backend driver events', () => {
    let emitEvent: AgentBackendDriver['onEvent'] extends (listener: infer Listener) => () => void ? Listener : never;
    const driver = createDriver({
      onEvent: vi.fn((listener) => {
        emitEvent = listener as typeof emitEvent;
        return () => undefined;
      }),
    });
    const rpc = new BackendDriverRpc(new Map([['codex', driver]]));
    const listener = vi.fn();

    rpc.onEvent(listener);
    emitEvent!({
      backend: 'codex',
      agentId: 'agent-dina',
      type: 'agent.statusChanged',
      payload: { type: 'working' },
    });

    expect(listener).toHaveBeenCalledWith({
      backend: 'codex',
      agentId: 'agent-dina',
      type: 'agent.statusChanged',
      payload: { type: 'working' },
    });
  });

  it('deletes a conversation when the driver can and reports unsupported otherwise', async () => {
    const agent = { id: 'agent-chat', backend: 'codex', backendSession: { kind: 'codex', threadId: 'thread-chat' } } as unknown as Agent;
    const deleteAgentConversation = vi.fn().mockResolvedValue(undefined);
    await expect(new BackendDriverRpc(new Map([['codex', createDriver({ deleteAgentConversation })]])).handle('driver/conversation/delete', { agent })).resolves.toStrictEqual({ supported: true });
    expect(deleteAgentConversation).toHaveBeenCalledExactlyOnceWith(agent);
    await expect(new BackendDriverRpc(new Map([['codex', createDriver()]])).handle('driver/conversation/delete', { agent })).resolves.toStrictEqual({ supported: false });
  });
});

function createDriver(overrides: Partial<AgentBackendDriver> = {}): AgentBackendDriver {
  return {
    backend: 'codex',
    getRuntimeStatus: vi.fn().mockReturnValue({ backend: 'codex', status: 'running' }),
    getCapabilities: vi.fn().mockReturnValue({}),
    sendPrompt: vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-send' },
      turnId: 'turn-send',
    }),
    interrupt: vi.fn().mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'thread-interrupt' },
      turnId: 'turn-interrupt',
    }),
    respondToAgentRequest: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn().mockReturnValue(() => undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createAgent(): Agent {
  return {
    id: 'agent-dina',
    name: 'Dina',
    backend: 'codex',
    folder: '/tmp/agent-workspace-agent',
    status: { type: 'idle' },
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
  };
}
