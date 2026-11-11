import { describeCodeRange, type CodeRange, type CodeAnnotationInput } from '@korus-dev/agent-ui-sdk';
export { describeCodeRange, type CodeRange, type CodeAnnotationInput } from '@korus-dev/agent-ui-sdk';
import { conversationAnnotationDrafts } from './conversation-annotation-drafts';
import { trimPromptContent } from '@korus-dev/multi-agent-sdk/prompt';
import type { ReferenceSendPromptOptions } from '@korus-dev/multi-agent-sdk';
import { computed, reactive } from 'vue';

/** Where the code is: a file and a run of lines, with the lines of a diff numbered on the side the person pointed at. */




export type CodeAnnotation = CodeAnnotationInput & { id: string };



/** Drafts of comments on code in the side panels, kept per agent until the next message carries them. */
export function useCodeAnnotations(options: { currentAgentId: () => string | undefined }) {
  const draftState = conversationAnnotationDrafts('code', () => ({ drafts: reactive<Record<string, CodeAnnotation[]>>({}), nextId: 0 }));
  const draftsByAgentId = draftState.drafts;

  const activeAnnotations = computed<readonly CodeAnnotation[]>(() => {
    const agentId = options.currentAgentId();
    return agentId ? draftsByAgentId[agentId] ?? [] : [];
  });

  function add(input: CodeAnnotationInput): void {
    const agentId = options.currentAgentId();
    const text = input.text.replace(/\s+$/u, '');
    const comment = input.comment.trim();
    if (!agentId || !text.trim() || !comment) return;
    draftState.nextId += 1;
    draftsByAgentId[agentId] = [...(draftsByAgentId[agentId] ?? []), { ...input, text, comment, id: `code-annotation-${draftState.nextId}` }];
  }

  function remove(annotationId: string): void {
    const agentId = options.currentAgentId();
    if (!agentId) return;
    draftsByAgentId[agentId] = (draftsByAgentId[agentId] ?? []).filter((annotation) => annotation.id !== annotationId);
  }

  async function forward(
    prompt: string,
    sendOptions: ReferenceSendPromptOptions | undefined,
    send: (nextPrompt: string, nextOptions?: ReferenceSendPromptOptions) => void | Promise<void>,
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
