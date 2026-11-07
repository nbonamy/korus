type Turn = {
  start: number;
  pausedAt: number | null;
  paused: number;
  first: number | null;
  /** The agent is waiting on the user (approval, question). */
  waiting: boolean;
  userWaitAt: number | null;
  userWaitMs: number;
  /** Tool calls in flight; parallel calls pause the clock once, until the last one ends. */
  tools: Set<string>;
  generating: boolean;
};
/**
 * Tracks task duration and throughput from prompt submission. Task duration excludes
 * only explicit user waits; throughput also excludes tool waits and notes first output.
 */
export class TurnClock {
  private readonly turns = new Map<string, Turn>();
  constructor(private readonly now: () => number = () => performance.now()) {}
  start(agentId: string, at = this.now()): void {
    if (!this.turns.has(agentId))
      this.turns.set(agentId, {
        start: at,
        pausedAt: null,
        paused: 0,
        first: null,
        waiting: false,
        userWaitAt: null,
        userWaitMs: 0,
        tools: new Set(),
        generating: false,
      });
  }
  /** A response can still generate thinking or tool arguments while tool rows already exist. */
  generation(agentId: string, running: boolean): void {
    const turn = this.turns.get(agentId);
    if (!turn) return;
    turn.generating = running;
    this.sync(turn);
  }
  /** Blocked on the user. */
  wait(agentId: string, waiting: boolean): void {
    const turn = this.turns.get(agentId);
    if (turn) {
      if (waiting && turn.userWaitAt === null) turn.userWaitAt = this.now();
      else if (!waiting && turn.userWaitAt !== null) {
        turn.userWaitMs += this.now() - turn.userWaitAt;
        turn.userWaitAt = null;
      }
      turn.waiting = waiting;
      this.sync(turn);
    }
  }
  /** Task time includes tools; only an explicit end of the user wait resumes it. */
  taskDurationMs(agentId: string): number | null {
    const turn = this.turns.get(agentId);
    if (!turn) return null;
    const end = this.now();
    const pendingWait = turn.userWaitAt === null ? 0 : end - turn.userWaitAt;
    return Math.max(0, Math.round(end - turn.start - turn.userWaitMs - pendingWait));
  }
  /** A tool call started or ended; its id makes repeated events harmless. */
  tool(agentId: string, id: string, running: boolean): void {
    const turn = this.turns.get(agentId);
    if (!turn) return;
    if (running) turn.tools.add(id);
    else turn.tools.delete(id);
    this.sync(turn);
  }
  /** Time to first output is the working time elapsed when output first appears. */
  output(agentId: string): void {
    const turn = this.turns.get(agentId);
    if (!turn || turn.first !== null) return;
    turn.waiting = false; // Throughput resumes when output proves generation is active.
    this.sync(turn);
    turn.first = this.working(turn);
  }
  /** Ends the turn and returns whole milliseconds, or null when it was never measured. */
  finish(agentId: string): { activeMs: number; ttftMs: number | null } | null {
    const turn = this.turns.get(agentId);
    this.turns.delete(agentId);
    if (!turn) return null;
    const activeMs = Math.round(this.working(turn));
    if (activeMs <= 0) return null;
    return {
      activeMs,
      ttftMs:
        turn.first === null ? null : Math.min(activeMs, Math.round(turn.first)),
    };
  }
  private sync(turn: Turn): void {
    const blocked = turn.waiting || (turn.tools.size > 0 && !turn.generating);
    if (blocked && turn.pausedAt === null) turn.pausedAt = this.now();
    else if (!blocked && turn.pausedAt !== null) {
      turn.paused += this.now() - turn.pausedAt;
      turn.pausedAt = null;
    }
  }
  private working(turn: Turn): number {
    return (turn.pausedAt ?? this.now()) - turn.start - turn.paused;
  }
}
