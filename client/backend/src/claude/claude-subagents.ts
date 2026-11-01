import type { BackendEvent } from '@workspace/core/backend-driver';
import type { SubagentStatus } from '@workspace/core/contracts';
import { claudeMessageContentBlocks, parseClaudeSdkMessage, type ClaudeSdkMessage } from './protocol';

type Child = {
  toolId: string;
  parentId: string;
  id?: string;
  name?: string;
  role?: string;
  prompt?: string;
  model?: string;
  status?: SubagentStatus;
};

/** Projects native Agent/Task executions; ordinary background shell tasks are excluded. */
export class ClaudeSubagents {
  private readonly sessions = new Map<string, {
    rootId: string;
    tools: Map<string, Child>;
    children: Map<string, Child>;
  }>();

  constructor(private readonly emit: (event: BackendEvent) => void) {}

  observe(agentId: string, rootId: string, message: ClaudeSdkMessage, occurredAt = new Date().toISOString()): boolean {
    let session = this.sessions.get(agentId);
    if (session?.rootId !== rootId) {
      session = { rootId, tools: new Map(), children: new Map() };
      this.sessions.set(agentId, session);
    }
    const raw = message as Record<string, unknown>;
    const parentTool = typeof raw.parent_tool_use_id === 'string' ? raw.parent_tool_use_id : null;
    const parentId = parentTool ? session.tools.get(parentTool)?.id ?? rootId : rootId;
    const blocks = claudeMessageContentBlocks(message);
    for (const block of blocks) {
      if (block.type !== 'tool_use' || (block.name !== 'Agent' && block.name !== 'Task') || typeof block.id !== 'string') continue;
      const input = record(block.input);
      const child = session.tools.get(block.id) ?? { toolId: block.id, parentId };
      Object.assign(child, {
        name: text(input.description), role: text(input.subagent_type),
        prompt: text(input.prompt), model: text(input.model),
      });
      session.tools.set(block.id, child);
    }

    const taskId = text(raw.task_id);
    if (message.type === 'system' && message.subtype === 'task_started' && taskId) {
      const toolId = text(raw.tool_use_id) ?? taskId;
      let child = session.tools.get(toolId);
      if (!child && !text(raw.subagent_type)) return false;
      child ??= { toolId, parentId, name: text(raw.description), role: text(raw.subagent_type), prompt: text(raw.prompt) };
      session.tools.set(toolId, child);
      this.update(agentId, rootId, child, taskId, 'running', occurredAt);
    } else if (message.type === 'system' && taskId) {
      const child = session.children.get(taskId);
      if (child && message.subtype === 'task_notification') {
        const status = raw.status === 'completed' ? 'completed' : raw.status === 'failed' ? 'errored' : raw.status === 'stopped' ? 'interrupted' : null;
        if (status) this.update(agentId, rootId, child, taskId, status, occurredAt);
      } else if (child?.status === 'running' && message.subtype === 'task_progress') {
        this.emit({ agentId, backend: 'claude', backendSessionId: rootId, conversationId: rootId, occurredAt,
          type: 'subagent.statusChanged', payload: { rootConversationId: rootId, conversationId: taskId, status: 'running' } });
      }
    }

    if (message.type === 'user') {
      const result = record(raw.tool_use_result ?? raw.toolUseResult);
      for (const block of blocks) {
        if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        const child = session.tools.get(block.tool_use_id);
        const id = text(result.agentId) ?? child?.id;
        if (!child || !id) continue;
        child.model = text(result.resolvedModel) ?? child.model;
        const status = block.is_error ? 'errored' : result.status === 'completed' ? 'completed'
          : result.status === 'async_launched' ? 'running' : child.status;
        if (status) this.update(agentId, rootId, child, id, status, occurredAt);
      }
    }
    // Native child tool/text events must not be flattened into the parent's transcript.
    return parentTool !== null;
  }

  release(agentId: string, occurredAt?: string): void {
    const session = this.sessions.get(agentId);
    for (const child of session?.children.values() ?? []) {
      if (child.status === 'running' && child.id) this.update(agentId, session!.rootId, child, child.id, 'interrupted', occurredAt ?? new Date().toISOString());
    }
    this.sessions.delete(agentId);
  }

  private update(agentId: string, rootId: string, child: Child, id: string, status: SubagentStatus, occurredAt: string): void {
    if (child.id === id && child.status === status) return;
    child.id = id;
    child.status = status;
    this.sessions.get(agentId)!.children.set(id, child);
    const running = status === 'running';
    this.emit({ agentId, backend: 'claude', backendSessionId: rootId, conversationId: rootId, occurredAt,
      type: 'subagent.operationChanged', payload: {
        rootConversationId: rootId,
        operation: { id: child.toolId, kind: 'spawnAgent', lifecycle: running ? 'started' : 'completed',
          status: running ? 'inProgress' : status === 'completed' ? 'completed' : status === 'interrupted' ? 'interrupted' : 'failed',
          senderConversationId: child.parentId, receiverConversationIds: [id], occurredAt,
          ...(child.prompt ? { prompt: child.prompt } : {}), ...(child.model ? { model: child.model } : {}),
        },
        agentStates: { [id]: { status } },
      } });
    this.emit({ agentId, backend: 'claude', backendSessionId: rootId, conversationId: rootId, occurredAt,
      type: 'subagent.identityChanged', payload: { rootConversationId: rootId, conversationId: id,
        ...(child.name ? { agentNickname: child.name } : {}), ...(child.role ? { agentRole: child.role } : {}),
      } });
  }
}

export function claudeSubagentHistoryEvents(content: string, agentId: string, rootId: string): BackendEvent[] {
  const events: BackendEvent[] = [];
  const subagents = new ClaudeSubagents(event => events.push(event));
  let lastAt = new Date(0).toISOString();
  for (const line of content.split(/\r?\n/)) {
    const message = parseClaudeSdkMessage(line);
    if (!message || (message as Record<string, unknown>).isSidechain) continue;
    const timestamp = (message as Record<string, unknown>).timestamp;
    if (typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp))) lastAt = new Date(timestamp).toISOString();
    subagents.observe(agentId, rootId, message, lastAt);
  }
  subagents.release(agentId, lastAt);
  return events;
}

function text(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
