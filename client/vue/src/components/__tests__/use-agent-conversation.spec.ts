import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { promptContentText } from '@codex-app-sdk/core/surface';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { CodexConversationPaneState, CodexNativeAttachment, CodexNativeRendererApi } from '@codex-app-sdk/vue';
import { agentConversationState, useAgentConversation, type AgentConversationActions } from '../use-agent-conversation';
import type { AgentConversationView } from '../../app-state';
import { projectCodexConversation } from '../../provider-conversation-bindings';
import { codexConversationSnapshot } from '../../../tests/support/codex-conversation-fixtures';
import { resolveConversationControllerValue } from '../../../tests/support/app-shell-test-harness';

const image: CodexNativeAttachment = { id: 'shot', type: 'image', reference: 'electron-attachment:shot', name: 'shot.png',
  mimeType: 'image/png', size: 10, previewUrl: 'data:image/png;base64,c2hvdA==' };
const annotated: CodexNativeAttachment = { ...image, id: 'shot-annotated', reference: 'electron-attachment:shot-annotated', name: 'shot-annotated.png' };

afterEach(() => { delete (window as Window & { codexAppSdkNative?: unknown }).codexAppSdkNative; });

describe('useAgentConversation image annotations', () => {
  it('sends the annotated image even though the composer clears its attachments as soon as it submits', async () => {
    const ingestAttachments = vi.fn().mockResolvedValue([annotated]);
    (window as Window & { codexAppSdkNative?: Partial<CodexNativeRendererApi> }).codexAppSdkNative = {
      capabilities: { attachments: true, clipboard: true, externalLinks: true, transcription: false }, ingestAttachments };
    const attachments = ref<readonly CodexNativeAttachment[]>([image]);
    const send = vi.fn();
    const state = { composer: { get attachments() { return attachments.value; } } } as unknown as CodexConversationPaneState;
    const conversation = useAgentConversation({
      agentId: () => 'agent', state, debugFallbackImageSource: '', notifyError: vi.fn(),
      openLink: vi.fn(), openImage: vi.fn(), openVisualization: vi.fn(),
      beforeSubmit: async () => undefined,
      actions: { send, updateComposerState: vi.fn(),
        updateAttachments: (_agentId: string, next: readonly CodexNativeAttachment[]) => { attachments.value = next; } } as unknown as AgentConversationActions,
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
  it('keeps an unhydrated conversation loading even if a bootstrap provider frame says not loading', () => {
    const agent = { ...createInitialSnapshot().agents[0]!, id: 'restored', backendSession: { kind: 'codex' as const, threadId: 'restored' } };
    const view = { agent,
      conversation: projectCodexConversation(codexConversationSnapshot([], { activeConversationId: 'restored', historyLoading: false }), agent),
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
