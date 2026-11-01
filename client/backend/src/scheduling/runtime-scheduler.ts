export type RuntimeScheduledTask = {
  id: string;
  intervalMs: number;
  run: () => Promise<void>;
  runOnStart?: boolean;
};

export type RuntimeSchedulerOptions = {
  onError?: (taskId: string, error: unknown) => void;
};

type RegisteredTask = RuntimeScheduledTask & {
  running: Promise<void> | null;
  timer: NodeJS.Timeout | null;
};

/** Runs independent periodic backend tasks without allowing a task to overlap itself. */
export class RuntimeScheduler {
  private readonly tasks = new Map<string, RegisteredTask>();
  private started = false;

  constructor(private readonly options: RuntimeSchedulerOptions = {}) {}

  register(task: RuntimeScheduledTask): void {
    if (this.started) throw new Error('Register runtime tasks before starting the scheduler.');
    if (!task.id.trim()) throw new Error('Runtime task id is required.');
    if (!Number.isFinite(task.intervalMs) || task.intervalMs <= 0) {
      throw new Error(`Runtime task interval must be positive: ${task.id}`);
    }
    if (this.tasks.has(task.id)) throw new Error(`Runtime task is already registered: ${task.id}`);
    this.tasks.set(task.id, { ...task, running: null, timer: null });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const task of this.tasks.values()) {
      if (task.runOnStart) void this.run(task);
      else this.schedule(task);
    }
  }

  stop(): void {
    this.started = false;
    for (const task of this.tasks.values()) {
      if (task.timer) clearTimeout(task.timer);
      task.timer = null;
    }
  }

  private schedule(task: RegisteredTask): void {
    if (!this.started) return;
    task.timer = setTimeout(() => {
      task.timer = null;
      void this.run(task);
    }, task.intervalMs);
  }

  private run(task: RegisteredTask): Promise<void> {
    if (task.running) return task.running;
    const running = Promise.resolve()
      .then(() => task.run())
      .catch((error) => this.options.onError?.(task.id, error))
      .finally(() => {
        if (task.running === running) task.running = null;
        this.schedule(task);
      });
    task.running = running;
    return running;
  }
}
