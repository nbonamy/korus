const baseMs = 1_000;
const capMs = 30_000;
const maxDoublings = 5;

/** Delays between reconnection attempts: 1 s doubling to a 30 s cap, jittered so phones do not retry in step. */
export function createBackoff(random: () => number = Math.random) {
  let attempts = 0;
  return {
    next: () => Math.min(capMs, baseMs * 2 ** Math.min(attempts++, maxDoublings)) * (0.8 + random() * 0.4),
    reset: () => { attempts = 0; },
  };
}
