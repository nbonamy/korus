import { trimPromptContent } from '@codex-app-sdk/core/surface';
import type { CodexRendererSendMessageOptions } from '@codex-app-sdk/vue';
import { computed, reactive } from 'vue';

export type VisualizationAnnotationElement = {
  id: string;
  type: string;
  text?: string;
};

export type VisualizationAnnotationInput = {
  visualizationId: string;
  title: string;
  revision: number;
  comment: string;
  elements: readonly VisualizationAnnotationElement[];
};

export type VisualizationAnnotation = VisualizationAnnotationInput & {
  id: string;
};

export function useVisualizationAnnotations(options: {
  currentAgentId: () => string | undefined;
}) {
  const draftsByAgentId = reactive<Record<string, VisualizationAnnotation[]>>({});
  let nextAnnotationId = 0;

  const activeAnnotations = computed<readonly VisualizationAnnotation[]>(() => {
    const agentId = options.currentAgentId();
    return agentId ? draftsByAgentId[agentId] ?? [] : [];
  });

  function add(input: VisualizationAnnotationInput): void {
    const agentId = options.currentAgentId();
    if (!agentId || input.elements.length === 0) return;
    nextAnnotationId += 1;
    const annotation: VisualizationAnnotation = {
      ...input,
      elements: input.elements.map(element => ({ ...element })),
      id: `visualization-annotation-${nextAnnotationId}`,
    };
    draftsByAgentId[agentId] = [...(draftsByAgentId[agentId] ?? []), annotation];
  }

  function remove(annotationId: string): void {
    const agentId = options.currentAgentId();
    if (!agentId) return;
    draftsByAgentId[agentId] = (draftsByAgentId[agentId] ?? [])
      .filter(annotation => annotation.id !== annotationId);
  }

  async function forward(
    prompt: string,
    sendOptions: CodexRendererSendMessageOptions | undefined,
    send: (nextPrompt: string, nextOptions?: CodexRendererSendMessageOptions) => void | Promise<void>,
  ): Promise<void> {
    const agentId = options.currentAgentId();
    const annotations = agentId
      ? (draftsByAgentId[agentId] ?? []).map(annotation => ({
          ...annotation,
          elements: annotation.elements.map(element => ({ ...element })),
        }))
      : [];
    if (!agentId || annotations.length === 0) {
      await send(prompt, sendOptions);
      return;
    }

    const content = sendOptions?.content === undefined ? undefined : trimPromptContent(sendOptions.content);
    const nextOptions = content === undefined ? sendOptions : { ...sendOptions, content: [...content, { type: 'text' as const, text: `${content.length ? '\n\n' : ''}${annotations.length} diagram annotation${annotations.length === 1 ? '' : 's'}` }] };
    await send(formatVisualizationAnnotationPrompt(annotations, prompt), nextOptions);
    const submittedIds = new Set(annotations.map(annotation => annotation.id));
    draftsByAgentId[agentId] = (draftsByAgentId[agentId] ?? [])
      .filter(annotation => !submittedIds.has(annotation.id));
  }

  return { activeAnnotations, add, forward, remove };
}

export function formatVisualizationAnnotationPrompt(
  annotations: readonly VisualizationAnnotation[],
  existingPrompt = '',
): string {
  const prompt = existingPrompt.trim();
  const annotationContext = [
    'Visualization annotations:',
    '',
    ...annotations.flatMap((annotation, index) => [
      `${index + 1}. ${annotation.title}`,
      `Visualization ID: ${annotation.visualizationId}`,
      `Canvas revision when attached: ${annotation.revision}`,
      `Request: ${annotation.comment}`,
      'Selected elements:',
      ...annotation.elements.map(element => `- ${element.id} (${element.type})${element.text ? `: ${element.text}` : ''}`),
      ...(index === annotations.length - 1 ? [] : ['']),
    ]),
    '',
    'Read the referenced canvas elements by their stable IDs before editing. Preserve every unreferenced element and user edit.',
  ].join('\n').replace(/<\/context>/giu, '&lt;/context&gt;');
  const visiblePrompt = [
    prompt,
    `${annotations.length} diagram annotation${annotations.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join('\n\n');
  return `<context>\n${annotationContext}\n</context>\n${visiblePrompt}`;
}
