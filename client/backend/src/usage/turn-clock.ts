type Turn = {
  start: number;
  pausedAt: number | null;
  paused: number;
  first: number | null;
  /** The agent is waiting on the user (approval, question). */
  waiting: boolean;
  /** Tool calls in flight; parallel calls pause the clock once, until the last one ends. */
  tools: Set<string>;
};
/**
 * Measures how long a turn really worked, independent of the provider driver:
 * the clock starts when the prompt is submitted, stops while the agent waits on the
 * user or on tools, and notes the first generated output.
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
        tools: new Set(),
      });
  }
  /** Blocked on the user. */
  wait(agentId: string, waiting: boolean): void {
    const turn = this.turns.get(agentId);
    if (turn) {
      turn.waiting = waiting;
      this.sync(turn);
    }
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
    turn.waiting = false; // Output proves the user is not being waited on.
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
    const blocked = turn.waiting || turn.tools.size > 0;
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
