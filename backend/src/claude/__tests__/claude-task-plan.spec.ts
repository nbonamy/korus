import { describe, expect, it } from 'vitest';
import type { RendererToolPart } from '@workspace/core/contracts';
import { ClaudeTaskPlan } from '../claude-task-plan';

let sequence = 0;
const tool = (title: string, input: unknown = {}): RendererToolPart => ({ type: 'tool', id: `tool-${++sequence}`, kind: 'generic', title, status: 'completed', input });
const create = (plan: ClaudeTaskPlan, turnId: string, id: string, subject: string) =>
  plan.apply(tool('TaskCreate', { subject }), { task: { id, subject } }, 'thread', turnId, '2026-10-25T00:00:00.000Z');
const complete = (plan: ClaudeTaskPlan, turnId: string, id: string) =>
  plan.apply(tool('TaskUpdate', { taskId: id, status: 'completed' }), { success: true, taskId: id, statusChange: { to: 'completed' } }, 'thread', turnId, '2026-10-25T00:00:01.000Z');
const steps = (plan: ClaudeTaskPlan) => plan.plan?.steps.map(step => `${step.status}:${step.step}`);

describe('ClaudeTaskPlan', () => {
  it('drops a plan finished in an earlier turn so the next plan starts empty', () => {
    const plan = new ClaudeTaskPlan();
    create(plan, 'turn-1', '1', 'Draft');
    create(plan, 'turn-1', '2', 'Ship');
    complete(plan, 'turn-1', '1');
    complete(plan, 'turn-1', '2');
    expect(plan.plan?.status).toBe('completed');

    expect(plan.startTurn('turn-2')).toStrictEqual({ plan: null });
    expect(plan.plan).toBeNull();

    create(plan, 'turn-2', '3', 'Remove MCP');
    expect(steps(plan)).toStrictEqual(['pending:Remove MCP']);
    expect(plan.plan?.turnId).toBe('turn-2');
  });

  it('keeps an unfinished plan across turns', () => {
    const plan = new ClaudeTaskPlan();
    create(plan, 'turn-1', '1', 'Draft');
    create(plan, 'turn-1', '2', 'Ship');
    complete(plan, 'turn-1', '1');
    expect(plan.startTurn('turn-2')).toMatchObject({ plan: { turnId: 'turn-2', status: 'inProgress' } });
    expect(steps(plan)).toStrictEqual(['completed:Draft', 'pending:Ship']);
  });

  it('keeps ignoring retired tasks when Claude lists its whole task list again', () => {
    const plan = new ClaudeTaskPlan();
    create(plan, 'turn-1', '1', 'Draft');
    complete(plan, 'turn-1', '1');
    plan.startTurn('turn-2');
    create(plan, 'turn-2', '2', 'Build');
    plan.apply(tool('TaskList'), { tasks: [
      { id: '1', subject: 'Draft', status: 'completed' },
      { id: '2', subject: 'Build', status: 'in_progress' },
    ] }, 'thread', 'turn-2', '2026-10-25T00:00:02.000Z');
    expect(steps(plan)).toStrictEqual(['inProgress:Build']);
    plan.apply(tool('TaskGet', { taskId: '1' }), { task: { id: '1', subject: 'Draft', status: 'completed' } }, 'thread', 'turn-2', '2026-10-25T00:00:03.000Z');
    expect(steps(plan)).toStrictEqual(['inProgress:Build']);
  });

  it('lets TodoWrite reuse the index ids of a retired plan', () => {
    const plan = new ClaudeTaskPlan();
    const todos = (status: string) => ({ todos: [{ content: 'One', status, activeForm: 'Doing one' }] });
    plan.apply(tool('TodoWrite', todos('completed')), { newTodos: todos('completed').todos }, 'thread', 'turn-1', '2026-10-25T00:00:00.000Z');
    plan.startTurn('turn-2');
    plan.apply(tool('TodoWrite', todos('pending')), { newTodos: todos('pending').todos }, 'thread', 'turn-2', '2026-10-25T00:00:01.000Z');
    expect(steps(plan)).toStrictEqual(['pending:One']);
  });

  it('lets a finished task stay for one more turn, then drops it while open work remains', () => {
    const plan = new ClaudeTaskPlan();
    create(plan, 'turn-1', '1', 'Draft');
    create(plan, 'turn-1', '2', 'Build');
    create(plan, 'turn-1', '3', 'Ship');
    complete(plan, 'turn-1', '1');
    plan.startTurn('turn-2');
    expect(steps(plan)).toStrictEqual(['completed:Draft', 'pending:Build', 'pending:Ship']);
    complete(plan, 'turn-2', '2');
    expect(plan.startTurn('turn-3')).toMatchObject({ plan: { turnId: 'turn-3' } });
    expect(steps(plan)).toStrictEqual(['completed:Build', 'pending:Ship']);
    expect(plan.startTurn('turn-4')).toMatchObject({ plan: { turnId: 'turn-4' } });
    expect(steps(plan)).toStrictEqual(['pending:Ship']);
  });

  it('does not bring dropped tasks back when Claude lists its tasks or when a new task is added', () => {
    const plan = new ClaudeTaskPlan();
    create(plan, 'turn-1', '1', 'Old work');
    create(plan, 'turn-1', '2', 'Current work');
    complete(plan, 'turn-1', '1');
    plan.startTurn('turn-2');
    plan.startTurn('turn-3');
    expect(steps(plan)).toStrictEqual(['pending:Current work']);
    plan.apply(tool('TaskList'), { tasks: [
      { id: '1', subject: 'Old work', status: 'completed' },
      { id: '2', subject: 'Current work', status: 'in_progress' },
    ] }, 'thread', 'turn-3', '2026-10-25T00:00:02.000Z');
    create(plan, 'turn-3', '3', 'Next');
    expect(steps(plan)).toStrictEqual(['inProgress:Current work', 'pending:Next']);
  });

  it('keeps a task completed in the previous turn when Claude lists its tasks again', () => {
    const plan = new ClaudeTaskPlan();
    create(plan, 'turn-1', '1', 'Draft');
    create(plan, 'turn-1', '2', 'Ship');
    plan.startTurn('turn-2');
    complete(plan, 'turn-2', '1');
    plan.startTurn('turn-3');
    plan.apply(tool('TaskList'), { tasks: [{ id: '1', subject: 'Draft', status: 'completed' }, { id: '2', subject: 'Ship', status: 'pending' }] }, 'thread', 'turn-3', '2026-10-25T00:00:03.000Z');
    expect(steps(plan)).toStrictEqual(['completed:Draft', 'pending:Ship']);
    plan.startTurn('turn-4');
    expect(steps(plan)).toStrictEqual(['pending:Ship']);
  });
});
