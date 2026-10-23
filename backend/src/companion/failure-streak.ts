/** Counts consecutive failures so a silent link can be told apart from one bad attempt. */
export class FailureStreak {
  private failures = 0;
  constructor(private readonly limit: number) {}

  /** Records an outcome; true when the streak just reached the limit (and the count restarts). */
  record(ok: boolean): boolean {
    if (ok) { this.failures = 0; return false; }
    if (++this.failures < this.limit) return false;
    this.failures = 0;
    return true;
  }
}
