import { describe, expect, it, vi } from 'vitest';
import { sendAgentPrompt } from '../agent-chat-service';
import { applyMainEventToSnapshot, createInitialSnapshot } from '../snapshot';
import type { MainToRendererEvent } from '../contracts';
import type { AgentBackendDriver, BackendSendResult } from '../backend-driver';
import { claudeBackendCapabilities, codexBackendCapabilities } from '../backend-capabilities';

describe('agent chat service', () => {
  it('rejects malformed user delegation controls without changing agent state or executing a prompt', () => {
    const snapshot = createInitialSnapshot();
    const backendDriver = createFakeBackendDriver(Promise.resolve({ backendSession: { kind: 'codex', threadId: 'unused' } }));
    expect(() => sendAgentPrompt(snapshot, backendDriver, 'agent-dina', '/delegate task', { delegation: { startingContext: 'replay' } } as never, vi.fn())).toThrow('Invalid worktree delegation overrides');
    expect(backendDriver.sendPrompt).not.toHaveBeenCalled();
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'idle' });
    expect(snapshot.agents[0].userDelegationOverrides).toBeUndefined();
  });
  it('delivers delegation-only options to the provider without requiring attachments or model options', async () => {
    const snapshot = createInitialSnapshot();
    const receipt = { backendSession: { kind: 'codex' as const, threadId: 'delegating-thread' }, turnId: 'delegating-turn' };
    const backendDriver = createFakeBackendDriver(Promise.resolve(receipt));
    const options = { delegation: { startingContext: 'handoff' as const, instructions: 'Say Hello only' } };
    sendAgentPrompt(snapshot, backendDriver, 'agent-dina', '/delegate Translate the README', options, vi.fn());
    expect(backendDriver.sendPrompt).toHaveBeenCalledExactlyOnceWith(snapshot.agents[0], '/delegate Translate the README', options);
    expect(snapshot.agents[0].userDelegationOverrides).toStrictEqual(options.delegation);
    expect(snapshot.agents[0].userDelegationOverrides).not.toBe(options.delegation);
    await flushMicrotasks();
    expect(snapshot.agents[0].backendSession).toStrictEqual(receipt.backendSession);
    snapshot.agents[0].status = { type: 'idle' };
    sendAgentPrompt(snapshot, backendDriver, 'agent-dina', 'Continue with another task', undefined, vi.fn());
    expect(snapshot.agents[0].userDelegationOverrides).toBeUndefined();
  });
  it('queues a Claude prompt immediately and records the returned session later', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].backend = 'claude';
    snapshot.agents[0].backendDefaults = { kind: 'claude' };
    const completion = deferred<BackendSendResult>();
    const backendDriver = createFakeBackendDriver(completion.promise, 'claude');
    const events: MainToRendererEvent[] = [];

    expect(snapshot.agents[0].hasSubmittedPrompt).toBeUndefined();
    const result = sendAgentPrompt(snapshot, backendDriver, 'agent-dina', ' hello ', undefined, (event) => {
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
    expect(backendDriver.sendPrompt).toHaveBeenCalledWith(expect.objectContaining({
      id: 'agent-dina',
      folder: '~/src/agent-workspace',
    }), 'hello');
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });
    expect(events.map((event) => event.type)).toStrictEqual([
      'agent.statusChanged',
      'backend.statusChanged',
    ]);
    expect(events.map((event) => event.payload)).toMatchObject([
      { type: 'working' },
      {
        backend: 'claude',
        status: 'starting',
        detail: 'Starting Claude Code backend...',
        capabilities: { approvalPresets: [] },
      },
    ]);

    completion.resolve({
      backendSession: { kind: 'claude', sessionId: 'session-1', transport: 'stdio' },
    });
    await flushMicrotasks();

    expect(snapshot.agents[0].backendSession).toStrictEqual({ kind: 'claude', sessionId: 'session-1', transport: 'stdio' });
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });
    expect(events.map((event) => event.payload)).toMatchObject([
      { type: 'working' },
      {
        backend: 'claude',
        status: 'starting',
        detail: 'Starting Claude Code backend...',
        capabilities: { approvalPresets: [] },
      },
      {
        backend: 'claude',
        status: 'running',
        detail: { key: 'backend.connected', params: { backend: 'Claude Code' } },
        capabilities: { approvalPresets: [] },
      },
    ]);
  });

  it('leaves Codex optimistic message identity to the backend driver', () => {
    const snapshot = createInitialSnapshot();
    const backendDriver = createFakeBackendDriver(Promise.resolve({
      backendSession: { kind: 'codex', threadId: 'thread-1' },
      turnId: 'turn-1',
    }));
    const events: MainToRendererEvent[] = [];

    sendAgentPrompt(snapshot, backendDriver, 'agent-dina', 'hello', undefined, (event) => {
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
    const completion = deferred<BackendSendResult>();
    const backendDriver = createFakeBackendDriver(completion.promise);
    const events: MainToRendererEvent[] = [];

    sendAgentPrompt(snapshot, backendDriver, 'agent-dina', 'hello', undefined, (event) => {
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

    expect(snapshot.backendRuntimes).toContainEqual({ backend: 'codex', status: 'error', detail: 'not authenticated' });
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'error', message: 'not authenticated' });
  });

  it('ignores blank prompts, missing agents, and busy agents', () => {
    const snapshot = createInitialSnapshot();
    const backendDriver = createFakeBackendDriver(Promise.resolve({ backendSession: { kind: 'codex', threadId: 'thread-1' }, turnId: 'turn-1' }));

    sendAgentPrompt(snapshot, backendDriver, 'agent-dina', '   ', undefined, vi.fn());
    sendAgentPrompt(snapshot, backendDriver, 'missing-agent', 'hello', undefined, vi.fn());
    snapshot.agents[0].status = { type: 'working' };
    sendAgentPrompt(snapshot, backendDriver, 'agent-dina', 'hello', undefined, vi.fn());

    expect(backendDriver.sendPrompt).not.toHaveBeenCalled();
  });

  it('routes backend prompt commands without appending visible user prompts', async () => {
    const snapshot = createInitialSnapshot();
    const completion = deferred<BackendSendResult>();
    const backendDriver = createFakeBackendDriver(Promise.resolve({ backendSession: { kind: 'codex', threadId: 'thread-ignored' } }));
    backendDriver.tryHandlePromptCommand = vi.fn().mockReturnValue(completion.promise);
    const events: MainToRendererEvent[] = [];

    sendAgentPrompt(snapshot, backendDriver, 'agent-dina', '/compact', undefined, (event) => {
      const fullEvent = {
        ...event,
        seq: events.length + 1,
        occurredAt: '2026-06-05T00:00:01.000Z',
      };
      events.push(fullEvent);
      applyMainEventToSnapshot(snapshot, fullEvent);
    });

    expect(backendDriver.tryHandlePromptCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), '/compact');
    expect(backendDriver.sendPrompt).not.toHaveBeenCalled();
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });

    completion.resolve({
      backendSession: { kind: 'codex', threadId: 'thread-compact' },
    });
    await flushMicrotasks();

    expect(snapshot.agents[0].backendSession).toStrictEqual({ kind: 'codex', threadId: 'thread-compact' });
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });
  });

  it('routes backend review instructions without appending visible user prompts', async () => {
    const snapshot = createInitialSnapshot();
    const completion = deferred<BackendSendResult>();
    const backendDriver = createFakeBackendDriver(Promise.resolve({ backendSession: { kind: 'codex', threadId: 'thread-ignored' } }));
    backendDriver.tryHandlePromptCommand = vi.fn().mockReturnValue(completion.promise);

    sendAgentPrompt(snapshot, backendDriver, 'agent-dina', '/review check regressions', undefined, vi.fn());

    expect(backendDriver.tryHandlePromptCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), '/review check regressions');
    expect(backendDriver.sendPrompt).not.toHaveBeenCalled();
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });

    completion.resolve({
      backendSession: { kind: 'codex', threadId: 'thread-review' },
    });
    await flushMicrotasks();

    expect(snapshot.agents[0].backendSession).toStrictEqual({ kind: 'codex', threadId: 'thread-review' });
    expect(snapshot.agents[0].status).toStrictEqual({ type: 'working' });
  });

  it('lets the backend driver prepare selected model and reasoning options', () => {
    const snapshot = createInitialSnapshot();
    const backendDriver = createFakeBackendDriver(Promise.resolve({ backendSession: { kind: 'codex', threadId: 'thread-1' }, turnId: 'turn-1' }));
    backendDriver.preparePromptOptions = vi.fn((_agent, options) => ({
      model: options?.model,
      backendOptions: { kind: 'codex' as const, reasoningEffort: options?.reasoningEffort },
    }));

    sendAgentPrompt(
      snapshot,
      backendDriver,
      'agent-dina',
      'hello',
      { model: 'gpt-5.1-codex', reasoningEffort: 'high' },
      vi.fn(),
    );

    expect(backendDriver.preparePromptOptions).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), {
      model: 'gpt-5.1-codex',
      reasoningEffort: 'high',
    });
    expect(backendDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      'hello',
      { model: 'gpt-5.1-codex', backendOptions: { kind: 'codex', reasoningEffort: 'high' } },
    );
  });

  it('persists an explicitly selected service tier before prompt submission returns', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].backendDefaults = { kind: 'codex', serviceTier: 'default' };
    const backendDriver = createFakeBackendDriver(Promise.resolve({
      backendSession: { kind: 'codex', threadId: 'thread-1' },
      turnId: 'turn-1',
    }));

    sendAgentPrompt(
      snapshot,
      backendDriver,
      'agent-dina',
      'run fast',
      { model: 'gpt-5.6-sol', serviceTier: 'fast' },
      vi.fn(),
    );

    expect(snapshot.agents[0].backendDefaults).toStrictEqual({
      kind: 'codex',
      serviceTier: 'fast',
    });
  });

  it('passes explicit disabled plan mode to the session manager', () => {
    const snapshot = createInitialSnapshot();
    const backendDriver = createFakeBackendDriver(Promise.resolve({ backendSession: { kind: 'codex', threadId: 'thread-1' }, turnId: 'turn-1' }));

    sendAgentPrompt(
      snapshot,
      backendDriver,
      'agent-dina',
      'hello',
      { planMode: false },
      vi.fn(),
    );

    expect(backendDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      'hello',
      { planMode: false },
    );
  });

  it('preserves dictated input provenance without other prompt options', () => {
    const snapshot = createInitialSnapshot();
    const backendDriver = createFakeBackendDriver(Promise.resolve({
      backendSession: { kind: 'codex', threadId: 'thread-1' },
      turnId: 'turn-1',
    }));

    sendAgentPrompt(
      snapshot,
      backendDriver,
      'agent-dina',
      'hello',
      { inputMethod: 'dictated' },
      vi.fn(),
    );

    expect(backendDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      'hello',
      { inputMethod: 'dictated' },
    );
  });

  it('tells a provider not to duplicate a previously submitted queued prompt', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].backend = 'claude';
    const backendDriver = createFakeBackendDriver(Promise.resolve({
      backendSession: { kind: 'claude', sessionId: 'session-1', transport: 'stdio' },
    }), 'claude');

    sendAgentPrompt(
      snapshot,
      backendDriver,
      'agent-dina',
      'retry me',
      undefined,
      vi.fn(),
      { appendUserMessage: false },
    );

    expect(backendDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      'retry me',
      { recordUserMessage: false },
    );
  });

  it('preserves provider-neutral attachment descriptors for the backend driver', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].backend = 'claude';
    snapshot.agents[0].backendDefaults = { kind: 'claude' };
    const backendDriver = createFakeBackendDriver(Promise.resolve({
      backendSession: { kind: 'claude', sessionId: 'session-1', transport: 'stdio' },
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
      backendDriver,
      'agent-dina',
      'review these files',
      { attachments },
      vi.fn(),
    );

    expect(backendDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      'review these files',
      { attachments },
    );
  });

  it('submits attachment-only prompts', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].backend = 'claude';
    snapshot.agents[0].backendDefaults = { kind: 'claude' };
    const backendDriver = createFakeBackendDriver(Promise.resolve({
      backendSession: { kind: 'claude', sessionId: 'session-1', transport: 'stdio' },
    }), 'claude');
    const attachments = [{ type: 'file' as const, path: '/tmp/report.txt', name: 'report.txt' }];

    sendAgentPrompt(snapshot, backendDriver, 'agent-dina', '   ', { attachments }, vi.fn());

    expect(backendDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      '',
      { attachments },
    );
  });

  it('lets the backend driver prepare selected prompt skills', () => {
    const snapshot = createInitialSnapshot();
    const backendDriver = createFakeBackendDriver(Promise.resolve({ backendSession: { kind: 'codex', threadId: 'thread-1' }, turnId: 'turn-1' }));
    backendDriver.preparePromptOptions = vi.fn((_agent, options) => ({
      backendOptions: {
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
      backendDriver,
      'agent-dina',
      '/frontend-design polish the composer',
      { skills },
      vi.fn(),
    );

    expect(backendDriver.preparePromptOptions).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), { skills });
    expect(backendDriver.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-dina' }),
      '/frontend-design polish the composer',
      {
        backendOptions: {
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

function createFakeBackendDriver(
  sendResult: Promise<BackendSendResult>,
  backend: 'codex' | 'claude' = 'codex',
): AgentBackendDriver {
  return {
    backend,
    getRuntimeStatus: () => ({ backend, status: 'notConfigured' }),
    getCapabilities: () => backend === 'codex' ? codexBackendCapabilities : claudeBackendCapabilities,
    sendPrompt: vi.fn().mockReturnValue(sendResult),
    interrupt: vi.fn().mockResolvedValue(backend === 'codex'
      ? { backendSession: { kind: 'codex', threadId: 'thread-1' } }
      : { backendSession: { kind: 'claude', sessionId: 'session-1', transport: 'stdio' } }),
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
