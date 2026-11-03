/** How long the screen stays awake after the last Computer Use action: agents pause to think between actions, and a locked session cannot be operated. */
export const computerUseHoldMs = 5 * 60_000;

/** Tracks whether Computer Use was recently used, so the Mac is kept unlocked while an agent drives it. */
export class ComputerUseActivity {
  private active = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly holdMs = computerUseHoldMs) {}

  touch(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.set(false);
    }, this.holdMs);
    this.timer.unref?.();
    this.set(true);
  }

  /** Forgets any recorded use, without notifying listeners. */
  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private set(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    for (const listener of this.listeners) listener();
  }
}

export const computerUseActivity = new ComputerUseActivity();
