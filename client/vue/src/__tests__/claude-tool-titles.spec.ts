import { describe, expect, it } from 'vitest';
import type { CodexToolPresentationContext } from '@codex-app-sdk/vue';
import { presentClaudeToolTitle } from '../claude-tool-titles';
import { messages } from '../i18n/messages';
import { presentAppTool } from '../tool-presentation';

type Phase = 'running' | 'completed' | 'failed';

describe('Claude tool titles', () => {
  it.each([
    ['todos', 'update', { total: 5, completed: 2 }, 'running', 'Updating todo list'],
    ['todos', 'update', { total: 5, completed: 2 }, 'completed', 'Updated todo list (2/5 done)'],
    ['todos', 'update', {}, 'completed', 'Updated todo list'],
    ['todos', 'update', { total: 5, completed: 2 }, 'failed', 'Could not update todo list'],
    ['task', 'create', { target: 'Fix login' }, 'completed', 'Created task Fix login'],
    ['task', 'create', {}, 'running', 'Creating task'],
    ['task', 'complete', { target: '#3' }, 'completed', 'Completed task #3'],
    ['task', 'start', { target: '#3' }, 'running', 'Starting task #3'],
    ['task', 'update', { target: '#3' }, 'completed', 'Updated task #3'],
    ['task', 'delete', { target: '#3' }, 'completed', 'Deleted task #3'],
    ['task', 'get', { target: '#3' }, 'completed', 'Read task #3'],
    ['task', 'list', {}, 'completed', 'Listed tasks'],
    ['background', 'output', {}, 'completed', 'Read background task output'],
    ['background', 'stop', {}, 'completed', 'Stopped background task'],
    ['background', 'monitor', { target: 'the build' }, 'running', 'Monitoring the build'],
    ['resources', 'list', { target: 'docs' }, 'completed', 'Listed MCP resources docs'],
    ['resources', 'read', { target: 'file://guide.md' }, 'completed', 'Read MCP resource file://guide.md'],
    ['resources', 'browse', {}, 'running', 'Browsing MCP resources'],
    ['remote', 'run', {}, 'running', 'Running remote trigger'],
    ['remote', 'list', {}, 'completed', 'Listed remote triggers'],
    ['worktree', 'enter', { target: 'feature-x' }, 'completed', 'Entered worktree feature-x'],
    ['worktree', 'exit', {}, 'completed', 'Left worktree'],
    ['worktree', 'remove', {}, 'completed', 'Removed worktree'],
    ['notification', 'send', {}, 'completed', 'Sent notification'],
    ['agent', 'delegate', { target: 'Review auth' }, 'running', 'Running subagent Review auth'],
    ['agent', 'delegate', { target: 'Review auth' }, 'completed', 'Ran subagent Review auth'],
    ['agent', 'delegate', { target: 'Review auth' }, 'failed', 'Subagent failed: Review auth'],
  ] as const)('titles %s %s (%j) while %s', (scope, operation, params, phase, title) => {
    expect(presentClaudeToolTitle(call(scope, operation, params, phase), translate)).toBe(title);
  });

  it('follows the tool state when the descriptor still says running', () => {
    const running = call('task', 'list', {}, 'running');
    expect(presentClaudeToolTitle({ ...running, toolCall: { ...running.toolCall, state: 'error' } }, translate)).toBe('Could not list tasks');
    expect(presentClaudeToolTitle({ ...running, toolCall: { ...running.toolCall, state: 'completed' } }, translate)).toBe('Listed tasks');
  });

  it('leaves unknown scopes, other sources and other actions to the SDK', () => {
    expect(presentClaudeToolTitle(call('future', 'thing', {}, 'completed'), translate)).toBeUndefined();
    expect(presentClaudeToolTitle(call('task', 'future', {}, 'completed'), translate)).toBeUndefined();
    expect(presentClaudeToolTitle({ ...call('task', 'list', {}, 'completed'), descriptor: { source: 'codex', action: 'run', phase: 'completed', params: { scope: 'task', operation: 'list' } } }, translate)).toBeUndefined();
    expect(presentClaudeToolTitle({ ...call('task', 'list', {}, 'completed'), descriptor: undefined }, translate)).toBeUndefined();
  });

  it('is applied by the app tool presentation', () => {
    expect(presentAppTool(call('task', 'list', {}, 'completed'), translate)?.title).toBe('Listed tasks');
  });

  it('has a title for every phase of every scope it knows', () => {
    for (const [scope, operations] of Object.entries(messages.en.chat.tool.claude)) {
      for (const [operation, phases] of Object.entries(operations)) {
        expect(Object.keys(phases).sort(), `${scope}.${operation}`).toStrictEqual(['completed', 'failed', 'running']);
      }
    }
  });
});

function call(scope: string, operation: string, params: Record<string, unknown>, phase: Phase): CodexToolPresentationContext {
  return {
    descriptor: { source: 'claude', action: 'run', phase, params: { scope, operation, ...params } },
    kind: 'generic',
    toolCall: {
      args: {},
      done: phase !== 'running',
      function: 'TaskList',
      id: 'tool-1',
      kind: 'generic',
      result: undefined,
      state: phase === 'running' ? 'running' : phase === 'failed' ? 'error' : 'completed',
    },
  };
}

function translate(key: string, params?: Record<string, unknown>): string {
  const value = key.split('.').reduce<unknown>((current, segment) => (
    typeof current === 'object' && current !== null
      ? (current as Record<string, unknown>)[segment]
      : undefined
  ), messages.en);
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? '')).replace(/\s+/g, ' ').trim();
}
