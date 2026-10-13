import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentFromInput } from '@workspace/core/agent-manager';
import type { Agent, BackendPublishedEvent, RendererMessage } from '@workspace/core/contracts';
import type { DelegatedTask } from '@workspace/core/delegated-task';
import { DurableTaskService } from '../durable-task-service';

const result = { summary: 'Implemented', evidence: ['Focused tests passed'], artifacts: ['src/change.ts'], caveats: ['No physical device check'] };
const services: DurableTaskService[] = [];
afterEach(() => { for (const service of services.splice(0)) service.close(); });

function fixture(saved: DelegatedTask[] = [], readHistory?: (agent: Agent) => Promise<RendererMessage[]>) {
  const parent = createAgentFromInput({ folder: '/repo', backend: 'codex', name: 'parent' });
  if (saved[0]) parent.id = saved[0].parentAgentId;
  const agents: Agent[] = [parent];
  let disk = structuredClone(saved);
  const save = vi.fn(async (tasks: DelegatedTask[]) => { disk = structuredClone(tasks); });
  const send = vi.fn(async (agent: Agent) => {
    agent.status = { type: 'working' };
    agent.backendSession = { kind: 'codex', threadId: `thread-${agent.id}` };
    const turnId = `turn-${agent.id}`;
    event(agent.id, 'turn.started', turnId);
    return { backendSession: agent.backendSession, turnId };
  });
  const interrupt = vi.fn(async () => undefined);
  const onError = vi.fn();
  const service = new DurableTaskService({ tasks: saved, save, send, interrupt, onError, readHistory, agent: id => agents.find(agent => agent.id === id) });
  services.push(service);
  function event(agentId: string, type: string, turnId?: string, payload: unknown = {}) {
    service.handleEvent({ agentId, type, turnId, payload } as BackendPublishedEvent);
  }
  const provision = vi.fn(async (task: DelegatedTask) => {
    const worker = createAgentFromInput({ folder: '/repo/worker', backend: 'codex', name: 'worker' });
    worker.id = task.workerAgentId;
    agents.push(worker);
    return worker;
  });
  const create = (requestId = 'request-1') => service.create(parent, { requestId, task: { title: 'Fix bug', doneWhen: 'Regression passes' }, prompt: 'Fix the bug', backend: 'codex', specification: { prompt: 'Fix the bug', requestId } }, provision);
  const finish = (task: DelegatedTask, outcome = 'completed', turn = task.acceptance!.turnId) => {
    agents.find(agent => agent.id === task.workerAgentId)!.status = { type: 'idle' };
    event(task.workerAgentId, 'turn.completed', turn, { status: outcome });
  };
  return { parent, agents, service, create, provision, save, send, interrupt, event, finish, onError, disk: () => disk };
}

describe('durable assignment lifecycle', () => {
  it('reserves task and worker identity before provisioning and deduplicates concurrent retries', async () => {
    const f = fixture();
    const [first, retry] = await Promise.all([f.create(), f.create()]);
    expect(first.id).toBe(retry.id);
    expect(first.workerAgentId).toBe(retry.workerAgentId);
    expect(retry.acceptance).toEqual(first.acceptance);
    expect(f.provision).toHaveBeenCalledOnce();
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.disk()[0]!.acceptance?.turnId).toBe(first.acceptance?.turnId);
    await expect(f.service.create(f.parent, { requestId: 'request-1', task: first.assignment, prompt: 'Different', backend: 'codex', specification: { prompt: 'different' } }, f.provision)).rejects.toThrow('different assignment');
    expect(f.provision).toHaveBeenCalledOnce();
  });

  it('does not provision or report success when the assignment cannot be saved', async () => {
    const f = fixture();
    f.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(f.create()).rejects.toThrow('disk full');
    expect(f.service.list(f.parent.id)).toEqual([]);
    expect(f.provision).not.toHaveBeenCalled();
  });

  it('saves the result before acknowledging, then finalizes only its successful submitting turn', async () => {
    const f = fixture();
    const task = await f.create();
    const submitted = await f.service.complete(task.workerAgentId, result);
    expect(submitted.state).toBe('running');
    expect(f.disk()[0]!.submission).toEqual(submitted.submission);
    f.finish(task, 'completed', 'stale-turn');
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(f.service.list(f.parent.id)[0]!.state).toBe('running');
    expect(f.send).toHaveBeenCalledTimes(1);
    f.finish(task);
    await vi.waitFor(() => expect(f.service.list(f.parent.id)[0]!.delivery?.state).toBe('accepted'));
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls[1]![0].id).toBe(f.parent.id);
    expect(f.disk()[0]!.state).toBe('completed');
  });

  it.each(['completed', 'interrupted', 'failed'])('never treats an unsubmitted %s turn as a successful assignment', async outcome => {
    const f = fixture();
    const task = await f.create();
    f.finish(task, outcome);
    await vi.waitFor(() => expect(f.service.list(f.parent.id)[0]!.state).toBe(outcome === 'failed' ? 'failed' : 'interrupted'));
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('retains a failed-turn provisional result without delivering it or allowing replacement', async () => {
    const f = fixture();
    const task = await f.create();
    await f.service.complete(task.workerAgentId, result);
    f.finish(task, 'interrupted');
    await vi.waitFor(() => expect(f.service.list(f.parent.id)[0]!.state).toBe('interrupted'));
    const worker = f.agents[1]!;
    worker.status = { type: 'working' };
    f.event(worker.id, 'turn.started', 'next-turn');
    await expect(f.service.complete(worker.id, result)).rejects.toThrow('already submitted');
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('rejects a result after replacing the worker conversation', async () => {
    const f = fixture();
    const task = await f.create();
    f.agents[1]!.backendSession = { kind: 'codex', threadId: 'replacement' };
    await expect(f.service.complete(task.workerAgentId, result)).rejects.toThrow('conversation changed');
  });

  it('does not acknowledge a result whose save failed', async () => {
    const f = fixture();
    const task = await f.create();
    f.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(f.service.complete(task.workerAgentId, result)).rejects.toThrow('disk full');
    expect(f.service.list(f.parent.id)[0]!.submission).toBeUndefined();
  });

  it('batches results until the busy parent reaches its next successful boundary', async () => {
    const f = fixture();
    f.parent.status = { type: 'working' };
    const tasks = await Promise.all([f.create('one'), f.create('two')]);
    for (const task of tasks) { await f.service.complete(task.workerAgentId, result); f.finish(task); }
    await vi.waitFor(() => expect(f.service.list(f.parent.id).every(task => task.state === 'completed')).toBe(true));
    expect(f.send).toHaveBeenCalledTimes(2);
    f.parent.status = { type: 'idle' };
    f.event(f.parent.id, 'turn.completed', 'parent-turn', { status: 'completed' });
    await vi.waitFor(() => expect(f.service.list(f.parent.id).every(task => task.delivery?.state === 'accepted')).toBe(true));
    expect(f.send).toHaveBeenCalledTimes(3);
    expect(new Set(f.disk().map(task => task.delivery!.id)).size).toBe(1);
  });

  it('reconciles the live interrupted-then-completed parent sequence without overriding an explicit stop', async () => {
    const f = fixture();
    f.parent.status = { type: 'working' };
    const task = await f.create();
    await f.service.complete(task.workerAgentId, result);
    f.finish(task);
    f.event(f.parent.id, 'turn.completed', 'parent-turn', { status: 'interrupted' });
    f.parent.status = { type: 'idle' };
    f.event(f.parent.id, 'turn.completed', 'parent-turn', { status: 'completed' });
    await vi.waitFor(() => expect(f.service.list(f.parent.id)[0]!.delivery?.state).toBe('accepted'));

    const stopped = fixture();
    stopped.parent.status = { type: 'working' };
    const stoppedTask = await stopped.create();
    await stopped.service.complete(stoppedTask.workerAgentId, result);
    stopped.finish(stoppedTask);
    await stopped.service.blockParent(stopped.parent.id);
    stopped.parent.status = { type: 'idle' };
    stopped.event(stopped.parent.id, 'turn.completed', 'parent-turn', { status: 'completed' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(stopped.service.list(stopped.parent.id)[0]!.delivery?.state).toBe('pending');
  });

  it.each(['stopped', 'awaitingInput', 'missing'] as const)('retains results without waking a %s parent', async state => {
    const f = fixture();
    const task = await f.create();
    if (state === 'stopped') await f.service.blockParent(f.parent.id);
    if (state === 'awaitingInput') f.parent.status = { type: 'awaitingInput' };
    if (state === 'missing') f.agents.splice(0, 1);
    await f.service.complete(task.workerAgentId, result);
    f.finish(task);
    await vi.waitFor(() => expect(f.service.list(task.workerAgentId)[0]!.state).toBe('completed'));
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.disk()[0]!.delivery?.state).toBe('pending');
  });

  it('retains a pending result when the parent is removed while saving dispatch intent', async () => {
    const f = fixture();
    const task = await f.create();
    await f.service.complete(task.workerAgentId, result);
    const save = f.save.getMockImplementation()!;
    f.save.mockImplementation(async tasks => {
      await save(tasks);
      if (tasks[0]?.delivery?.state === 'sending') f.agents.splice(0, 1);
    });
    f.finish(task);
    await vi.waitFor(() => expect(f.save.mock.calls.some(([tasks]) => tasks[0]?.delivery?.state === 'sending')).toBe(true));
    await vi.waitFor(() => expect(f.disk()[0]!.delivery?.state).toBe('pending'));
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('cancellation wins over later completion and is re-applied after restart', async () => {
    const f = fixture();
    const task = await f.create();
    await f.service.complete(task.workerAgentId, result);
    await f.service.cancel(f.parent.id, task.id);
    f.finish(task);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(f.disk()[0]!.state).toBe('cancelled');
    const recovered = fixture(f.disk());
    recovered.agents.push(f.agents[1]!);
    await recovered.service.recover();
    expect(recovered.interrupt).toHaveBeenCalledOnce();
    expect(recovered.send).not.toHaveBeenCalled();
    expect(recovered.service.list(f.parent.id)[0]!.submission).toEqual(f.disk()[0]!.submission);
  });

  it('preserves ambiguous startup and delivery without replaying accepted work after restart', async () => {
    const f = fixture();
    const task = await f.create();
    await f.service.complete(task.workerAgentId, result);
    await f.service.blockParent(f.parent.id);
    f.finish(task);
    await vi.waitFor(() => expect(f.disk()[0]!.state).toBe('completed'));
    const saved = f.disk();
    saved[0]!.delivery!.state = 'sending';
    const recovered = fixture(saved);
    await recovered.service.recover();
    expect(recovered.service.list(f.parent.id)[0]!.delivery?.state).toBe('uncertain');
    expect(recovered.service.list(f.parent.id)[0]!.submission).toEqual(saved[0]!.submission);
    await recovered.create();
    expect(recovered.provision).not.toHaveBeenCalled();
    expect(recovered.send).not.toHaveBeenCalled();
  });

  it('wakes bounded waits for actionable input, isolates owners, and does not cancel on timeout', async () => {
    const f = fixture();
    const task = await f.create();
    expect(() => f.service.list('stranger', [task.id])).toThrow('not owned');
    await expect(f.service.cancel('stranger', task.id)).rejects.toThrow('not owned');
    await expect(f.service.complete(f.parent.id, result)).rejects.toThrow();
    expect((await f.service.wait(f.parent.id, { timeoutMs: 5 })).timedOut).toBe(true);
    expect(f.service.list(f.parent.id)[0]!.state).toBe('running');
    const waiting = f.service.wait(f.parent.id, { timeoutMs: 1000 });
    f.event(task.workerAgentId, 'agent.statusChanged', undefined, { type: 'awaitingInput' });
    expect((await waiting).tasks[0]!.state).toBe('needs-input');
  });

  it('reconciles a saved delivery marker from provider history without waking the parent again', async () => {
    const f = fixture();
    const task = await f.create();
    await f.service.complete(task.workerAgentId, result);
    await f.service.blockParent(f.parent.id);
    f.finish(task);
    await vi.waitFor(() => expect(f.disk()[0]!.state).toBe('completed'));
    const saved = f.disk();
    saved[0]!.delivery!.state = 'sending';
    const readHistory = vi.fn(async () => [{ role: 'user', turnId: 'accepted-parent-turn', parts: [{ type: 'text', text: `${product.name} task results (${saved[0]!.delivery!.id}). Delivered result` }] }] as RendererMessage[]);
    const recovered = fixture(saved, readHistory);
    recovered.parent.backendSession = { kind: 'codex', threadId: 'parent-thread' };
    await recovered.service.recover();
    expect(recovered.disk()[0]!.delivery).toEqual({ id: saved[0]!.delivery!.id, state: 'accepted', acceptance: { backendSession: { kind: 'codex', threadId: 'parent-thread' }, turnId: 'accepted-parent-turn' } });
    expect(recovered.send).not.toHaveBeenCalled();
  });

  it('keeps acceptance failures uncertain and never retries their provider side effects', async () => {
    const f = fixture();
    const task = await f.create();
    f.send.mockRejectedValueOnce(new Error('connection lost after send'));
    await f.service.complete(task.workerAgentId, result);
    f.finish(task);
    await vi.waitFor(() => expect(f.disk()[0]!.delivery?.state).toBe('uncertain'));
    f.event(f.parent.id, 'agent.statusChanged', undefined, { type: 'idle' });
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(f.send).toHaveBeenCalledTimes(2);
  });

});
