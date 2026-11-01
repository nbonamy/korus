import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { useAppState } from '../app-state';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import { claudeBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { AppSnapshot, BackendApprovalRequest, BackendConversationRef, AppApi, ConversationSummary, DevicePairingSession, MainToRendererEvent, RendererMessage, SourceRepository, WorkItem, WorkSource } from '@workspace/core/contracts';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import { workItemAssignmentPrompt } from '@workspace/core/work-item-prompts';
import { clearConfetti, useConfetti } from '../shared/confetti/use-confetti';
import { stubElectronTestWindow } from '../test/client';
import { configureAppClient } from '../platform-api';
import { clearFirstRunOnboardingStage, setFirstRunOnboardingStage } from '../onboarding-session';
import { deferred } from './app-state-test-harness';

describe('useAppState', () => {
  afterEach(() => {
    clearConfetti();
    clearFirstRunOnboardingStage();
    vi.useRealTimers();
  });

  it('shows and removes backend-owned teammate prompts in the target agent queue', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(createInitialSnapshot()),
        onEvent: vi.fn((listener) => {
          listeners.push(listener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });
    const state = useAppState();
    await state.loadSnapshot();

    listeners[0]?.({
      seq: 1,
      agentId: 'agent-dina',
      type: 'agent.promptQueued',
      payload: { id: 'inbox-1', text: 'Review the other agent change.' },
      occurredAt: '2026-08-02T00:00:00.000Z',
      snapshot: {
        ...createInitialSnapshot(),
        queuedPrompts: [{ id: 'inbox-1', agentId: 'agent-dina', text: 'Review the other agent change.', createdAt: '2026-08-02T00:00:00.000Z' }],
      },
    });
    expect(state.activeQueuedPrompts.value).toEqual([
      expect.objectContaining({ id: 'inbox-1', text: 'Review the other agent change.' }),
    ]);

    listeners[0]?.({
      seq: 2,
      agentId: 'agent-dina',
      type: 'agent.promptDequeued',
      payload: { ids: ['inbox-1'] },
      occurredAt: '2026-08-02T00:00:01.000Z',
      snapshot: createInitialSnapshot(),
    });
    expect(state.activeQueuedPrompts.value).toStrictEqual([]);
  });

  it('passes attachment descriptors to the backend queue owner', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].status = { type: 'working' };
    const backendAttachments = [
      {
        type: 'image' as const,
        path: '/tmp/screenshot.png',
        detail: 'original' as const,
        name: 'screenshot.png',
        mimeType: 'image/png',
        previewUrl: 'data:image/png;base64,cG5n',
      },
      { type: 'file' as const, path: '/tmp/report.txt', name: 'report.txt', mimeType: 'text/plain' },
    ];
    const rendererAttachments = [
      { type: 'image' as const, reference: 'electron-attachment:screenshot', detail: 'original' as const },
      { type: 'file' as const, reference: 'electron-attachment:report' },
    ];

    const queuedSnapshot = createInitialSnapshot();
    queuedSnapshot.agents[0].status = { type: 'working' };
    queuedSnapshot.queuedPrompts = [{ id: 'prompt-files', agentId: 'agent-dina', text: 'review these files', createdAt: '2026-06-05T00:00:01.000Z', options: { attachments: backendAttachments } }];
    const sendPrompt = vi.fn().mockResolvedValue(queuedSnapshot);
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn((nextListener) => {
          listeners.push(nextListener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.sendPrompt('review these files', { attachments: rendererAttachments });

    expect(state.activeQueuedPrompts.value).toStrictEqual([
      expect.objectContaining({
        text: 'review these files',
        options: { attachments: backendAttachments },
      }),
    ]);

    expect(sendPrompt).toHaveBeenCalledWith('agent-dina', 'review these files', { attachments: rendererAttachments });
  });

  it('submits attachments without requiring composer text', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const sendPrompt = vi.fn().mockResolvedValue(remoteSnapshot);
    const attachments = [{ type: 'image' as const, reference: 'electron-attachment:screenshot' }];
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.sendPrompt('   ', { attachments });

    expect(sendPrompt).toHaveBeenCalledWith('agent-dina', '', { attachments });
  });

  it('keeps the previous authoritative queue visible while a backend mutation is pending', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.queuedPrompts = [{ id: 'prompt-1', agentId: 'agent-dina', text: 'do not disappear', createdAt: '2026-06-05T00:00:01.000Z' }];
    const pendingSend = deferred<AppSnapshot>();
    const sendPrompt = vi.fn().mockReturnValue(pendingSend.promise);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn((nextListener) => {
          listeners.push(nextListener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    const mutation = state.sendPrompt('another prompt');
    expect(state.activeQueuedPrompts.value).toEqual([
      expect.objectContaining({ text: 'do not disappear' }),
    ]);

    pendingSend.resolve(remoteSnapshot);
    await mutation;
    expect(state.activeQueuedPrompts.value).toEqual([
      expect.objectContaining({ text: 'do not disappear' }),
    ]);
  });

  it('preserves the authoritative queue when a backend mutation rejects', async () => {
    const listeners: Array<(event: MainToRendererEvent) => void> = [];
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.queuedPrompts = [{ id: 'prompt-1', agentId: 'agent-dina', text: 'retry me later', createdAt: '2026-06-05T00:00:01.000Z' }];
    const sendPrompt = vi.fn().mockRejectedValue(new Error('backend unavailable'));

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn((nextListener) => {
          listeners.push(nextListener);
          return () => undefined;
        }),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await expect(state.sendPrompt('another prompt')).rejects.toThrow('backend unavailable');
    expect(state.activeQueuedPrompts.value).toEqual([
      expect.objectContaining({ text: 'retry me later' }),
    ]);
  });

  it('updates and steers busy drafts and queued prompts through preload', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].status = { type: 'working' };
    remoteSnapshot.queuedPrompts = [{ id: 'queued-1', agentId: 'agent-dina', text: 'queued but steerable', createdAt: '2026-06-05T00:00:01.000Z' }];
    const steerPrompt = vi.fn().mockResolvedValue(remoteSnapshot);
    const updatedSnapshot = {
      ...remoteSnapshot,
      queuedPrompts: [{ ...remoteSnapshot.queuedPrompts[0]!, text: 'edited queued prompt' }],
    };
    const updateQueuedPrompt = vi.fn().mockResolvedValue(updatedSnapshot);
    const steerQueuedPrompt = vi.fn().mockResolvedValue({
      ...remoteSnapshot,
      queuedPrompts: [],
    });

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        steerPrompt,
        updateQueuedPrompt,
        steerQueuedPrompt,
        sendPrompt: vi.fn().mockResolvedValue(remoteSnapshot),
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.steerPrompt('use the smaller patch', {
      attachments: [{ type: 'file', reference: 'electron-attachment:notes' }],
    });

    expect(steerPrompt).toHaveBeenCalledWith('agent-dina', 'use the smaller patch', {
      attachments: [{ type: 'file', reference: 'electron-attachment:notes' }],
    });

    const queuedPromptId = state.activeQueuedPrompts.value[0]?.id;
    expect(queuedPromptId).toBeTruthy();

    await state.updateQueuedPrompt(queuedPromptId as string, 'edited queued prompt');
    expect(updateQueuedPrompt).toHaveBeenCalledWith('agent-dina', 'queued-1', 'edited queued prompt');
    expect(state.activeQueuedPrompts.value).toEqual([
      expect.objectContaining({ id: 'queued-1', text: 'edited queued prompt' }),
    ]);

    await state.steerQueuedPrompt(queuedPromptId as string, 'edited steer');

    expect(steerQueuedPrompt).toHaveBeenCalledWith('agent-dina', 'queued-1', 'edited steer');
    expect(state.activeQueuedPrompts.value).toStrictEqual([]);

  });

  it('queues an unsupported steer for the targeted Claude agent without steering or consuming its queue', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.backendRuntimes.find((runtime) => runtime.backend === 'claude')!.capabilities = { ...claudeBackendCapabilities, steerPrompt: false };
    const agent = remoteSnapshot.agents.find(candidate => candidate.id === 'agent-jesse')!;
    agent.backend = 'claude';
    agent.backendDefaults = { kind: 'claude' };
    agent.status = { type: 'working' };
    remoteSnapshot.queuedPrompts = [{ id: 'queued-claude', agentId: agent.id, text: 'Keep queued', createdAt: '2026-10-03T00:00:00Z' }];
    const sendPrompt = vi.fn().mockResolvedValue(remoteSnapshot);
    const steerPrompt = vi.fn().mockResolvedValue(remoteSnapshot);
    const steerQueuedPrompt = vi.fn().mockResolvedValue(remoteSnapshot);
    stubElectronTestWindow({ app: {
      getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot), sendPrompt, steerPrompt, steerQueuedPrompt,
    } });
    const state = useAppState();
    await state.loadSnapshot();
    const options = { attachments: [{ type: 'file' as const, reference: 'electron-attachment:notes' }] };

    await state.steerPromptToAgent(agent.id, 'New instruction', options);
    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith(agent.id, 'New instruction', options);
    expect(steerPrompt).not.toHaveBeenCalled();
    await state.steerQueuedPromptForAgent(agent.id, 'queued-claude');
    expect(steerQueuedPrompt).not.toHaveBeenCalled();
    expect(state.snapshot.value.queuedPrompts).toStrictEqual(remoteSnapshot.queuedPrompts);
    expect(state.activeAgent.value?.id).toBe('agent-dina');
  });

  it('interrupts the active busy agent through preload', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].status = { type: 'working' };
    const interruptedSnapshot = createInitialSnapshot();
    interruptedSnapshot.agents[0].status = { type: 'working' };
    const interruptAgent = vi.fn().mockResolvedValue(interruptedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        interruptAgent,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    await state.interruptActiveAgent();

    expect(interruptAgent).toHaveBeenCalledWith('agent-dina');
    expect(state.snapshot.value.agents[0].status).toStrictEqual({ type: 'working' });
  });

  it('deletes queued prompts through the backend owner', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].status = { type: 'working' };
    remoteSnapshot.queuedPrompts = [{ id: 'queued-1', agentId: 'agent-dina', text: 'delete this queued prompt', createdAt: '2026-06-05T00:00:01.000Z' }];
    const deleteQueuedPrompt = vi.fn().mockResolvedValue({ ...remoteSnapshot, queuedPrompts: [] });

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        deleteQueuedPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    const queuedPromptId = state.activeQueuedPrompts.value[0]?.id;

    await state.removeQueuedPrompt(queuedPromptId as string);

    expect(deleteQueuedPrompt).toHaveBeenCalledWith('agent-dina', 'queued-1');
    expect(state.activeQueuedPrompts.value).toStrictEqual([]);
  });

  it('tracks sending state per agent so another agent can be used while one starts', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const dinaQueuedSnapshot = {
      ...createInitialSnapshot(),
      activeAgentId: 'agent-dina',
    };
    const jesseQueuedSnapshot = {
      ...createInitialSnapshot(),
      activeAgentId: 'agent-jesse',
    };
    const dinaSend = deferred<typeof dinaQueuedSnapshot>();
    const sendPrompt = vi.fn((agentId: string) => {
      if (agentId === 'agent-dina') {
        return dinaSend.promise;
      }

      return Promise.resolve(jesseQueuedSnapshot);
    });
    const selectAgent = vi.fn().mockResolvedValue({
      ...remoteSnapshot,
      activeAgentId: 'agent-jesse',
    });

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        selectAgent,
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();

    const firstSend = state.sendPrompt('work in dina');
    expect(sendPrompt).toHaveBeenCalledWith('agent-dina', 'work in dina');
    expect(state.isSending.value).toBe(true);

    await state.selectAgent('agent-jesse');
    expect(state.activeAgent.value?.id).toBe('agent-jesse');
    expect(state.isSending.value).toBe(false);

    await state.sendPrompt('work in jesse');
    expect(sendPrompt).toHaveBeenCalledWith('agent-jesse', 'work in jesse');

    dinaSend.resolve(dinaQueuedSnapshot);
    await firstSend;
    expect(state.activeAgent.value?.id).toBe('agent-jesse');
  });

  it('keeps composer text, selection, and attachments isolated under the emitting agent', async () => {
    const base = createInitialSnapshot();
    const selectAgent = vi.fn((agentId: string) => Promise.resolve({ ...base, activeAgentId: agentId }));
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(base),
        selectAgent,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    state.updateComposerState('agent-dina', {
      text: 'draft for Dina', selectionStart: 3, selectionEnd: 8,
    });
    state.updateComposerAttachments('agent-dina', [
      {
        id: 'attachment-dina', type: 'file', reference: 'electron-attachment:dina', name: 'dina.txt',
        mimeType: 'text/plain', size: 10,
      },
    ]);

    await state.selectAgent('agent-jesse');
    expect(state.activeComposerState.value).toStrictEqual({
      text: '', selectionStart: 0, selectionEnd: 0,
    });
    expect(state.activeComposerAttachments.value).toStrictEqual([]);
    state.updateComposerState('agent-jesse', {
      text: 'draft for Jesse', selectionStart: 15, selectionEnd: 15,
    });
    state.updateComposerAttachments('agent-jesse', [
      {
        id: 'attachment-jesse', type: 'image', reference: 'electron-attachment:jesse', name: 'jesse.png',
        mimeType: 'image/png', size: 20,
      },
    ]);
    state.updateComposerState('agent-dina', {
      text: 'late Dina state', selectionStart: 4, selectionEnd: 4,
    });
    expect(state.activeComposerState.value.text).toBe('draft for Jesse');

    await state.selectAgent('agent-dina');
    expect(state.activeComposerState.value).toStrictEqual({
      text: 'late Dina state', selectionStart: 4, selectionEnd: 4,
    });
    expect(state.activeComposerAttachments.value).toStrictEqual([
      {
        id: 'attachment-dina', type: 'file', reference: 'electron-attachment:dina', name: 'dina.txt',
        mimeType: 'text/plain', size: 10,
      },
    ]);
    await state.selectAgent('agent-jesse');
    expect(state.activeComposerState.value).toStrictEqual({
      text: 'draft for Jesse', selectionStart: 15, selectionEnd: 15,
    });
    expect(state.activeComposerAttachments.value).toStrictEqual([
      {
        id: 'attachment-jesse', type: 'image', reference: 'electron-attachment:jesse', name: 'jesse.png',
        mimeType: 'image/png', size: 20,
      },
    ]);
  });

  it('keeps each agent queue in the authoritative snapshot while switching agents', async () => {
    const base = createInitialSnapshot();
    base.queuedPrompts = [
      { id: 'dina-queue', agentId: 'agent-dina', text: 'Dina next', createdAt: '2026-06-05T00:00:01.000Z' },
      { id: 'jesse-queue', agentId: 'agent-jesse', text: 'Jesse next', createdAt: '2026-06-05T00:00:02.000Z' },
    ];
    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(base),
        selectAgent: vi.fn((agentId: string) => Promise.resolve({ ...base, activeAgentId: agentId })),
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    expect(state.activeQueuedPrompts.value.map((prompt) => prompt.text)).toStrictEqual(['Dina next']);
    await state.selectAgent('agent-jesse');
    expect(state.activeQueuedPrompts.value.map((prompt) => prompt.text)).toStrictEqual(['Jesse next']);
    await state.selectAgent('agent-dina');
    expect(state.activeQueuedPrompts.value.map((prompt) => prompt.text)).toStrictEqual(['Dina next']);
  });

  it('includes selected plan mode in prompt options', async () => {
    const remoteSnapshot = createInitialSnapshot();
    const updatedSnapshot = createInitialSnapshot();
    const sendPrompt = vi.fn().mockResolvedValue(updatedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    state.selectedModelId.value = null;
    state.selectedReasoningEffort.value = null;
    state.setPlanMode(true);

    await state.sendPrompt('make a plan and keep going');

    expect(sendPrompt).toHaveBeenCalledWith('agent-dina', 'make a plan and keep going', {
      planMode: true,
    });
  });

  it('includes prompted plan mode for Claude agents', async () => {
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.agents[0].backend = 'claude';
    remoteSnapshot.agents[0].backendDefaults = { kind: 'claude' };
    const updatedSnapshot = createInitialSnapshot();
    updatedSnapshot.agents[0].backend = 'claude';
    updatedSnapshot.agents[0].backendDefaults = { kind: 'claude' };
    const sendPrompt = vi.fn().mockResolvedValue(updatedSnapshot);

    stubElectronTestWindow({
      app: {
        getSnapshot: vi.fn().mockResolvedValue(remoteSnapshot),
        sendPrompt,
        onEvent: vi.fn(),
      } satisfies Partial<AppApi>,
    });

    const state = useAppState();
    await state.loadSnapshot();
    state.setPlanMode(true);

    await state.sendPrompt('make a Claude plan');

    expect(sendPrompt).toHaveBeenCalledWith('agent-dina', 'make a Claude plan', {
      planMode: true,
    });
  });
});
