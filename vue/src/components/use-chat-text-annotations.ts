import { trimPromptContent } from '@codex-app-sdk/core/surface';
import type {
  CodexMessageTextSelection,
  CodexRendererSendMessageOptions,
} from '@codex-app-sdk/vue';
import { computed, reactive } from 'vue';

export type ChatTextAnnotation = Omit<CodexMessageTextSelection, 'anchor'> & {
  comment: string;
  id: string;
};

export function useChatTextAnnotations(options: {
  currentAgentId: () => string | undefined;
}) {
  const draftsByAgentId = reactive<Record<string, ChatTextAnnotation[]>>({});
  let nextAnnotationId = 0;

  const activeAnnotations = computed<readonly ChatTextAnnotation[]>(() => {
    const agentId = options.currentAgentId();
    return agentId ? draftsByAgentId[agentId] ?? [] : [];
  });

  function add(selection: CodexMessageTextSelection, comment: string): void {
    const agentId = options.currentAgentId();
    const text = selection.text.trim();
    const normalizedComment = comment.trim();
    if (!agentId || !text || !normalizedComment) return;
    nextAnnotationId += 1;
    draftsByAgentId[agentId] = [
      ...(draftsByAgentId[agentId] ?? []),
      {
        id: `chat-text-annotation-${nextAnnotationId}`,
        text,
        comment: normalizedComment,
        messageIndex: selection.messageIndex,
        role: selection.role,
        ...(selection.messageId ? { messageId: selection.messageId } : {}),
        ...(selection.turnId ? { turnId: selection.turnId } : {}),
      },
    ];
  }

  function remove(annotationId: string): void {
    const agentId = options.currentAgentId();
    if (!agentId) return;
    draftsByAgentId[agentId] = (draftsByAgentId[agentId] ?? [])
      .filter((annotation) => annotation.id !== annotationId);
  }

  async function forward(
    prompt: string,
    sendOptions: CodexRendererSendMessageOptions | undefined,
    send: (nextPrompt: string, nextOptions?: CodexRendererSendMessageOptions) => void | Promise<void>,
  ): Promise<void> {
    const agentId = options.currentAgentId();
    const annotations = agentId
      ? (draftsByAgentId[agentId] ?? []).map((annotation) => ({ ...annotation }))
      : [];
    if (!agentId || annotations.length === 0) {
      await send(prompt, sendOptions);
      return;
    }

    const content = sendOptions?.content === undefined ? undefined : trimPromptContent(sendOptions.content);
    const nextOptions = content === undefined ? sendOptions : { ...sendOptions, content: [...content, { type: 'text' as const, text: `${content.length ? '\n\n' : ''}${annotations.length} annotation${annotations.length === 1 ? '' : 's'}` }] };
    await send(formatChatTextAnnotationPrompt(annotations, prompt), nextOptions);
    const submittedIds = new Set(annotations.map((annotation) => annotation.id));
    draftsByAgentId[agentId] = (draftsByAgentId[agentId] ?? [])
      .filter((annotation) => !submittedIds.has(annotation.id));
  }

  return {
    activeAnnotations,
    add,
    forward,
    remove,
  };
}

export function formatChatTextAnnotationPrompt(
  annotations: readonly ChatTextAnnotation[],
  existingPrompt = '',
): string {
  const prompt = existingPrompt.trim();
  const annotationContext = [
    'Chat annotations:',
    '',
    ...annotations.flatMap((annotation, index) => [
      `${index + 1}. ${capitalize(annotation.role)} message ${annotation.messageIndex + 1}`,
      'Selected text:',
      ...annotation.text.split('\n').map((line: string) => `> ${line}`.trimEnd()),
      `Comment: ${annotation.comment}`,
      ...(index === annotations.length - 1 ? [] : ['']),
    ]),
  ].join('\n').replace(/<\/context>/gi, '&lt;/context&gt;');
  const visiblePrompt = [
    prompt,
    `${annotations.length} annotation${annotations.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join('\n\n');
  return `<context>\n${annotationContext}\n</context>\n${visiblePrompt}`;
}

function capitalize(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : 'Unknown';
}
