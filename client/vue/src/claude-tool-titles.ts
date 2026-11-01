import type { CodexToolPresentationContext, CodexToolTitlePresenterContext } from '@codex-app-sdk/vue';
import { messages } from './i18n/messages';

type Translate = CodexToolTitlePresenterContext['translate'];
type Phase = 'completed' | 'failed' | 'running';

const claudeTitles: Record<string, Record<string, unknown> | undefined> = messages.en.chat.tool.claude;

/**
 * Titles for Claude tools the backend describes by `scope` and `operation`
 * instead of by file or command. Unknown pairs return undefined so the SDK
 * falls back to its generic title.
 */
export function presentClaudeToolTitle(
  { descriptor, toolCall }: CodexToolPresentationContext,
  translate: Translate,
): string | undefined {
  const params = descriptor?.params;
  const scope = params?.scope;
  const operation = params?.operation;
  if (descriptor?.source !== 'claude' || typeof scope !== 'string' || typeof operation !== 'string') return undefined;
  if (!claudeTitles[scope]?.[operation]) return undefined;

  const phase: Phase = descriptor.phase === 'failed' || toolCall.state === 'error'
    ? 'failed'
    : descriptor.phase === 'completed' || toolCall.state === 'completed' ? 'completed' : 'running';
  const target = typeof params?.target === 'string' ? params.target : '';
  const completed = params?.completed;
  const total = params?.total;
  const progress = typeof completed === 'number' && typeof total === 'number' ? ` (${completed}/${total} done)` : '';
  return translate(`chat.tool.claude.${scope}.${operation}.${phase}`, { target, progress });
}
