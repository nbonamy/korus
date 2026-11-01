import type { RendererToolPart, ThreadPlan, ThreadPlanStepStatus } from '@workspace/core/contracts';

/** `doneIn` is the turn ordinal in which the task was first seen completed. */
type Task = { subject: string; status: ThreadPlanStepStatus; activeForm?: string; doneIn?: number };

/** A session-scoped projection of confirmed native task results, shared by live and history reads. */
export class ClaudeTaskPlan {
  private tasks = new Map<string, Task>();
  /** Finished tasks that were dropped. Claude's own list keeps them, so listing it again must not bring them back. */
  private retired = new Set<string>();
  private turnCount = 0;
  plan: ThreadPlan | null = null;

  /**
   * An unfinished plan follows the new turn, but a task finished more than one turn ago no longer belongs on it.
   * A plan that was already finished when the turn began is no longer shown, so it is deleted and the next task
   * starts a fresh one. Returns the plan state to publish, or null when nothing changed.
   */
  startTurn(turnId: string): { plan: ThreadPlan | null } | null {
    this.turnCount += 1;
    if (this.plan?.status === 'inProgress') {
      for (const [id, task] of this.tasks) {
        if (task.status === 'completed' && task.doneIn !== undefined && task.doneIn < this.turnCount - 1) this.retire(id);
      }
      this.plan = { ...this.plan, turnId, steps: this.steps() };
      return { plan: this.plan };
    }
    if (this.plan?.status !== 'completed') return null;
    for (const id of this.tasks.keys()) this.retired.add(id);
    this.tasks.clear();
    this.plan = null;
    return { plan: null };
  }

  private retire(id: string): void {
    this.tasks.delete(id);
    this.retired.add(id);
  }

  private steps(): ThreadPlan['steps'] {
    return [...this.tasks.values()].map(value => ({
      step: value.status === 'inProgress' ? value.activeForm ?? value.subject : value.subject,
      status: value.status,
    }));
  }

  private withKnownActiveForm(entry: [string, Task]): [string, Task] {
    const previous = this.tasks.get(entry[0]);
    entry[1].activeForm ??= previous?.subject === entry[1].subject ? previous.activeForm : undefined;
    if (entry[1].status === 'completed' && previous?.status === 'completed') entry[1].doneIn = previous.doneIn;
    return entry;
  }

  private isRetired([id, task]: [string, Task]): boolean {
    return task.status === 'completed' && this.retired.has(id);
  }

  apply(tool: RendererToolPart, result: unknown, threadId: string, turnId: string, updatedAt: string): boolean {
    if (tool.status !== 'completed') return false;
    const input = record(tool.input);
    const output = record(result);
    switch (tool.title) {
      case 'TodoWrite': {
        const todos = output.newTodos ?? input.todos;
        if (!Array.isArray(todos)) return false;
        const tasks = todos.map((value, index) => task({ ...record(value), id: String(index), subject: record(value).content }));
        if (tasks.some(value => !value)) return false;
        this.tasks = new Map((tasks as [string, Task][]).map(entry => this.withKnownActiveForm(entry)));
        this.retired.clear();
        break;
      }
      case 'TaskCreate': {
        const created = task({ ...record(output.task), status: 'pending', activeForm: input.activeForm ?? input.active_form });
        if (!created) return false;
        this.retired.delete(created[0]);
        this.tasks.set(...created);
        break;
      }
      case 'TaskUpdate': {
        if (output.success !== true) return false;
        const id = text(output.taskId) ?? text(input.taskId ?? input.task_id ?? input.id);
        if (!id) return false;
        const status = record(output.statusChange).to ?? input.status;
        if (status === 'deleted') this.tasks.delete(id);
        else {
          const existing = this.tasks.get(id);
          if (!existing) return false;
          this.tasks.set(id, { ...existing,
            subject: text(input.subject) ?? existing.subject,
            status: taskStatus(status) ?? existing.status,
            activeForm: text(input.activeForm ?? input.active_form) ?? existing.activeForm,
          });
        }
        break;
      }
      case 'TaskGet': {
        const found = task(output.task);
        if (found && this.isRetired(found)) return false;
        if (found) this.tasks.set(...this.withKnownActiveForm(found));
        else if (output.task === null && text(input.taskId)) this.tasks.delete(input.taskId as string);
        else return false;
        break;
      }
      case 'TaskList': {
        if (!Array.isArray(output.tasks)) return false;
        const tasks = output.tasks.map(task);
        if (tasks.some(value => !value)) return false;
        this.tasks = new Map((tasks as [string, Task][]).filter(entry => !this.isRetired(entry)).map(entry => this.withKnownActiveForm(entry)));
        break;
      }
      default: return false;
    }
    for (const value of this.tasks.values()) {
      if (value.status !== 'completed') delete value.doneIn;
      else value.doneIn ??= this.turnCount;
    }
    const steps = this.steps();
    this.plan = steps.length ? { threadId, turnId, kind: 'execution',
      status: steps.every(step => step.status === 'completed') ? 'completed' : 'inProgress',
      explanation: '', markdown: '', steps, updatedAt } : null;
    return true;
  }
}

function task(value: unknown): [string, Task] | null {
  const raw = record(value);
  const id = text(raw.id);
  const subject = text(raw.subject);
  const status = taskStatus(raw.status);
  return id && subject && status ? [id, { subject, status, activeForm: text(raw.activeForm) }] : null;
}

function taskStatus(value: unknown): ThreadPlanStepStatus | undefined {
  return value === 'in_progress' ? 'inProgress' : value === 'pending' || value === 'completed' ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
