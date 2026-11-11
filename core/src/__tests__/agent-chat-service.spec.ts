import { describe, expect, it, vi } from 'vitest';
import { sendAgentPrompt } from '../agent-chat-service';
import { applyMainEventToSnapshot, createInitialSnapshot } from '../snapshot';
import type { MainToRendererEvent } from '../contracts';
import type { AgentProviderDriver, ProviderSendResult } from '../provider-driver';
import { claudeProviderCapabilities, codexProviderCapabilities } from '../provider-capabilities';

describe('agent chat service', () => {
  it('delivers explicit mention content even when it is the only prompt option', () => {
    const snapshot = createInitialSnapshot();
    const driver = createFakeProviderDriver(Promise.resolve({ providerSession: { kind: 'codex', threadId: 'bound' } }));
    const options = { content: [{ type: 'mention' as const, kind: 'skill' as const, id: '/skills/cp/SKILL.md', value: 'cp', label: 'Commit and push' }] };
    sendAgentPrompt(snapshot, driver, 'agent-dina', 'Commit and push', options, vi.fn());
    expect(driver.sendPrompt).toHaveBeenCalledWith(snapshot.agents[0], 'Commit and push', options);
  });
  it('delivers approved guest text verbatim without invoking app slash commands', async () => {
    const snapshot = createInitialSnapshot();
    const driver = createFakeProviderDriver(Promise.resolve({ providerSession: { kind: 'codex', threadId: 'bound' }, messageId: 'canonical' }));
    driver.tryHandlePromptCommand = vi.fn(() => Promise.resolve({ providerSession: { kind: 'codex' as const, threadId: 'wrong' } }));
    sendAgentPrompt(snapshot, driver, 'agent-dina', '  /review exact guest text  ', undefined, vi.fn(), { plainText: true });
    expect(driver.tryHandlePromptCommand).not.toHaveBeenCalled();
    expect(driver.sendPrompt).toHaveBeenCalledWith(snapshot.agents[0], '  /review exact guest text  ');
    await flushMicrotasks();
  });
  it.each([{ interactive: true, planMode: true }, { interactive: false, planMode: true }, { interactive: true, planMode: false }, { interactive: true, planMode: undefined }])('adds hidden choice guidance only for interactive Plan-mode turns: %j', ({ interactive, planMode }) => {
    const snapshot = createInitialSnapshot();
    snapshot.general.useInteractivePlans = interactive;
    const driver = createFakeProviderDriver(Promise.resolve({ providerSession: { kind: 'codex', threadId: 'plan-thread' } }));
    const options = planMode === undefined ? undefined : { planMode };
    sendAgentPrompt(snapshot, driver, 'agent-dina', 'Plan the requested change.', options, vi.fn());
    const [, prompt, deliveredOptions] = vi.mocked(driver.sendPrompt).mock.calls[0]!;
    expect(deliveredOptions).toEqual(options);
    if (interactive && planMode) {
      expect(prompt).toContain('- [ ] / - [x]');
      expect(prompt).toContain('- ( ) / - (x)');
      expect(prompt).toContain('```mermaid');
      expect(prompt).toContain('Do not call display-markdown for the proposal.');
      expect(prompt.replace(/<context>[\s\S]*?<\/context>/gu, '').trim()).toBe('Plan the requested change.');
    } else expect(prompt).toBe('Plan the requested change.');
  });

  it('rejects malformed user delegation controls without changing agent state or executing a prompt', () => {
    const snapshot = createInitialSnapshot();
    const providerDriver = createFakeProviderDriver(Promise.resolve({ providerSession: { kind: 'codex', threadId: 'unused' } }));
    expect(() => sendAgentPrompt(snapshot, providerDriver, 'agent-dina', '/delegate task', { delegation: { startingContext: 'replay' } } as never, vi.fn())).toThrow('Invalid worktree delegation overrides');
    expect(providerDriver.sendPrompt).not.toHaveBeenCalled();
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'idle' });
    expect(snapshot.agents[0].userDelegationOverrides).toBeUndefined();
  });
  it('delivers delegation-only options to the provider without requiring attachments or model options', async () => {
    const snapshot = createInitialSnapshot();
    const receipt = { providerSession: { kind: 'codex' as const, threadId: 'delegating-thread' }, turnId: 'delegating-turn' };
    const providerDriver = createFakeProviderDriver(Promise.resolve(receipt));
    const options = { delegation: { startingContext: 'handoff' as const, instructions: 'Say Hello only' } };
    sendAgentPrompt(snapshot, providerDriver, 'agent-dina', '/delegate Translate the README', options, vi.fn());
    expect(providerDriver.sendPrompt).toHaveBeenCalledExactlyOnceWith(snapshot.agents[0], '/delegate Translate the README', options);
    expect(snapshot.agents[0].userDelegationOverrides).toStrictEqual(options.delegation);
    expect(snapshot.agents[0].userDelegationOverrides).not.toBe(options.delegation);
    await flushMicrotasks();
    expect(snapshot.agents[0].providerSession).toStrictEqual(receipt.providerSession);
    snapshot.agents[0].status = { type: 'idle' };
    sendAgentPrompt(snapshot, providerDriver, 'agent-dina', 'Continue with another task', undefined, vi.fn());
    expect(snapshot.agents[0].userDelegationOverrides).toBeUndefined();
  });
  it('does not let an older rejected prompt clear replacement delegation directions', async () => {
    const snapshot = createInitialSnapshot();
    const first = deferred<ProviderSendResult>();
    const second = deferred<ProviderSendResult>();
    const driver = createFakeProviderDriver(first.promise);
    vi.mocked(driver.sendPrompt).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    sendAgentPrompt(snapshot, driver, 'agent-dina', 'First', { delegation: { startingContext: 'handoff', instructions: 'First directions' } }, vi.fn());
    snapshot.agents[0]!.status = { type: 'idle' };
    sendAgentPrompt(snapshot, driver, 'agent-dina', 'Second', { delegation: { startingContext: 'handoff', instructions: 'Second directions' } }, vi.fn());
    first.reject(new Error('Late admission failure'));
    await flushMicrotasks();
    expect(snapshot.agents[0]!.userDelegationOverrides?.instructions).toBe('Second directions');
    second.reject(new Error('Current admission failure'));
    await flushMicrotasks();
    expect(snapshot.agents[0]!.userDelegationOverrides).toBeUndefined();
  });
  it('queues a Claude prompt immediately and records the returned session later', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].provider = 'claude';
    snapshot.agents[0].providerDefaults = { kind: 'claude' };
    const completion = deferred<ProviderSendResult>();
    const providerDriver = createFakeProviderDriver(completion.promise, 'claude');
    const events: MainToRendererEvent[] = [];

    expect(snapshot.agents[0].hasSubmittedPrompt).toBeUndefined();
    const result = sendAgentPrompt(snapshot, providerDriver, 'agent-dina', ' hello ', undefined, (event) => {
      const fullEvent = {
        ...event,
        seq: events.length + 1,
        occurredAt: '2026-06-05T00:00:01.000Z',
      };
      events.push(fullEvent);
      applyMainEventToSnapshot(snapshot, fullEvent);
    });
    expect(snapshot.agents[0].hasSubmittedPrompt).toBe(true);

    expect(result).toBe(snapshot);
    expect(providerDriver.sendPrompt).toHaveBeenCalledWith(expect.objectContaining({
      id: 'agent-dina',
      folder: '~/src/agent-workspace',
    }), 'hello');
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });
    expect(events.map((event) => event.type)).toStrictEqual([
      'agent.statusChanged',
      'provider.statusChanged',
    ]);
    expect(events.map((event) => event.payload)).toMatchObject([
      { type: 'working' },
      {
        provider: 'claude',
        status: 'starting',
        detail: 'Starting Claude Code backend...',
        capabilities: { approvalPresets: [] },
      },
    ]);

    completion.resolve({
      providerSession: { kind: 'claude', sessionId: 'session-1', transport: 'stdio' },
    });
    await flushMicrotasks();

    expect(snapshot.agents[0].providerSession).toStrictEqual({ kind: 'claude', sessionId: 'session-1', transport: 'stdio' });
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });
    expect(events.map((event) => event.payload)).toMatchObject([
      { type: 'working' },
      {
        provider: 'claude',
        status: 'starting',
        detail: 'Starting Claude Code backend...',
        capabilities: { approvalPresets: [] },
      },
      {
        provider: 'claude',
        status: 'running',
        detail: { key: 'backend.connected', params: { provider: 'Claude Code' } },
        capabilities: { approvalPresets: [] },
      },
    ]);
  });

  it('leaves Codex optimistic message identity to the backend driver', () => {
    const snapshot = createInitialSnapshot();
    const providerDriver = createFakeProviderDriver(Promise.resolve({
      providerSession: { kind: 'codex', threadId: 'thread-1' },
      turnId: 'turn-1',
    }));
    const events: MainToRendererEvent[] = [];

    sendAgentPrompt(snapshot, providerDriver, 'agent-dina', 'hello', undefined, (event) => {
      events.push({
        ...event,
        seq: events.length + 1,
        occurredAt: event.occurredAt ?? '2026-06-05T00:00:01.000Z',
      });
    });

    expect(snapshot.agents[0].status.type).toBe('working');
  });

  it('records visible backend errors without throwing through IPC', async () => {
    const snapshot = createInitialSnapshot();
    const completion = deferred<ProviderSendResult>();
    const providerDriver = createFakeProviderDriver(completion.promise);
    const events: MainToRendererEvent[] = [];

    sendAgentPrompt(snapshot, providerDriver, 'agent-dina', 'hello', undefined, (event) => {
      const fullEvent = {
        ...event,
        seq: events.length + 1,
        occurredAt: '2026-06-05T00:00:01.000Z',
      };
      events.push(fullEvent);
      applyMainEventToSnapshot(snapshot, fullEvent);
    });

    completion.reject(new Error('not authenticated'));
    await flushMicrotasks();

    expect(snapshot.providerRuntimes).toContainEqual({ provider: 'codex', status: 'error', detail: 'not authenticated' });
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'error', message: 'not authenticated' });
  });

  it('ignores blank prompts, missing agents, and busy agents', () => {
    const snapshot = createInitialSnapshot();
    const providerDriver = createFakeProviderDriver(Promise.resolve({ providerSession: { kind: 'codex', threadId: 'thread-1' }, turnId: 'turn-1' }));

    sendAgentPrompt(snapshot, providerDriver, 'agent-dina', '   ', undefined, vi.fn());
    sendAgentPrompt(snapshot, providerDriver, 'missing-agent', 'hello', undefined, vi.fn());
    snapshot.agents[0].status = { type: 'working' };
    sendAgentPrompt(snapshot, providerDriver, 'agent-dina', 'hello', undefined, vi.fn());

    expect(providerDriver.sendPrompt).not.toHaveBeenCalled();
  });

  it('routes backend prompt commands without appending visible user prompts', async () => {
    const snapshot = createInitialSnapshot();
    const completion = deferred<ProviderSendResult>();
    const providerDriver = createFakeProviderDriver(Promise.resolve({ providerSession: { kind: 'codex', threadId: 'thread-ignored' } }));
    providerDriver.tryHandlePromptCommand = vi.fn().mockReturnValue(completion.promise);
    const events: MainToRendererEvent[] = [];

    sendAgentPrompt(snapshot, providerDriver, 'agent-dina', '/compact', undefined, (event) => {
      const fullEvent = {
        ...event,
        seq: events.length + 1,
        occurredAt: '2026-06-05T00:00:01.000Z',
      };
      events.push(fullEvent);
      applyMainEventToSnapshot(snapshot, fullEvent);
    });

    expect(providerDriver.tryHandlePromptCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), '/compact');
    expect(providerDriver.sendPrompt).not.toHaveBeenCalled();
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });

    completion.resolve({
      providerSession: { kind: 'codex', threadId: 'thread-compact' },
    });
    await flushMicrotasks();

    expect(snapshot.agents[0].providerSession).toStrictEqual({ kind: 'codex', threadId: 'thread-compact' });
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });
  });

  it('routes backend review instructions without appending visible user prompts', async () => {
    const snapshot = createInitialSnapshot();
    const completion = deferred<ProviderSendResult>();
    const providerDriver = createFakeProviderDriver(Promise.resolve({ providerSession: { kind: 'codex', threadId: 'thread-ignored' } }));
    providerDriver.tryHandlePromptCommand = vi.fn().mockReturnValue(completion.promise);

    sendAgentPrompt(snapshot, providerDriver, 'agent-dina', '/review check regressions', undefined, vi.fn());

    expect(providerDriver.tryHandlePromptCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), '/review check regressions');
    expect(providerDriver.sendPrompt).not.toHaveBeenCalled();
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });

    completion.resolve({
      providerSession: { kind: 'codex', threadId: 'thread-review' },
    });
    await flushMicrotasks();

    expect(snapshot.agents[0].providerSession).toStrictEqual({ kind: 'codex', threadId: 'thread-review' });
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });
  });

  it('lets the backend driver prepare selected model and reasoning options', () => {
    const snapshot = createInitialSnapshot();
    const providerDriver = createFakeProviderDriver(Promise.resolve({ providerSession: { kind: 'codex', threadId: 'thread-1' }, turnId: 'turn-1' }));
    providerDriver.preparePromptOptions = vi.fn((_agent, options) => ({
      selection: options?.selection,
      providerOptions: { kind: 'codex' as const },
    }));

    sendAgentPrompt(
      snapshot,
      providerDriver,
      'agent-dina',
      'hello',
      { selection: { model: 'gpt-5.1-codex', reasoningEffort: 'high' } },
      vi.fn(),
    );

    expect(providerDriver.preparePromptOptions).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), {
      selection: { model: 'gpt-5.1-codex', reasoningEffort: 'high' },
    });
    expect(providerDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      'hello',
      { selection: { model: 'gpt-5.1-codex', reasoningEffort: 'high' }, providerOptions: { kind: 'codex' } },
    );
  });

  it('persists an explicitly selected service tier before prompt submission returns', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].providerDefaults = { kind: 'codex', serviceTier: 'default' };
    const providerDriver = createFakeProviderDriver(Promise.resolve({
      providerSession: { kind: 'codex', threadId: 'thread-1' },
      turnId: 'turn-1',
    }));

    sendAgentPrompt(
      snapshot,
      providerDriver,
      'agent-dina',
      'run fast',
      { selection: { model: 'gpt-5.6-sol', serviceTier: 'fast' } },
      vi.fn(),
    );

    expect(snapshot.agents[0].providerDefaults).toStrictEqual({
      kind: 'codex',
      serviceTier: 'fast',
    });
  });

  it('passes explicit disabled plan mode to the session manager', () => {
    const snapshot = createInitialSnapshot();
    const providerDriver = createFakeProviderDriver(Promise.resolve({ providerSession: { kind: 'codex', threadId: 'thread-1' }, turnId: 'turn-1' }));

    sendAgentPrompt(
      snapshot,
      providerDriver,
      'agent-dina',
      'hello',
      { planMode: false },
      vi.fn(),
    );

    expect(providerDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      'hello',
      { planMode: false },
    );
  });

  it('preserves dictated input provenance without other prompt options', () => {
    const snapshot = createInitialSnapshot();
    const providerDriver = createFakeProviderDriver(Promise.resolve({
      providerSession: { kind: 'codex', threadId: 'thread-1' },
      turnId: 'turn-1',
    }));

    sendAgentPrompt(
      snapshot,
      providerDriver,
      'agent-dina',
      'hello',
      { inputMethod: 'dictated' },
      vi.fn(),
    );

    expect(providerDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      'hello',
      { inputMethod: 'dictated' },
    );
  });

  it('tells a provider not to duplicate a previously submitted queued prompt', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].provider = 'claude';
    const providerDriver = createFakeProviderDriver(Promise.resolve({
      providerSession: { kind: 'claude', sessionId: 'session-1', transport: 'stdio' },
    }), 'claude');

    sendAgentPrompt(
      snapshot,
      providerDriver,
      'agent-dina',
      'retry me',
      undefined,
      vi.fn(),
      { appendUserMessage: false },
    );

    expect(providerDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      'retry me',
      { recordUserMessage: false },
    );
  });

  it('preserves provider-neutral attachment descriptors for the backend driver', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].provider = 'claude';
    snapshot.agents[0].providerDefaults = { kind: 'claude' };
    const providerDriver = createFakeProviderDriver(Promise.resolve({
      providerSession: { kind: 'claude', sessionId: 'session-1', transport: 'stdio' },
    }), 'claude');
    const attachments = [
      {
        type: 'image' as const,
        path: '/tmp/screenshot.png',
        detail: 'high' as const,
        name: 'screenshot.png',
        mimeType: 'image/png',
        previewUrl: 'data:image/png;base64,cG5n',
      },
      { type: 'file' as const, path: '/tmp/report.txt', name: 'report.txt', mimeType: 'text/plain' },
    ];

    sendAgentPrompt(
      snapshot,
      providerDriver,
      'agent-dina',
      'review these files',
      { attachments },
      vi.fn(),
    );

    expect(providerDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      'review these files',
      { attachments },
    );
  });

  it('submits attachment-only prompts', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].provider = 'claude';
    snapshot.agents[0].providerDefaults = { kind: 'claude' };
    const providerDriver = createFakeProviderDriver(Promise.resolve({
      providerSession: { kind: 'claude', sessionId: 'session-1', transport: 'stdio' },
    }), 'claude');
    const attachments = [{ type: 'file' as const, path: '/tmp/report.txt', name: 'report.txt' }];

    sendAgentPrompt(snapshot, providerDriver, 'agent-dina', '   ', { attachments }, vi.fn());

    expect(providerDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      '',
      { attachments },
    );
  });

  it('lets the backend driver prepare selected prompt skills', () => {
    const snapshot = createInitialSnapshot();
    const providerDriver = createFakeProviderDriver(Promise.resolve({ providerSession: { kind: 'codex', threadId: 'thread-1' }, turnId: 'turn-1' }));
    providerDriver.preparePromptOptions = vi.fn((_agent, options) => ({
      providerOptions: {
        kind: 'codex' as const,
        skills: options?.skills ?? [],
      },
    }));
    const skills = [
      {
        name: 'frontend-design',
        path: '/Users/nbonamy/.codex/skills/frontend-design/SKILL.md',
      },
    ];

    sendAgentPrompt(
      snapshot,
      providerDriver,
      'agent-dina',
      '/frontend-design polish the composer',
      { skills },
      vi.fn(),
    );

    expect(providerDriver.preparePromptOptions).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), { skills });
    expect(providerDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      '/frontend-design polish the composer',
      {
        providerOptions: {
          kind: 'codex',
          skills: [
            {
              name: 'frontend-design',
              path: '/Users/nbonamy/.codex/skills/frontend-design/SKILL.md',
            },
          ],
        },
      },
    );
  });
});

function createFakeProviderDriver(
  sendResult: Promise<ProviderSendResult>,
  provider: 'codex' | 'claude' = 'codex',
): AgentProviderDriver {
  return {
    provider: provider,
    getRuntimeStatus: () => ({ provider: provider, status: 'notConfigured' }),
    getCapabilities: () => provider === 'codex' ? codexProviderCapabilities : claudeProviderCapabilities,
    sendPrompt: vi.fn().mockReturnValue(sendResult),
    interrupt: vi.fn().mockResolvedValue(provider === 'codex'
      ? { providerSession: { kind: 'codex', threadId: 'thread-1' } }
      : { providerSession: { kind: 'claude', sessionId: 'session-1', transport: 'stdio' } }),
    respondToAgentRequest: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn(() => () => undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
