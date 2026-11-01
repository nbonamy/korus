import path from 'node:path';

export type ClaudeToolSemantics = {
  /** Closest action the conversation SDK already understands, used if the host cannot present the scope. */
  action: 'plan' | 'run';
  scope: string;
  operation: string;
  params: Record<string, unknown>;
  /** Row title for tools whose input names the work, such as subagents. */
  title?: string;
};

const MAX_TARGET_LENGTH = 80;
const REMOTE_OPERATIONS = new Set(['list', 'get', 'create', 'update', 'run']);

/**
 * Names the user-facing intent of Claude tools that have no file or command
 * shape. The host maps `scope` and `operation` to titles; backend code only
 * states what the tool does and which object it acts on.
 */
export function claudeToolSemantics(name: string, input: Record<string, unknown>): ClaudeToolSemantics | null {
  switch (name) {
    case 'TodoWrite':
      return todoSemantics(input);
    case 'TaskCreate':
      return semantics('task', 'create', target(input.subject));
    case 'TaskUpdate':
      return semantics('task', taskUpdateOperation(input.status), target(input.subject) ?? taskId(input.taskId));
    case 'TaskGet':
      return semantics('task', 'get', taskId(input.taskId));
    case 'TaskList':
      return semantics('task', 'list');
    case 'TaskOutput':
      return semantics('background', 'output');
    case 'TaskStop':
      return semantics('background', 'stop');
    case 'Monitor':
      return semantics('background', 'monitor', target(input.description));
    case 'ListMcpResourcesTool':
      return semantics('resources', 'list', target(input.server));
    case 'ReadMcpResourceTool':
      return semantics('resources', 'read', target(input.uri));
    case 'ReadMcpResourceDirTool':
      return semantics('resources', 'browse', target(input.uri));
    case 'RemoteTrigger':
      return semantics('remote', remoteOperation(input.action));
    case 'EnterWorktree':
      return semantics('worktree', 'enter', target(input.name) ?? target(baseName(input.path)));
    case 'ExitWorktree':
      return semantics('worktree', input.action === 'remove' ? 'remove' : 'exit');
    case 'PushNotification':
      return semantics('notification', 'send');
    case 'Agent':
    case 'Task': {
      const description = target(input.description);
      return { ...semantics('agent', 'delegate', description), title: description ?? 'Agent' };
    }
    default:
      return null;
  }
}

function semantics(scope: string, operation: string, targetText?: string): ClaudeToolSemantics {
  return { action: 'run', scope, operation, params: targetText ? { target: targetText } : {} };
}

function todoSemantics(input: Record<string, unknown>): ClaudeToolSemantics {
  const todos = Array.isArray(input.todos) ? input.todos : null;
  return {
    action: 'plan',
    scope: 'todos',
    operation: 'update',
    params: todos
      ? {
          total: todos.length,
          completed: todos.filter((todo) => (todo as { status?: unknown } | null)?.status === 'completed').length,
        }
      : {},
  };
}

function taskUpdateOperation(status: unknown): string {
  if (status === 'completed') return 'complete';
  if (status === 'in_progress') return 'start';
  if (status === 'deleted') return 'delete';
  return 'update';
}

function remoteOperation(action: unknown): string {
  if (typeof action === 'string' && REMOTE_OPERATIONS.has(action)) return action;
  return action === 'create_webhook_trigger' ? 'create' : 'run';
}

function taskId(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? target(`#${value}`) : undefined;
}

function baseName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? path.basename(value.trim()) : undefined;
}

function target(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = value.replace(/\s+/gu, ' ').trim();
  if (!line) return undefined;
  return line.length > MAX_TARGET_LENGTH ? `${line.slice(0, MAX_TARGET_LENGTH - 1).trimEnd()}…` : line;
}
