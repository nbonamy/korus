import { product } from '@workspace/core/product';
import { createHash, randomUUID } from 'node:crypto';
import type { Agent, BackendPublishedEvent, RendererMessage } from '@workspace/core/contracts';
import type { DelegatedTask, TaskAcceptance, TaskContract, TaskResultInput, TaskWorkspace, WaitTasksInput, WaitTasksResult } from '@workspace/core/delegated-task';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';
import { handoffInProgress } from '@workspace/core/agent-handoff';
import { taskContractSchema, taskResultSchema } from '../persistence/task-schema';

type CreateTaskInput = { retryFailedProvision?: boolean; requestId: string; task: TaskContract; prompt: string; backend: Agent['backend']; workspace?: TaskWorkspace; specification: unknown };
type TaskPorts = {
  tasks: DelegatedTask[];
  save(tasks: DelegatedTask[]): Promise<void>;
  agent(id: string): Agent | undefined;
  send(agent: Agent, prompt: string): Promise<TaskAcceptance>;
  interrupt(agent: Agent, expectedTurnId: string): Promise<unknown>;
  readHistory?(agent: Agent): Promise<RendererMessage[]>;
  onError(error: unknown): void;
};

const terminal = (task: DelegatedTask) => ['completed', 'cancelled', 'failed'].includes(task.state);
const actionable = (task: DelegatedTask) => terminal(task) || task.state === 'needs-input' || task.state === 'interrupted';
const sessionKey = (session: TaskAcceptance['backendSession'] | undefined) => session?.kind === 'codex' ? `codex:${session.threadId}` : session ? `claude:${session.sessionId}` : '';

/** One owner for durable assignment, result and outbox transitions. Provider history remains provider-owned. */
export class DurableTaskService {
  private tasks: DelegatedTask[];
  private writes: Promise<unknown> = Promise.resolve();
  private readonly turns = new Map<string, string>();
  private readonly latestTurns = new Map<string, string>();
  private readonly stoppedParents = new Set<string>();
  private readonly parentAdmissions = new Map<string, { turnId?: string; stopRequested: boolean }>();
  private readonly listeners = new Set<() => void>();
  private readonly dispatching = new Set<string>();
  private readonly creating = new Map<string, { fingerprint: string; promise: Promise<DelegatedTask> }>();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(private readonly ports: TaskPorts) { this.tasks = structuredClone(ports.tasks); }

  list(caller: string, ids?: string[]): DelegatedTask[] {
    const visible = this.tasks.filter(task => task.parentAgentId === caller || task.workerAgentId === caller);
    if (ids?.some(id => !visible.some(task => task.id === id))) throw new Error('Task not found or not owned by this agent.');
    return structuredClone(ids ? visible.filter(task => ids.includes(task.id)) : visible);
  }

  mayStartAutomatedPrompt(agentId: string): boolean {
    return !this.closed && !this.stoppedParents.has(agentId);
  }

  instructions(worker: string): string | undefined {
    const task = this.tasks.find(task => task.workerAgentId === worker && !terminal(task));
    return task ? `Durable assignment ${task.id}: ${task.assignment.title}\nDone when: ${task.assignment.doneWhen}\nLoad korus-delegation for the result procedure. Finish foreground/background work, submit with complete-task before finish_turn, and make no further mutations. ${product.name} delivers the result after this turn succeeds; no completion message is needed. Completion grants no merge, publication or Mission progression authority.` : undefined;
  }

  create(parent: Agent, input: CreateTaskInput, provision: (task: DelegatedTask) => Promise<Agent>): Promise<DelegatedTask> {
    const key = JSON.stringify([parent.id, input.requestId.trim()]);
    const fingerprint = JSON.stringify(input.specification);
    const existing = this.creating.get(key);
    if (existing) return existing.fingerprint === fingerprint ? existing.promise : Promise.reject(new Error('requestId already belongs to a different assignment.'));
    const promise = this.createTask(parent, input, provision).finally(() => this.creating.delete(key));
    this.creating.set(key, { fingerprint, promise });
    return promise;
  }

  private async createTask(parent: Agent, input: CreateTaskInput, provision: (task: DelegatedTask) => Promise<Agent>): Promise<DelegatedTask> {
    const assignment = taskContractSchema.parse(input.task);
    const requestId = input.requestId.trim();
    const prompt = input.prompt.trim();
    if (!requestId || requestId.length > 200 || !prompt || prompt.length > 100000) throw new Error('Task mode requires a requestId (1–200 characters) and prompt (1–100000 characters).');
    const fingerprint = createHash('sha256').update(JSON.stringify(input.specification)).digest('hex');
    let created = false;
    const task = await this.change(tasks => {
      const existing = tasks.find(task => task.parentAgentId === parent.id && task.requestId === requestId);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) throw new Error('requestId already belongs to a different assignment.');
        if (input.retryFailedProvision && existing.state === 'failed' && !existing.folder && !existing.acceptance && !existing.executionTurnId && !existing.submission) {
          existing.state = 'preparing';
          delete existing.detail;
          created = true;
        }
        return existing;
      }
      created = true;
      const now = new Date().toISOString();
      const next: DelegatedTask = {
        id: `task-${randomUUID()}`, requestId, requestFingerprint: fingerprint,
        parentAgentId: parent.id, workerAgentId: `agent-${randomUUID()}`, backend: input.backend,
        assignment, prompt, attemptId: `attempt-${randomUUID()}`, state: 'preparing',
        ...(input.workspace ? { workspace: input.workspace } : {}),
        createdAt: now, updatedAt: now, parentWakeBlocked: this.stoppedParents.has(parent.id),
        ...(this.stoppedParents.has(parent.id) ? { parentStopRequested: true } : {}),
      };
      tasks.push(next);
      return next;
    });
    if (!created) return task;
    try {
      const worker = await provision(task);
      const ready = await this.change(tasks => {
        const current = tasks.find(item => item.id === task.id)!;
        current.folder = worker.folder ?? undefined;
        if (current.state === 'cancelled') return false;
        current.state = 'running';
        current.detail = 'Provider acceptance pending; do not replay automatically.';
        return true;
      });
      if (!ready) return this.list(parent.id, [task.id])[0]!;
      const receipt = await this.ports.send(worker, `[${product.name} task ${task.id}; attempt ${task.attemptId}]\n${prompt}`);
      await this.change(tasks => {
        const current = tasks.find(item => item.id === task.id)!;
        current.acceptance = receipt;
        if (current.state === 'running') delete current.detail;
      });
      if (this.list(parent.id, [task.id])[0]!.state === 'cancelled' && receipt.turnId) await this.ports.interrupt(worker, receipt.turnId);
    } catch (error) {
      await this.change(tasks => {
        const current = tasks.find(item => item.id === task.id)!;
        if (!terminal(current)) {
          current.state = current.state === 'preparing' ? 'failed' : 'interrupted';
          current.detail = `Startup did not finish: ${error instanceof Error ? error.message : String(error)}. Inspect the worker before starting new work.`;
        }
      });
      throw error;
    }
    return this.list(parent.id, [task.id])[0]!;
  }

  async complete(workerId: string, input: TaskResultInput): Promise<DelegatedTask> {
    const result = taskResultSchema.parse(input);
    const worker = this.ports.agent(workerId);
    const turnId = this.turns.get(workerId);
    if (!worker?.backendSession || !turnId || worker.status.type !== 'working') throw new Error('Result submission requires an identified active worker turn.');
    const backendSession = structuredClone(worker.backendSession);
    return this.change(tasks => {
      const task = tasks.find(task => task.workerAgentId === workerId);
      if (!task || terminal(task)) throw new Error('No active assignment for this worker.');
      if (this.turns.get(workerId) !== turnId) throw new Error('The submitting turn is no longer active.');
      if (task.acceptance && sessionKey(task.acceptance.backendSession) !== sessionKey(backendSession)) throw new Error('Worker conversation changed; the previous assignment cannot be completed here.');
      if (task.submission) {
        const { id: _id, attemptId: _attempt, turnId: submittedTurn, backendSession: _session, ...previous } = task.submission;
        if (submittedTurn === turnId && JSON.stringify(previous) === JSON.stringify(result)) return task;
        throw new Error('A result was already submitted. It cannot be replaced by a follow-up turn.');
      }
      task.submission = { ...result, id: `result-${randomUUID()}`, attemptId: task.attemptId, turnId, backendSession };
      task.state = 'running';
      task.detail = 'Result saved; awaiting successful completion of the submitting turn.';
      return task;
    });
  }

  async cancel(caller: string, id: string): Promise<DelegatedTask> {
    const requested = this.list(caller, [id])[0]!;
    if (!terminal(requested)) this.stopAutomaticPrompts(requested.workerAgentId);
    const task = await this.change(tasks => {
      const task = tasks.find(task => task.id === id)!;
      if (!terminal(task)) {
        task.state = 'cancelled';
        task.detail = 'Cancellation saved. Conversation, workspace and submitted result are retained.';
        for (const child of tasks) if (child.parentAgentId === task.workerAgentId) { child.parentWakeBlocked = true; child.parentStopRequested = true; }
      }
      return task;
    });
    if (task.state === 'cancelled') {
      const worker = this.ports.agent(task.workerAgentId);
      const turnId = task.executionTurnId ?? task.acceptance?.turnId;
      if (worker && turnId && (!task.acceptance || sessionKey(worker.backendSession) === sessionKey(task.acceptance.backendSession))) {
        try { await this.ports.interrupt(worker, turnId); }
        catch (error) {
          await this.change(tasks => { tasks.find(item => item.id === id)!.detail = `Cancellation saved, but provider interruption failed: ${String(error)}`; });
        }
      }
    }
    return this.list(caller, [id])[0]!;
  }

  async wait(caller: string, input: WaitTasksInput = {}): Promise<WaitTasksResult> {
    const timeout = Math.min(30000, Math.max(0, input.timeoutMs ?? 0));
    const read = () => this.list(caller, input.taskIds);
    const ready = () => {
      const tasks = read();
      return tasks.length === 0 || (input.mode === 'all' ? tasks.every(actionable) : tasks.some(actionable));
    };
    if (ready() || timeout === 0) return { tasks: read(), timedOut: false };
    let timedOut = false;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.listeners.delete(check); resolve(); };
      const check = () => { if (ready() || this.closed) done(); };
      const timer = setTimeout(() => { timedOut = true; done(); }, timeout);
      this.listeners.add(check);
      check();
    });
    return { tasks: read(), timedOut };
  }

  /** A stop is durable before invoking the provider so a racing result cannot revive the parent. */
  async blockParent(parentId: string): Promise<void> {
    this.stopAutomaticPrompts(parentId);
    await this.change(tasks => { for (const task of tasks) if (task.parentAgentId === parentId) { task.parentWakeBlocked = true; task.parentStopRequested = true; } });
  }

  private stopAutomaticPrompts(agentId: string): void {
    this.stoppedParents.add(agentId);
    const admission = this.parentAdmissions.get(agentId);
    if (admission) admission.stopRequested = true;
  }

  async recover(): Promise<void> {
    await this.change(tasks => {
      for (const task of tasks) {
        // Startup is not user consent to continue an idle/stopped conversation.
        task.parentWakeBlocked = true;
        task.parentStopRequested = true;
        this.stoppedParents.add(task.parentAgentId);
        if (task.delivery?.state === 'sending') task.delivery.state = 'uncertain';
        if (!terminal(task)) {
          task.state = 'interrupted';
          task.detail = 'Daemon restarted. Provider execution/turn outcome is unconfirmed; inspect the retained worker. Work is never automatically replayed.';
        }
      }
    });
    // Provider-owned user history can prove acceptance, never absence of execution.
    // A missing marker (including truncated/unavailable history) remains uncertain.
    const history = new Map<string, RendererMessage[]>();
    const findAcceptance = async (agentId: string, marker: string): Promise<TaskAcceptance | undefined> => {
      const agent = this.ports.agent(agentId);
      if (!agent?.backendSession || !this.ports.readHistory) return;
      if (!history.has(agentId)) history.set(agentId, await this.ports.readHistory(agent));
      const message = history.get(agentId)!.find(message => message.role === 'user' && message.parts.some(part => part.type === 'text' && part.text.startsWith(marker)));
      return message ? { backendSession: structuredClone(agent.backendSession), ...(message.turnId ? { turnId: message.turnId } : {}) } : undefined;
    };
    for (const task of this.tasks) {
      try {
        const workerReceipt = !task.acceptance ? await findAcceptance(task.workerAgentId, `[${product.name} task ${task.id}; attempt ${task.attemptId}]`) : undefined;
        const parentReceipt = task.delivery?.state === 'uncertain' ? await findAcceptance(task.parentAgentId, `${product.name} task results (${task.delivery.id}).`) : undefined;
        if (workerReceipt || parentReceipt) await this.change(tasks => {
          const current = tasks.find(item => item.id === task.id)!;
          if (workerReceipt) current.acceptance = workerReceipt;
          if (parentReceipt) current.delivery = { ...current.delivery!, state: 'accepted', acceptance: parentReceipt };
        });
      } catch (error) { this.ports.onError(error); }
    }
    // Cancellation is sticky, including a crash between the saved decision and interruption.
    for (const task of this.tasks.filter(task => task.state === 'cancelled')) await this.cancel(task.parentAgentId, task.id);
  }

  handleEvent(event: BackendPublishedEvent): void {
    if (event.type === 'snapshot.updated') {
      void this.change(tasks => {
        for (const task of tasks) if (!terminal(task) && task.state !== 'preparing' && !this.ports.agent(task.workerAgentId)) {
          task.state = 'interrupted';
          task.detail = 'Worker was removed. Assignment and any provisional result are retained.';
        }
      }).catch(this.ports.onError);
      return;
    }
    const view = providerConversationEventView(event);
    if (!event.agentId) return;
    const agentId = event.agentId;
    const latestTurn = this.latestTurns.get(agentId);
    const olderCompletion = view.type === 'turn.completed' && latestTurn !== undefined && view.turnId !== latestTurn;
    let preserveStop = false;
    if (view.type === 'turn.started' && view.turnId) {
      const admission = this.parentAdmissions.get(agentId);
      if (admission && (!admission.turnId || admission.turnId === view.turnId)) {
        admission.turnId = view.turnId;
        preserveStop = admission.stopRequested;
      } else {
        this.parentAdmissions.delete(agentId);
      }
      this.turns.set(agentId, view.turnId);
      this.latestTurns.set(agentId, view.turnId);
      if (!preserveStop) this.stoppedParents.delete(agentId);
    }
    if (view.type === 'turn.completed' && this.turns.get(agentId) === view.turnId) this.turns.delete(agentId);
    if (!['turn.started', 'turn.completed', 'agent.statusChanged', 'agent.closed'].includes(view.type)) return;
    void this.change(tasks => {
      const payload = view.payload as { status?: string; turn?: { status?: string }; type?: string };
      const outcome = payload.status ?? payload.turn?.status;
      for (const task of tasks) {
        if (task.parentAgentId === agentId && !olderCompletion) {
          if (view.type === 'turn.started' && !preserveStop) { task.parentWakeBlocked = false; task.parentStopRequested = false; }
          if (view.type === 'turn.completed' && outcome === 'completed' && !task.parentStopRequested) task.parentWakeBlocked = false;
          if (view.type === 'turn.completed' && outcome !== 'completed') task.parentWakeBlocked = true;
        }
        if (task.workerAgentId !== agentId || terminal(task)) continue;
        // Readiness can release a newer turn before the submitting turn's outcome arrives.
        // Only that saved submission may settle from an older completion.
        if (olderCompletion && task.submission?.turnId !== view.turnId) continue;
        if (view.type === 'agent.statusChanged' && payload.type === 'awaitingInput') task.state = 'needs-input';
        if (view.type === 'agent.statusChanged' && payload.type === 'working' && this.turns.has(agentId)) task.state = 'running';
        if (view.type === 'agent.statusChanged' && payload.type === 'error') {
          task.state = 'interrupted';
          task.detail = 'Worker provider reported an error; inspect its conversation before continuing.';
        }
        if (view.type === 'turn.started') { task.state = 'running'; task.executionTurnId = view.turnId; }
        if (view.type === 'turn.completed') {
          const worker = this.ports.agent(agentId);
          const result = task.submission;
          if (result && result.turnId === view.turnId && result.attemptId === task.attemptId && sessionKey(result.backendSession) === sessionKey(worker?.backendSession)) {
            if (outcome === 'completed') {
              task.state = 'completed';
              task.delivery = { id: `delivery-${randomUUID()}`, state: 'pending' };
              delete task.detail;
            } else {
              task.state = outcome === 'interrupted' ? 'interrupted' : 'failed';
              task.detail = 'The submitting turn did not succeed. The provisional result is retained.';
            }
          } else if (!result || result.turnId === view.turnId) {
            task.state = outcome === 'failed' ? 'failed' : 'interrupted';
            task.detail = 'Turn ended without a valid explicit result. This is not task completion.';
          }
        }
      }
    }).then(() => this.scheduleDispatch()).catch(this.ports.onError);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    for (const listener of this.listeners) listener();
  }

  private scheduleDispatch(): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const parent of new Set(this.tasks.filter(task => task.delivery?.state === 'pending').map(task => task.parentAgentId))) {
        void this.dispatch(parent).catch(this.ports.onError);
      }
    }, 25);
    this.timer.unref?.();
  }

  private async dispatch(parentId: string): Promise<void> {
    if (this.dispatching.has(parentId) || !this.mayStartAutomatedPrompt(parentId)) return;
    const parent = this.ports.agent(parentId);
    if (!parent || parent.status.type !== 'idle' || handoffInProgress(parent) || parent.planReview?.status === 'pending') return;
    this.dispatching.add(parentId);
    try {
      const batch = await this.change(tasks => {
        const pending = tasks.filter(task => task.parentAgentId === parentId && !task.parentWakeBlocked && task.delivery?.state === 'pending').slice(0, 20);
        const deliveryId = `delivery-${randomUUID()}`;
        for (const task of pending) task.delivery = { id: deliveryId, state: 'sending' };
        return pending;
      });
      if (!batch.length) return;
      // Recheck after disk I/O; a user prompt or approval may have arrived meanwhile.
      const currentParent = this.ports.agent(parentId);
      if (!currentParent || !this.mayStartAutomatedPrompt(parentId) || currentParent.status.type !== 'idle' || handoffInProgress(currentParent) || currentParent.planReview?.status === 'pending' || batch.some(task => this.tasks.find(item => item.id === task.id)?.parentWakeBlocked)) {
        await this.change(tasks => { for (const task of tasks) if (batch.some(item => item.id === task.id)) task.delivery!.state = 'pending'; });
        return;
      }
      // Retain the automatic turn identity until a different turn starts: its
      // delayed or repeated start event is not consent to clear a user's Stop.
      const admission: { turnId?: string; stopRequested: boolean } = { stopRequested: false };
      this.parentAdmissions.set(parentId, admission);
      let receipt: TaskAcceptance | undefined;
      try {
        receipt = await this.ports.send(currentParent, `${product.name} task results (${batch[0]!.delivery!.id}). These are saved task outcomes, not new assignments. No acknowledgment to workers is needed. Review results and continue only within the user's authorization. Completion does not approve merge, publication, or Mission progression.\n${JSON.stringify(batch.map(task => ({ taskId: task.id, title: task.assignment.title, workerAgentId: task.workerAgentId, result: task.submission })))}`);
        admission.turnId ??= receipt.turnId;
        await this.change(tasks => {
          for (const task of tasks) if (batch.some(item => item.id === task.id)) task.delivery = { ...task.delivery!, state: 'accepted', acceptance: receipt };
        });
      } catch (error) {
        await this.change(tasks => {
          for (const task of tasks) if (batch.some(item => item.id === task.id)) {
            task.delivery!.state = 'uncertain';
            task.detail = `Parent acceptance unconfirmed. Result retained; use wait-tasks to recover. ${String(error)}`;
          }
        });
      }
      if (receipt && admission.stopRequested && admission.turnId) {
        // The first Stop may have preceded provider turn identity. The driver's
        // expected-turn guard prevents this retry from interrupting newer work.
        try { await this.ports.interrupt(currentParent, admission.turnId); }
        catch (error) { this.ports.onError(error); }
      }
    } finally { this.dispatching.delete(parentId); }
  }

  private change<T>(update: (tasks: DelegatedTask[]) => T): Promise<T> {
    const operation = this.writes.then(async () => {
      const next = structuredClone(this.tasks);
      const result = update(next);
      if (JSON.stringify(next) !== JSON.stringify(this.tasks)) {
        for (const task of next) if (JSON.stringify(task) !== JSON.stringify(this.tasks.find(item => item.id === task.id))) task.updatedAt = new Date().toISOString();
        await this.ports.save(next);
        this.tasks = next;
        for (const listener of this.listeners) listener();
      }
      return structuredClone(result);
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }
}
