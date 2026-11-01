import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { AppController } from '../app-controller';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot, ClientState, MainToRendererEvent, RendererSnapshotState } from '@workspace/core/contracts';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { ipcChannels } from '@workspace/core/ipc';
import { callPrivate, emitBackendEvent, setMainWindowSend, currentSnapshot, createBackendClient, getSnapshot } from './app-controller-test-harness';

describe('AppController', () => {

  it('returns the latest event-applied snapshot after refreshing client state', async () => {
    const staleSnapshot = createInitialSnapshot();
    const replacementSnapshot = createInitialSnapshot();
    replacementSnapshot.agents[0]!.status = { type: 'working' };
    let resolveClientState!: (state: ClientState) => void;
    const clientState = new Promise<ClientState>((resolve) => {
      resolveClientState = resolve;
    });
    const request = vi.fn((method: string) => {
      if (method === backendMethods.clientStateGet) return clientState;
      return Promise.resolve({});
    });
    const backendClient = createBackendClient({
      request: vi.fn(),
      clientState: undefined,
    });
    backendClient.request = <Result,>(method: string) => request(method) as Promise<Result>;
    const controller = new AppController(createInitialSnapshot(), backendClient);

    const adoption = adoptBackendSnapshot(controller, staleSnapshot);
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith(backendMethods.clientStateGet));
    emitBackendEvent(controller, {
      type: 'snapshot.updated',
      payload: replacementSnapshot,
      occurredAt: '2026-08-02T14:00:00.000Z',
    });
    resolveClientState({ sourceFolderPath: '', shouldPreventDisplaySleep: true });

    await expect(adoption).resolves.toBe(staleSnapshot);
    expect(currentSnapshot(controller)).not.toBe(staleSnapshot);
    expect(currentSnapshot(controller).agents[0]?.status).toStrictEqual({ type: 'working' });
  });

  it('hydrates its metadata cache from daemon snapshot state', async () => {
    const initialSnapshot = createInitialSnapshot();
    const backendSnapshot = {
      ...createInitialSnapshot(),
      activeAgentId: 'agent-dina',
      activeTeamId: 'team-app',
      sourceFolder: {
        path: '/Users/nbonamy/src',
        initialized: true,
        recentRepoNames: ['agent-workspace'],
      },
    };
    const clientState: ClientState = {
      sourceFolderPath: '/Users/nbonamy/src',
      shouldPreventDisplaySleep: false,
    };
    const request = vi.fn();
    const backendClient: NonNullable<ConstructorParameters<typeof AppController>[1]> = {
      start: vi.fn().mockResolvedValue(undefined),
      health: vi.fn().mockResolvedValue({ ok: true, name: 'daemon', version: '0.1.0', pid: 123 }),
      request: <Result,>(method: string): Promise<Result> => {
        request(method);
        return Promise.resolve((method === 'snapshot/get' ? { snapshot: backendSnapshot, lastEventSeq: 17, clientState } : {}) as Result);
      },
      onEvent: vi.fn(() => () => undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new AppController(initialSnapshot, backendClient);

    await controller.initialize();

    expect(request).toHaveBeenCalledWith('snapshot/get');
    expect(currentSnapshot(controller)).toBe(backendSnapshot);
    expect(currentSnapshot(controller).activeAgentId).toBe('agent-dina');
    expect(currentSnapshot(controller).sourceFolder).toStrictEqual(backendSnapshot.sourceFolder);
    expect(currentClientState(controller)).toStrictEqual(clientState);
  });

  it('forwards synchronization snapshots to the renderer', async () => {
    const backendSnapshot = createInitialSnapshot();
    backendSnapshot.agents[0]!.status = { type: 'working' };
    const clientState: ClientState = { sourceFolderPath: '', shouldPreventDisplaySleep: false };
    const backendClient = createBackendClient({
      request: vi.fn(),
    });
    backendClient.request = vi.fn(async (method: string) => {
      if (method === backendMethods.snapshotGet) {
        return { snapshot: backendSnapshot, lastEventSeq: 0, clientState };
      }
      if (method === backendMethods.clientStateGet) return clientState;
      return {};
    }) as typeof backendClient.request;
    const controller = new AppController(createInitialSnapshot(), backendClient);

    await controller.initialize();

    const rendererState = await callPrivate<RendererSnapshotState>(controller, 'getSnapshotState');

    expect(rendererState.snapshot.agents[0]?.status).toStrictEqual({ type: 'working' });
    expect(rendererState.lastBackendEventSeq).toBe(0);
    expect(rendererState.connection).toStrictEqual({ status: 'connected' });
  });

  it('replaces the cached full snapshot during an explicit renderer resynchronization', async () => {
    const initialSnapshot = createInitialSnapshot();
    const refreshedSnapshot = createInitialSnapshot();
    refreshedSnapshot.agents[0]!.status = { type: 'awaitingInput' };
    const clientState: ClientState = { sourceFolderPath: '', shouldPreventDisplaySleep: false };
    let snapshotReads = 0;
    const backendClient = createBackendClient();
    backendClient.request = vi.fn(async (method: string) => {
      if (method === backendMethods.snapshotGet) {
        snapshotReads += 1;
        return {
          snapshot: snapshotReads === 1 ? initialSnapshot : refreshedSnapshot,
          lastEventSeq: snapshotReads,
          clientState,
        };
      }
      if (method === backendMethods.clientStateGet) return clientState;
      return {};
    }) as typeof backendClient.request;
    const controller = new AppController(initialSnapshot, backendClient);

    await controller.initialize();

    await expect(getSnapshot(controller)).resolves.toBe(refreshedSnapshot);
    expect(snapshotReads).toBe(2);
    expect(currentSnapshot(controller)).toBe(refreshedSnapshot);
    expect(currentSnapshot(controller).agents[0]?.status).toStrictEqual({ type: 'awaitingInput' });
  });

  it.each(['success', 'error'] as const)('forwards creation %s even when a synchronization snapshot already covers its sequence', async state => {
    const snapshot = createInitialSnapshot();
    const clientState: ClientState = { sourceFolderPath: '', shouldPreventDisplaySleep: false };
    let resolveSnapshot!: (value: { snapshot: AppSnapshot; lastEventSeq: number; clientState: ClientState }) => void;
    const pending = new Promise<{ snapshot: AppSnapshot; lastEventSeq: number; clientState: ClientState }>(resolve => { resolveSnapshot = resolve; });
    let reads = 0;
    const backend = createBackendClient();
    backend.request = vi.fn(async (method: string) => method === backendMethods.snapshotGet
      ? ++reads === 1 ? { snapshot, lastEventSeq: 0, clientState } : pending
      : clientState) as typeof backend.request;
    const controller = new AppController(snapshot, backend);
    const send = vi.fn();
    setMainWindowSend(controller, send);
    await controller.initialize();
    const progress = { id: 'creation', state: 'running' as const, backend: 'codex' as const, repositoryName: 'korus', createWorktree: false, hasPrompt: true };
    emitBackendEvent(controller, { seq: 1, agentId: 'agent-dina', type: 'agentCreation.progress', payload: progress });
    const refresh = getSnapshot(controller);
    await vi.waitFor(() => expect(reads).toBe(2));
    emitBackendEvent(controller, { seq: 3, agentId: 'agent-dina', type: 'agentCreation.progress', payload: { ...progress, state } });
    resolveSnapshot({ snapshot, lastEventSeq: 3, clientState });
    await refresh;
    expect(send).toHaveBeenCalledWith(ipcChannels.event, expect.objectContaining({ type: 'agentCreation.progress', payload: { ...progress, state } }));
  });

  it('replays buffered provider frames before publishing the reconnected snapshot', async () => {
    vi.useFakeTimers();
    const initialSnapshot = createInitialSnapshot();
    const reconnectedSnapshot = createInitialSnapshot();
    reconnectedSnapshot.agents[0]!.status = { type: 'working' };
    const clientState: ClientState = { sourceFolderPath: '', shouldPreventDisplaySleep: false };
    let connectionListener: (state: 'connected' | 'disconnected', error?: Error) => void = () => undefined;
    let backendEventListener: (event: AppBackendEvent) => void = () => undefined;
    let resolveReconnectSnapshot!: (value: {
      snapshot: AppSnapshot;
      lastEventSeq: number;
      clientState: ClientState;
    }) => void;
    const reconnectSnapshot = new Promise<{
      snapshot: AppSnapshot;
      lastEventSeq: number;
      clientState: ClientState;
    }>((resolve) => {
      resolveReconnectSnapshot = resolve;
    });
    let snapshotReads = 0;
    const backendClient: NonNullable<ConstructorParameters<typeof AppController>[1]> = {
      start: vi.fn().mockResolvedValue(undefined),
      health: vi.fn().mockResolvedValue({ ok: true, name: 'daemon', version: '0.1.0', pid: 123 }),
      request: vi.fn(async (method: string) => {
        if (method === 'snapshot/get') {
          snapshotReads += 1;
          return snapshotReads === 1 ? {
            snapshot: initialSnapshot,
            lastEventSeq: 0,
            clientState,
          } : reconnectSnapshot;
        }
        return {};
      }) as NonNullable<ConstructorParameters<typeof AppController>[1]>['request'],
      onEvent: vi.fn((listener) => {
        backendEventListener = listener;
        return () => undefined;
      }),
      onConnectionState: vi.fn((listener) => {
        connectionListener = listener;
        return () => undefined;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new AppController(initialSnapshot, backendClient);
    const send = vi.fn();
    setMainWindowSend(controller, send);
    await controller.initialize();
    send.mockClear();

    connectionListener('disconnected', new Error('socket closed'));
    expect(send).toHaveBeenCalledWith(ipcChannels.event, expect.objectContaining({
      type: 'client.connectionChanged',
      payload: expect.objectContaining({ status: 'reconnecting', detail: 'socket closed' }),
    }));

    await vi.advanceTimersByTimeAsync(250);
    expect(snapshotReads).toBe(2);
    backendEventListener({
      seq: 2,
      occurredAt: '2026-09-06T20:00:00.000Z',
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-dina',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 2,
        event: {
          seq: 2,
          occurredAt: '2026-09-06T20:00:00.000Z',
          origin: 'notification',
          conversationId: 'thread-dina',
          type: 'message.delta',
          payload: { messageId: 'message-1', itemId: 'item-1', delta: 'Hello' },
        } as unknown as Extract<AppBackendEvent, { type: 'codex.conversationEventReceived' }>['payload']['event'],
      },
    });
    resolveReconnectSnapshot({
      snapshot: reconnectedSnapshot,
      lastEventSeq: 1,
      clientState,
    });
    await flushMicrotasks();

    expect(backendClient.start).toHaveBeenCalledTimes(2);
    expect(currentSnapshot(controller)).toBe(reconnectedSnapshot);
    expect(currentSnapshot(controller).agents[0]?.status).toStrictEqual({ type: 'working' });
    expect(send).toHaveBeenCalledWith(ipcChannels.event, expect.objectContaining({
      type: 'client.connectionChanged',
      payload: { status: 'connected' },
    }));
    expect(send.mock.calls
      .filter(([channel]) => channel === ipcChannels.event)
      .map(([, event]) => event.type))
      .toStrictEqual([
        'client.connectionChanged',
        'codex.conversationEventReceived',
        'client.connectionChanged',
        'snapshot.updated',
      ]);
    await controller.shutdown();
  });

  it('caches authoritative snapshot metadata from backend events emitted by the daemon process client', async () => {
    const snapshot = createInitialSnapshot();
    const backendSnapshot = createInitialSnapshot();
    backendSnapshot.agents[0]!.status = { type: 'working' };
    const unsubscribe = vi.fn();
    let emitBackendEvent: (event: AppBackendEvent) => void = () => undefined;
    const backendClient = createBackendClientWithEventEmitter((listener) => {
      emitBackendEvent = listener;
      return unsubscribe;
    });
    const controller = new AppController(snapshot, backendClient);
    const send = vi.fn();

    setMainWindowSend(controller, send);
    await controller.initialize();
    emitBackendEvent({
      seq: 1,
      backend: 'codex',
      agentId: 'agent-dina',
      type: 'agent.statusChanged',
      payload: { type: 'working' },
      occurredAt: '2026-06-13T00:00:00.000Z',
      clientState: {
        sourceFolderPath: '/Users/nbonamy/src',
        shouldPreventDisplaySleep: true,
      },
      snapshot: backendSnapshot,
    });
    await controller.shutdown();

    expect(currentSnapshot(controller)).toBe(backendSnapshot);
    expect(currentSnapshot(controller).agents[0]?.status).toStrictEqual({ type: 'working' });
    expect(send).toHaveBeenCalledWith(ipcChannels.event, expect.objectContaining({
      seq: 1,
      backend: 'codex',
      agentId: 'agent-dina',
      type: 'agent.statusChanged',
      payload: { type: 'working' },
    }));
    expect(send).toHaveBeenCalledWith(ipcChannels.event, expect.objectContaining({
      snapshot: backendSnapshot,
    }));
    expect(currentClientState(controller)).toStrictEqual({
      sourceFolderPath: '/Users/nbonamy/src',
      shouldPreventDisplaySleep: true,
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('applies incremental backend events to the Electron metadata cache', async () => {
    const snapshot = createInitialSnapshot();
    const payloadSnapshot = createInitialSnapshot();
    payloadSnapshot.agents[0]!.status = { type: 'working' };
    const controller = new AppController(snapshot, createBackendClient());
    const send = vi.fn();

    setMainWindowSend(controller, send);
    await controller.initialize();
    (controller as unknown as {
      emitBackendEvent(event: AppBackendEvent): void;
    }).emitBackendEvent({
      seq: 1,
      type: 'snapshot.updated',
      payload: payloadSnapshot,
      occurredAt: '2026-06-13T00:00:00.000Z',
    });

    expect(currentSnapshot(controller)).toBe(payloadSnapshot);
    expect(currentSnapshot(controller).agents[0]?.status).toStrictEqual({ type: 'working' });
    expect(send).toHaveBeenCalledWith(ipcChannels.event, expect.objectContaining({
      seq: 1,
      type: 'snapshot.updated',
      payload: payloadSnapshot,
    }));
  });

  it('replaces generated-image file URLs before sending messages to the renderer', async () => {
    const snapshot = createInitialSnapshot();
    const controller = new AppController(snapshot, createBackendClient());
    const send = vi.fn();
    const generatedImageUrl = `file:///Users/nbonamy/${product.homeDirectory}/codex-home/generated_images/thread/image.png`;

    setMainWindowSend(controller, send);
    await controller.initialize();
    (controller as unknown as {
      emitBackendEvent(event: AppBackendEvent): void;
    }).emitBackendEvent({
      seq: 1,
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-dina',
      type: 'codex.conversationEventReceived',
      payload: {
        revision: 1,
        event: {
          seq: 1,
          occurredAt: '2026-08-30T18:33:55.000Z',
          origin: 'notification',
          conversationId: 'thread-dina',
          turnId: 'turn-image',
          type: 'message.updated',
          payload: {
            message: {
              id: 'assistant-turn-image',
              agentId: 'agent-dina',
              role: 'assistant',
              status: 'complete',
              turnId: 'turn-image',
              createdAt: '2026-08-30T18:33:55.000Z',
              parts: [{
                type: 'media',
                itemId: 'image-live',
                media: {
                  url: generatedImageUrl,
                  alt: 'Generated image',
                  mimeType: 'image/png',
                  title: 'Generated image',
                },
              }],
            },
          },
        } as unknown as Extract<AppBackendEvent, { type: 'codex.conversationEventReceived' }>['payload']['event'],
      },
      occurredAt: '2026-08-30T18:33:55.000Z',
    });

    const rendererEvent = send.mock.calls.find(([channel, event]) => (
      channel === ipcChannels.event && event.type === 'codex.conversationEventReceived'
    ))?.[1] as MainToRendererEvent | undefined;
    const message = rendererEvent?.type === 'codex.conversationEventReceived'
      && rendererEvent.payload.event.type === 'message.updated'
      ? rendererEvent.payload.event.payload.message
      : undefined;
    const media = message?.parts.find((part) => part.type === 'media');

    expect(media?.type === 'media' ? media.media.url : null).toMatch(/^agent-workspace-media:\/\/generated\//);
    expect(media?.type === 'media' ? media.media.url : null).not.toBe(generatedImageUrl);
    expect(currentSnapshot(controller)).toBe(snapshot);
  });

  it('ignores backend event snapshots with malformed nested state', async () => {
    const snapshot = createInitialSnapshot();
    const controller = new AppController(snapshot, createBackendClient());
    const send = vi.fn();
    const malformedSnapshot = structuredClone(snapshot);
    malformedSnapshot.agents[0]!.status = { type: 'working' };
    (malformedSnapshot.general.appshots as unknown as Record<string, unknown>).hotkey = 42;

    setMainWindowSend(controller, send);
    await controller.initialize();
    (controller as unknown as {
      emitBackendEvent(event: AppBackendEvent): void;
    }).emitBackendEvent({
      seq: 1,
      type: 'snapshot.updated',
      payload: snapshot,
      occurredAt: '2026-06-13T00:00:00.000Z',
      snapshot: malformedSnapshot as unknown as AppSnapshot,
    });
    const malformedPayload = structuredClone(snapshot);
    malformedPayload.agents[0]!.name = 'Malformed payload';
    (malformedPayload.sourceFolder as unknown as Record<string, unknown>).initialized = 'yes';
    (controller as unknown as {
      emitBackendEvent(event: AppBackendEvent): void;
    }).emitBackendEvent({
      seq: 2,
      type: 'snapshot.updated',
      payload: malformedPayload,
      occurredAt: '2026-06-13T00:00:01.000Z',
    } as unknown as AppBackendEvent);

    expect(currentSnapshot(controller)).toBe(snapshot);
    expect(currentSnapshot(controller).agents[0]?.status).toStrictEqual({ type: 'idle' });
    expect(currentSnapshot(controller).agents[0]?.name).toBe('Dina');
    expect(send).toHaveBeenCalledWith(ipcChannels.event, expect.objectContaining({
      seq: 1,
      type: 'snapshot.updated',
    }));
  });

  it('caches token usage updates emitted by daemon', async () => {
    const snapshot = createInitialSnapshot();
    const controller = new AppController(snapshot, createBackendClient());
    const contextUsage = {
      totalTokens: 1200,
      inputTokens: 900,
      cachedInputTokens: 100,
      outputTokens: 300,
      reasoningOutputTokens: 80,
      lastTotalTokens: 300,
      modelContextWindow: 10000,
      usedPercent: 12,
    };

    await controller.initialize();
    emitBackendEvent(controller, {
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-dina',
      turnId: 'turn-1',
      type: 'conversation.contextUsageUpdated',
      payload: { contextUsage },
    });
    await flushMicrotasks();

    expect(snapshot.agents[0].contextUsage).toStrictEqual(contextUsage);
  });

  it('caches account rate-limit updates emitted by daemon', async () => {
    const snapshot = createInitialSnapshot();
    const controller = new AppController(snapshot, createBackendClient());
    const rateLimits = {
      limitId: 'codex',
      limitName: null,
      primary: {
        usedPercent: 62,
        windowDurationMins: 300,
        resetsAt: 1_780_756_682,
      },
      secondary: {
        usedPercent: 50,
        windowDurationMins: 10_080,
        resetsAt: 1_781_140_878,
      },
      credits: null,
      individualLimit: null,
      planType: 'pro',
      rateLimitReachedType: null,
    };

    await controller.initialize();
    emitBackendEvent(controller, {
      type: 'account.rateLimitsUpdated',
      backend: 'codex',
      payload: { rateLimits },
    });
    await flushMicrotasks();

    expect(currentSnapshot(controller).accountRateLimits).toStrictEqual(rateLimits);
  });


  it('caches turn diff updates emitted by daemon without deriving side-panel previews', async () => {
    const snapshot = createInitialSnapshot();
    const controller = new AppController(snapshot, createBackendClient());
    await controller.initialize();
    const send = vi.fn();
    setMainWindowSend(controller, send);
    const diff = [
      'diff --git a/src/main.ts b/src/main.ts',
      '--- a/src/main.ts',
      '+++ b/src/main.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');

    emitBackendEvent(controller, {
      agentId: 'agent-dina',
      backend: 'codex',
      threadId: 'thread-dina',
      turnId: 'turn-1',
      type: 'conversation.turnDiffUpdated',
      payload: {
        addedLines: 1,
        removedLines: 1,
        diff,
      },
    });

    expect(send).toHaveBeenCalledWith('app:event', expect.objectContaining({
      type: 'conversation.turnDiffUpdated',
      payload: expect.objectContaining({ diff }),
    }));
    expect(send).not.toHaveBeenCalledWith('app:event', expect.objectContaining({
      type: 'sidePanel.gitDiffRequested',
    }));
  });

  it('forwards semantic plan events without interpreting their presentation', async () => {
    const snapshot = createInitialSnapshot();
    const controller = new AppController(snapshot, createBackendClient());
    await controller.initialize();
    const send = vi.fn();
    setMainWindowSend(controller, send);

    emitBackendEvent(controller, {
      agentId: 'agent-dina',
      threadId: 'thread-dina',
      turnId: 'turn-1',
      type: 'plan.readyForReview',
      payload: {
        markdown: '# Plan\n\nBuild it',
      },
    });

    expect(send).toHaveBeenCalledWith('app:event', expect.objectContaining({
      agentId: 'agent-dina',
      threadId: 'thread-dina',
      turnId: 'turn-1',
      type: 'plan.readyForReview',
      payload: {
        markdown: '# Plan\n\nBuild it',
      },
    }));
  });
});

function adoptBackendSnapshot(controller: AppController, snapshot: AppSnapshot): Promise<AppSnapshot> {
  return (controller as unknown as {
    adoptBackendSnapshot(snapshot: AppSnapshot): Promise<AppSnapshot>;
  }).adoptBackendSnapshot(snapshot);
}

function currentClientState(controller: AppController): ClientState {
  return (controller as unknown as { clientState: ClientState }).clientState;
}

function createBackendClientWithEventEmitter(
  onEvent: (listener: (event: AppBackendEvent) => void) => () => void,
) {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    health: vi.fn().mockResolvedValue({ ok: true, name: 'daemon', version: '0.1.0', pid: 123 }),
    request: vi.fn().mockResolvedValue({}),
    onEvent: vi.fn(onEvent),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}
