import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { AppController } from '../app-controller';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AgentFilePreviewResult, AgentFileSearchItem, AppSnapshot, ConversationSummary, AutomationLocation, RendererMessage, RendererSendPromptOptions } from '@workspace/core/contracts';
import { currentSnapshot, createBackendClient } from './app-controller-test-harness';

describe('AppController', () => {

  it('routes agent restart through daemon', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-old' };
    const backendSnapshot = {
      ...snapshot,
      agents: [{ ...snapshot.agents[0]!, backendSession: undefined }],
    };
    const request = vi.fn().mockResolvedValue(backendSnapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();

    await expect(restartAgent(controller, 'agent-dina')).resolves.toBe(backendSnapshot);

    expect(request).toHaveBeenCalledWith('agent/conversation/reset', { agentId: 'agent-dina' });
  });

  it('routes lazy provider history hydration through daemon', async () => {
    const snapshot = createInitialSnapshot();
    const backendSnapshot = structuredClone(snapshot);
    const request = vi.fn().mockResolvedValue(backendSnapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();
    await expect(loadConversationHistory(controller, 'agent-dina')).resolves.toBe(backendSnapshot);

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('agent/conversation/load', { agentId: 'agent-dina' });
    expect(currentSnapshot(controller)).toStrictEqual(backendSnapshot);
  });

  it('routes agent goal mutations through daemon', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.sourceFolder.initialized = true;
    const goalSnapshot = {
      ...snapshot,
      agents: [{
        ...snapshot.agents[0]!,
        backendSession: { kind: 'codex' as const, threadId: 'thread-dina' },
        goal: {
          threadId: 'thread-dina',
          objective: 'Ship the goal shelf',
          status: 'active' as const,
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      }],
    };
    const clearedSnapshot = {
      ...goalSnapshot,
      agents: [{ ...goalSnapshot.agents[0]!, goal: undefined }],
    };
    const request = vi.fn()
      .mockResolvedValueOnce(goalSnapshot)
      .mockResolvedValueOnce(clearedSnapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();

    await expect(setAgentGoal(controller, 'agent-dina', ' Ship the goal shelf ')).resolves.toBe(goalSnapshot);
    await expect(clearAgentGoal(controller, 'agent-dina')).resolves.toBe(clearedSnapshot);

    expect(request).toHaveBeenNthCalledWith(1, 'agent/goal/update', { agentId: 'agent-dina', objective: ' Ship the goal shelf ' });
    expect(request).toHaveBeenNthCalledWith(2, 'agent/goal/clear', { agentId: 'agent-dina' });
  });

  it('routes approval preset updates through daemon', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.sourceFolder.initialized = true;
    const backendSnapshot = {
      ...snapshot,
      agents: [{
        ...snapshot.agents[0]!,
        backendSession: { kind: 'codex' as const, threadId: 'thread-dina' },
        backendDefaults: {
          kind: 'codex' as const,
          approvalPreset: 'approve-for-me' as const,
          approvalPolicy: 'on-request' as const,
          approvalsReviewer: 'auto_review' as const,
          sandboxMode: 'workspace-write' as const,
        },
      }],
    };
    const request = vi.fn().mockResolvedValue(backendSnapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();

    await expect(setAgentApprovalPreset(controller, 'agent-dina', 'approve-for-me')).resolves.toBe(backendSnapshot);

    expect(request).toHaveBeenCalledWith('agent/approvalPreset/update', { agentId: 'agent-dina', preset: 'approve-for-me' });
  });

  it('routes permission mode updates through their separate daemon method', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.sourceFolder.initialized = true;
    snapshot.agents[0] = {
      ...snapshot.agents[0]!,
      backend: 'claude',
      backendDefaults: { kind: 'claude', permissionMode: 'acceptEdits' },
    };
    const request = vi.fn().mockResolvedValue(snapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();

    await expect(setAgentPermissionMode(controller, 'agent-dina', 'acceptEdits')).resolves.toBe(snapshot);
    expect(request).toHaveBeenCalledWith('agent/permissionMode/update', { agentId: 'agent-dina', mode: 'acceptEdits' });
  });

  it('routes active-turn steering through daemon', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.sourceFolder.initialized = true;
    const backendSnapshot = {
      ...snapshot,
      agents: [{
        ...snapshot.agents[0]!,
        backendSession: { kind: 'codex' as const, threadId: 'thread-dina' },
      }],
    };
    const request = vi.fn().mockResolvedValue(backendSnapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();
    const attachment = registerNativeAttachment(controller, {
      type: 'file',
      path: '/tmp/notes.txt',
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: 12,
    });

    await expect(steerPrompt(controller, 'agent-dina', ' try smaller ')).resolves.toBe(backendSnapshot);
    await expect(steerPrompt(controller, 'agent-dina', ' inspect this ', {
      attachments: [{ type: 'file', reference: attachment.reference }],
    })).resolves.toBe(backendSnapshot);

    expect(request).toHaveBeenCalledWith('agent/prompt/steer', { agentId: 'agent-dina', prompt: ' try smaller ' });
    expect(request).toHaveBeenCalledWith('agent/prompt/steer', {
      agentId: 'agent-dina',
      prompt: ' inspect this ',
      options: {
        attachments: [{ type: 'file', path: '/tmp/notes.txt', name: 'notes.txt', mimeType: 'text/plain' }],
      },
    });

    await expect(steerPrompt(controller, 'agent-dina', ' invalid attachment ', {
      attachments: [{ type: 'file', reference: 'electron-attachment:missing' }],
    })).rejects.toThrow('Attachment reference is invalid or expired');
  });

  it('routes queued prompt mutations through daemon', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.sourceFolder.initialized = true;
    const request = vi.fn().mockResolvedValue(snapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));
    await controller.initialize();

    await expect(updateQueuedPrompt(controller, 'agent-dina', 'prompt-1', 'edited queue')).resolves.toBe(snapshot);
    await expect(steerQueuedPrompt(controller, 'agent-dina', 'prompt-1', 'edited steer')).resolves.toBe(snapshot);
    await expect(deleteQueuedPrompt(controller, 'agent-dina', 'prompt-2')).resolves.toBe(snapshot);

    expect(request).toHaveBeenNthCalledWith(1, 'agent/queuedPrompt/update', {
      agentId: 'agent-dina', promptId: 'prompt-1', prompt: 'edited queue',
    });
    expect(request).toHaveBeenNthCalledWith(2, 'agent/queuedPrompt/steer', {
      agentId: 'agent-dina', promptId: 'prompt-1', prompt: 'edited steer',
    });
    expect(request).toHaveBeenNthCalledWith(3, 'agent/queuedPrompt/delete', { agentId: 'agent-dina', promptId: 'prompt-2' });
  });

  it('routes interruption through daemon', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].status = { type: 'working' };
    snapshot.sourceFolder.initialized = true;
    const backendSnapshot = {
      ...snapshot,
      agents: [{
        ...snapshot.agents[0]!,
        backendSession: { kind: 'codex' as const, threadId: 'thread-dina' },
      }],
    };
    const request = vi.fn().mockResolvedValue(backendSnapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();

    await expect(interruptAgent(controller, 'agent-dina')).resolves.toBe(backendSnapshot);

    expect(request).toHaveBeenCalledWith('agent/interrupt', { agentId: 'agent-dina' });
  });

  it('routes prompts through daemon by agent id', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].backend = 'claude';
    snapshot.agents[0].backendDefaults = { kind: 'claude' };
    const backendSnapshot = {
      ...snapshot,
      agents: [{
        ...snapshot.agents[0]!,
        backendSession: { kind: 'claude' as const, sessionId: 'claude-session-1', transport: 'stdio' as const },
      }],
    };
    const request = vi.fn().mockResolvedValue(backendSnapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();
    await expect(sendPrompt(controller, 'agent-dina', 'hello claude')).resolves.toBe(backendSnapshot);

    expect(request).toHaveBeenCalledWith('agent/prompt/send', {
      agentId: 'agent-dina',
      prompt: 'hello claude',
      options: undefined,
    });
  });

  it('reads historical conversation messages through daemon', async () => {
    const snapshot = createInitialSnapshot();
    const generatedImageUrl = `file:///Users/nbonamy/${product.homeDirectory}/codex-home/generated_images/thread/history.png`;
    const messages: RendererMessage[] = [
      {
        id: 'user-thread-dina-user-1',
        agentId: 'agent-dina',
        role: 'user',
        status: 'complete',
        createdAt: '2026-06-09T10:00:00.000Z',
        parts: [{ type: 'text', text: 'hello' }],
      },
      {
        id: 'assistant-thread-dina-image-1',
        agentId: 'agent-dina',
        role: 'assistant',
        status: 'complete',
        createdAt: '2026-06-09T10:00:01.000Z',
        parts: [{
          type: 'media',
          media: { url: generatedImageUrl, mimeType: 'image/png' },
        }],
      },
    ];
    const request = vi.fn().mockResolvedValue(messages);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();

    const loaded = await readConversationMessages(controller, { backend: 'codex', threadId: 'thread-dina' }, 'agent-dina');
    expect(loaded[0]).toStrictEqual(messages[0]);
    const media = loaded[1]?.parts.find((part) => part.type === 'media');
    expect(media?.type === 'media' ? media.media.url : null).toMatch(/^agent-workspace-media:\/\/generated\//);
    expect(media?.type === 'media' ? media.media.url : null).not.toBe(generatedImageUrl);
    expect(request).toHaveBeenCalledWith('agent/conversation/messages/get', {
      ref: { backend: 'codex', threadId: 'thread-dina' },
      agentId: 'agent-dina',
    });
  });

  it('lists agent conversations through daemon', async () => {
    const snapshot = createInitialSnapshot();
    const conversations: ConversationSummary[] = [{
      id: 'thread-dina',
      title: 'Read docs',
      updatedAt: '2026-06-09T10:00:00.000Z',
      messageCount: 3,
      storageState: 'archived',
      ref: { backend: 'codex', threadId: 'thread-dina' },
    }];
    const request = vi.fn().mockResolvedValue(conversations);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();

    await expect(listAgentConversations(controller, 'agent-dina')).resolves.toStrictEqual(conversations);
    expect(request).toHaveBeenCalledWith('agent/conversations/list', { agentId: 'agent-dina', input: undefined });
  });

  it('routes agent conversation resume through daemon', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-old' };
    const backendSnapshot = {
      ...snapshot,
      agents: [{ ...snapshot.agents[0]!, backendSession: { kind: 'codex' as const, threadId: 'thread-dina' } }],
    };
    const request = vi.fn().mockResolvedValue(backendSnapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));
    const target = { ref: { backend: 'codex' as const, threadId: 'thread-dina' }, storageState: 'archived' as const };

    await controller.initialize();

    await expect(resumeAgentConversation(controller, 'agent-dina', target)).resolves.toBe(backendSnapshot);

    expect(request).toHaveBeenCalledWith('agent/conversation/resume', { agentId: 'agent-dina', target });
  });

  it('lets daemon validate busy agent conversation resume', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].status = { type: 'working' };
    const request = vi.fn().mockRejectedValue(new Error('Agent must be idle before resuming a conversation.'));
    const controller = new AppController(snapshot, createBackendClient({ request }));
    const target = { ref: { backend: 'codex' as const, threadId: 'thread-dina' }, storageState: 'archived' as const };

    await controller.initialize();

    await expect(resumeAgentConversation(controller, 'agent-dina', target)).rejects.toThrow('Agent must be idle before resuming a conversation.');
    expect(request).toHaveBeenCalledWith('agent/conversation/resume', { agentId: 'agent-dina', target });
  });

  it('lets daemon reject unrecorded historical conversation refs', async () => {
    const snapshot = createInitialSnapshot();
    const request = vi.fn().mockRejectedValue(new Error('Conversation reference is not available.'));
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();

    await expect(readConversationMessages(controller, { backend: 'codex', threadId: 'thread-dina' }, 'agent-dina')).rejects.toThrow('Conversation reference is not available.');
    expect(request).toHaveBeenCalledWith('agent/conversation/messages/get', {
      ref: { backend: 'codex', threadId: 'thread-dina' },
      agentId: 'agent-dina',
    });
  });

  it('lets daemon reject invalid historical conversation refs', async () => {
    const snapshot = createInitialSnapshot();
    const request = vi.fn().mockRejectedValue(new Error('Invalid conversation reference.'));
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();

    await expect(readConversationMessages(controller, { backend: 'codex' }, 'agent-dina')).rejects.toThrow('Invalid conversation reference.');
    expect(request).toHaveBeenCalledWith('agent/conversation/messages/get', {
      ref: { backend: 'codex' },
      agentId: 'agent-dina',
    });
  });

  it('routes agent file listing and previews through daemon', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.sourceFolder.initialized = true;
    snapshot.agents[0].folder = '/Users/nbonamy/src/agent-workspace';
    const files: AgentFileSearchItem[] = [{ name: 'README.md', path: 'README.md' }];
    const readResult: AgentFilePreviewResult = { path: 'README.md', size: 10, kind: 'text', content: '# Read me\n' };
    const request = vi.fn()
      .mockResolvedValueOnce(files)
      .mockResolvedValueOnce(readResult);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();

    await expect(listAgentFiles(controller, 'agent-dina')).resolves.toStrictEqual(files);
    await expect(previewAgentFile(controller, 'agent-dina', 'README.md')).resolves.toStrictEqual(readResult);
    expect(request).toHaveBeenNthCalledWith(1, 'agent/files/list', {
      agentId: 'agent-dina',
    });
    expect(request).toHaveBeenNthCalledWith(2, 'agent/file/preview', {
      agentId: 'agent-dina',
      filePath: 'README.md',
    });
  });

  it('routes Codex turn deletion through daemon', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.sourceFolder.initialized = true;
    snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-dina' };
    const rollbackSnapshot = { ...snapshot };
    const request = vi.fn().mockResolvedValue(rollbackSnapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();

    await expect(deleteTurn(controller, 'agent-dina', 'turn-2')).resolves.toBe(rollbackSnapshot);

    expect(request).toHaveBeenCalledWith('agent/turn/delete', { agentId: 'agent-dina', turnId: 'turn-2' });
  });

  it('routes retry and interrupted-turn continuation to distinct backend operations', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.sourceFolder.initialized = true;
    snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-dina' };
    const rollbackSnapshot = { ...snapshot };
    const request = vi.fn().mockResolvedValue(rollbackSnapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();
    await retryTurn(controller, 'agent-dina', 'turn-1');
    await continueInterruptedTurn(controller, 'agent-dina');

    expect(request).toHaveBeenCalledWith('agent/turn/retry', { agentId: 'agent-dina', turnId: 'turn-1' });
    expect(request).toHaveBeenCalledWith('agent/turn/continueInterrupted', { agentId: 'agent-dina' });
  });

  it('edits a Codex turn', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.sourceFolder.initialized = true;
    snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-dina' };
    const rollbackSnapshot = { ...snapshot };
    const request = vi.fn().mockResolvedValue(rollbackSnapshot);
    const controller = new AppController(snapshot, createBackendClient({ request }));

    await controller.initialize();
    await editTurn(controller, 'agent-dina', 'turn-1', ' edited prompt ');

    expect(request).toHaveBeenCalledWith('agent/turn/edit', { agentId: 'agent-dina', turnId: 'turn-1', content: ' edited prompt ' });
  });
});

async function sendPrompt(controller: AppController, agentId: string, prompt: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    sendPrompt(agentId: string, prompt: string): Promise<AppSnapshot>;
  }).sendPrompt(agentId, prompt);
}

async function restartAgent(controller: AppController, agentId: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    restartAgent(agentId: string): Promise<AppSnapshot>;
  }).restartAgent(agentId);
}

async function loadConversationHistory(controller: AppController, agentId: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    loadConversationHistory(agentId: string): Promise<AppSnapshot>;
  }).loadConversationHistory(agentId);
}

async function readConversationMessages(
  controller: AppController,
  ref: unknown,
  agentId: string,
  location?: AutomationLocation,
): Promise<RendererMessage[]> {
  return (controller as unknown as {
    readConversationMessages(ref: unknown, agentId: string, location?: AutomationLocation): Promise<RendererMessage[]>;
  }).readConversationMessages(ref, agentId, location);
}

async function listAgentConversations(
  controller: AppController,
  agentId: string,
): Promise<ConversationSummary[]> {
  return (controller as unknown as {
    listAgentConversations(agentId: string): Promise<ConversationSummary[]>;
  }).listAgentConversations(agentId);
}

async function resumeAgentConversation(
  controller: AppController,
  agentId: string,
  target: import('@workspace/core/contracts').ConversationResumeTarget,
): Promise<AppSnapshot> {
  return (controller as unknown as {
    resumeAgentConversation(agentId: string, target: unknown): Promise<AppSnapshot>;
  }).resumeAgentConversation(agentId, target);
}

async function steerPrompt(
  controller: AppController,
  agentId: string,
  prompt: string,
  options?: RendererSendPromptOptions,
): Promise<AppSnapshot> {
  return (controller as unknown as {
    steerPrompt(agentId: string, prompt: string, options?: RendererSendPromptOptions): Promise<AppSnapshot>;
  }).steerPrompt(agentId, prompt, options);
}

function registerNativeAttachment(
  controller: AppController,
  input: { type: 'file' | 'image'; path: string; name: string; mimeType: string; size: number },
): { reference: string } {
  return (controller as unknown as {
    nativeAttachmentRegistry: { register(value: typeof input): { reference: string } };
  }).nativeAttachmentRegistry.register(input);
}

async function updateQueuedPrompt(controller: AppController, agentId: string, promptId: string, prompt: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    updateQueuedPrompt(agentId: string, promptId: string, prompt: string): Promise<AppSnapshot>;
  }).updateQueuedPrompt(agentId, promptId, prompt);
}

async function steerQueuedPrompt(controller: AppController, agentId: string, promptId: string, prompt?: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    steerQueuedPrompt(agentId: string, promptId: string, prompt?: string): Promise<AppSnapshot>;
  }).steerQueuedPrompt(agentId, promptId, prompt);
}

async function deleteQueuedPrompt(controller: AppController, agentId: string, promptId: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    deleteQueuedPrompt(agentId: string, promptId: string): Promise<AppSnapshot>;
  }).deleteQueuedPrompt(agentId, promptId);
}

async function interruptAgent(controller: AppController, agentId: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    interruptAgent(agentId: string): Promise<AppSnapshot>;
  }).interruptAgent(agentId);
}

async function deleteTurn(controller: AppController, agentId: string, turnId: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    deleteTurn(agentId: string, turnId: string): Promise<AppSnapshot>;
  }).deleteTurn(agentId, turnId);
}

async function retryTurn(controller: AppController, agentId: string, turnId: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    retryTurn(agentId: string, turnId: string): Promise<AppSnapshot>;
  }).retryTurn(agentId, turnId);
}

async function continueInterruptedTurn(controller: AppController, agentId: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    continueInterruptedTurn(agentId: string): Promise<AppSnapshot>;
  }).continueInterruptedTurn(agentId);
}

async function editTurn(controller: AppController, agentId: string, turnId: string, content: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    editTurn(agentId: string, turnId: string, content: string): Promise<AppSnapshot>;
  }).editTurn(agentId, turnId, content);
}

async function setAgentGoal(controller: AppController, agentId: string, objective: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    setAgentGoal(agentId: string, objective: string): Promise<AppSnapshot>;
  }).setAgentGoal(agentId, objective);
}

async function clearAgentGoal(controller: AppController, agentId: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    clearAgentGoal(agentId: string): Promise<AppSnapshot>;
  }).clearAgentGoal(agentId);
}

async function setAgentApprovalPreset(controller: AppController, agentId: string, preset: 'ask-for-approval' | 'approve-for-me' | 'full-access'): Promise<AppSnapshot> {
  return (controller as unknown as {
    setAgentApprovalPreset(agentId: string, preset: 'ask-for-approval' | 'approve-for-me' | 'full-access'): Promise<AppSnapshot>;
  }).setAgentApprovalPreset(agentId, preset);
}

async function setAgentPermissionMode(controller: AppController, agentId: string, mode: string): Promise<AppSnapshot> {
  return (controller as unknown as {
    setAgentPermissionMode(agentId: string, mode: string): Promise<AppSnapshot>;
  }).setAgentPermissionMode(agentId, mode);
}

async function previewAgentFile(controller: AppController, agentId: string, filePath: string): Promise<unknown> {
  return (controller as unknown as {
    previewAgentFile(agentId: string, filePath: string): Promise<unknown>;
  }).previewAgentFile(agentId, filePath);
}

async function listAgentFiles(controller: AppController, agentId: string): Promise<AgentFileSearchItem[]> {
  return (controller as unknown as {
    listAgentFiles(agentId: string): Promise<AgentFileSearchItem[]>;
  }).listAgentFiles(agentId);
}
