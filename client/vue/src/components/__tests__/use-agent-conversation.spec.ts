import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { promptContentText } from '@korus-dev/multi-agent-sdk/prompt';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { ConversationPaneState, NativeAttachment, NativeRendererApi } from '@korus-dev/agent-ui-sdk';
import { agentConversationState, useAgentConversation, type AgentConversationActions } from '../use-agent-conversation';
import type { AgentConversationView } from '../../app-state';
import { conversationFrom, sessionState } from '../../../tests/support/conversation-fixtures';
import { resolveConversationControllerValue } from '../../../tests/support/app-shell-test-harness';

const image: NativeAttachment = { id: 'shot', type: 'image', reference: 'electron-attachment:shot', name: 'shot.png',
  mimeType: 'image/png', size: 10, previewUrl: 'data:image/png;base64,c2hvdA==' };
const annotated: NativeAttachment = { ...image, id: 'shot-annotated', reference: 'electron-attachment:shot-annotated', name: 'shot-annotated.png' };

afterEach(() => { delete (window as Window & { agentUiHostCapabilities?: unknown }).agentUiHostCapabilities; });

describe('useAgentConversation image annotations', () => {
  it('sends the annotated image even though the composer clears its attachments as soon as it submits', async () => {
    const ingestAttachments = vi.fn().mockResolvedValue([annotated]);
    (window as Window & { agentUiHostCapabilities?: Partial<NativeRendererApi> }).agentUiHostCapabilities = {
      capabilities: { attachments: true, clipboard: true, externalLinks: true, transcription: false }, ingestAttachments };
    const attachments = ref<readonly NativeAttachment[]>([image]);
    const send = vi.fn();
    const state = { composer: { get attachments() { return attachments.value; } } } as unknown as ConversationPaneState;
    const conversation = useAgentConversation({
      agentId: () => 'agent', state, debugFallbackImageSource: '', notifyError: vi.fn(),
      openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
      beforeSubmit: async () => undefined,
      actions: { send, updateComposerState: vi.fn(),
        updateAttachments: (_agentId: string, next: readonly NativeAttachment[]) => { attachments.value = next; } } as unknown as AgentConversationActions,
    });
    const actions = resolveConversationControllerValue(conversation.controller.actions);
    conversation.imageAnnotation.openAttachment(image);
    conversation.imageAnnotation.save({ annotations: [{ id: 'a', number: 1, tool: 'arrow', start: { x: 1, y: 2 }, end: { x: 3, y: 4 }, comment: 'Look here.' }],
      dataUrl: 'data:image/png;base64,YW5ub3RhdGVk', fileName: 'shot-annotated.png', width: 10, height: 10, pixelRatio: 1 });

    // Same order as the SDK composer: hand the prompt to submit, then clear its attachments synchronously.
    const content = [{ type: 'mention' as const, kind: 'file' as const, id: 'src/fix.ts', value: 'src/fix.ts', label: 'Fix this.' }];
    const submitted = actions.submit?.('Fix this.', { content, attachments: [{ type: 'image', reference: image.reference }] });
    actions.updateAttachments?.([]);
    await submitted;

    expect(ingestAttachments).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('agent', expect.stringContaining('1. Look here.'),
      { content: expect.arrayContaining(content), attachments: [{ type: 'image', reference: annotated.reference }] });
    expect(promptContentText(send.mock.calls[0]![2].content)).toBe(send.mock.calls[0]![1]);
    await actions.submit?.('Fix this.', { content });
    expect(send).toHaveBeenLastCalledWith('agent', 'Fix this.', { content });
  });
});

describe('agentConversationState identity', () => {
  it('shows injected prompts before native acceptance without confusing identical history or blocking hydration', () => {
    const createdAt = '2026-11-09T10:00:00.000Z';
    const text = 'Fix the selected findings.\n\n<context>Private review instructions</context>';
    const pendingPrompt = { id: 'review-injection', text, createdAt };
    const agent = { ...createInitialSnapshot().agents[0]!, pendingPrompts: [pendingPrompt] };
    const previous = { id: 'old-injection', agentId: agent.id, role: 'user' as const, status: 'complete' as const, createdAt: '2026-11-08T10:00:00.000Z', parts: [{ type: 'text' as const, text }] };
    const view = { agent, conversation: conversationFrom(agent, sessionState({ messages: [previous] })), history: { hydrating: true } } as unknown as AgentConversationView;
    const state = agentConversationState(() => view);
    expect(state.identity.messages).toHaveLength(2);
    expect(state.identity.messages.at(-1)).toMatchObject({ id: pendingPrompt.id, role: 'user', parts: [{ type: 'text', text }] });
    expect(state.identity.busy).toBe(true);
    expect(state.history!.loading).toBe(false);
    view.conversation = conversationFrom(agent, sessionState({ messages: [previous, { ...previous, id: 'accepted-injection', createdAt }] }));
    expect(state.identity.messages).toHaveLength(2);
    expect(state.identity.messages.at(-1)!.id).toBe('accepted-injection');
    agent.pendingPrompts = [];
    expect(state.identity.messages).toHaveLength(2);
    view.conversation = null;
    agent.pendingPrompts = [pendingPrompt];
    expect(state.identity.messages).toHaveLength(1);
    agent.pendingPrompts = [];
    expect(state.identity.messages).toHaveLength(0);
    const obsoleteSteeringPreview = { ...pendingPrompt, steering: true };
    agent.pendingPrompts = [obsoleteSteeringPreview];
    expect(state.identity.messages).toHaveLength(0);
  });

  it('uses native loaded model and permissions instead of stored defaults, with pending edits taking precedence', () => {
    const agent = { ...createInitialSnapshot().agents[0]!, providerDefaults: { kind: 'codex' as const, model: 'saved', approvalPreset: 'full-access' as const } };
    const native = sessionState({ permission: 'ask-for-approval', selection: { model: 'native', reasoningEffort: 'low', serviceTier: 'fast' } });
    const view = { agent, conversation: conversationFrom(agent, native),
      capabilities: { approvals: true, approvalPresets: ['ask-for-approval', 'full-access'] },
      composer: { selectedModelId: 'saved', selectedReasoningEffort: 'high', selectedServiceTier: null, pendingSelection: null },
    } as unknown as AgentConversationView;
    const state = agentConversationState(() => view);
    expect(state.composer!.permission).toBe('ask-for-approval');
    expect(state.composer!.selectedModelId).toBe('native');
    expect(state.composer!.selectedReasoningEffort).toBe('low');
    expect(state.composer!.selectedServiceTier).toBe('fast');
    view.composer.selectedModelId = 'draft';
    view.composer.pendingSelection = { provider: 'codex', model: 'draft', reasoningEffort: 'high', serviceTier: null };
    expect(state.composer!.selectedModelId).toBe('draft');
  });

  it('shows the saved model, effort and speed when the loaded conversation reports no model, as after a restart', () => {
    const agent = { ...createInitialSnapshot().agents[0]!, provider: 'claude' as const, providerDefaults: { kind: 'claude' as const, model: 'claude-sonnet-5-5', userSelectedModel: true } };
    // A restored conversation that has not run yet: the harness knows the conversation, not what it will run with.
    const view = { agent, conversation: conversationFrom(agent, sessionState({ selection: { serviceTier: null } })), capabilities: {},
      composer: { selectedModelId: 'claude-sonnet-5-5', selectedReasoningEffort: 'high', selectedServiceTier: 'fast', pendingSelection: null },
    } as unknown as AgentConversationView;
    const state = agentConversationState(() => view);
    expect(state.composer!.selectedModelId).toBe('claude-sonnet-5-5');
    expect(state.composer!.selectedReasoningEffort).toBe('high');
    expect(state.composer!.selectedServiceTier).toBe('fast');
  });

  it('shows the chosen model while the conversation runs the model it resolves to', () => {
    const agent = { ...createInitialSnapshot().agents[0]!, provider: 'claude' as const, providerDefaults: { kind: 'claude' as const, model: 'sonnet', userSelectedModel: true } };
    const entry = (id: string, resolvedModel: string) => ({ id, model: id, displayName: id, providerMetadata: { resolvedModel } });
    const view = { agent, conversation: conversationFrom(agent, sessionState({ selection: { model: 'claude-sonnet-5-5' } })), capabilities: {},
      composer: { models: [entry('default', 'claude-sonnet-5-5'), entry('opus', 'claude-opus-5-5'), entry('sonnet', 'claude-sonnet-5-5')], selectedModelId: 'sonnet', selectedReasoningEffort: null, selectedServiceTier: null, pendingSelection: null },
    } as unknown as AgentConversationView;
    const state = agentConversationState(() => view);
    expect(state.composer!.selectedModelId).toBe('sonnet');
    view.conversation = conversationFrom(agent, sessionState({ selection: { model: 'claude-opus-5-5' } }));
    expect(state.composer!.selectedModelId).toBe('opus');
  });

  it('keeps an unhydrated conversation loading even if a bootstrap provider frame says not loading', () => {
    const agent = { ...createInitialSnapshot().agents[0]!, id: 'restored', providerSession: { kind: 'codex' as const, threadId: 'restored' } };
    const view = { agent,
      conversation: conversationFrom(agent, sessionState({ historyLoading: false })),
      history: { hydrating: true } } as unknown as AgentConversationView;
    const state = agentConversationState(() => view);
    expect(state.history!.loading).toBe(true);
    expect(state.identity.disabled).toBe(true);
    view.history.hydrating = false;
    expect(state.history!.loading).toBe(false);
    expect(state.identity.disabled).toBe(false);
  });
  it('hands the pane the same answered-request set until its members change, so message blocks are not re-rendered by every update', () => {
    const agent = createInitialSnapshot().agents[0]!;
    const answered = ref<ReadonlySet<string>>(new Set(['a']));
    const state = agentConversationState(() => ({
      agent, conversation: null, answeredClientRequestIds: answered.value,
    }) as unknown as AgentConversationView);
    const first = state.thread!.answeredClientRequestIds;

    answered.value = new Set(['a']);
    expect(state.thread!.answeredClientRequestIds).toBe(first);

    answered.value = new Set(['a', 'b']);
    const changed = state.thread!.answeredClientRequestIds;
    expect([...changed!]).toStrictEqual(['a', 'b']);
    expect(changed).not.toBe(first);
    expect(state.thread!.answeredClientRequestIds).toBe(changed);
  });
});
