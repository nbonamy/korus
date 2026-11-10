import { product } from '@workspace/core/product';
import type {
  PermissionResult,
} from '@anthropic-ai/claude-agent-sdk';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ClaudeAgentSdkTransport,
} from '../agent-sdk-transport';
import type { ClaudePermissionRequest } from '../transport';
import type { ClaudeSdkMessage } from '../protocol';
import { ClaudeBackendDriver } from '../claude-driver';
import { createQueryHarness } from './sdk-query-fixture';

const runtime = vi.hoisted(() => ({ missingCli: false }));
vi.mock('@workspace/core/runtime-discovery', () => ({
  // Runtime discovery owns its shell integration tests; this suite tests the transport boundary.
  resolveRuntimeLaunch: (command: string, env: NodeJS.ProcessEnv | undefined) => ({
    command: command === 'claude' && !runtime.missingCli ? '/resolved/bin/claude' : command,
    env: { ...env, PATH: env?.PATH ?? '/resolved/bin' },
  }),
}));

describe('ClaudeAgentSdkTransport', () => {

  it('routes identical SDK request IDs through the driver without resolving another agent session', async () => {
    const harnesses = [createQueryHarness(), createQueryHarness()];
    let index = 0;
    const transport = new ClaudeAgentSdkTransport({ createQuery: (input) => harnesses[index++]!.createQuery(input) });
    const driver = new ClaudeBackendDriver(transport);
    try {
      const sends = ['A', 'B'].map((id) => driver.sendPrompt({ id, name: id, folder: '/tmp/project', backend: 'claude', status: { type: 'idle' }, createdAt: '', updatedAt: '' }, 'edit'));
      await vi.waitFor(() => expect(harnesses.every((harness) => harness.inputs.length === 1)).toBe(true));
      harnesses.forEach((harness, i) => harness.emit({ type: 'system', subtype: 'init', session_id: `session-${i}` } as ClaudeSdkMessage));
      await Promise.all(sends);
      const resolved = [vi.fn(), vi.fn()];
      const permissions = harnesses.map((harness, i) => Promise.resolve(harness.options[0]!.canUseTool!('Edit', { file_path: `${i}.ts` }, {
        signal: new AbortController().signal, toolUseID: 'item', requestId: 'same',
      })).then(resolved[i]));
      await expect(transport.respondToPermissionRequest('same', { decision: 'allow' })).rejects.toThrow('Agent identity');
      await expect(transport.respondToPermissionRequest('same', { decision: 'allow' }, 'unknown')).rejects.toThrow('no longer pending');
      await expect(driver.respondToAgentRequest({ id: 'same', outcome: { kind: 'decision', decision: 'allow' } })).rejects.toThrow('Agent identity');
      await expect(driver.respondToAgentRequest({ agentId: 'unknown', id: 'same', outcome: { kind: 'decision', decision: 'allow' } })).rejects.toThrow('no longer pending');
      await driver.respondToAgentRequest({ agentId: 'A', id: 'same', outcome: { kind: 'decision', decision: 'allow' } });
      await permissions[0];
      expect(resolved[0]).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'allow', updatedInput: { file_path: '0.ts' } }));
      expect(resolved[1]).not.toHaveBeenCalled();
      await driver.respondToAgentRequest({ agentId: 'B', id: 'same', outcome: { kind: 'decision', decision: 'deny' } });
      await permissions[1];
      expect(resolved[1]).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'deny' }));
    } finally { await driver.close(); }
  });

  it.each(['cli', 'sdk-cli', 'sdk-ts', 'custom-launcher'])('keeps explicit product attribution when a resumed session inherits a %s parent', async entrypoint => {
    const harness = createQueryHarness();
    const env = { PATH: '/usr/local/bin', CLAUDE_CODE_ENTRYPOINT: entrypoint };
    const transport = new ClaudeAgentSdkTransport({ env, createQuery: harness.createQuery });
    try {
      const turn = transport.startTurn({ cwd: '/tmp/project', sessionId: 'resumed', prompt: 'continue' }, () => undefined);
      await vi.waitFor(() => expect(harness.inputs).toHaveLength(1));
      expect(harness.options[0]?.env?.CLAUDE_CODE_ENTRYPOINT).toBe(product.slug);
      expect(harness.options[0]?.resume).toBe('resumed');
      expect(env).toStrictEqual({ PATH: '/usr/local/bin', CLAUDE_CODE_ENTRYPOINT: entrypoint });
      harness.emit({ type: 'result', subtype: 'success', session_id: 'resumed', is_error: false });
      await turn.done;
    } finally { await transport.close(); }
  });

  it('keeps one Agent SDK query alive across turns in the same session', async () => {
    const harness = createQueryHarness();
    const transport = new ClaudeAgentSdkTransport({
      command: '/usr/local/bin/claude',
      env: { PATH: '/usr/local/bin', NODE_OPTIONS: '--inspect' },
      createQuery: harness.createQuery,
      createSessionId: () => '11111111-1111-4111-8111-111111111111',
    });
    const firstMessages: ClaudeSdkMessage[] = [];
    const first = transport.startTurn({
      cwd: '/tmp/project',
      prompt: 'first prompt',
      model: 'sonnet',
      permissionMode: 'default',
      appendSystemPrompt: `${product.name} instructions`,
      mcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-1',
      hostedMcpServerUrls: {
        github: 'http://127.0.0.1:4321/mcp/providers/github?agentId=agent-1',
        gitlab: 'http://127.0.0.1:4321/mcp/providers/gitlab?agentId=agent-1',
      },
      allowedTools: [`mcp__${product.mcpServerName}__*`],
    }, (message) => firstMessages.push(message));

    await vi.waitFor(() => expect(harness.inputs).toHaveLength(1));
    expect(harness.createQuery).toHaveBeenCalledOnce();
    expect(harness.options[0]).toMatchObject({
      cwd: '/tmp/project',
      pathToClaudeCodeExecutable: '/usr/local/bin/claude',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: `${product.name} instructions` },
      tools: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true,
      model: 'sonnet',
      permissionMode: 'default',
      sessionId: '11111111-1111-4111-8111-111111111111',
      disallowedTools: ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'],
      mcpServers: {
        korus: {
          type: 'http',
          url: 'http://127.0.0.1:4321/mcp?agentId=agent-1',
        },
        github: {
          type: 'http',
          url: 'http://127.0.0.1:4321/mcp/providers/github?agentId=agent-1',
        },
        gitlab: {
          type: 'http',
          url: 'http://127.0.0.1:4321/mcp/providers/gitlab?agentId=agent-1',
        },
      },
      env: expect.objectContaining({
        PATH: expect.stringContaining('/usr/local/bin'),
        CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-workspace',
        CLAUDE_CODE_ENTRYPOINT: product.slug,
      }),
    });
    expect(harness.options[0]).not.toHaveProperty('allowedTools');
    expect(harness.options[0]?.env).not.toHaveProperty('NODE_OPTIONS');
    expect(harness.inputs[0]).toMatchObject({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'first prompt' }],
      },
    });

    harness.runtimes[0]?.supportedModels.mockResolvedValueOnce([{
      value: 'claude-sonnet-4-5',
      displayName: 'Sonnet 4.5',
      description: 'Balanced for coding',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high'],
    }]);
    await expect(transport.listModels()).resolves.toEqual([{
      value: 'claude-sonnet-4-5',
      displayName: 'Sonnet 4.5',
      description: 'Balanced for coding',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high'],
    }]);

    harness.emit({ type: 'system', subtype: 'init', session_id: '11111111-1111-4111-8111-111111111111' });
    harness.emit({ type: 'result', subtype: 'success', session_id: '11111111-1111-4111-8111-111111111111', is_error: false });
    await expect(first.done).resolves.toBeUndefined();
    expect(firstMessages.map((message) => message.type)).toStrictEqual(['system', 'result']);

    const secondMessages: ClaudeSdkMessage[] = [];
    const second = transport.startTurn({
      cwd: '/tmp/project',
      prompt: 'second prompt',
      sessionId: '11111111-1111-4111-8111-111111111111',
      model: 'opus',
      effort: 'high',
      permissionMode: 'acceptEdits',
      appendSystemPrompt: `${product.name} instructions`,
      mcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-1',
      hostedMcpServerUrls: {
        github: 'http://127.0.0.1:4321/mcp/providers/github?agentId=agent-1',
        gitlab: 'http://127.0.0.1:4321/mcp/providers/gitlab?agentId=agent-1',
      },
      allowedTools: [`mcp__${product.mcpServerName}__*`],
    }, (message) => secondMessages.push(message));
    await vi.waitFor(() => expect(harness.inputs).toHaveLength(2));

    expect(harness.createQuery).toHaveBeenCalledOnce();
    expect(harness.runtimes[0]?.setModel).toHaveBeenCalledWith('opus');
    expect(harness.runtimes[0]?.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
    expect(harness.runtimes[0]?.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'high' });
    expect(harness.inputs[1]?.message.content).toStrictEqual([{ type: 'text', text: 'second prompt' }]);

    harness.emit({ type: 'result', subtype: 'success', session_id: '11111111-1111-4111-8111-111111111111', is_error: false });
    await expect(second.done).resolves.toBeUndefined();
    expect(secondMessages.map((message) => message.type)).toStrictEqual(['result']);

    const third = transport.startTurn({
      cwd: '/tmp/project',
      prompt: 'third prompt',
      sessionId: '11111111-1111-4111-8111-111111111111',
      appendSystemPrompt: `${product.name} instructions`,
      mcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-1',
      hostedMcpServerUrls: { github: 'http://127.0.0.1:4321/mcp/providers/github?agentId=agent-1', gitlab: 'http://127.0.0.1:4321/mcp/providers/gitlab?agentId=agent-1' },
      allowedTools: [`mcp__${product.mcpServerName}__*`],
    }, () => undefined);
    await vi.waitFor(() => expect(harness.inputs).toHaveLength(3));
    expect(harness.runtimes[0]?.setModel).toHaveBeenLastCalledWith(undefined);
    expect(harness.runtimes[0]?.setPermissionMode).toHaveBeenLastCalledWith('default');
    harness.emit({ type: 'result', subtype: 'success', session_id: '11111111-1111-4111-8111-111111111111', is_error: false });
    await third.done;
    await transport.close();
  });

  it('reads context usage from a persisted conversation without sending or saving a prompt', async () => {
    const harness = createQueryHarness();
    const transport = new ClaudeAgentSdkTransport({
      createQuery: harness.createQuery,
      createSessionId: () => '20202020-2020-4020-8020-202020202020',
    });

    const result = transport.readContextUsage({
      ownerId: 'agent-claude',
      cwd: '/tmp/project',
      sessionId: '21212121-2121-4121-8121-212121212121',
      model: 'haiku',
      appendSystemPrompt: `${product.name} instructions`,
      mcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-claude',
      allowedTools: [`mcp__${product.mcpServerName}__*`],
    });
    expect(harness.runtimes).toHaveLength(1);
    harness.runtimes[0]?.getContextUsage.mockResolvedValueOnce({
      categories: [],
      totalTokens: 33_120,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      percentage: 16.56,
      gridRows: [],
      model: 'claude-haiku-4-5',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
    });

    await expect(result).resolves.toStrictEqual({
      totalTokens: 33_120,
      maxTokens: 200_000,
      percentage: 16.56,
    });
    expect(harness.options[0]).toMatchObject({
      cwd: '/tmp/project',
      resume: '21212121-2121-4121-8121-212121212121',
      model: 'haiku',
      persistSession: false,
    });
    expect(harness.options[0]).not.toHaveProperty('sessionId');
    expect(harness.inputs).toStrictEqual([]);
    expect(harness.runtimes[0]?.close).toHaveBeenCalledOnce();
  });

  it('bridges Agent SDK permission requests and conversation-scoped decisions', async () => {
    const harness = createQueryHarness();
    const transport = new ClaudeAgentSdkTransport({
      createQuery: harness.createQuery,
      createSessionId: () => '33333333-3333-4333-8333-333333333333',
    });
    const requests: ClaudePermissionRequest[] = [];
    transport.startTurn({ cwd: '/tmp/project', prompt: 'edit it' }, () => undefined, (request) => requests.push(request));
    await vi.waitFor(() => expect(harness.inputs).toHaveLength(1));
    const canUseTool = harness.options[0]?.canUseTool;
    expect(canUseTool).toBeTypeOf('function');
    const abortController = new AbortController();
    const permission = canUseTool?.('Edit', { file_path: '/tmp/project/a.ts' }, {
      signal: abortController.signal,
      toolUseID: 'tool-edit-1',
      requestId: 'request-edit-1',
      title: 'Claude wants to edit a.ts',
      displayName: 'Edit file',
      description: 'Claude will modify a.ts.',
      suggestions: [{
        type: 'addRules',
        rules: [{ toolName: 'Edit' }],
        behavior: 'allow',
        destination: 'localSettings',
      }],
    });

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toStrictEqual({
      kind: 'confirm_tool',
      id: 'request-edit-1',
      toolName: 'Edit',
      input: { file_path: '/tmp/project/a.ts' },
      title: 'Claude wants to edit a.ts',
      displayName: 'Edit file',
      description: 'Claude will modify a.ts.',
      allowConversation: true,
      allowAlways: true,
    });

    await transport.respondToPermissionRequest('request-edit-1', { decision: 'allow_conversation' });
    await expect(permission).resolves.toStrictEqual({
      behavior: 'allow',
      updatedInput: { file_path: '/tmp/project/a.ts' },
      updatedPermissions: [{
        type: 'addRules',
        rules: [{ toolName: 'Edit' }],
        behavior: 'allow',
        destination: 'session',
      }],
    });

    const question = canUseTool?.('AskUserQuestion', {
      questions: [{
        header: 'Approach',
        question: 'Which approach should I use?',
        options: [{ label: 'Simple', description: 'Use the smaller change.' }],
        multiSelect: false,
      }],
    }, {
      signal: abortController.signal,
      toolUseID: 'tool-question-1',
      requestId: 'request-question-1',
    });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toStrictEqual({
      kind: 'ask_user',
      id: 'request-question-1',
      toolName: 'AskUserQuestion',
      input: {
        questions: [{
          header: 'Approach',
          question: 'Which approach should I use?',
          options: [{ label: 'Simple', description: 'Use the smaller change.' }],
          multiSelect: false,
        }],
      },
      allowConversation: false,
      allowAlways: false,
      questions: [{
        id: 'Which approach should I use?',
        header: 'Approach',
        question: 'Which approach should I use?',
        isOther: true,
        isSecret: false,
        multiSelect: false,
        options: [{ label: 'Simple', description: 'Use the smaller change.' }],
      }],
    });
    await transport.respondToPermissionRequest('request-question-1', {
      answers: {
        'Which approach should I use?': { answers: ['Simple'] },
      },
    });
    await expect(question).resolves.toStrictEqual({
      behavior: 'allow',
      updatedInput: {
        questions: [{
          header: 'Approach',
          question: 'Which approach should I use?',
          options: [{ label: 'Simple', description: 'Use the smaller change.' }],
          multiSelect: false,
        }],
        answers: { 'Which approach should I use?': 'Simple' },
      },
    });

    await expect(canUseTool?.('ExitPlanMode', { plan: '# Plan' }, {
      signal: abortController.signal,
      toolUseID: 'tool-plan-1',
      requestId: 'request-plan-1',
    })).resolves.toStrictEqual({
      behavior: 'deny',
      message: `${product.name} captured the proposed plan. Wait for the user to review or request implementation.`,
    });
    expect(requests).toHaveLength(2);

    const cancelledController = new AbortController();
    const cancelled = canUseTool?.('Bash', { command: 'npm test' }, {
      signal: cancelledController.signal,
      toolUseID: 'tool-cancelled-1',
      requestId: 'request-cancelled-1',
    });
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    cancelledController.abort();
    await expect(cancelled).resolves.toStrictEqual({
      behavior: 'deny',
      message: 'Claude permission request was cancelled.',
    });
    await expect(transport.respondToPermissionRequest('request-cancelled-1', { decision: 'allow' }))
      .rejects.toThrow('no longer pending');
    await transport.close();
  });

  it('adopts the runtime session id and fails closed when no permission UI is available', async () => {
    const harness = createQueryHarness();
    const transport = new ClaudeAgentSdkTransport({
      createQuery: harness.createQuery,
      createSessionId: () => '66666666-6666-4666-8666-666666666666',
    });
    const first = transport.startTurn({ cwd: '/tmp/project', prompt: 'first' }, () => undefined);
    await vi.waitFor(() => expect(harness.inputs).toHaveLength(1));
    const canUseTool = harness.options[0]?.canUseTool;
    const abortController = new AbortController();
    await expect(canUseTool?.('Bash', { command: 'npm test' }, {
      signal: abortController.signal,
      toolUseID: 'tool-no-ui',
      requestId: 'request-no-ui',
    })).resolves.toStrictEqual({
      behavior: 'deny',
      message: `${product.name} cannot display this Claude permission request.`,
    });

    harness.emit({ type: 'system', subtype: 'init', session_id: '77777777-7777-4777-8777-777777777777' });
    harness.emit({ type: 'result', subtype: 'success', session_id: '77777777-7777-4777-8777-777777777777', is_error: false });
    await first.done;
    const second = transport.startTurn({
      cwd: '/tmp/project',
      prompt: 'second',
      sessionId: '77777777-7777-4777-8777-777777777777',
    }, () => undefined);
    await vi.waitFor(() => expect(harness.inputs).toHaveLength(2));
    expect(harness.createQuery).toHaveBeenCalledOnce();
    await second.interrupt();
    await transport.close();
  });
});


it('passes the SDK bundled runtime to queries when no CLI is installed', async () => {
  runtime.missingCli = true;
  vi.stubEnv('APP_CLAUDE_COMMAND', '');
  const harness = createQueryHarness();
  const transport = new ClaudeAgentSdkTransport({ createQuery: harness.createQuery });
  try {
    transport.startTurn({ cwd: '/tmp/project', prompt: 'hello' }, () => undefined);
    await vi.waitFor(() => expect(harness.inputs).toHaveLength(1));
    expect(harness.options[0]?.pathToClaudeCodeExecutable).toMatch(/claude-agent-sdk-[^/]+[/\\]claude(?:\.exe)?$/);
  } finally { await transport.close(); runtime.missingCli = false; vi.unstubAllEnvs(); }
});
