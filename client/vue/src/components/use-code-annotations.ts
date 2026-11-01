import { trimPromptContent } from '@codex-app-sdk/core/surface';
import type { CodexRendererSendMessageOptions } from '@codex-app-sdk/vue';
import { computed, reactive } from 'vue';

/** Where the code is: a file and a run of lines, with the lines of a diff numbered on the side the person pointed at. */
export type CodeRange = { path: string; startLine: number; endLine: number; side?: 'old' | 'new' };

export type CodeAnnotationInput = CodeRange & {
  /** The selected code, one source line per line; diff lines carry their +/- marker. */
  text: string;
  comment: string;
};

export type CodeAnnotation = CodeAnnotationInput & { id: string };

export function describeCodeRange(range: CodeRange): string {
  const lines = range.startLine === range.endLine ? `line ${range.startLine}` : `lines ${range.startLine}-${range.endLine}`;
  return `${range.path} ${lines}${range.side === 'old' ? ' (before the change)' : ''}`;
}

/** Drafts of comments on code in the side panels, kept per agent until the next message carries them. */
export function useCodeAnnotations(options: { currentAgentId: () => string | undefined }) {
  const draftsByAgentId = reactive<Record<string, CodeAnnotation[]>>({});
  let nextAnnotationId = 0;

  const activeAnnotations = computed<readonly CodeAnnotation[]>(() => {
    const agentId = options.currentAgentId();
    return agentId ? draftsByAgentId[agentId] ?? [] : [];
  });

  function add(input: CodeAnnotationInput): void {
    const agentId = options.currentAgentId();
    const text = input.text.replace(/\s+$/u, '');
    const comment = input.comment.trim();
    if (!agentId || !text.trim() || !comment) return;
    nextAnnotationId += 1;
    draftsByAgentId[agentId] = [...(draftsByAgentId[agentId] ?? []), { ...input, text, comment, id: `code-annotation-${nextAnnotationId}` }];
  }

  function remove(annotationId: string): void {
    const agentId = options.currentAgentId();
    if (!agentId) return;
    draftsByAgentId[agentId] = (draftsByAgentId[agentId] ?? []).filter((annotation) => annotation.id !== annotationId);
  }

  async function forward(
    prompt: string,
    sendOptions: CodexRendererSendMessageOptions | undefined,
    send: (nextPrompt: string, nextOptions?: CodexRendererSendMessageOptions) => void | Promise<void>,
  ): Promise<void> {
    const agentId = options.currentAgentId();
    const annotations = agentId ? (draftsByAgentId[agentId] ?? []).map((annotation) => ({ ...annotation })) : [];
    if (!agentId || annotations.length === 0) {
      await send(prompt, sendOptions);
      return;
    }
    const content = sendOptions?.content === undefined ? undefined : trimPromptContent(sendOptions.content);
    const label = `${annotations.length} code annotation${annotations.length === 1 ? '' : 's'}`;
    const nextOptions = content === undefined ? sendOptions : { ...sendOptions, content: [...content, { type: 'text' as const, text: `${content.length ? '\n\n' : ''}${label}` }] };
    await send(formatCodeAnnotationPrompt(annotations, prompt), nextOptions);
    const submittedIds = new Set(annotations.map((annotation) => annotation.id));
    draftsByAgentId[agentId] = (draftsByAgentId[agentId] ?? []).filter((annotation) => !submittedIds.has(annotation.id));
  }

  return { activeAnnotations, add, forward, remove };
}

export function formatCodeAnnotationPrompt(annotations: readonly CodeAnnotation[], existingPrompt = ''): string {
  const prompt = existingPrompt.trim();
  const context = [
    'Code annotations:',
    '',
    ...annotations.flatMap((annotation, index) => [
      `${index + 1}. ${describeCodeRange(annotation)}`,
      'Selected code:',
      ...annotation.text.split('\n').map((line) => `> ${line}`.trimEnd()),
      `Comment: ${annotation.comment}`,
      ...(index === annotations.length - 1 ? [] : ['']),
    ]),
  ].join('\n').replace(/<\/context>/gi, '&lt;/context&gt;');
  const visible = [prompt, `${annotations.length} code annotation${annotations.length === 1 ? '' : 's'}`].filter(Boolean).join('\n\n');
  return `<context>\n${context}\n</context>\n${visible}`;
}
