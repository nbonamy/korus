import { describe, expect, it } from 'vitest';
import { claudeToolSemantics } from '../claude-tool-semantics';

describe('Claude tool semantics', () => {
  it.each([
    ['TodoWrite', { todos: [{ status: 'completed' }, { status: 'pending' }, { status: 'completed' }] }, 'plan', 'todos', 'update', { total: 3, completed: 2 }],
    ['TodoWrite', {}, 'plan', 'todos', 'update', {}],
    ['TaskCreate', { subject: 'Fix login', description: 'long text' }, 'run', 'task', 'create', { target: 'Fix login' }],
    ['TaskCreate', {}, 'run', 'task', 'create', {}],
    ['TaskUpdate', { taskId: '3', status: 'completed' }, 'run', 'task', 'complete', { target: '#3' }],
    ['TaskUpdate', { taskId: '3', status: 'in_progress', subject: 'Fix login' }, 'run', 'task', 'start', { target: 'Fix login' }],
    ['TaskUpdate', { taskId: '3', status: 'deleted' }, 'run', 'task', 'delete', { target: '#3' }],
    ['TaskUpdate', { taskId: '3', owner: 'me' }, 'run', 'task', 'update', { target: '#3' }],
    ['TaskGet', { taskId: '7' }, 'run', 'task', 'get', { target: '#7' }],
    ['TaskList', {}, 'run', 'task', 'list', {}],
    ['TaskOutput', { task_id: 'b1', block: true, timeout: 30 }, 'run', 'background', 'output', {}],
    ['TaskStop', { task_id: 'b1' }, 'run', 'background', 'stop', {}],
    ['Monitor', { description: 'watch the build', command: 'tail -f log' }, 'run', 'background', 'monitor', { target: 'watch the build' }],
    ['ListMcpResourcesTool', { server: 'docs' }, 'run', 'resources', 'list', { target: 'docs' }],
    ['ReadMcpResourceTool', { server: 'docs', uri: 'file://guide.md' }, 'run', 'resources', 'read', { target: 'file://guide.md' }],
    ['ReadMcpResourceDirTool', { server: 'docs', uri: 'file://' }, 'run', 'resources', 'browse', { target: 'file://' }],
    ['RemoteTrigger', { action: 'run', trigger_id: 't' }, 'run', 'remote', 'run', {}],
    ['RemoteTrigger', { action: 'create_webhook_trigger' }, 'run', 'remote', 'create', {}],
    ['RemoteTrigger', { action: 'something-new' }, 'run', 'remote', 'run', {}],
    ['EnterWorktree', { name: 'feature-x' }, 'run', 'worktree', 'enter', { target: 'feature-x' }],
    ['EnterWorktree', { path: '/repo/.worktrees/feature-y' }, 'run', 'worktree', 'enter', { target: 'feature-y' }],
    ['ExitWorktree', { action: 'keep' }, 'run', 'worktree', 'exit', {}],
    ['ExitWorktree', { action: 'remove' }, 'run', 'worktree', 'remove', {}],
    ['PushNotification', { message: 'done', status: 'proactive' }, 'run', 'notification', 'send', {}],
    ['Agent', { description: 'Review auth', prompt: 'p' }, 'run', 'agent', 'delegate', { target: 'Review auth' }],
    ['Task', { description: 'Review auth', prompt: 'p' }, 'run', 'agent', 'delegate', { target: 'Review auth' }],
    ['Agent', { prompt: 'p' }, 'run', 'agent', 'delegate', {}],
  ])('describes %s %j', (name, input, action, scope, operation, params) => {
    expect(claudeToolSemantics(name, input)).toMatchObject({ action, scope, operation, params });
  });

  it('keeps targets on one short line', () => {
    const semantics = claudeToolSemantics('TaskCreate', { subject: `  first line\nsecond ${'x'.repeat(200)}` });
    const target = String(semantics?.params.target);
    expect(target.startsWith('first line second x')).toBe(true);
    expect(target).not.toContain('\n');
    expect(target.length).toBeLessThanOrEqual(80);
    expect(target.endsWith('…')).toBe(true);
  });

  it('uses the subagent description as the row title', () => {
    expect(claudeToolSemantics('Agent', { description: 'Review auth' })?.title).toBe('Review auth');
    expect(claudeToolSemantics('Agent', {})?.title).toBe('Agent');
  });

  it.each(['Bash', 'Read', 'mcp__server__tool', 'SomethingNew'])('ignores tools without a presentation: %s', (name) => {
    expect(claudeToolSemantics(name, {})).toBeNull();
  });
});
