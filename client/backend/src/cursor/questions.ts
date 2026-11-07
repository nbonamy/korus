import type { ClientRequest } from '@workspace/core/contracts';
import type { AgentRequestResponse } from '@workspace/core/agent-request';
import { record } from '../acp/acp-connection';

/** Documented extension contract; native question emission remains unqualified. */
export function cursorQuestion(params: Record<string, unknown>, id: string, sessionId: string, turnId: string) {
  if (typeof params.toolCallId !== 'string' || !Array.isArray(params.questions) || !params.questions.length || params.questions.length > 20) throw new Error('Invalid Cursor question.');
  const questions = params.questions.map(value => {
    if (!record(value) || typeof value.id !== 'string' || !value.id || typeof value.prompt !== 'string' || !Array.isArray(value.options) || !value.options.length || value.options.length > 50 || (value.allowMultiple !== undefined && typeof value.allowMultiple !== 'boolean')) throw new Error('Invalid Cursor question.');
    const options = value.options.map(option => {
      if (!record(option) || typeof option.id !== 'string' || !option.id || typeof option.label !== 'string' || !option.label) throw new Error('Invalid Cursor choice.');
      return { id: option.id, label: option.label };
    });
    if (new Set(options.map(option => option.id)).size !== options.length || new Set(options.map(option => option.label)).size !== options.length) throw new Error('Ambiguous Cursor choices.');
    return { id: value.id, prompt: value.prompt, multiple: value.allowMultiple === true, options };
  });
  if (new Set(questions.map(question => question.id)).size !== questions.length) throw new Error('Duplicate Cursor question identity.');
  const request: ClientRequest = { id, kind: 'ask_user', conversationId: sessionId, turnId, itemId: params.toolCallId, payload: { request: { itemId: params.toolCallId, blocking: true, delivery: 'tool', questions: questions.map(question => ({ id: question.id, header: typeof params.title === 'string' ? params.title : '', question: question.prompt, isOther: false, isSecret: false, multiSelect: question.multiple, options: question.options.map(option => ({ label: option.label, description: '' })) })) } } };
  return { request, answer(response: AgentRequestResponse): unknown {
    if (response.outcome.kind === 'cancelled') return {outcome:{outcome:'cancelled'}};
    if (response.outcome.kind !== 'answered' || Object.keys(response.outcome.answers).length !== questions.length) throw new Error('Answer every Cursor question.');
    const input = response.outcome.answers;
    const answers = questions.map(question => {
      const selected = input[question.id]?.answers;
      if (!selected?.length || (!question.multiple && selected.length !== 1)) throw new Error('Invalid Cursor answer count.');
      const selectedOptionIds = selected.map(value => {
        const matches = question.options.filter(option => option.id === value || option.label === value);
        if (matches.length !== 1) throw new Error('Unknown or ambiguous Cursor choice.');
        return matches[0]!.id;
      });
      if (new Set(selectedOptionIds).size !== selectedOptionIds.length) throw new Error('Duplicate Cursor choices.');
      return {questionId:question.id,selectedOptionIds};
    });
    return {outcome:{outcome:'answered',answers}};
  } };
}
