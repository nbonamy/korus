import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
export type MonitorInput = {
  name: string;
  command: string;
  delivery: 'progressive' | 'onCompletion';
  timeoutSeconds: number;
};
export type MonitorEvent = {
  id: string;
  name: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'timedOut';
  stdout: string;
  stderr: string;
  truncated: boolean;
  exitCode?: number | null;
};
type Run = MonitorEvent & {
  owner: string;
  child: ChildProcess;
  timer: ReturnType<typeof setTimeout>;
  batch?: ReturnType<typeof setTimeout>;
  pending?: MonitorEvent;
  closed: Promise<void>;
  mode: MonitorInput['delivery'];
};
/** Commands are session-owned: they are never restarted after daemon shutdown or Stop. */
export class MonitorManager {
  private readonly runs = new Map<string, Run>();
  private readonly flushing = new Set<string>();
  private closed = false;
  constructor(
    private readonly deliver: (
      owner: string,
      event: MonitorEvent,
    ) => Promise<boolean>,
  ) {}
  list(owner: string): MonitorEvent[] {
    return [...this.runs.values()]
      .filter((run) => run.owner === owner)
      .map((run) => this.event(run));
  }
  start(owner: string, cwd: string, input: MonitorInput): MonitorEvent {
    if (this.closed) throw new Error('Monitor service is closed.');
    if (
      !input.command.trim() ||
      !input.name.trim() ||
      !Number.isFinite(input.timeoutSeconds) ||
      input.timeoutSeconds <= 0 ||
      input.timeoutSeconds > 86400
    )
      throw new Error('Invalid monitor command, name or timeout.');
    const active = [...this.runs.values()].filter(
      (run) => run.state === 'running',
    );
    if (
      active.length >= 64 ||
      active.filter((run) => run.owner === owner).length >= 8
    )
      throw new Error('Monitor limit reached. Stop an existing monitor first.');
    for (const [id, run] of this.runs)
      if (this.runs.size >= 256 && run.state !== 'running' && !run.pending)
        this.runs.delete(id);
    if (this.runs.size >= 256) throw new Error('Monitor history is full.');
    const child = spawn(input.command, {
      cwd,
      shell: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let resolveClosed!: () => void;
    const run: Run = {
      id: randomUUID(),
      name: input.name,
      state: 'running',
      stdout: '',
      stderr: '',
      truncated: false,
      owner,
      child,
      mode: input.delivery,
      timer: setTimeout(() => {
        if (run.state === 'running') {
          run.state = 'timedOut';
          this.kill(run);
        }
      }, input.timeoutSeconds * 1000),
      closed: new Promise((resolve) => {
        resolveClosed = resolve;
      }),
    };
    run.timer.unref();
    this.runs.set(run.id, run);
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    const append = (stream: 'stdout' | 'stderr', chunk: string) => {
      const limit = stream === 'stdout' ? 65536 : 8192;
      const text = run[stream] + chunk;
      run.truncated ||= text.length > limit;
      run[stream] = text.slice(-limit);
      if (
        run.mode === 'progressive' &&
        stream === 'stdout' &&
        chunk.length > 0 &&
        !run.batch &&
        run.state === 'running'
      ) {
        run.batch = setTimeout(() => {
          run.batch = undefined;
          if (run.state === 'running') {
            this.enqueue(run, this.event(run));
            run.stdout = '';
            void this.flush(owner);
          }
        }, 500);
        run.batch.unref();
      }
    };
    child.stdout!.on('data', (chunk: string) => append('stdout', chunk));
    child.stderr!.on('data', (chunk: string) => append('stderr', chunk));
    child.on('error', (error) => append('stderr', error.message));
    child.on('close', (code) => {
      clearTimeout(run.timer);
      clearTimeout(run.batch);
      if (run.state === 'running')
        run.state = code === 0 ? 'completed' : 'failed';
      run.exitCode = code;
      this.kill(run);
      if (run.state !== 'cancelled' && !this.closed) {
        this.enqueue(run, this.event(run));
        void this.flush(owner);
      }
      resolveClosed();
    });
    return this.event(run);
  }
  stop(owner: string, id: string): MonitorEvent {
    const run = this.runs.get(id);
    if (!run || run.owner !== owner) throw new Error('Monitor not found.');
    run.pending = undefined;
    clearTimeout(run.batch);
    if (run.state === 'running' || run.state === 'timedOut') {
      run.state = 'cancelled';
      clearTimeout(run.timer);
      this.kill(run);
    }
    return this.event(run);
  }
  stopOwner(owner: string): void {
    for (const run of this.runs.values())
      if (run.owner === owner) this.stop(owner, run.id);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const run of this.runs.values()) this.stop(run.owner, run.id);
    await Promise.all([...this.runs.values()].map((run) => run.closed));
  }
  async flush(owner: string): Promise<void> {
    if (this.closed || this.flushing.has(owner)) return;
    this.flushing.add(owner);
    let again = false;
    try {
      for (const run of this.runs.values())
        if (run.owner === owner && run.pending) {
          const event = run.pending;
          let accepted = false;
          try {
            accepted = await this.deliver(owner, event);
          } catch {
            /* Retain events until the owner can receive them. */
          }
          if (accepted && run.pending === event) run.pending = undefined;
          else if (run.pending && run.pending !== event) again = true;
        }
    } finally {
      this.flushing.delete(owner);
      if (again) queueMicrotask(() => void this.flush(owner));
    }
  }
  private event(run: MonitorEvent): MonitorEvent {
    return {
      id: run.id,
      name: run.name,
      state: run.state,
      stdout: run.stdout,
      stderr: run.stderr,
      truncated: run.truncated,
      ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}),
    };
  }
  private enqueue(run: Run, event: MonitorEvent): void {
    if (run.pending) {
      const combined = run.pending.stdout + event.stdout;
      event.stdout = combined.slice(-65536);
      event.truncated ||= run.pending.truncated || combined.length > 65536;
    }
    run.pending = event;
  }
  private kill(run: Run): void {
    try {
      if (process.platform === 'win32')
        spawn('taskkill', ['/pid', String(run.child.pid), '/T', '/F'], {
          stdio: 'ignore',
        }).on('error', () => {});
      else if (run.child.pid) process.kill(-run.child.pid, 'SIGKILL');
    } catch {
      /* Already exited. */
    }
  }
}
